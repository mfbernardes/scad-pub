// Tests the render worker's download-progress throttle policy
// (src/openscad/progressThrottle.ts): at most ~5 posts/sec AND only on a
// real (>=1%) change, with an injectable clock so the tests don't sleep.
import { test } from "node:test";
import assert from "node:assert/strict";

const { makeProgressThrottle } = await import("../src/openscad/progressThrottle.ts");

function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms) => (now += ms) };
}

test("the first report always posts, regardless of thresholds", () => {
  const posts = [];
  const c = clock();
  const report = makeProgressThrottle((loaded, total) => posts.push([loaded, total]), { now: c.now });
  report(1, 100);
  assert.deepEqual(posts, [[1, 100]]);
});

test("a report before minIntervalMs has elapsed is dropped even with a big delta", () => {
  const posts = [];
  const c = clock();
  const report = makeProgressThrottle((loaded, total) => posts.push([loaded, total]), {
    now: c.now,
    minIntervalMs: 200,
  });
  report(0, 100);
  c.advance(50); // under the interval
  report(90, 100); // huge delta, but too soon
  assert.equal(posts.length, 1);
});

test("a report after minIntervalMs but under minDeltaFraction is dropped", () => {
  const posts = [];
  const c = clock();
  const report = makeProgressThrottle((loaded, total) => posts.push([loaded, total]), {
    now: c.now,
    minIntervalMs: 200,
    minDeltaFraction: 0.05,
  });
  report(0, 100);
  c.advance(300); // interval satisfied
  report(1, 100); // 1% change, under the 5% threshold
  assert.equal(posts.length, 1);
});

test("a report satisfying both thresholds posts", () => {
  const posts = [];
  const c = clock();
  const report = makeProgressThrottle((loaded, total) => posts.push([loaded, total]), {
    now: c.now,
    minIntervalMs: 200,
    minDeltaFraction: 0.01,
  });
  report(0, 100);
  c.advance(250);
  report(5, 100); // 5% change, interval satisfied
  assert.deepEqual(posts, [
    [0, 100],
    [5, 100],
  ]);
});

test("posts at most ~5/sec across a burst of rapid, large-delta reports", () => {
  const posts = [];
  const c = clock();
  const report = makeProgressThrottle((loaded, total) => posts.push(loaded), { now: c.now });
  for (let i = 0; i <= 50; i++) {
    report(i * 20_000, 1_000_000); // huge delta every call
    c.advance(10); // 500ms total across 50 calls at 10ms apart
  }
  // ~500ms of elapsed time at a ~200ms floor between posts allows at most 3-4.
  assert.ok(posts.length <= 4, `expected a throttled few posts, got ${posts.length}`);
  assert.ok(posts.length >= 1);
});

test("with an unknown total, the delta fraction is computed against bytes seen so far", () => {
  const posts = [];
  const c = clock();
  const report = makeProgressThrottle((loaded) => posts.push(loaded), {
    now: c.now,
    minIntervalMs: 0,
    minDeltaFraction: 0.5,
  });
  report(100, null);
  report(101, null); // ~1% change against 100 -- below the 50% threshold
  assert.deepEqual(posts, [100]);
  report(200, null); // 100% change against the last posted 100 -- clears it
  assert.deepEqual(posts, [100, 200]);
});
