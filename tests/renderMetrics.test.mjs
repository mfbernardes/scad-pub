// Tests the local-only render performance telemetry (duration formatting,
// changed-param diffing, and the last/slowest bookkeeping) that backs the
// Output console's Metrics tab.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDuration,
  changedParamLabels,
  recordRender,
  emptyMetrics,
} from "../src/lib/renderMetrics.ts";

// Minimal fake Params — only the fields changedParamLabels/defaultsFor-style
// callers actually read (name, description, default; the rest of ParamBase is
// irrelevant here).
function numberParam(name, description, def) {
  return { name, description, help: "", section: "", type: "number", default: def };
}

test("formatDuration: sub-second uses rounded ms, at/above a second uses seconds to 1 decimal", () => {
  assert.equal(formatDuration(999), "999 ms");
  assert.equal(formatDuration(1000), "1.0 s");
  assert.equal(formatDuration(4200), "4.2 s");
  assert.equal(formatDuration(214.4), "214 ms");
});

test("changedParamLabels: detects a changed param, labels it by description, ignores unchanged, preserves order", () => {
  const params = [
    numberParam("width", "Width (mm)", 10),
    numberParam("height", "Height (mm)", 20),
    numberParam("depth", "Depth (mm)", 30),
  ];
  const prev = { width: 10, height: 20, depth: 30 };
  const next = { width: 15, height: 20, depth: 25 };
  assert.deepEqual(changedParamLabels(params, prev, next), ["Width (mm)", "Depth (mm)"]);
});

test("changedParamLabels: missing keys fall back to the param default for comparison", () => {
  const params = [numberParam("width", "Width (mm)", 10)];
  // prev has no explicit "width" — falls back to default (10), matching next.
  assert.deepEqual(changedParamLabels(params, {}, { width: 10 }), []);
  assert.deepEqual(changedParamLabels(params, {}, { width: 11 }), ["Width (mm)"]);
});

test("changedParamLabels: falls back to the variable name when description is empty", () => {
  const params = [{ name: "w", description: "", help: "", section: "", type: "number", default: 1 }];
  assert.deepEqual(changedParamLabels(params, { w: 1 }, { w: 2 }), ["w"]);
});

test("recordRender: last always updates to the newest metric", () => {
  const m1 = recordRender(emptyMetrics, { ms: 100, cached: false, changed: [] });
  assert.deepEqual(m1.last, { ms: 100, cached: false, changed: [] });
  const m2 = recordRender(m1, { ms: 50, cached: true, changed: [] });
  assert.deepEqual(m2.last, { ms: 50, cached: true, changed: [] });
});

test("recordRender: slowest tracks the max-ms fresh render", () => {
  let m = emptyMetrics;
  m = recordRender(m, { ms: 100, cached: false, changed: [] });
  assert.equal(m.slowest.ms, 100);
  m = recordRender(m, { ms: 300, cached: false, changed: ["Width (mm)"] });
  assert.equal(m.slowest.ms, 300);
  assert.deepEqual(m.slowest.changed, ["Width (mm)"]);
});

test("recordRender: a cached render never replaces slowest, even if it reports a larger ms", () => {
  let m = recordRender(emptyMetrics, { ms: 100, cached: false, changed: [] });
  m = recordRender(m, { ms: 9999, cached: true, changed: [] });
  assert.equal(m.slowest.ms, 100);
  assert.equal(m.last.ms, 9999); // last still updates
});

test("recordRender: a faster fresh render doesn't replace a slower recorded slowest", () => {
  let m = recordRender(emptyMetrics, { ms: 500, cached: false, changed: [] });
  m = recordRender(m, { ms: 200, cached: false, changed: [] });
  assert.equal(m.slowest.ms, 500);
  assert.equal(m.last.ms, 200);
});

test("recordRender: a cached render can still become `last` while `slowest` stays null if none was ever fresh", () => {
  const m = recordRender(emptyMetrics, { ms: 100, cached: true, changed: [] });
  assert.equal(m.slowest, null);
  assert.deepEqual(m.last, { ms: 100, cached: true, changed: [] });
});
