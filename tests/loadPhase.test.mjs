// Tests the pure pre-first-render lifecycle model (src/lib/loadPhase.ts):
// phase derivation, byte formatting, and the overlay copy it produces.
import { test } from "node:test";
import assert from "node:assert/strict";

const { derivePhase, formatBytes, engineProgressFraction, phaseCopy } = await import(
  "../src/lib/loadPhase.ts"
);

// A tiny stand-in for the real t() — records the key/vars it was called with
// so assertions can check both without depending on actual locale strings.
function fakeT(key, vars) {
  return vars ? `${key}:${JSON.stringify(vars)}` : key;
}

test("derivePhase: not ready is always the engine phase", () => {
  assert.equal(derivePhase({ ready: false, rendering: false, hasResult: false }), "engine");
  assert.equal(derivePhase({ ready: false, rendering: true, hasResult: false }), "engine");
  assert.equal(derivePhase({ ready: false, rendering: true, hasResult: true }), "engine");
});

test("derivePhase: ready + rendering + no result yet is the render phase", () => {
  assert.equal(derivePhase({ ready: true, rendering: true, hasResult: false }), "render");
});

test("derivePhase: ready and (not rendering OR a result already landed) is done", () => {
  assert.equal(derivePhase({ ready: true, rendering: false, hasResult: false }), "done");
  assert.equal(derivePhase({ ready: true, rendering: true, hasResult: true }), "done");
  assert.equal(derivePhase({ ready: true, rendering: false, hasResult: true }), "done");
});

test("formatBytes: sub-KB stays in bytes", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
});

test("formatBytes: KB/MB/GB with one decimal below 10 units, none at/above", () => {
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1024 * 1024 * 9.5), "9.5 MB");
  assert.equal(formatBytes(1024 * 1024 * 23), "23 MB");
  assert.equal(formatBytes(1024 * 1024 * 1024 * 1.2), "1.2 GB");
});

test("formatBytes: invalid input degrades to an empty string, not NaN/throw", () => {
  assert.equal(formatBytes(-1), "");
  assert.equal(formatBytes(NaN), "");
  assert.equal(formatBytes(Infinity), "");
});

test("engineProgressFraction: null progress or unknown total is indeterminate (null)", () => {
  assert.equal(engineProgressFraction(null), null);
  assert.equal(engineProgressFraction({ type: "progress", stage: "engine", loaded: 10, total: null }), null);
  assert.equal(engineProgressFraction({ type: "progress", stage: "engine", loaded: 10, total: 0 }), null);
});

test("engineProgressFraction: known total is loaded/total, clamped to [0,1]", () => {
  assert.equal(
    engineProgressFraction({ type: "progress", stage: "engine", loaded: 5_000_000, total: 10_000_000 }),
    0.5
  );
  // Clamp: a chunk that overshoots (shouldn't happen, but don't emit >1).
  assert.equal(
    engineProgressFraction({ type: "progress", stage: "engine", loaded: 11_000_000, total: 10_000_000 }),
    1
  );
});

test("phaseCopy: render phase uses viewer.building and no size line", () => {
  const copy = phaseCopy("render", null, 10_000_000, fakeT);
  assert.equal(copy.title, "viewer.building");
  assert.equal(copy.sizeLine, null);
});

test("phaseCopy: done phase has no title and no size line", () => {
  const copy = phaseCopy("done", null, 10_000_000, fakeT);
  assert.equal(copy.title, "");
  assert.equal(copy.sizeLine, null);
});

test("phaseCopy: engine phase with no progress yet (cache hit or not started) has no size line", () => {
  const copy = phaseCopy("engine", null, 10_000_000, fakeT);
  assert.equal(copy.title, "loading.preparingEngine");
  assert.equal(copy.sizeLine, null, "a size line must not flash before any real download is happening");
});

test("phaseCopy: engine phase with progress flowing shows the size line", () => {
  const progress = { type: "progress", stage: "engine", loaded: 1_000_000, total: 10_000_000 };
  const copy = phaseCopy("engine", progress, 10_000_000, fakeT);
  assert.equal(copy.title, "loading.preparingEngine");
  assert.ok(copy.sizeLine.startsWith("loading.downloadSize:"));
  assert.ok(copy.sizeLine.includes("9.5 MB"));
});

test("phaseCopy: engine phase with progress but no known engineBytes has no size line", () => {
  const progress = { type: "progress", stage: "engine", loaded: 1_000_000, total: 10_000_000 };
  const copy = phaseCopy("engine", progress, undefined, fakeT);
  assert.equal(copy.sizeLine, null);
});
