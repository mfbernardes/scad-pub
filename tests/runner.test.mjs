// Tests the render runner's latest-wins cancellation: a superseding render must
// terminate + respawn the worker and reject the abandoned one. A fake Worker
// stands in for the real module worker (which needs the browser/Vite).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

class FakeWorker {
  static instances = [];
  constructor() {
    this.posted = [];
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    FakeWorker.instances.push(this);
  }
  postMessage(m) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data) {
    this.onmessage && this.onmessage({ data });
  }
  emitError(message = "boom") {
    let defaultPrevented = false;
    this.onerror &&
      this.onerror({
        message,
        preventDefault() {
          defaultPrevented = true;
        },
      });
    return defaultPrevented;
  }
  emitMessageError() {
    this.onmessageerror && this.onmessageerror({});
  }
  get last() {
    return this.posted[this.posted.length - 1];
  }
}
globalThis.Worker = FakeWorker;

const { OpenSCADRunner, SupersededError, MountCollisionError, fileSignature } = await import(
  "../src/openscad/runner.ts"
);

const ok = (id, bytes = 0) => ({
  id,
  ok: true,
  exitCode: 0,
  stl: new Uint8Array(bytes),
  log: [],
  ms: 1,
});
const newest = () => FakeWorker.instances[FakeWorker.instances.length - 1];

beforeEach(() => {
  FakeWorker.instances.length = 0;
});

test("a superseding render cancels the in-flight one", async () => {
  const runner = new OpenSCADRunner();
  const w0 = newest();
  const a = runner.render({ design: "x", defines: {} });
  const aRejects = assert.rejects(a, (e) => e.name === "SupersededError");
  const b = runner.render({ design: "y", defines: {} }); // supersedes a

  assert.equal(w0.terminated, true);
  await aRejects;
  const w1 = newest();
  assert.notStrictEqual(w1, w0); // respawned
  assert.equal(w1.last.design, "y");

  w1.emit(ok(w1.last.id));
  assert.equal((await b).ok, true);
  runner.dispose();
});

test("no cancellation when the worker is idle (same worker reused)", async () => {
  const runner = new OpenSCADRunner();
  const w = newest();
  const a = runner.render({ design: "x", defines: {} });
  w.emit(ok(w.last.id));
  await a;

  const count = FakeWorker.instances.length;
  const b = runner.render({ design: "y", defines: {} });
  assert.equal(FakeWorker.instances.length, count); // no respawn
  assert.equal(w.terminated, false);
  w.emit(ok(w.last.id));
  await b;
  runner.dispose();
});

test("successful renders are served from the runner cache", async () => {
  const runner = new OpenSCADRunner();
  const w = newest();
  const first = runner.render({ design: "x", defines: { a: "1" } });
  w.emit(ok(w.last.id));
  const firstResult = await first;

  const count = w.posted.length;
  const secondResult = await runner.render({ design: "x", defines: { a: "1" } });

  assert.equal(w.posted.length, count);
  assert.notEqual(secondResult.id, firstResult.id);
  assert.equal(secondResult.ok, true);
  runner.dispose();
});

test("a cache hit still supersedes an in-flight render", async () => {
  const runner = new OpenSCADRunner();
  const w = newest();
  const first = runner.render({ design: "x", defines: { a: "1" } });
  w.emit(ok(w.last.id));
  await first;

  const slow = runner.render({ design: "y", defines: { a: "2" } });
  const slowRejects = assert.rejects(slow, (e) => e.name === "SupersededError");
  const cached = await runner.render({ design: "x", defines: { a: "1" } });

  assert.equal(w.terminated, true);
  await slowRejects;
  assert.equal(cached.ok, true);
  assert.equal(newest().posted.length, 0); // served from cache after respawn
  runner.dispose();
});

test("render cache is bounded by cacheSize", async () => {
  const runner = new OpenSCADRunner({ cacheSize: 1 });
  const w = newest();

  const a = runner.render({ design: "x", defines: { a: "1" } });
  w.emit(ok(w.last.id));
  await a;

  const b = runner.render({ design: "x", defines: { a: "2" } });
  w.emit(ok(w.last.id));
  await b;

  const count = w.posted.length;
  const aAgain = runner.render({ design: "x", defines: { a: "1" } });
  assert.equal(w.posted.length, count + 1);
  w.emit(ok(w.last.id));
  await aAgain;
  runner.dispose();
});

