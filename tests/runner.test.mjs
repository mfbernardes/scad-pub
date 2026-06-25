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

const { OpenSCADRunner, SupersededError } = await import("../src/openscad/runner.ts");

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

test("render cache reuses entries within the same user font set", async () => {
  const runner = new OpenSCADRunner();
  const w = newest();
  const req = {
    design: "x",
    defines: { a: "1" },
    userFonts: { "user.ttf": new Uint8Array([1, 2, 3]) },
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

test("render cache clears when the user font set changes", async () => {
  const runner = new OpenSCADRunner();
  const w = newest();

  const first = runner.render({
    design: "x",
    defines: { a: "1" },
    userFonts: { "user.ttf": new Uint8Array([1, 2, 3]) },
  });
  w.emit(ok(w.last.id, 6));
  await first;

  const count = w.posted.length;
  const second = runner.render({
    design: "x",
    defines: { a: "1" },
    userFonts: { "user.ttf": new Uint8Array([4, 5, 6]) },
  });
  assert.equal(w.posted.length, count + 1);
  w.emit(ok(w.last.id, 6));
  await second;
  runner.dispose();
});

test("render cache clears when user font bytes mutate in place", async () => {
  const runner = new OpenSCADRunner();
  const w = newest();
  const fontBytes = new Uint8Array([1, 2, 3]);
  const req = {
    design: "x",
    defines: { a: "1" },
    userFonts: { "user.ttf": fontBytes },
  };

  const first = runner.render(req);
  w.emit(ok(w.last.id, 6));
  await first;

  fontBytes[0] = 9;
  const count = w.posted.length;
  const second = runner.render(req);
  assert.equal(w.posted.length, count + 1);
  w.emit(ok(w.last.id, 6));
  await second;
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
