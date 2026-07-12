// stlCache.ts — persistent L2 cache for rendered STL, in IndexedDB. The
// in-memory LRU inside OpenSCADRunner is the fast L1 tier in front of this one;
// L2 survives reloads so reopening the page (or revisiting a configuration)
// serves instantly instead of re-running OpenSCAD.
//
// Entries are keyed by a content-stable key built in runner.ts (design + sorted
// defines + font signature + CACHE_VERSION). Payloads live in STL_DATA_STORE;
// small {bytes,lastAccess} records live in STL_META_STORE so LRU eviction can
// scan sizes/recency without deserializing the STL blobs. Every operation is
// best-effort: any failure (private mode, quota, blocked upgrade) degrades to
// L1-only rather than throwing.
import {
  openDb,
  reqToPromise,
  STL_DATA_STORE,
  STL_META_STORE,
  txDone,
} from "./idb";

// Manual base version for the cache format/recipe itself. Render-affecting
// changes are caught automatically by the build's renderHash, which the runner
// combines with this: scad sources, fonts, features and wasm, plus the renderer
// source (worker.ts) whose OpenSCAD flags (--backend / --export-format) gen-schema
// now folds in. Bump this only for changes renderHash can't see — the stored-
// record shape or the keying scheme itself. Imported by the runner.
export const CACHE_VERSION = 1;

export const MB = 1024 * 1024;
const DEFAULT_MAX_BYTES = 256 * MB;
const DEFAULT_MAX_ENTRY_BYTES = 64 * MB;
// M11: cap a record's persisted log independent of the STL byte budget above
// — an unusually chatty render (many ECHO/warning lines) shouldn't be able to
// grow a stored record without limit while its size mostly evades the STL-only
// byte accounting a naive budget would use. Kept generous (a real render log
// is normally a few dozen short lines) but bounded.
const MAX_LOG_CHARS = 20_000;
// Exported so tests can inspect the raw stamp; a leading NUL keeps it out of
// any real STL cache key's namespace.
export const VERSION_KEY = "\0cache-version";

/** The cacheable part of a successful RenderResult. */
export interface StoredStl {
  stl: Uint8Array;
  log: string[];
  exitCode: number;
  ms: number;
  /**
   * M11: correctness-relevant, not just informational — a truthy entry means
   * this result was rendered against parameters the design source no longer
   * fully declares (see orphanedDefines/worker.ts). Must round-trip through
   * the store so a later cache hit still carries the reload prompt the UI
   * showed when the result was first produced.
   */
  staleDefines?: string[];
}

export interface StlCacheStore {
  get(key: string): Promise<StoredStl | undefined>;
  put(key: string, value: StoredStl): Promise<void>;
  /** Drop every cached entry (keeping the version stamp). Best-effort. */
  clear(): Promise<void>;
}

interface DataRecord {
  stl: ArrayBufferLike; // structured-cloned by IndexedDB; copied back out on get
  log: string[];
  exitCode: number;
  ms: number;
  staleDefines?: string[];
}

interface MetaRecord {
  bytes: number;
  lastAccess: number;
}

function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

// M11: cap a log array to at most MAX_LOG_CHARS characters, keeping the most
// RECENT lines (the tail is what a user/debugger cares about — a truncated
// build's earliest ECHOs matter less than its final error) and prefixing a
// marker when anything was dropped, so a persisted record's true byte cost
// stays bounded regardless of how chatty a render was.
function budgetLog(log: readonly string[]): string[] {
  let total = 0;
  const kept: string[] = [];
  for (let i = log.length - 1; i >= 0; i--) {
    const len = log[i].length;
    if (total + len > MAX_LOG_CHARS && kept.length > 0) break;
    kept.unshift(log[i]);
    total += len;
  }
  if (kept.length < log.length)
    kept.unshift(`[truncated ${log.length - kept.length} earlier line(s) for storage]`);
  return kept;
}

// M11: the COMPLETE persisted-record size a budget/eviction decision should
// use — the STL payload plus its (already log-budgeted) text, not STL bytes
// alone. UTF-16 code units are counted as 2 bytes each, a safe upper bound for
// the log's actual storage cost.
function recordBytes(stlBytes: number, log: readonly string[]): number {
  return stlBytes + log.reduce((sum, line) => sum + line.length * 2, 0);
}

