// Tests the pure derivation behind a review summary (src/lib/
// reviewSummary.ts): the row list built from a design's curated
// `designs[].reviewLabels` config plus one overall "Dimensions" row. No
// DOM/React harness needed since this module is dependency-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mm, formatBoundingBox, formatReviewValue, buildReviewSummaryRows } from "../src/lib/reviewSummary.ts";

// A minimal Design-shaped fixture — structurally sufficient for these tests,
// which run untyped under node:test.
function design(params) {
  return { id: "fixture", label: "Fixture", file: "fixture.scad", presets: [], sections: ["Main"], params };
}

function numberParam(name, overrides = {}) {
  return { name, section: "Main", description: name, help: "", type: "number", default: 0, ...overrides };
}

test("mm(): always shows at least one decimal", () => {
  assert.equal(mm(90), "90.0");
  assert.equal(mm(12.34), "12.3");
  assert.equal(mm(12.36), "12.4");
});

test("formatBoundingBox(): W × D × H with a unit suffix", () => {
  assert.equal(formatBoundingBox({ x: 90, y: 45, z: 3 }), "90.0 × 45.0 × 3.0 mm");
});

test("formatReviewValue(): number gets its @info unit appended", () => {
  const p = numberParam("thickness", { info: { label: null, unit: "mm" } });
  assert.equal(formatReviewValue(p, { thickness: 3 }), "3 mm");
});

test("formatReviewValue(): boolean renders as Yes/No", () => {
  const p = { name: "engrave", section: "Main", description: "Engrave", help: "", type: "boolean", default: false };
  assert.equal(formatReviewValue(p, { engrave: true }), "Yes");
  assert.equal(formatReviewValue(p, { engrave: false }), "No");
});

test("formatReviewValue(): an empty string value formats to null (nothing worth showing)", () => {
  const p = { name: "label", section: "Main", description: "Label", help: "", type: "string", default: "" };
  assert.equal(formatReviewValue(p, { label: "  " }), null);
  assert.equal(formatReviewValue(p, { label: "Hello" }), "Hello");
});

test("formatReviewValue(): enum resolves to its choice label, falling back to the raw value", () => {
  const p = {
    name: "style",
    section: "Main",
    description: "Style",
    help: "",
    type: "enum",
    default: "a",
    choices: [{ value: "a", label: "Style A" }],
  };
  assert.equal(formatReviewValue(p, { style: "a" }), "Style A");
  assert.equal(formatReviewValue(p, { style: "unknown" }), "unknown");
});

test("buildReviewSummaryRows(): [] when reviewLabels is unset and size is null", () => {
  const d = design([numberParam("width")]);
  assert.deepEqual(buildReviewSummaryRows(d, { width: 10 }, undefined, null), []);
});

test("buildReviewSummaryRows(): one row per curated label, in first-appearance order — not the param's description", () => {
  const d = design([
    { name: "label", section: "Text", description: "Free text label", help: "", type: "string", default: "" },
    numberParam("thickness"),
  ]);
  const rows = buildReviewSummaryRows(
    d,
    { label: "Hallo", thickness: 3 },
    { label: "Text", thickness: "Thickness" },
    null
  );
  assert.deepEqual(rows, [
    { key: "curated:0:Text", label: "Text", value: "Hallo" },
    { key: "curated:1:Thickness", label: "Thickness", value: "3" },
  ]);
});

test("buildReviewSummaryRows(): several params sharing one label merge into a single row, values joined \" / \"", () => {
  const d = design([
    { name: "label", section: "Text", description: "Label", help: "", type: "string", default: "" },
    { name: "font", section: "Text", description: "Font", help: "", type: "string", default: "", isFont: true },
  ]);
  const rows = buildReviewSummaryRows(
    d,
    { label: "Hallo", font: "Liberation Sans:style=Bold" },
    { label: "Text", font: "Text" },
    null
  );
  assert.deepEqual(rows, [{ key: "curated:0:Text", label: "Text", value: "Hallo / Liberation Sans:style=Bold" }]);
});

test("buildReviewSummaryRows(): excludes a hidden (@showIf) or empty-value param", () => {
  const d = design([
    numberParam("depth", { showIf: "on" }),
    { name: "note", section: "Text", description: "Note", help: "", type: "string", default: "" },
  ]);
  const rows = buildReviewSummaryRows(d, { depth: 5, on: false, note: "  " }, { depth: "Depth", note: "Note" }, null);
  assert.deepEqual(rows, []);
});

