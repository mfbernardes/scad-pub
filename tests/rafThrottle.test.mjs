// Tests the pure "at most once per frame" throttle behind
// src/lib/rafThrottle.ts, using an injectable fake raf/caf (a manual frame
// queue) so no real animation frame — or DOM — is needed.
import { test } from "node:test";
import assert from "node:assert/strict";

const { makeRafThrottle } = await import("../src/lib/rafThrottle.ts");

// A fake raf/caf pair backed by a manual queue: `raf(cb)` enqueues `cb` under
// a fresh handle and returns it; `tick()` fires (and clears) every queued
// callback, simulating one animation frame; `caf(handle)` drops one queued
// callback without firing it.
function fakeFrames() {
  let nextHandle = 1;
  const queue = new Map();
  return {
    raf: (cb) => {
      const handle = nextHandle++;
      queue.set(handle, cb);
      return handle;
    },
    caf: (handle) => {
      queue.delete(handle);
    },
    tick: () => {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const cb of callbacks) cb();
    },
    pendingCount: () => queue.size,
  };
}

test("call(): the first call in a frame schedules exactly one frame", () => {
  const frames = fakeFrames();
  const calls = [];
  const throttle = makeRafThrottle((v) => calls.push(v), { raf: frames.raf, caf: frames.caf });
  throttle.call(1);
  assert.equal(frames.pendingCount(), 1);
  assert.deepEqual(calls, []); // not forwarded yet — only on frame fire
});

test("call(): repeated calls within the same frame collapse to the LAST value", () => {
  const frames = fakeFrames();
  const calls = [];
  const throttle = makeRafThrottle((v) => calls.push(v), { raf: frames.raf, caf: frames.caf });
  throttle.call(1);
  throttle.call(2);
  throttle.call(3);
  assert.equal(frames.pendingCount(), 1); // still just one scheduled frame
  frames.tick();
  assert.deepEqual(calls, [3]);
});

test("call(): a new call after the frame fired schedules a fresh frame", () => {
  const frames = fakeFrames();
  const calls = [];
  const throttle = makeRafThrottle((v) => calls.push(v), { raf: frames.raf, caf: frames.caf });
  throttle.call(1);
  frames.tick();
  throttle.call(2);
  frames.tick();
  assert.deepEqual(calls, [1, 2]);
});

test("cancel(): drops a pending frame without forwarding its value", () => {
  const frames = fakeFrames();
  const calls = [];
  const throttle = makeRafThrottle((v) => calls.push(v), { raf: frames.raf, caf: frames.caf });
  throttle.call(1);
  throttle.cancel();
  assert.equal(frames.pendingCount(), 0);
  frames.tick(); // no-op — nothing queued
  assert.deepEqual(calls, []);
});

test("cancel(): a no-op when nothing is pending", () => {
  const frames = fakeFrames();
  const throttle = makeRafThrottle(() => {}, { raf: frames.raf, caf: frames.caf });
  assert.doesNotThrow(() => throttle.cancel());
});

test("flush(): cancels any pending frame and forwards the given value synchronously", () => {
  const frames = fakeFrames();
  const calls = [];
  const throttle = makeRafThrottle((v) => calls.push(v), { raf: frames.raf, caf: frames.caf });
  throttle.call(1); // schedules a frame for 1, never fired
  throttle.flush(2); // commit value — should win, and land immediately
  assert.deepEqual(calls, [2]);
  assert.equal(frames.pendingCount(), 0);
  frames.tick(); // the cancelled frame must not also fire
  assert.deepEqual(calls, [2]);
});

test("flush(): forwards synchronously even with no pending frame", () => {
  const frames = fakeFrames();
  const calls = [];
  const throttle = makeRafThrottle((v) => calls.push(v), { raf: frames.raf, caf: frames.caf });
  throttle.flush(5);
  assert.deepEqual(calls, [5]);
});

test("a burst of calls across many frames forwards exactly one value per fired frame", () => {
  const frames = fakeFrames();
  const calls = [];
  const throttle = makeRafThrottle((v) => calls.push(v), { raf: frames.raf, caf: frames.caf });
  for (let i = 0; i < 5; i++) {
    throttle.call(i * 10);
    throttle.call(i * 10 + 1); // superseded within the same frame
    frames.tick();
  }
  assert.deepEqual(calls, [1, 11, 21, 31, 41]);
});
