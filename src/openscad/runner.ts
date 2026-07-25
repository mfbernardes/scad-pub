// runner.ts — main-thread client for the OpenSCAD render worker. Latest-wins:
// because callMain is blocking and cannot be interrupted in-place, a render that
// supersedes one still in flight cancels it by terminating and respawning the
// worker (the superseded promise rejects with SupersededError).
//
// Two-tier render cache: an in-memory LRU (L1, this file) in front of an
// optional persistent IndexedDB store (L2, stlCache.ts). A render checks L1,
// then L2, then the worker; a successful worker render is written back to both.
// Both tiers share one content-stable key (design + sorted defines + user-file
// signature + CACHE_VERSION), so hits survive reloads.
import { CACHE_VERSION, MB, createStlCache } from "../lib/stlCache";
import type { StlCacheStore, StoredStl } from "../lib/stlCache";
import type { RenderRequest, RenderResult, WorkerProgress } from "./types";
import { detectMountCollisions } from "./renderArgs";

// M10: a user file set that sanitizes to a colliding mount path (see
// detectMountCollisions) is a request-shape error, not a render outcome — it's
// rejected before touching either cache tier or the worker, so the caller
// finds out immediately which raw names collided rather than getting a render
// of whichever one happened to mount last.
export class MountCollisionError extends Error {
  readonly collisions: Record<string, string[]>;
  constructor(collisions: Record<string, string[]>) {
    const detail = Object.entries(collisions)
      .map(([mount, names]) => `${mount} <- ${names.join(", ")}`)
      .join("; ");
    super(`user files collide after sanitizing to the same mount path: ${detail}`);
    this.name = "MountCollisionError";
    this.collisions = collisions;
  }
}

export class SupersededError extends Error {
  constructor() {
    super("render superseded");
    this.name = "SupersededError";
  }
}

interface Pending {
  resolve: (r: RenderResult) => void;
  reject: (e: unknown) => void;
}

const DEFAULT_CACHE_SIZE = 16;

interface CacheOptions {
  maxEntries: number;
  maxBytes: number;
  maxEntryBytes: number;
}

function deviceMemoryGiB(): number | undefined {
  const nav = globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined;
  return typeof nav?.deviceMemory === "number" ? nav.deviceMemory : undefined;
}

function defaultCacheBudgetBytes(): number {
  const gb = deviceMemoryGiB();
  if (gb === undefined) return 64 * MB;
  return Math.min(Math.max(gb * 1024 * MB * 0.1, 32 * MB), 192 * MB);
}

function defaultCacheOptions(opts: {
  cacheSize?: number;
  cacheBytes?: number;
  maxCacheEntryBytes?: number;
}): CacheOptions {
  const finiteOr = (n: number | undefined, fallback: number) =>
    typeof n === "number" && Number.isFinite(n) ? n : fallback;
  const maxEntries = Math.max(0, Math.floor(finiteOr(opts.cacheSize, DEFAULT_CACHE_SIZE)));
  const maxBytes = Math.max(0, finiteOr(opts.cacheBytes, defaultCacheBudgetBytes()));
  const maxEntryBytes = Math.max(
    0,
    finiteOr(opts.maxCacheEntryBytes, Math.min(Math.floor(maxBytes / 2), 64 * MB))
  );
  return { maxEntries, maxBytes, maxEntryBytes };
}

function hasFiles(files: RenderRequest["userFiles"]): files is Record<string, Uint8Array> {
  return Object.keys(files ?? {}).length > 0;
}

// M10: FNV-1a-64 (BigInt), one pass over the bytes. `seed` lets the same byte
// stream produce two statistically-independent 64-bit outputs cheaply (see
// strongDigest) instead of one 32-bit output — the review reproduced an actual
// same-name/same-length collision against the previous 32-bit FNV-1a, which a
// 64-bit (let alone combined 128-bit-equivalent) space makes practically
// unreachable for a same-length forged collision.
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

function fnv1a64(bytes: Uint8Array, seed: bigint): string {
  let h = seed;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * FNV64_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, "0");
}