test("render cache evicts entries to stay under the byte budget", async () => {
  const runner = new OpenSCADRunner({
    cacheSize: 10,
    cacheBytes: 10,
    maxCacheEntryBytes: 10,
  });
  const w = newest();

  const a = runner.render({ design: "x", defines: { a: "1" } });
  w.emit(ok(w.last.id, 6));
  await a;

  const b = runner.render({ design: "x", defines: { a: "2" } });
  w.emit(ok(w.last.id, 6));
  await b;

  const count = w.posted.length;
  const aAgain = runner.render({ design: "x", defines: { a: "1" } });
  assert.equal(w.posted.length, count + 1);
  w.emit(ok(w.last.id, 6));
  await aAgain;
  runner.dispose();
});

test("render cache skips entries larger than maxCacheEntryBytes", async () => {
  const runner = new OpenSCADRunner({
    cacheSize: 10,
    cacheBytes: 100,
    maxCacheEntryBytes: 5,
  });
  const w = newest();

  const first = runner.render({ design: "x", defines: { a: "1" } });
  w.emit(ok(w.last.id, 6));
  await first;

  const count = w.posted.length;
  const second = runner.render({ design: "x", defines: { a: "1" } });
  assert.equal(w.posted.length, count + 1);
  w.emit(ok(w.last.id, 6));
  await second;
  runner.dispose();
});

test("render cache reuses entries within the same user file set", async () => {
  const runner = new OpenSCADRunner();
  const w = newest();
  const req = {
    design: "x",
    defines: { a: "1" },
    userFiles: { "user.ttf": new Uint8Array([1, 2, 3]) },
  };

  const first = runner.render(req);
  w.emit(ok(w.last.id, 6));
  await first;

  const count = w.posted.length;
  const second = await runner.render(req);
  assert.equal(w.posted.length, count);
  assert.equal(second.ok, true);
  runner.dispose();
});

test("render cache clears when the user file set changes", async () => {
  const runner = new OpenSCADRunner();
  const w = newest();

  const first = runner.render({
    design: "x",
    defines: { a: "1" },
    userFiles: { "user.ttf": new Uint8Array([1, 2, 3]) },
  });
  w.emit(ok(w.last.id, 6));
  await first;

  const count = w.posted.length;
  const second = runner.render({
    design: "x",
    defines: { a: "1" },
    userFiles: { "user.ttf": new Uint8Array([4, 5, 6]) },
  });
  assert.equal(w.posted.length, count + 1);
  w.emit(ok(w.last.id, 6));
  await second;
  runner.dispose();
});

test("render cache clears when user file bytes mutate in place", async () => {
  const runner = new OpenSCADRunner();
  const w = newest();
  const fileBytes = new Uint8Array([1, 2, 3]);
  const req = {
    design: "x",
    defines: { a: "1" },
    userFiles: { "user.ttf": fileBytes },
  };

  const first = runner.render(req);
  w.emit(ok(w.last.id, 6));
  await first;

  fileBytes[0] = 9;
  const count = w.posted.length;
  const second = runner.render(req);
  assert.equal(w.posted.length, count + 1);
  w.emit(ok(w.last.id, 6));
  await second;
  runner.dispose();
});

test("clearCache() drops the in-memory cache so the next render re-runs", async () => {
  const runner = new OpenSCADRunner();
  const w = newest();
  const req = { design: "x", defines: { a: "1" } };

  const first = runner.render(req);
  w.emit(ok(w.last.id, 6));
  await first;

  // Without clearing, the identical req would be served from L1 (no new post).
  runner.clearCache();
  const count = w.posted.length;
  const second = runner.render(req);
  assert.equal(w.posted.length, count + 1); // cleared -> re-posted to the worker
  w.emit(ok(w.last.id, 6));
  await second;
  runner.dispose();
});

