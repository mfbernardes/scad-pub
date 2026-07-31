// Tests the pure derivations in src/lib/renderStatus.ts. The one with teeth is
// `stageLoading` ("nothing has EVER been on the canvas this mount") which two
// unrelated places read: ViewerStage's loading overlay and AppShell's arming of
// the one-time first-visit sheet nudge (whose fade timeout starts when it
// mounts, so mounting it while this is true burns the whole once-per-browser
// nudge behind the overlay on any slow first-run boot). The "still loading" vs
// "nothing to show yet" distinction is exactly what the branches below pin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stageLoading, deriveRenderStatus } from "../src/lib/renderStatus.ts";

const okResult = { id: 1, ok: true, exitCode: 0, stl: new Uint8Array([1]), log: [], ms: 10 };
const failedResult = { id: 2, ok: false, exitCode: 1, log: [], ms: 10 };

test("stageLoading: the engine bootstrapping counts as loading, whatever else is true", () => {
  assert.equal(stageLoading({ ready: false, rendering: false, result: null }), true);
  assert.equal(stageLoading({ ready: false, rendering: true, result: null }), true);
  // Even a result from a previous mount can't beat a not-yet-ready engine.
  assert.equal(stageLoading({ ready: false, rendering: false, result: okResult }), true);
});

test("stageLoading: the first render of this mount, with nothing yet shown, is loading", () => {
  assert.equal(stageLoading({ ready: true, rendering: true, result: null }), true);
});

test("stageLoading: a re-render over an existing result is NOT loading", () => {
  // The canvas still shows the previous model: the overlay would hide it, and
  // the sheet nudge is perfectly actionable here.
  assert.equal(stageLoading({ ready: true, rendering: true, result: okResult }), false);
});

test("stageLoading: an idle stage with no result (manual/heavy design) is NOT loading", () => {
  // A `heavy` design starts in manual mode and never renders on its own, so
  // gating on `result?.ok` would leave the stage "loading" forever.
  assert.equal(stageLoading({ ready: true, rendering: false, result: null }), false);
});

test("stageLoading: a failed render is a visible, actionable state, not loading", () => {
  assert.equal(stageLoading({ ready: true, rendering: false, result: failedResult }), false);
  assert.equal(stageLoading({ ready: true, rendering: true, result: failedResult }), false);
});

test("stageLoading: a settled successful render is not loading", () => {
  assert.equal(stageLoading({ ready: true, rendering: false, result: okResult }), false);
});

test("deriveRenderStatus: the shapes the smoke/capture scripts wait on stay stable", () => {
  // `waitRendered` in scripts/lib/browser.mjs polls `.render-status` for /\d+ ms/,
  // and that text may only appear once a render has actually finished.
  assert.equal(deriveRenderStatus({ ready: true, rendering: false, result: okResult }).text, "10 ms");
  assert.equal(
    deriveRenderStatus({ ready: true, rendering: false, result: { ...okResult, cached: true } }).text,
    "10 ms (cached)"
  );
  assert.equal(deriveRenderStatus({ ready: true, rendering: false, result: failedResult }).text, "Failed (exit 1)");
  for (const input of [
    { ready: false, rendering: false, result: null },
    { ready: true, rendering: true, result: okResult },
    { ready: true, rendering: false, result: okResult, stale: true },
    { ready: true, rendering: false, result: null },
  ]) {
    assert.doesNotMatch(deriveRenderStatus(input).text, /\d+ ms/);
  }
});
