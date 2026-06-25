// runner.ts — main-thread client for the OpenSCAD render worker. Latest-wins:
// because callMain is blocking and cannot be interrupted in-place, a render that
// supersedes one still in flight cancels it by terminating and respawning the
// worker (the superseded promise rejects with SupersededError).
//
// Two-tier render cache: an in-memory LRU (L1, this file) in front of an
// optional persistent IndexedDB store (L2, stlCache.ts). A render checks L1,
// then L2, then the worker; a successful worker render is written back to both.
// Both tiers share one content-stable key (design + sorted defines + font
// signature + CACHE_VERSION), so hits survive reloads.
import { CACHE_VERSION, createStlCache } from "../lib/stlCache";
import type { StlCacheStore, StoredStl } from "../lib/stlCache";
import type { RenderRequest, RenderResult } from "./types";

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
const MB = 1024 * 1024;

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

function hasFonts(fonts: RenderRequest["userFonts"]): fonts is Record<string, Uint8Array> {
  return Object.keys(fonts ?? {}).length > 0;
}

export function fontSignature(fonts: RenderRequest["userFonts"]): string {
  if (!hasFonts(fonts)) return "";
  return JSON.stringify(
    Object.entries(fonts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, bytes]) => {
        let h = 0x811c9dc5;
        for (const b of bytes) {
          h ^= b;
          h = Math.imul(h, 0x01000193);
        }
        return [name, bytes.byteLength, h >>> 0];
      })
  );
}

// Content-stable cache key shared by both tiers. The font signature (not an
// ephemeral session counter) is baked in so the key reproduces across reloads:
// changing fonts simply yields a different key, and stale entries age out via
// LRU instead of needing an explicit cache wipe. `version` carries the build's
// renderHash, so a deploy that changes any render input invalidates old entries.
function cacheKey(req: Omit<RenderRequest, "id">, version: string): string {
  const defines = Object.fromEntries(Object.entries(req.defines).sort());
  return JSON.stringify({ v: version, design: req.design, defines, fonts: fontSignature(req.userFonts) });
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
  private readyFired = false;
  private workerFailed = false;

  constructor(
    opts: {
      onReady?: () => void;
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

  private clearCache() {
    this.cache.clear();
    this.cacheBytes = 0;
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
      const data = e.data as RenderResult | { type: "ready" };
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
          if (this.inflightKey) {
            this.remember(this.inflightKey, result); // L1
            if (this.store && result.ok)
              void this.store.put(this.inflightKey, {
                stl: result.stl,
                log: result.log,
                exitCode: result.exitCode,
                ms: result.ms,
              }); // L2, write-through (fire-and-forget)
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
        };
        this.remember(key, result); // promote into L1
        return result;
      }
    }

    if (this.workerFailed) this.spawn();

    this.inflightId = id;
    this.inflightKey = key;
    return new Promise<RenderResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id });
    });
  }

  dispose() {
    this.disposed = true;
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new SupersededError());
    this.pending.clear();
    this.clearCache();
    this.inflightId = null;
    this.inflightKey = null;
  }
}