test("clearCache() also clears the persistent (L2) store", async () => {
  let cleared = 0;
  const store = {
    async get() {
      return undefined;
    },
    async put() {},
    async clear() {
      cleared++;
    },
  };
  const runner = new OpenSCADRunner({ store });
  const w = newest();
  const first = runner.render({ design: "x", defines: {} });
  // The injected store makes render() await an async L2 lookup before posting.
  await new Promise((r) => setTimeout(r, 0));
  w.emit(ok(w.last.id));
  await first;

  runner.clearCache();
  assert.equal(cleared, 1);
  runner.dispose();
});

test("non-finite cache options are sanitized", async () => {
  const runner = new OpenSCADRunner({
    cacheSize: Number.POSITIVE_INFINITY,
    cacheBytes: Number.NaN,
    maxCacheEntryBytes: Number.NaN,
  });
  const w = newest();

  const first = runner.render({ design: "x", defines: { a: "1" } });
  w.emit(ok(w.last.id, 6));
  await first;

  const count = w.posted.length;
  const second = await runner.render({ design: "x", defines: { a: "1" } });
  assert.equal(w.posted.length, count);
  assert.equal(second.ok, true);
  runner.dispose();
});

test("worker errors reject the active render and recover on the next render", async () => {
  const runner = new OpenSCADRunner();
  const w0 = newest();
  const render = runner.render({ design: "x", defines: {} });

  assert.equal(w0.emitError("worker exploded"), true);
  await assert.rejects(render, /worker exploded/);
  assert.equal(w0.terminated, true);

  const next = runner.render({ design: "y", defines: {} });
  const w1 = newest();
  assert.notStrictEqual(w1, w0);
  w1.emit(ok(w1.last.id));
  assert.equal((await next).ok, true);
  runner.dispose();
});

test("a worker message error rejects the active render and recovers next render", async () => {
  // A structured-clone failure surfaces as onmessageerror; it must reject the
  // in-flight render (not hang) and leave the runner able to render again.
  const runner = new OpenSCADRunner();
  const w0 = newest();
  const render = runner.render({ design: "x", defines: {} });
  w0.emitMessageError();
  await assert.rejects(render, /message error/);

  const next = runner.render({ design: "y", defines: {} });
  const w1 = newest();
  assert.notStrictEqual(w1, w0);
  w1.emit(ok(w1.last.id));
  assert.equal((await next).ok, true);
  runner.dispose();
});

test("the ready signal fires onReady exactly once", () => {
  let ready = 0;
  const runner = new OpenSCADRunner({ onReady: () => ready++ });
  const w = newest();
  w.emit({ type: "ready" });
  w.emit({ type: "ready" });
  assert.equal(ready, 1);
  runner.dispose();
});

// ---- Persistent L2 cache (injected store) ----
// The runner only takes the async L2 path when a store is present; with no
// store (as in the tests above, and in Node where IndexedDB is undefined) it
// posts to the worker synchronously, exactly as before.

const flush = () => new Promise((r) => setTimeout(r));

// An in-memory stand-in for the IndexedDB-backed store, cloning on the way in
// and out like the real one does.
function memStore() {
  const map = new Map();
  return {
    map,
    async get(key) {
      const v = map.get(key);
      return v && { stl: new Uint8Array(v.stl), log: [...v.log], exitCode: v.exitCode, ms: v.ms };
    },
    async put(key, value) {
      map.set(key, {
        stl: new Uint8Array(value.stl),
        log: [...value.log],
        exitCode: value.exitCode,
        ms: value.ms,
      });
    },
  };
}

test("successful renders are written through to the persistent store", async () => {
  const store = memStore();
  const runner = new OpenSCADRunner({ store });
  const w = newest();
  const p = runner.render({ design: "x", defines: { a: "1" } });
  await flush(); // the L2 miss resolves, then the worker is posted
  w.emit(ok(w.last.id, 6));
  await p;
  assert.equal(store.map.size, 1);
  runner.dispose();
});

