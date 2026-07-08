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

// Of the given Cache Storage keys, the stale binary caches to delete: every
// openscad-wasm-bin-* entry except the one currently in use. Keys that aren't
// one of our binary caches (the service worker's shell cache, other apps on the
// origin) are left untouched.
export function staleBinaryCaches(keys: readonly string[], current: string): string[] {
  return keys.filter((k) => k.startsWith(BIN_CACHE_PREFIX) && k !== current);
}
