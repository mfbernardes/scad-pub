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

test("SupersededError is exported and identifiable", () => {
  assert.equal(new SupersededError().name, "SupersededError");
});
