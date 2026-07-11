// Tests the render worker's pure binary-cache helpers (src/openscad/binCache.ts):
// the version-keyed Cache Storage name and the stale-cache eviction predicate.
// These run in the real worker (worker.ts) but were unreachable from `npm test`
// until they were extracted. Getting the predicate wrong would delete the
// in-use cache or leak stale ~10 MB binaries across deploys, so it's worth pinning.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BIN_CACHE_PREFIX,
  MAX_RETAINED_BIN_CACHES,
  binCacheName,
  staleBinaryCaches,
} from "../src/openscad/binCache.ts";

test("binCacheName folds the pinned version into a prefixed name", () => {
  assert.equal(binCacheName("2026.06.12"), "openscad-wasm-bin-2026.06.12");
  assert.equal(binCacheName("2027.01.01"), "openscad-wasm-bin-2027.01.01");
  // Different versions yield different names, so a WASM bump renames the cache.
  assert.notEqual(binCacheName("a"), binCacheName("b"));
});

test("binCacheName falls back to a default pin when no version is given", () => {
  // An older generated bundle may carry no wasmVersion (undefined).
  assert.equal(binCacheName(undefined), "openscad-wasm-bin-2026.06.12");
  assert.ok(binCacheName(undefined).startsWith(BIN_CACHE_PREFIX));
});

test("staleBinaryCaches selects old binary caches beyond the retained bound", () => {
  // Default retain (MAX_RETAINED_BIN_CACHES=3) keeps the current cache plus
  // the 2 lexically-latest others — both of these fit within that bound, so
  // neither is stale (H4 point 3: bounded retention, not blanket eviction).
  const current = binCacheName("2027.01.01");
  const keys = [
    binCacheName("2026.06.12"),
    binCacheName("2026.12.01"),
    current,
  ];
  assert.deepEqual(staleBinaryCaches(keys, current), []);
});

test("staleBinaryCaches deletes everything else when explicitly given retain=1", () => {
  const current = binCacheName("2027.01.01");
  const keys = [
    binCacheName("2026.06.12"),
    binCacheName("2026.12.01"),
    current,
  ];
  assert.deepEqual(staleBinaryCaches(keys, current, 1), [
    "openscad-wasm-bin-2026.06.12",
    "openscad-wasm-bin-2026.12.01",
  ]);
});

test("staleBinaryCaches evicts beyond the bound, keeping the lexically-latest others", () => {
  const current = binCacheName("2027.06.01");
  const keys = [
    binCacheName("2025.01.01"), // oldest — should be evicted
    binCacheName("2026.06.12"),
    binCacheName("2026.12.01"),
    current,
  ];
  // retain=3 -> current + 2 others kept; the oldest of the 3 others is stale.
  assert.deepEqual(staleBinaryCaches(keys, current, 3), ["openscad-wasm-bin-2025.01.01"]);
});

test("staleBinaryCaches never deletes the in-use cache", () => {
  const current = "openscad-wasm-bin-2026.06.12";
  assert.deepEqual(staleBinaryCaches([current], current), []);
  assert.deepEqual(staleBinaryCaches([current], current, 1), []);
});

test("staleBinaryCaches leaves non-binary caches untouched", () => {
  const current = binCacheName("2026.06.12");
  const keys = [
    "scadpub-shell-v3", // the service worker's shell cache
    "some-other-app", // an unrelated cache on the same origin
    binCacheName("2025.01.01"), // a genuinely stale binary cache
    current,
  ];
  // Only the stale openscad-wasm-bin-* entry is returned (retain=1 forces
  // eviction of every other version so this old-behavior-style assertion
  // still exercises the filter); the SW shell and the unrelated cache are not
  // ours to delete regardless of retain.
  assert.deepEqual(staleBinaryCaches(keys, current, 1), ["openscad-wasm-bin-2025.01.01"]);
});

test("MAX_RETAINED_BIN_CACHES is a small positive bound", () => {
  assert.ok(MAX_RETAINED_BIN_CACHES >= 1);
  assert.ok(MAX_RETAINED_BIN_CACHES <= 10);
});