test("an L1 miss is served from the persistent store without the worker", async () => {
  const store = memStore();
  // First runner renders and writes through to the shared store.
  const a = new OpenSCADRunner({ store });
  const wa = newest();
  const first = a.render({ design: "x", defines: { a: "1" } });
  await flush();
  wa.emit(ok(wa.last.id, 6));
  await first;
  a.dispose();

  // A fresh runner (empty L1) serves the same request from L2 — no worker post.
  const b = new OpenSCADRunner({ store });
  const wb = newest();
  const cached = await b.render({ design: "x", defines: { a: "1" } });
  assert.equal(wb.posted.length, 0);
  assert.equal(cached.ok, true);
  assert.equal(cached.cached, true);
  b.dispose();
});

test("an L2 hit that resolves after a superseding render is rejected", async () => {
  // A store whose get() is gated, so a second render can supersede the first
  // while its L2 lookup is still pending.
  let release;
  const gate = new Promise((r) => (release = r));
  const store = {
    async get() {
      await gate;
      return undefined;
    },
    async put() {},
  };
  const runner = new OpenSCADRunner({ store });
  const a = runner.render({ design: "x", defines: { a: "1" } });
  const aRejects = assert.rejects(a, (e) => e.name === "SupersededError");
  const b = runner.render({ design: "y", defines: { a: "2" } }); // supersedes a
  release();
  await aRejects;

  await flush(); // b's L2 miss resolves and posts to the worker
  const wb = newest();
  wb.emit(ok(wb.last.id));
  assert.equal((await b).ok, true);
  runner.dispose();
});

test("a different cacheVersion does not reuse another build's stored entry", async () => {
  const store = memStore();
  const a = new OpenSCADRunner({ store, cacheVersion: "build-1" });
  const wa = newest();
  const first = a.render({ design: "x", defines: { a: "1" } });
  await flush();
  wa.emit(ok(wa.last.id, 6));
  await first;
  a.dispose();

  // A new build (different renderHash) must re-render, not serve stale geometry.
  const b = new OpenSCADRunner({ store, cacheVersion: "build-2" });
  const wb = newest();
  const p = b.render({ design: "x", defines: { a: "1" } });
  await flush();
  assert.equal(wb.posted.length, 1); // L2 miss under the new version -> worker
  wb.emit(ok(wb.last.id, 6));
  assert.equal((await p).ok, true);
  b.dispose();
});

test("failed renders are not written to the persistent store", async () => {
  const store = memStore();
  const runner = new OpenSCADRunner({ store });
  const w = newest();
  const p = runner.render({ design: "x", defines: { a: "1" } });
  await flush();
  w.emit({ id: w.last.id, ok: false, exitCode: 1, stl: new Uint8Array(0), log: ["err"], ms: 1 });
  await p;
  assert.equal(store.map.size, 0);
  runner.dispose();
});

test("SupersededError is exported and identifiable", () => {
  assert.equal(new SupersededError().name, "SupersededError");
});

// ---- M10: strong user-file digest, mount collisions, transport dedup ----

// A real reproduced collision against the PREVIOUS 32-bit FNV-1a fileSignature
// (`fnv32([102,191,170,4,123,252,63,207]) === fnv32([240,156,234,254,246,13,62,237])
// === 2990537249`, found by brute-force search over random 8-byte payloads —
// see the review's M10 evidence). Same name, same length, different bytes: the
// old signature could not tell these two files apart. The new digest must.
test("a same-name/same-length collision against the old 32-bit FNV-1a no longer collides", () => {
  const a = new Uint8Array([102, 191, 170, 4, 123, 252, 63, 207]);
  const b = new Uint8Array([240, 156, 234, 254, 246, 13, 62, 237]);
  const sigA = fileSignature({ "user.bin": a });
  const sigB = fileSignature({ "user.bin": b });
  assert.notEqual(sigA, sigB, "distinct 8-byte payloads must not share a signature");
});

test("fileSignature is deterministic for the same bytes", () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  assert.equal(fileSignature({ f: bytes }), fileSignature({ f: new Uint8Array(bytes) }));
});

