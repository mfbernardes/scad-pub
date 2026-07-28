// Tests the pure derivation behind a review summary (src/lib/
// reviewSummary.ts): the row list built from a design's curated
// `reviewLabels` (gathered by gen-schema from each parameter's own
// `// @review "<label>"` annotation — there is no config-level source)
// plus one overall "Dimensions" row. No DOM/React harness needed. Value
// formatting itself lives in src/lib/format.ts and is covered by
// tests/format.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBoundingBox, buildReviewSummaryRows } from "../src/lib/reviewSummary.ts";

// A minimal Design-shaped fixture — structurally sufficient for these tests,
// which run untyped under node:test.
function design(params) {
  return { id: "fixture", label: "Fixture", file: "fixture.scad", presets: [], sections: ["Main"], params };
}

function numberParam(name, overrides = {}) {
  return { name, section: "Main", description: name, help: "", type: "number", default: 0, ...overrides };
}

test("formatBoundingBox(): W × D × H with a unit suffix", () => {
  assert.equal(formatBoundingBox({ x: 90, y: 45, z: 3 }), "90.0 × 45.0 × 3.0 mm");
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
    { label: "Hello", thickness: 3 },
    { label: "Text", thickness: "Thickness" },
    null
  );
  assert.deepEqual(rows, [
    { key: "curated:0:Text", label: "Text", value: "Hello" },
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
    { label: "Hello", font: "Liberation Sans:style=Bold" },
    { label: "Text", font: "Text" },
    null
  );
  // The font param's row value is its friendly name, matching the selector.
  assert.deepEqual(rows, [{ key: "curated:0:Text", label: "Text", value: "Hello / Liberation Sans Bold" }]);
});

test("buildReviewSummaryRows(): a @review override on a font param wins verbatim, skipping the friendly naming", () => {
  const d = design([
    { name: "font", section: "Text", description: "Font", help: "", type: "string", default: "", isFont: true },
  ]);
  const rows = buildReviewSummaryRows(
    d,
    { font: "Liberation Sans:style=Bold" },
    { font: "Typeface" },
    null,
    new Map([["font", "Liberation Sans:style=Bold (custom label)"]])
  );
  assert.deepEqual(rows, [
    { key: "curated:0:Typeface", label: "Typeface", value: "Liberation Sans:style=Bold (custom label)" },
  ]);
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
    { name: "units", section: "Text", description: "Units", help: "", type: "string", default: "" },
    { name: "text", section: "Text", description: "Text", help: "", type: "string", default: "" },
  ]);
  const rows = buildReviewSummaryRows(
    d,
    { text: "Ground floor", units: "metric" },
    // Key order: text (Visible lettering) BEFORE units (Units).
    { text: "Visible lettering", units: "Units" },
    null
  );
  assert.deepEqual(rows, [
    { key: "curated:0:Visible lettering", label: "Visible lettering", value: "Ground floor" },
    { key: "curated:1:Units", label: "Units", value: "metric" },
  ]);
});

test("buildReviewSummaryRows(): appends one overall Dimensions row after the curated rows when size is known", () => {
  const d = design([{ name: "label", section: "Text", description: "Label", help: "", type: "string", default: "" }]);
  const rows = buildReviewSummaryRows(d, { label: "Hello" }, { label: "Text" }, { x: 90, y: 45, z: 3 });
  assert.deepEqual(rows, [
    { key: "curated:0:Text", label: "Text", value: "Hello" },
    { key: "dimensions", label: "Dimensions", value: "90.0 × 45.0 × 3.0 mm", headline: true },
  ]);
});

test("buildReviewSummaryRows(): no Dimensions row when size is null (no render has landed yet)", () => {
  const d = design([{ name: "label", section: "Text", description: "Label", help: "", type: "string", default: "" }]);
  const rows = buildReviewSummaryRows(d, { label: "Hello" }, { label: "Text" }, null);
  assert.deepEqual(rows, [{ key: "curated:0:Text", label: "Text", value: "Hello" }]);
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
    { label: "gate 12" },
    { label: "Text" },
    null,
    new Map([["label", "GATE 12"]])
  );
  assert.deepEqual(rows, [{ key: "curated:0:Text", label: "Text", value: "GATE 12" }]);
});

test("buildReviewSummaryRows(): an override replaces the value, param-by-param, before joining several params under one label", () => {
  const d = design([
    { name: "label", section: "Text", description: "Label", help: "", type: "string", default: "" },
    { name: "font", section: "Text", description: "Font", help: "", type: "string", default: "" },
  ]);
  const rows = buildReviewSummaryRows(
    d,
    { label: "gate 12", font: "Liberation Sans" },
    { label: "Text", font: "Text" },
    null,
    new Map([["label", "GATE 12"]])
  );
  assert.deepEqual(rows, [{ key: "curated:0:Text", label: "Text", value: "GATE 12 / Liberation Sans" }]);
});

test("buildReviewSummaryRows(): with no reviewOverrides map, behaves exactly as before (raw formatted value)", () => {
  const d = design([{ name: "label", section: "Text", description: "Label", help: "", type: "string", default: "" }]);
  const rows = buildReviewSummaryRows(d, { label: "gate 12" }, { label: "Text" }, null);
  assert.deepEqual(rows, [{ key: "curated:0:Text", label: "Text", value: "gate 12" }]);
});