// A strong, SYNCHRONOUS per-file digest: two independent FNV-1a-64 passes
// (different seeds) concatenated into a 128-bit-equivalent hex string.
// crypto.subtle.digest (SHA-256) is async, which would break the synchronous
// `fileSignature` contract useRenderPipeline.ts's renderKey useMemo relies on
// (`useMemo(() => fileSignature(userFiles), [userFiles])`) — staying
// synchronous keeps that call site unchanged while making a same-length
// collision astronomically less likely than the previous single 32-bit pass.
function strongDigest(bytes: Uint8Array): string {
  return fnv1a64(bytes, 0xcbf29ce484222325n) + fnv1a64(bytes, 0x84222325cbf29ce4n);
}

// M10: NOT memoized by object identity — a caller that mutates a Uint8Array's
// bytes in place (rather than supplying a new object, the app's normal
// pattern — see useFileImports.ts) must still be detected as a different file
// set on the next render(); recomputing the digest fresh each call is what
// makes that possible (see the "mutate in place" runner.test.mjs case). Files
// are typically small (fonts/SVGs/data — KBs, not MBs), so a full re-hash per
// render stays cheap; the actually expensive part this finding also calls
// out — retransmitting unchanged bytes to the worker on every render — is
// addressed separately in OpenSCADRunner.render() by only including
// `userFiles` in the postMessage payload when this signature has changed
// since the last message a given worker instance received.
export function fileSignature(files: RenderRequest["userFiles"]): string {
  if (!hasFiles(files)) return "";
  return JSON.stringify(
    Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, bytes]) => [name, bytes.byteLength, strongDigest(bytes)])
  );
}

// Content-stable cache key shared by both tiers. The user-file signature (not an
// ephemeral session counter) is baked in so the key reproduces across reloads:
// changing files simply yields a different key, and stale entries age out via
// LRU instead of needing an explicit cache wipe. `version` carries the build's
// renderHash, so a deploy that changes any render input invalidates old entries.
function cacheKey(req: Omit<RenderRequest, "id">, version: string): string {
  const defines = Object.fromEntries(Object.entries(req.defines).sort());
  return JSON.stringify({ v: version, design: req.design, defines, files: fileSignature(req.userFiles) });
}

function cloneResult(result: RenderResult, id: number): RenderResult {
  return { ...result, id, stl: new Uint8Array(result.stl), log: [...result.log] };
}

export class OpenSCADRunner {
  private worker!: Worker;
  private nextId = 1;
  // Id of the most recent render(); a render whose id is no longer the latest
  // when its async L2 lookup resolves has been superseded.
  private latestId = 0;
  private disposed = false;
  private pending = new Map<number, Pending>();
  private inflightId: number | null = null;
  private inflightKey: string | null = null;
  private readonly cache = new Map<string, RenderResult>();
  private readonly cacheOptions: CacheOptions;
  private cacheBytes = 0;
  private readonly version: string;
  private readonly store?: StlCacheStore;
  private readonly onReady?: () => void;
  // Forwards the worker's bootstrap-download progress (see worker.ts's
  // cachedBufferWithProgress). Suppressed once `readyFired` is set (below) —
  // a late/stale message from a respawned worker (spawn() resets bootstrap,
  // which typically hits Cache Storage and posts nothing, but isn't
  // guaranteed to) must never resurrect the pre-ready loading UI after the
  // app has already moved on.
  private readonly onProgress?: (p: WorkerProgress) => void;
  private readyFired = false;
  private workerFailed = false;
  // M10: the user-file signature last actually POSTED to the current worker
  // instance (as opposed to served from a cache tier without ever reaching
  // the worker). null after spawn() — a fresh worker's module scope starts
  // with no mounted user files, so the first post to it must always include
  // them regardless of what a previous (now-terminated) worker last saw.
  private lastSentFileSig: string | null = null;

  constructor(
    opts: {
      onReady?: () => void;
      /** Forwarded the worker's bootstrap-download progress (see WorkerProgress).
       *  Never called after onReady has fired once — see the field's own doc. */
      onProgress?: (p: WorkerProgress) => void;
      cacheSize?: number;
      cacheBytes?: number;
      maxCacheEntryBytes?: number;
      /** Persist renders to IndexedDB (L2). Default on where IndexedDB exists. */
      persistentCache?: boolean;
      /** Build content hash (schema.renderHash); namespaces both cache tiers. */
      cacheVersion?: string;
      /** Inject a persistent store (tests); overrides the IndexedDB default. */
      store?: StlCacheStore;
    } = {}
  ) {
    this.onReady = opts.onReady;
    this.onProgress = opts.onProgress;
    this.cacheOptions = defaultCacheOptions(opts);
    // Combine the manual cache-format version with the build's renderHash.
    this.version = `${CACHE_VERSION}:${opts.cacheVersion ?? ""}`;
    this.store =
      opts.store ??
      (opts.persistentCache === false || typeof indexedDB === "undefined"
        ? undefined
        : createStlCache({ version: this.version }));
    this.spawn();
  }

