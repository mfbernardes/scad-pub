// Tests the render worker's pure binary-cache helpers (src/openscad/binCache.ts):
// the version-keyed Cache Storage name and the stale-cache eviction predicate.
// These run in the real worker (worker.ts) but were unreachable from `npm test`
// until they were extracted. Getting the predicate wrong would delete the
// in-use cache or leak stale ~10 MB binaries across deploys, so it's worth pinning.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BIN_CACHE_PREFIX,
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

test("staleBinaryCaches selects every old binary cache except the current one", () => {
  const current = binCacheName("2027.01.01");
  const keys = [
    binCacheName("2026.06.12"),
    binCacheName("2026.12.01"),
    current,
  ];
  assert.deepEqual(staleBinaryCaches(keys, current), [
    "openscad-wasm-bin-2026.06.12",
    "openscad-wasm-bin-2026.12.01",
  ]);
});

test("staleBinaryCaches never deletes the in-use cache", () => {
  const current = "openscad-wasm-bin-2026.06.12";
  assert.deepEqual(staleBinaryCaches([current], current), []);
});

test("staleBinaryCaches leaves non-binary caches untouched", () => {
  const current = binCacheName("2026.06.12");
  const keys = [
    "scadpub-shell-v3", // the service worker's shell cache
    "some-other-app", // an unrelated cache on the same origin
    binCacheName("2025.01.01"), // a genuinely stale binary cache
    current,
  ];
  // Only the stale openscad-wasm-bin-* entry is returned; the SW shell and the
  // unrelated cache are not ours to delete.
  assert.deepEqual(staleBinaryCaches(keys, current), ["openscad-wasm-bin-2025.01.01"]);
});