test("buildReviewSummaryRows(): a param not listed in reviewLabels contributes nothing", () => {
  const d = design([numberParam("width"), numberParam("depth")]);
  const rows = buildReviewSummaryRows(d, { width: 10, depth: 5 }, { width: "Width" }, null);
  assert.deepEqual(rows, [{ key: "curated:0:Width", label: "Width", value: "10" }]);
});

test("buildReviewSummaryRows(): row order follows reviewLabels' own key order, not the design's param-declaration order", () => {
  const d = design([
    // Declared in the OPPOSITE order from the deployment's curated intent.
    { name: "language_standard", section: "Text", description: "Language", help: "", type: "string", default: "" },
    { name: "text", section: "Text", description: "Text", help: "", type: "string", default: "" },
  ]);
  const rows = buildReviewSummaryRows(
    d,
    { text: "Erdgeschoss", language_standard: "de-basis-din32976-gross" },
    // Key order: text (Visible lettering) BEFORE language_standard (Language).
    { text: "Visible lettering", language_standard: "Language" },
    null
  );
  assert.deepEqual(rows, [
    { key: "curated:0:Visible lettering", label: "Visible lettering", value: "Erdgeschoss" },
    { key: "curated:1:Language", label: "Language", value: "de-basis-din32976-gross" },
  ]);
});

test("buildReviewSummaryRows(): appends one overall Dimensions row after the curated rows when size is known", () => {
  const d = design([{ name: "label", section: "Text", description: "Label", help: "", type: "string", default: "" }]);
  const rows = buildReviewSummaryRows(d, { label: "Hallo" }, { label: "Text" }, { x: 90, y: 45, z: 3 });
  assert.deepEqual(rows, [
    { key: "curated:0:Text", label: "Text", value: "Hallo" },
    { key: "dimensions", label: "Dimensions", value: "90.0 × 45.0 × 3.0 mm", headline: true },
  ]);
});

test("buildReviewSummaryRows(): no Dimensions row when size is null (no render has landed yet)", () => {
  const d = design([{ name: "label", section: "Text", description: "Label", help: "", type: "string", default: "" }]);
  const rows = buildReviewSummaryRows(d, { label: "Hallo" }, { label: "Text" }, null);
  assert.deepEqual(rows, [{ key: "curated:0:Text", label: "Text", value: "Hallo" }]);
});

test("buildReviewSummaryRows(): a Dimensions-only summary when reviewLabels is unset but size is known", () => {
  const d = design([numberParam("width")]);
  const rows = buildReviewSummaryRows(d, { width: 10 }, undefined, { x: 90, y: 45, z: 3 });
  assert.deepEqual(rows, [{ key: "dimensions", label: "Dimensions", value: "90.0 × 45.0 × 3.0 mm", headline: true }]);
});

test("buildReviewSummaryRows(): honours @review overrides, replacing a row's formatted value verbatim", () => {
  const d = design([{ name: "label", section: "Text", description: "Label", help: "", type: "string", default: "" }]);
  const rows = buildReviewSummaryRows(
    d,
    { label: "Raum 101" },
    { label: "Text" },
    null,
    new Map([["label", "RAUM 101"]])
  );
  assert.deepEqual(rows, [{ key: "curated:0:Text", label: "Text", value: "RAUM 101" }]);
});

test("buildReviewSummaryRows(): an override replaces the value, param-by-param, before joining several params under one label", () => {
  const d = design([
    { name: "label", section: "Text", description: "Label", help: "", type: "string", default: "" },
    { name: "font", section: "Text", description: "Font", help: "", type: "string", default: "" },
  ]);
  const rows = buildReviewSummaryRows(
    d,
    { label: "Raum 101", font: "Liberation Sans" },
    { label: "Text", font: "Text" },
    null,
    new Map([["label", "RAUM 101"]])
  );
  assert.deepEqual(rows, [{ key: "curated:0:Text", label: "Text", value: "RAUM 101 / Liberation Sans" }]);
});

test("buildReviewSummaryRows(): with no reviewOverrides map, behaves exactly as before (raw formatted value)", () => {
  const d = design([{ name: "label", section: "Text", description: "Label", help: "", type: "string", default: "" }]);
  const rows = buildReviewSummaryRows(d, { label: "Raum 101" }, { label: "Text" }, null);
  assert.deepEqual(rows, [{ key: "curated:0:Text", label: "Text", value: "Raum 101" }]);
});