  private deleteCached(key: string): boolean {
    const cached = this.cache.get(key);
    if (!cached) return false;
    this.cacheBytes -= cached.stl.byteLength;
    this.cache.delete(key);
    return true;
  }

  private clearMemoryCache() {
    this.cache.clear();
    this.cacheBytes = 0;
  }

  /**
   * Drop every cached render — the in-memory LRU (L1) and the persistent store
   * (L2). Used when the set of user files changes (import/clear), so previously
   * rendered geometry can't be served and the persisted cache doesn't accrete
   * entries for file sets that no longer exist.
   */
  clearCache(): void {
    this.clearMemoryCache();
    void this.store?.clear();
  }

  private remember(key: string, result: RenderResult) {
    const bytes = result.stl.byteLength;
    if (
      !result.ok ||
      this.cacheOptions.maxEntries <= 0 ||
      this.cacheOptions.maxBytes <= 0 ||
      bytes > this.cacheOptions.maxEntryBytes ||
      bytes > this.cacheOptions.maxBytes
    )
      return;

    this.deleteCached(key);
    this.cache.set(key, cloneResult(result, result.id));
    this.cacheBytes += bytes;
    while (
      this.cache.size > this.cacheOptions.maxEntries ||
      this.cacheBytes > this.cacheOptions.maxBytes
    ) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.deleteCached(oldest);
    }
  }

  private spawn() {
    this.workerFailed = false;
    // M10: a fresh worker's module scope holds no mounted user files (see
    // worker.ts's `cachedUserFiles`), so whatever this runner last sent to a
    // now-terminated worker is irrelevant — the next render() must send the
    // full current file set again, not skip it as "unchanged".
    this.lastSentFileSig = null;
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker = worker;
    worker.onerror = (e: ErrorEvent) => {
      if (this.worker !== worker) return;
      e.preventDefault();
      this.failInflight(new Error(e.message || "render worker error"));
    };
    worker.onmessageerror = () => {
      if (this.worker !== worker) return;
      this.failInflight(new Error("render worker message error"));
    };
    worker.onmessage = (e: MessageEvent) => {
      if (this.worker !== worker) return;
      const data = e.data as RenderResult | { type: "ready" } | WorkerProgress;
      if ("type" in data && data.type === "progress") {
        // Suppressed once ready has fired — see onProgress's doc comment.
        if (!this.readyFired) this.onProgress?.(data);
        return;
      }
      if ("type" in data && data.type === "ready") {
        // The renderer fires this once per worker; surface it only the first time.
        if (!this.readyFired) {
          this.readyFired = true;
          this.onReady?.();
        }
        return;
      }
      const result = data as RenderResult;
      const p = this.pending.get(result.id);
      if (p) {
        this.pending.delete(result.id);
        if (this.inflightId === result.id) {
          // M10/H3: a fatal bootstrap failure throws inside the worker's
          // ensureAssets(), BEFORE it records this request's userFiles into its
          // cross-render cache (worker.ts only stores them once bootstrap
          // succeeds). We already marked that file set as "sent" optimistically
          // when we posted it, and this worker is reused for the retry (a fatal
          // result arrives as a normal message, not onerror, so spawn() never
          // runs and lastSentFileSig is retained). Forget the sent signature so
          // the next render resends the full file set — otherwise the retry
          // omits the unchanged bytes and the worker mounts nothing, producing
          // (and caching) wrong geometry under a key that claims those files
          // were present.
          if (result.fatal) this.lastSentFileSig = null;
          if (this.inflightKey) {
            this.remember(this.inflightKey, result); // L1
            // M11: staleDefines is correctness-relevant (it's what tells the
            // UI "reload — this build is skewed relative to the design
            // source"), so it must survive an L2 round-trip exactly like every
            // other field here; omitting it would let a later reload serve a
            // skewed successful result with no reload warning attached.
            if (this.store && result.ok)
              void this.store.put(this.inflightKey, {
                stl: result.stl,
                log: result.log,
                exitCode: result.exitCode,
                ms: result.ms,
                ...(result.staleDefines?.length ? { staleDefines: result.staleDefines } : {}),
              }); // L2, write-through (serialized by the store itself — see stlCache.ts)
          }
          this.inflightId = null;
          this.inflightKey = null;
        }
        p.resolve(result);
      }
    };
  }

  private rejectInflight(error: unknown) {
    if (this.inflightId === null) return;
    const p = this.pending.get(this.inflightId);
    this.pending.delete(this.inflightId);
    this.inflightId = null;
    this.inflightKey = null;
    p?.reject(error);
  }

  private cancelInflight() {
    this.rejectInflight(new SupersededError());
    this.worker.terminate();
    this.spawn();
  }

  private failInflight(error: Error) {
    this.workerFailed = true;
    this.rejectInflight(error);
    this.worker.terminate();
  }

  async render(req: Omit<RenderRequest, "id">): Promise<RenderResult> {
    // M10: reject a colliding user-file set up front — before it can consume
    // an id, touch either cache tier, or reach the worker — so the caller
    // finds out immediately which raw names collided. (worker.ts carries a
    // defense-in-depth copy of this same check, since it's the actual
    // mounting authority; this one gives faster, richer feedback without a
    // worker round-trip.)
    const collisions = detectMountCollisions(req.userFiles);
    if (Object.keys(collisions).length > 0) throw new MountCollisionError(collisions);

    const id = this.nextId++;
    this.latestId = id;
    const key = cacheKey(req, this.version);
    // Latest-wins means every new render request supersedes the current one,
    // even if the new result can be served from a cache.
    if (this.inflightId !== null) this.cancelInflight();

    // L1: in-memory LRU (synchronous — no await before the worker post when
    // there's no L2 store, so the latest-wins/timing contract is unchanged).
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return { ...cloneResult(cached, id), cached: true };
    }

    // L2: persistent store. The lookup is async, so a newer render() can land
    // while we await it — the latestId guard rejects this one if so.
    if (this.store) {
      let stored: StoredStl | undefined;
      try {
        stored = await this.store.get(key);
      } catch {
        stored = undefined;
      }
      if (this.disposed || this.latestId !== id) throw new SupersededError();
      if (stored) {
        const result: RenderResult = {
          id,
          ok: true,
          exitCode: stored.exitCode,
          stl: stored.stl, // owned by this call (store.get returns a fresh copy)
          log: stored.log,
          ms: stored.ms,
          cached: true,
          // M11: reconstruct staleDefines from the persisted record (see the
          // matching write-through above) so a skewed result served from L2
          // still carries the reload prompt it had when first rendered.
          ...(stored.staleDefines?.length ? { staleDefines: stored.staleDefines } : {}),
        };
        this.remember(key, result); // promote into L1
        return result;
      }
    }

    if (this.workerFailed) this.spawn();

    this.inflightId = id;
    this.inflightKey = key;
    // M10: only include `userFiles` in the postMessage payload when the file
    // set has changed since the last message THIS worker instance received —
    // worker.ts retains the last-mounted set across renders (its module scope
    // survives even though it instantiates a fresh WASM module per render),
    // so re-sending unchanged bytes (a full structured-clone copy) on every
    // param-only render is pure waste. spawn() resets lastSentFileSig to null,
    // so a fresh worker (which starts with no mounted files) always gets a
    // full send regardless of what a previous worker last saw.
    const fileSig = fileSignature(req.userFiles);
    const filesUnchanged = fileSig === this.lastSentFileSig;
    const payload: RenderRequest = { ...req, id };
    if (filesUnchanged) delete payload.userFiles;
    else this.lastSentFileSig = fileSig;
    return new Promise<RenderResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(payload);
    });
  }

  dispose() {
    this.disposed = true;
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new SupersededError());
    this.pending.clear();
    this.clearMemoryCache();
    this.inflightId = null;
    this.inflightKey = null;
  }
}