test("render() rejects filename aliases that sanitize to the same mount path", async () => {
  const runner = new OpenSCADRunner();
  const req = {
    design: "x",
    defines: {},
    userFiles: {
      "a/logo.svg": new Uint8Array([1]),
      "b/logo.svg": new Uint8Array([2]), // sanitizes to the same "/logo.svg" mount path
    },
  };
  await assert.rejects(runner.render(req), (e) => {
    assert.ok(e instanceof MountCollisionError);
    assert.ok(e.collisions["/logo.svg"]);
    assert.deepEqual(e.collisions["/logo.svg"].sort(), ["a/logo.svg", "b/logo.svg"]);
    return true;
  });
  // Rejected before ever posting to the worker.
  assert.equal(newest().posted.length, 0);
  runner.dispose();
});

test("render() does not reject distinct raw names that sanitize to distinct paths", async () => {
  const runner = new OpenSCADRunner();
  const w = newest();
  const p = runner.render({
    design: "x",
    defines: {},
    userFiles: {
      "a/logo.svg": new Uint8Array([1]),
      "b/other.svg": new Uint8Array([2]),
    },
  });
  w.emit(ok(w.last.id));
  assert.equal((await p).ok, true);
  runner.dispose();
});

test("MountCollisionError is exported and identifiable", () => {
  const e = new MountCollisionError({ "/x": ["a", "b"] });
  assert.equal(e.name, "MountCollisionError");
  assert.deepEqual(e.collisions, { "/x": ["a", "b"] });
});

test("unchanged user files are not resent to the worker on a later render", async () => {
  const runner = new OpenSCADRunner();
  const w = newest();
  const files = { "user.ttf": new Uint8Array([1, 2, 3]) };

  const first = runner.render({ design: "x", defines: { a: "1" }, userFiles: files });
  assert.ok("userFiles" in w.last, "first post to a fresh worker must include the files");
  w.emit(ok(w.last.id, 6));
  await first;

  // A different `defines` value means a cache miss (so this must reach the
  // worker), but the SAME file bytes — the worker already has them mounted
  // (see worker.ts's cachedUserFiles), so this post must omit `userFiles`
  // entirely rather than re-cloning the same bytes across the thread boundary.
  const second = runner.render({ design: "x", defines: { a: "2" }, userFiles: files });
  assert.equal(w.last.userFiles, undefined, "unchanged files must not be resent");
  w.emit(ok(w.last.id, 6));
  await second;
  runner.dispose();
});

test("changed user files ARE resent to the worker", async () => {
  const runner = new OpenSCADRunner();
  const w = newest();

  const first = runner.render({
    design: "x",
    defines: { a: "1" },
    userFiles: { "user.ttf": new Uint8Array([1, 2, 3]) },
  });
  w.emit(ok(w.last.id, 6));
  await first;

  const second = runner.render({
    design: "x",
    defines: { a: "2" },
    userFiles: { "user.ttf": new Uint8Array([9, 9, 9]) },
  });
  assert.ok("userFiles" in w.last && w.last.userFiles, "changed files must be resent");
  w.emit(ok(w.last.id, 6));
  await second;
  runner.dispose();
});

test("a respawned worker always gets a full resend, even if files are unchanged", async () => {
  const runner = new OpenSCADRunner();
  const files = { "user.ttf": new Uint8Array([1, 2, 3]) };

  const first = runner.render({ design: "x", defines: { a: "1" }, userFiles: files });
  const w0 = newest();
  w0.emit(ok(w0.last.id, 6));
  await first;

  // Force a respawn (worker error), then render again with the SAME files —
  // the new worker's module scope has no cached files, so it must NOT be
  // skipped even though the signature matches what the old worker last saw.
  const w1current = newest();
  w1current.emitError("boom");
  const afterRespawn = runner.render({ design: "y", defines: { a: "1" }, userFiles: files });
  const w1 = newest();
  assert.notStrictEqual(w1, w0);
  assert.ok("userFiles" in w1.last && w1.last.userFiles, "a fresh worker must get a full resend");
  w1.emit(ok(w1.last.id, 6));
  await afterRespawn;
  runner.dispose();
});