// M11: serialize every mutation (put/clear) through one promise chain per
// store instance, so:
//   - a clear() and a put() can never interleave — a write already in flight
//     when clear() is called completes (and is visible) BEFORE clear() runs,
//     or clear() completes fully before a later put() begins. Either way, an
//     older write can never repopulate the store just after a clear.
//   - overlapping put()s never race the same evict-then-write budget check —
//     each one now sees the true post-previous-write state, so the combined
//     effect of several concurrent put() calls can't exceed the byte budget
//     the way two callers each separately observing "under budget" could.
// A failed operation doesn't break the chain for the next one (chained with
// both success/failure continuations).
function createMutationQueue() {
  let chain: Promise<unknown> = Promise.resolve();
  return function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

export function createStlCache(
  opts: { maxBytes?: number; maxEntryBytes?: number; version?: string } = {}
): StlCacheStore {
  const maxBytes = Math.max(0, opts.maxBytes ?? DEFAULT_MAX_BYTES);
  const maxEntryBytes = Math.max(
    0,
    opts.maxEntryBytes ?? Math.min(maxBytes, DEFAULT_MAX_ENTRY_BYTES)
  );
  // Identifies the renderer build; when it changes, every stored entry is stale
  // (the runner also keys by it, so they'd never match) — clear to reclaim space.
  const version = opts.version ?? String(CACHE_VERSION);

  // M11: every mutation (the version-wipe below, put, clear) goes through this
  // one queue so they never interleave — see createMutationQueue's comment.
  const serialize = createMutationQueue();

  // Run the one-time version check at most once; reused by get/put. NOT
  // routed through serialize(): put()/clear() call ensureVersion() from
  // WITHIN their own serialize()'d callback (see below), so queuing
  // checkVersion on that SAME shared chain would deadlock — the inner
  // serialize() call would queue itself after the chain position the outer,
  // still-pending callback already occupies, so neither could ever finish.
  // checkVersion's own memoization (versionChecked) already gives it
  // effectively-once semantics without needing the mutation queue: at most
  // one real checkVersion() runs, and every other caller (concurrent or
  // nested) just awaits that same promise.
  let versionChecked: Promise<void> | undefined;
  function ensureVersion(): Promise<void> {
    if (!versionChecked)
      versionChecked = checkVersion().catch(() => {
        // A transient failure (blocked upgrade, etc.) must not be memoized as
        // done — the next get/put should retry, or a stale-version wipe might
        // never run this session and crowd out current entries.
        versionChecked = undefined;
      });
    return versionChecked;
  }

  async function checkVersion(): Promise<void> {
    const db = await openDb();
    const stored = await reqToPromise<string | undefined>(
      db.transaction(STL_META_STORE, "readonly").objectStore(STL_META_STORE).get(VERSION_KEY)
    );
    if (stored === version) return;
    // First run or a version change: wipe every cached entry, then stamp it.
    const tx = db.transaction([STL_DATA_STORE, STL_META_STORE], "readwrite");
    tx.objectStore(STL_DATA_STORE).clear();
    tx.objectStore(STL_META_STORE).clear();
    tx.objectStore(STL_META_STORE).put(version, VERSION_KEY);
    await txDone(tx);
  }

  async function touch(key: string): Promise<void> {
    try {
      const db = await openDb();
      const store = db.transaction(STL_META_STORE, "readwrite").objectStore(STL_META_STORE);
      const meta = await reqToPromise<MetaRecord | undefined>(store.get(key));
      if (meta) store.put({ ...meta, lastAccess: Date.now() }, key);
    } catch {
      /* a missed LRU touch only affects eviction order — ignore */
    }
  }

  // M11: eviction and the new record's write, in ONE readwrite transaction —
  // previously these were two separate transactions (a read-only scan, a
  // separate delete transaction, then put()'s own write transaction later).
  // Two overlapping put() calls could each read the pre-eviction total,
  // decide independently how much to evict, and both write — jointly
  // exceeding the byte budget even though each individually respected it.
  // Combining them into one transaction (and running every put/clear through
  // the serialize() queue above, so transactions from this store are never
  // concurrent in the first place) removes that race entirely: eviction and
  // the write it made room for either both land or neither does.
  async function evictAndWrite(
    key: string,
    data: DataRecord,
    bytes: number,
    othersTargetBytes: number
  ): Promise<void> {
    const db = await openDb();
    const tx = db.transaction([STL_DATA_STORE, STL_META_STORE], "readwrite");
    const dataStore = tx.objectStore(STL_DATA_STORE);
    const metaStore = tx.objectStore(STL_META_STORE);
    const [keys, values] = await Promise.all([
      reqToPromise(metaStore.getAllKeys()),
      reqToPromise<MetaRecord[]>(metaStore.getAll()),
    ]);
    const entries = (keys as IDBValidKey[])
      .map((k, i) => ({ key: k, ...values[i] }))
      .filter((e) => e.key !== VERSION_KEY && e.key !== key);
    let total = entries.reduce((sum, e) => sum + e.bytes, 0);
    if (total > othersTargetBytes) {
      entries.sort((a, b) => a.lastAccess - b.lastAccess);
      for (const e of entries) {
        if (total <= othersTargetBytes) break;
        dataStore.delete(e.key);
        metaStore.delete(e.key);
        total -= e.bytes;
      }
    }
    dataStore.put(data, key);
    metaStore.put({ bytes, lastAccess: Date.now() }, key);
    await txDone(tx);
  }

  async function get(key: string): Promise<StoredStl | undefined> {
    try {
      await ensureVersion();
      const db = await openDb();
      const rec = await reqToPromise<DataRecord | undefined>(
        db.transaction(STL_DATA_STORE, "readonly").objectStore(STL_DATA_STORE).get(key)
      );
      if (!rec) return undefined;
      void touch(key); // fire-and-forget LRU bump
      return {
        stl: new Uint8Array(rec.stl),
        log: rec.log,
        exitCode: rec.exitCode,
        ms: rec.ms,
        ...(rec.staleDefines?.length ? { staleDefines: rec.staleDefines } : {}),
      };
    } catch {
      return undefined;
    }
  }

  async function put(key: string, value: StoredStl): Promise<void> {
    // M11: budget the COMPLETE record (STL bytes + a capped log), not STL
    // bytes alone — an unbounded log array could otherwise inflate storage
    // past what the byte budget was meant to bound.
    const log = budgetLog(value.log);
    const stlBytes = value.stl.byteLength;
    const bytes = recordBytes(stlBytes, log);
    if (maxBytes <= 0 || bytes > maxEntryBytes || bytes > maxBytes) return;
    // Copy the bytes now, synchronously, into a standalone ArrayBuffer — the
    // source view is shared with the live render result and the writes below
    // are async.
    const buf = value.stl.buffer.slice(value.stl.byteOffset, value.stl.byteOffset + stlBytes);
    const data: DataRecord = {
      stl: buf,
      log,
      exitCode: value.exitCode,
      ms: value.ms,
      // M11: staleDefines must round-trip — a skewed result served later from
      // this record needs to still carry its reload prompt (see StoredStl).
      ...(value.staleDefines?.length ? { staleDefines: value.staleDefines } : {}),
    };

    await serialize(async () => {
      try {
        await ensureVersion();
        try {
          await evictAndWrite(key, data, bytes, maxBytes - bytes); // leave room for the new entry
        } catch (e) {
          if (!isQuotaError(e)) throw e;
          // Quota despite our budget (other origins/stores compete): free half, retry once.
          await evictAndWrite(key, data, bytes, Math.floor(maxBytes / 2));
        }
      } catch {
        /* best-effort: a failed persist just means this stays L1-only */
      }
    });
  }

  async function clear(): Promise<void> {
    await serialize(async () => {
      try {
        const db = await openDb();
        const tx = db.transaction([STL_DATA_STORE, STL_META_STORE], "readwrite");
        tx.objectStore(STL_DATA_STORE).clear();
        tx.objectStore(STL_META_STORE).clear();
        tx.objectStore(STL_META_STORE).put(version, VERSION_KEY); // keep the stamp
        await txDone(tx);
      } catch {
        /* best-effort: leaving stale entries is harmless (keys won't match) */
      }
    });
  }

  return { get, put, clear };
}
