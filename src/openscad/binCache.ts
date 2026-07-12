// binCache.ts — pure naming + eviction logic for the persistent Cache Storage
// entry that holds OpenSCAD's big, version-pinned binaries (the ~10 MB WASM and
// the bundled fonts). Extracted from worker.ts so the version-keyed cache name
// and the "which stale caches to evict" predicate can be unit-tested without a
// Cache Storage / worker environment; the actual caches.open/delete side
// effects stay in worker.ts.

// Every binary cache this app has ever written shares this prefix, so a version
// bump can find and evict its predecessors. Neutral — NOT namespaced per config:
// the WASM binary is identical across deployments, so one shared cache per
// origin avoids re-downloading ~10 MB.
export const BIN_CACHE_PREFIX = "openscad-wasm-bin-";

// Last-resort fallback for a legacy/malformed schema that carries no
// wasmVersion; the normal path is schema.wasmVersion, single-sourced from
// scripts/wasm-version.mjs. That build script can't be imported into worker
// runtime code, so this mirrors its PINNED_WASM_VERSION by hand — bump both
// together when the WASM is re-pinned.
const DEFAULT_WASM_VERSION = "2026.06.12";

// The Cache Storage name for a given pinned OpenSCAD version (single-sourced via
// schema.wasmVersion from scripts/wasm-version.mjs). Folding the version into
// the name means a WASM bump renames the cache, so stale binaries evict
// automatically (see staleBinaryCaches).
export function binCacheName(wasmVersion?: string): string {
  return `${BIN_CACHE_PREFIX}${wasmVersion ?? DEFAULT_WASM_VERSION}`;
}

// H4 (point 3): how many openscad-wasm-bin-* caches to retain at once,
// including the current one. Evicting every OTHER version unconditionally
// (the pre-H4 behavior) meant a second ScadPub deployment/scope sharing this
// origin — pinned to a different wasmVersion, or mid-rollout of a new one —
// could have its offline binaries deleted out from under it by the first
// scope's worker to run cleanupOldCaches(). Retaining a small bounded set
// instead lets a few versions coexist; eviction still bounds total storage
// (each entry is the ~10 MB wasm binary plus bundled fonts) rather than
// growing forever.
export const MAX_RETAINED_BIN_CACHES = 3;

// Of the given Cache Storage keys, the stale binary caches to delete: every
// openscad-wasm-bin-* entry except the current one and up to
// MAX_RETAINED_BIN_CACHES - 1 others (kept in lexical order, which sorts
// pinned OpenSCAD version strings like "2026.06.12" chronologically). Keys
// that aren't one of our binary caches (the service worker's shell cache,
// other apps on the origin) are left untouched.
export function staleBinaryCaches(
  keys: readonly string[],
  current: string,
  retain: number = MAX_RETAINED_BIN_CACHES
): string[] {
  const others = keys.filter((k) => k.startsWith(BIN_CACHE_PREFIX) && k !== current);
  const keepCount = Math.max(0, retain - 1);
  if (keepCount <= 0) return others;
  // Sort ascending, then keep the lexically-last `keepCount` entries — for
  // date-like version strings that keeps the most recent ones.
  const sorted = [...others].sort();
  const kept = new Set(sorted.slice(sorted.length - keepCount));
  return others.filter((k) => !kept.has(k));
}
