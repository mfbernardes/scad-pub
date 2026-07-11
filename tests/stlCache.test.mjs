// Tests the real persistent L2 render cache (src/lib/stlCache.ts) against an
// in-memory IndexedDB (fake-indexeddb). The runner tests use a hand-written
// store stand-in, so the actual IndexedDB logic — version-on-change wipe, the
// byte-budget LRU eviction, the entry-size cap and clear() — lives only here.
import "fake-indexeddb/auto";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { createStlCache, VERSION_KEY } = await import("../src/lib/stlCache.ts");
const { openDb, reqToPromise, STL_META_STORE } = await import("../src/lib/idb.ts");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
// M11: put() now budgets the COMPLETE record (STL bytes + a capped log), not
// just STL bytes — an empty log here keeps every byte-budget assertion below
// about STL bytes exactly as it was before that change; log-byte accounting
// itself is covered by its own dedicated tests further down.
const entry = (n, over = {}) => ({
  stl: new Uint8Array(n),
  log: [],
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

// Must run before any other test in this file touches IndexedDB: idb.ts
// memoizes its DB connection at module scope, so once it has resolved once,
// nothing here can force indexedDB.open() to be called again to exercise this
// failure path (short of a real versionchange/close, which fake-indexeddb
// doesn't trigger for us). Runs first so the very first open is the one that
// fails.
test("a transient version-check failure is retried by a later operation, not stuck forever", async () => {
  // Simulate one transient IndexedDB failure (e.g. a blocked upgrade) on the
  // very first open this process makes, then let opens succeed normally.
  const realOpen = indexedDB.open.bind(indexedDB);
  let failNext = true;
  indexedDB.open = (...args) => {
    if (!failNext) return realOpen(...args);
    failNext = false;
    const req = {};
    queueMicrotask(() => {
      req.error = new Error("simulated transient IndexedDB failure");
      req.onerror?.();
    });
    return req;
  };

  const cache = createStlCache({ version });
  try {
    // First operation: the simulated open failure aborts the version check
    // before it can stamp anything; best-effort semantics swallow it (get/put
    // themselves still work via a fresh, successful openDb() retry).
    assert.equal(await cache.get("nope"), undefined);
    // A later operation must retry the version check rather than treating the
    // earlier failure as permanently done.
    await cache.put("k", entry(8));
    assert.ok(await cache.get("k"));
    // Prove the version check actually completed (not just that get/put
    // worked): the version stamp must be persisted, which only happens once
    // checkVersion() runs to completion.
    const db = await openDb();
    const stored = await reqToPromise(
      db.transaction(STL_META_STORE, "readonly").objectStore(STL_META_STORE).get(VERSION_KEY)
    );
    assert.equal(stored, version);
  } finally {
    indexedDB.open = realOpen;
  }
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

// ---- M11: staleDefines round-trip ----

test("staleDefines round-trips through IndexedDB", async () => {
  const cache = createStlCache({ version });
  await cache.put("k", entry(8, { staleDefines: ["oldParam", "otherParam"] }));
  const got = await cache.get("k");
  assert.deepEqual(got.staleDefines, ["oldParam", "otherParam"]);
});

test("an entry with no staleDefines round-trips without the field", async () => {
  const cache = createStlCache({ version });
  await cache.put("k", entry(8));
  const got = await cache.get("k");
  assert.equal(got.staleDefines, undefined);
});

test("an empty staleDefines array is treated the same as absent", async () => {
  const cache = createStlCache({ version });
  await cache.put("k", entry(8, { staleDefines: [] }));
  const got = await cache.get("k");
  assert.equal(got.staleDefines, undefined);
});

// ---- M11: clear/write ordering (mutations are serialized) ----

test("a write that started before clear() is not repopulated after it", async () => {
  const cache = createStlCache({ version });
  // Seed one entry so the write below has to compete with clear()'s own
  // eviction/version-check work, not just an empty store.
  await cache.put("seed", entry(4));

  // Fire a put() and clear() back-to-back with no await between them — the
  // put() is still in flight (its internal ensureVersion/evictAndWrite work
  // hasn't settled) when clear() is queued. Without serialization, the put()
  // could complete its transaction AFTER clear()'s, leaving "k" behind.
  const putP = cache.put("k", entry(8));
  const clearP = cache.clear();
  await Promise.all([putP, clearP]);

  // clear() was queued after put() (both queued synchronously, in call
  // order), so it must win: nothing put() wrote survives.
  assert.equal(await cache.get("k"), undefined);
  assert.equal(await cache.get("seed"), undefined);
});

test("a clear() then a later put() leaves the new entry in place", async () => {
  const cache = createStlCache({ version });
  await cache.put("old", entry(4));
  await cache.clear();
  await cache.put("new", entry(4));
  assert.equal(await cache.get("old"), undefined);
  assert.ok(await cache.get("new"));
});

// ---- M11: overlapping put()s respect the shared quota ----

test("overlapping put()s never jointly exceed the byte budget", async () => {
  // Budget holds exactly two 6-byte entries. Fire three put()s concurrently
  // (no await between them) so their evict-then-write work would race under
  // the old two-transaction design; serialized + atomic evict-and-write must
  // still land at <= 12 bytes total no matter the interleaving.
  const cache = createStlCache({ version, maxBytes: 12, maxEntryBytes: 12 });
  await Promise.all([
    cache.put("a", entry(6)),
    cache.put("b", entry(6)),
    cache.put("c", entry(6)),
  ]);
  const sizes = await Promise.all(
    ["a", "b", "c"].map(async (k) => ((await cache.get(k))?.stl.byteLength ?? 0))
  );
  const total = sizes.reduce((s, n) => s + n, 0);
  assert.ok(total <= 12, `total stored bytes ${total} exceeded the 12-byte budget`);
});

// ---- M11: large logs are budgeted independently of the STL byte budget ----

test("an oversized log is truncated to a bounded size, keeping the most recent lines", async () => {
  const cache = createStlCache({ version, maxBytes: 10_000_000, maxEntryBytes: 10_000_000 });
  const bigLog = Array.from({ length: 5000 }, (_, i) => `line ${i} `.repeat(5));
  await cache.put("k", entry(8, { log: bigLog }));
  const got = await cache.get("k");
  const totalChars = got.log.reduce((s, l) => s + l.length, 0);
  assert.ok(totalChars < 25_000, `stored log grew to ${totalChars} chars, budget was ~20000`);
  // The most recent line must survive (it's usually the most actionable —
  // the final error/echo of a render), and a truncation marker precedes it.
  assert.equal(got.log[got.log.length - 1], bigLog[bigLog.length - 1]);
  assert.match(got.log[0], /truncated/);
});

test("a log within budget is stored verbatim", async () => {
  const cache = createStlCache({ version });
  const log = ["[cmd] openscad foo.scad", "[out] done"];
  await cache.put("k", entry(8, { log }));
  const got = await cache.get("k");
  assert.deepEqual(got.log, log);
});

test("a large log alone can push a record over maxEntryBytes even with tiny STL bytes", async () => {
  // maxEntryBytes is small enough that STL bytes alone would fit, but the
  // (budgeted) log's byte cost is counted too — proving the budget covers the
  // COMPLETE record, not STL bytes in isolation.
  const cache = createStlCache({ version, maxBytes: 1000, maxEntryBytes: 100 });
  const log = ["x".repeat(500)]; // well within MAX_LOG_CHARS, but > 100 bytes as UTF-16
  await cache.put("k", entry(4, { log }));
  assert.equal(await cache.get("k"), undefined, "record rejected: log bytes pushed it over maxEntryBytes");
});
