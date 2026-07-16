// Tests the pure derivation behind PR18's Review stage (src/lib/
// reviewSummary.ts): the row list DimensionInfo and QuickStart's Review stage
// both render ("what will actually be produced"), and the readiness line's
// label/dot mapping. Mirrors tests/computedInfo.test.mjs's own style — no
// DOM/React harness needed since this module is dependency-free of both.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mm,
  formatBoundingBox,
  formatParamValue,
  paramInfoRows,
  buildReviewRows,
  readinessLabel,
  readinessDotClass,
  readinessPulse,
} from "../src/lib/reviewSummary.ts";

// A minimal Design-shaped fixture — structurally sufficient for these tests,
// which run untyped under node:test (mirrors tests/quickStart.test.mjs's own
// fixture helper).
function design(params) {
  return { id: "fixture", label: "Fixture", file: "fixture.scad", presets: [], sections: ["Main"], params };
}

function numberParam(name, overrides = {}) {
  return {
    name,
    section: "Main",
    description: name,
    help: "",
    type: "number",
    default: 0,
    ...overrides,
  };
}

test("mm(): always shows at least one decimal", () => {
  assert.equal(mm(90), "90.0");
  assert.equal(mm(12.34), "12.3");
  assert.equal(mm(12.36), "12.4");
});

test("formatBoundingBox(): W × D × H with a unit suffix", () => {
  assert.equal(formatBoundingBox({ x: 90, y: 45, z: 3 }), "90.0 × 45.0 × 3.0 mm");
});

test("formatParamValue(): number gets its @info unit appended", () => {
  const p = numberParam("thickness", { info: { label: null, unit: "mm" } });
  assert.equal(formatParamValue(p, { thickness: 3 }), "3 mm");
});

test("formatParamValue(): boolean renders as localized Yes/No", () => {
  const p = { name: "engrave", section: "Main", description: "Engrave", help: "", type: "boolean", default: false, info: { label: null, unit: null } };
  assert.equal(formatParamValue(p, { engrave: true }), "Yes");
  assert.equal(formatParamValue(p, { engrave: false }), "No");
});

test("formatParamValue(): an empty string value formats to null (nothing worth showing)", () => {
  const p = { name: "label", section: "Main", description: "Label", help: "", type: "string", default: "", info: { label: null, unit: null } };
  assert.equal(formatParamValue(p, { label: "  " }), null);
  assert.equal(formatParamValue(p, { label: "Hello" }), "Hello");
});

test("formatParamValue(): enum resolves to its choice label, falling back to the raw value", () => {
  const p = {
    name: "style",
    section: "Main",
    description: "Style",
    help: "",
    type: "enum",
    default: "a",
    choices: [{ value: "a", label: "Style A" }],
    info: { label: null, unit: null },
  };
  assert.equal(formatParamValue(p, { style: "a" }), "Style A");
  assert.equal(formatParamValue(p, { style: "unknown" }), "unknown");
});

test("paramInfoRows(): only @info params with a non-empty value, in design order", () => {
  const d = design([
    numberParam("width", { info: { label: null, unit: "mm" } }),
    numberParam("depth"), // no @info — excluded
    { name: "label", section: "Main", description: "Label", help: "", type: "string", default: "", info: { label: "Engraved text", unit: null } },
  ]);
  const rows = paramInfoRows(d, { width: 90, depth: 45, label: "" });
  assert.deepEqual(rows, [{ key: "param:width", label: "width", value: "90 mm" }]);
});

test("paramInfoRows(): a showIf-hidden @info param is excluded", () => {
  const d = design([
    numberParam("width", { info: { label: null, unit: "mm" }, showIf: "on" }),
  ]);
  assert.deepEqual(paramInfoRows(d, { width: 90, on: false }), []);
  assert.deepEqual(paramInfoRows(d, { width: 90, on: true }), [{ key: "param:width", label: "width", value: "90 mm" }]);
});

test("buildReviewRows(): headline + @info rows + computed rows, in that order", () => {
  const d = design([numberParam("width", { info: { label: null, unit: "mm" } })]);
  const rows = buildReviewRows(d, { width: 90 }, { x: 90, y: 45, z: 3 }, [{ label: "Dot height", unit: "mm", value: "0.48 mm" }]);
  assert.deepEqual(rows, [
    { key: "dimensions", label: "Dimensions", value: "90.0 × 45.0 × 3.0 mm", headline: true },
    { key: "param:width", label: "width", value: "90 mm" },
    { key: "computed:0:Dot height", label: "Dot height", value: "0.48 mm" },
  ]);
});

test("buildReviewRows(): no headline row when size is null (no render has landed yet)", () => {
  const d = design([]);
  assert.deepEqual(buildReviewRows(d, {}, null, []), []);
});

test("readinessLabel(): one label per state", () => {
  assert.equal(readinessLabel("ready"), "Ready to export");
  assert.equal(readinessLabel("attention"), "Needs attention");
  assert.equal(readinessLabel("failed"), "Preview failed");
  assert.equal(readinessLabel("building"), "Preview building…");
});

test("readinessDotClass(): attention uses the shared warn token; others reuse renderStatus.ts", () => {
  assert.equal(readinessDotClass("attention"), "bg-warn");
  assert.equal(readinessDotClass("ready"), "bg-[#4ade80]");
  assert.equal(readinessDotClass("failed"), "bg-[#f87171]");
  assert.equal(readinessDotClass("building"), "bg-muted-foreground");
});

test("readinessPulse(): only the building state pulses", () => {
  assert.equal(readinessPulse("building"), true);
  assert.equal(readinessPulse("ready"), false);
  assert.equal(readinessPulse("attention"), false);
  assert.equal(readinessPulse("failed"), false);
});
