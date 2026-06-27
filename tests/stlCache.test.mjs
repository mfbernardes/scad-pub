// Tests the real persistent L2 render cache (src/lib/stlCache.ts) against an
// in-memory IndexedDB (fake-indexeddb). The runner tests use a hand-written
// store stand-in, so the actual IndexedDB logic — version-on-change wipe, the
// byte-budget LRU eviction, the entry-size cap and clear() — lives only here.
import "fake-indexeddb/auto";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { createStlCache } = await import("../src/lib/stlCache.ts");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const entry = (n, over = {}) => ({
  stl: new Uint8Array(n),
  log: ["ok"],
  exitCode: 0,
  ms: 1,
  ...over,
});

// Each test uses a unique version string. createStlCache wipes the whole DB the
// first time it sees a version it didn't stamp, so a fresh version per test
// isolates it from the previous one without any cross-test teardown.
let v = 0;
let version;
beforeEach(() => {
  version = `test-${v++}`;
});

test("a stored render round-trips through IndexedDB", async () => {
  const cache = createStlCache({ version });
  await cache.put("k", entry(8, { exitCode: 0, ms: 42, log: ["a", "b"] }));
  const got = await cache.get("k");
  assert.ok(got);
  assert.equal(got.stl.byteLength, 8);
  assert.equal(got.exitCode, 0);
  assert.equal(got.ms, 42);
  assert.deepEqual(got.log, ["a", "b"]);
  // get returns a fresh copy, not a view aliased to the stored buffer.
  got.stl[0] = 9;
  assert.equal((await cache.get("k")).stl[0], 0);
});

test("a missing key resolves to undefined", async () => {
  const cache = createStlCache({ version });
  assert.equal(await cache.get("nope"), undefined);
});

test("a new version wipes entries written under the old one", async () => {
  const a = createStlCache({ version: `${version}-old` });
  await a.put("k", entry(8));
  assert.ok(await a.get("k"));
  // A different build (new version) must not serve stale geometry, and reclaims
  // the space by clearing the store on first access.
  const b = createStlCache({ version: `${version}-new` });
  assert.equal(await b.get("k"), undefined);
});

test("entries larger than maxEntryBytes are not stored", async () => {
  const cache = createStlCache({ version, maxBytes: 1000, maxEntryBytes: 10 });
  await cache.put("big", entry(50));
  assert.equal(await cache.get("big"), undefined);
  await cache.put("ok", entry(8));
  assert.ok(await cache.get("ok"));
});

test("putting past the byte budget evicts to make room", async () => {
  // Budget fits one 6-byte payload at a time; the second put must evict the first.
  const cache = createStlCache({ version, maxBytes: 10, maxEntryBytes: 10 });
  await cache.put("a", entry(6));
  await cache.put("b", entry(6));
  assert.equal(await cache.get("a"), undefined, "a evicted to fit b");
  assert.ok(await cache.get("b"), "b retained");
});

test("eviction drops the least-recently-used entry first", async () => {
  // Budget holds two 6-byte payloads. Touch `a` (via get) so `b` is the LRU,
  // then insert `c`: `b` should be evicted, `a` and `c` kept.
  const cache = createStlCache({ version, maxBytes: 12, maxEntryBytes: 10 });
  await cache.put("a", entry(6));
  await delay(3);
  await cache.put("b", entry(6));
  await delay(3);
  await cache.get("a"); // bump a's recency above b
  await delay(3);
  await cache.put("c", entry(6));
  assert.ok(await cache.get("a"), "a kept (recently used)");
  assert.equal(await cache.get("b"), undefined, "b evicted (LRU)");
  assert.ok(await cache.get("c"), "c kept (newest)");
});

test("clear() drops all entries", async () => {
  const cache = createStlCache({ version });
  await cache.put("k", entry(8));
  assert.ok(await cache.get("k"));
  await cache.clear();
  assert.equal(await cache.get("k"), undefined);
});
