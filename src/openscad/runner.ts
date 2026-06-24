// runner.ts — main-thread client for the OpenSCAD render worker. Latest-wins:
// because callMain is blocking and cannot be interrupted in-place, a render that
// supersedes one still in flight cancels it by terminating and respawning the
// worker (the superseded promise rejects with SupersededError).
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

function cacheKey(req: Omit<RenderRequest, "id">, fontScope: number): string {
  const defines = Object.fromEntries(Object.entries(req.defines).sort());
  return JSON.stringify({ design: req.design, defines, fontScope });
}

function cloneResult(result: RenderResult, id: number): RenderResult {
  return { ...result, id, stl: new Uint8Array(result.stl), log: [...result.log] };
}

export class OpenSCADRunner {
  private worker!: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private inflightId: number | null = null;
  private inflightKey: string | null = null;
  private readonly cache = new Map<string, RenderResult>();
  private readonly cacheOptions: CacheOptions;
  private cacheBytes = 0;
  private fontScope = 0;
  private userFontsSig = "";
  private readonly onReady?: () => void;
  private readyFired = false;
  private workerFailed = false;

  constructor(
    opts: {
      onReady?: () => void;
      cacheSize?: number;
      cacheBytes?: number;
      maxCacheEntryBytes?: number;
    } = {}
  ) {
    this.onReady = opts.onReady;
    this.cacheOptions = defaultCacheOptions(opts);
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

  private syncFontScope(req: Omit<RenderRequest, "id">): number {
    const sig = fontSignature(req.userFonts);
    if (sig !== this.userFontsSig) {
      this.userFontsSig = sig;
      this.fontScope++;
      this.clearCache();
    }
    return this.fontScope;
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
          if (this.inflightKey) this.remember(this.inflightKey, result);
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

  render(req: Omit<RenderRequest, "id">): Promise<RenderResult> {
    const id = this.nextId++;
    const key = cacheKey(req, this.syncFontScope(req));
    // Latest-wins means every new render request supersedes the current one,
    // even if the new result can be served from the cache.
    if (this.inflightId !== null) this.cancelInflight();

    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cloneResult(cached, id));
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
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new SupersededError());
    this.pending.clear();
    this.clearCache();
    this.inflightId = null;
    this.inflightKey = null;
  }
}
