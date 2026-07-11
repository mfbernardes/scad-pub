// Tests retryableOnce (src/openscad/retryableOnce.ts): the memoize-with-retry
// contract extracted from worker.ts's ensureAssets (M1). worker.ts's actual
// bootstrap (WASM/glue import, Cache Storage, fetch) needs a real worker/
// browser environment to exercise end-to-end; this file pins the generic
// contract that fix depends on — a rejected attempt is not memoized, so the
// next call retries from scratch, while a resolved attempt IS memoized and
// shared by concurrent callers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { retryableOnce } from "../src/openscad/retryableOnce.ts";

test("a successful load is memoized: later calls reuse the same promise", async () => {
  let calls = 0;
  const run = retryableOnce(async () => {
    calls++;
    return "ok";
  });
  assert.equal(await run(), "ok");
  assert.equal(await run(), "ok");
  assert.equal(await run(), "ok");
  assert.equal(calls, 1);
});

test("concurrent callers before the first resolution share one load", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const run = retryableOnce(async () => {
    calls++;
    await gate;
    return "ok";
  });
  const a = run();
  const b = run();
  const c = run();
  release();
  assert.deepEqual(await Promise.all([a, b, c]), ["ok", "ok", "ok"]);
  assert.equal(calls, 1);
});

// M1's core fix: a failed attempt must NOT be sticky.
test("a rejected load is retried on the next call, not replayed forever", async () => {
  let calls = 0;
  const run = retryableOnce(async () => {
    calls++;
    if (calls === 1) throw new Error("first attempt failed");
    return "ok";
  });

  await assert.rejects(run(), /first attempt failed/);
  // Without the fix, a second call would resolve/reject with the exact same
  // memoized (rejected) promise — same object, same error, forever.
  assert.equal(await run(), "ok");
  assert.equal(calls, 2);
});

test("every call while an attempt is still failing gets the same rejection, not duplicate loads", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const run = retryableOnce(async () => {
    calls++;
    await gate;
    throw new Error("boom");
  });
  const a = run();
  const b = run();
  release();
  await assert.rejects(a, /boom/);
  await assert.rejects(b, /boom/);
  assert.equal(calls, 1); // a and b shared the one in-flight (failing) attempt
});

test("repeated failures each get their own retry (never sticky)", async () => {
  let calls = 0;
  const run = retryableOnce(async () => {
    calls++;
    throw new Error(`attempt ${calls} failed`);
  });
  await assert.rejects(run(), /attempt 1 failed/);
  await assert.rejects(run(), /attempt 2 failed/);
  await assert.rejects(run(), /attempt 3 failed/);
  assert.equal(calls, 3);
});

test("a value-returning loader threads its resolved value through", async () => {
  const run = retryableOnce(async () => ({ ready: true, at: 42 }));
  const result = await run();
  assert.deepEqual(result, { ready: true, at: 42 });
});

// Regression guard for the exact M1 bug pattern: a piece of bootstrap work
// that is started but never actually awaited inside the loader can reject
// without the caller ever finding out — retryableOnce can't fix that half of
// the bug (it can only retry what the loader actually awaits), so worker.ts's
// ensureAssets loader is required to await every promise it starts (see its
// comment). This test documents/pins that retryableOnce alone is not
// sufficient if the loader doesn't await everything.
test("retryableOnce cannot rescue a loader that starts work without awaiting it", async () => {
  let leaked;
  const run = retryableOnce(async () => {
    // Deliberately NOT awaited — mirrors the pre-fix bug where
    // `factoryPromise = loadFactory()` was assigned but not included in the
    // Promise.all.
    leaked = Promise.reject(new Error("never awaited")).catch((e) => {
      throw e;
    });
    void leaked.catch(() => {}); // silence the unhandled-rejection warning for this test
    return "ok"; // the loader "succeeds" even though leaked work failed
  });
  assert.equal(await run(), "ok"); // the bug: looks like success
  await assert.rejects(leaked, /never awaited/); // the leaked work did fail, invisibly
});
