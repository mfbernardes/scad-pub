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
  truncateMiddle,
  formatEssentialValue,
  essentialParamRows,
  displayInfoRows,
  buildReviewSummaryRows,
  buildCuratedReviewRows,
  buildGuidedReviewRows,
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

test("truncateMiddle(): a no-op when the value already fits", () => {
  assert.equal(truncateMiddle("short", 60), "short");
});

test("truncateMiddle(): keeps the start and end, ellipsis in the middle", () => {
  const s = "a".repeat(30) + "b".repeat(30);
  const out = truncateMiddle(s, 21);
  assert.equal(out.length, 21);
  assert.ok(out.startsWith("a"));
  assert.ok(out.endsWith("b"));
  assert.ok(out.includes("…"));
});

test("formatEssentialValue(): a font string param shows the family name only, stripping :style=…", () => {
  const p = { name: "font", section: "Text", description: "Font", help: "", type: "string", default: "", isFont: true };
  assert.equal(formatEssentialValue(p, { font: "DIN 32986 Taktil Positiv:style=Regular" }), "DIN 32986 Taktil Positiv");
});

test("formatEssentialValue(): a font enum param also shows the family name only", () => {
  const p = {
    name: "font",
    section: "Text",
    description: "Font",
    help: "",
    type: "enum",
    default: "a",
    isFont: true,
    choices: [{ value: "a", label: "A" }],
  };
  assert.equal(formatEssentialValue(p, { font: "Liberation Sans:style=Bold" }), "Liberation Sans");
});

test("formatEssentialValue(): long free text is middle-truncated", () => {
  const p = { name: "label", section: "Text", description: "Label", help: "", type: "string", default: "" };
  const long = "x".repeat(100);
  const out = formatEssentialValue(p, { label: long });
  assert.ok(out.length < long.length);
  assert.ok(out.includes("…"));
});

test("formatEssentialValue(): boolean/enum/number use the same rules as formatParamValue", () => {
  const bp = { name: "on", section: "Main", description: "On", help: "", type: "boolean", default: false };
  assert.equal(formatEssentialValue(bp, { on: true }), "Yes");
  const np = numberParam("count");
  assert.equal(formatEssentialValue(np, { count: 5 }), "5");
});

test("essentialParamRows(): every visible non-advanced param, in design order — not limited to @info", () => {
  const d = design([
    numberParam("width"),
    numberParam("facet", { advanced: true }), // excluded: advanced
    numberParam("depth", { showIf: "on" }), // excluded: hidden
  ]);
  assert.deepEqual(essentialParamRows(d, { width: 10, facet: 1, depth: 5, on: false }), [
    { key: "essential:width", label: "width", value: "10" },
  ]);
});

test("essentialParamRows(): an empty-string value is excluded, same rule as paramInfoRows", () => {
  const d = design([
    { name: "label", section: "Main", description: "Label", help: "", type: "string", default: "" },
  ]);
  assert.deepEqual(essentialParamRows(d, { label: "  " }), []);
});

test("buildCuratedReviewRows(): returns [] when reviewLabels is unset", () => {
  const d = design([numberParam("width")]);
  assert.deepEqual(buildCuratedReviewRows(d, { width: 10 }, undefined), []);
});

test("buildCuratedReviewRows(): one row per curated label, in first-appearance order — not the param's description", () => {
  const d = design([
    { name: "label", section: "Text", description: "Free text label", help: "", type: "string", default: "" },
    numberParam("thickness"),
  ]);
  const rows = buildCuratedReviewRows(d, { label: "Hallo", thickness: 3 }, { label: "Text", thickness: "Thickness" });
  assert.deepEqual(rows, [
    { key: "curated:0:Text", label: "Text", value: "Hallo" },
    { key: "curated:1:Thickness", label: "Thickness", value: "3" },
  ]);
});

test("buildCuratedReviewRows(): several params sharing one label merge into a single row, values joined \" / \"", () => {
  const d = design([
    { name: "label", section: "Text", description: "Label", help: "", type: "string", default: "" },
    { name: "font", section: "Text", description: "Font", help: "", type: "string", default: "", isFont: true },
  ]);
  const rows = buildCuratedReviewRows(
    d,
    { label: "Hallo", font: "Liberation Sans:style=Bold" },
    { label: "Text", font: "Text" }
  );
  assert.deepEqual(rows, [{ key: "curated:0:Text", label: "Text", value: "Hallo / Liberation Sans" }]);
});

test("buildCuratedReviewRows(): excludes a hidden (@showIf) or empty-value param, same rule as the other row builders", () => {
  const d = design([
    numberParam("depth", { showIf: "on" }),
    { name: "note", section: "Text", description: "Note", help: "", type: "string", default: "" },
  ]);
  const rows = buildCuratedReviewRows(d, { depth: 5, on: false, note: "  " }, { depth: "Depth", note: "Note" });
  assert.deepEqual(rows, []);
});

test("buildCuratedReviewRows(): a param not listed in reviewLabels contributes nothing", () => {
  const d = design([numberParam("width"), numberParam("depth")]);
  const rows = buildCuratedReviewRows(d, { width: 10, depth: 5 }, { width: "Width" });
  assert.deepEqual(rows, [{ key: "curated:0:Width", label: "Width", value: "10" }]);
});

// Round-6, item 3: row order follows the ORDER OF KEYS in the `reviewLabels`
// OBJECT — a deployment's declared curation order — not the order those same
// params happen to be declared in the design's own .scad file. Reproduces
// the exact bug report: a design that declares `language_standard` before
// `text` (so param-declaration order would put "Language" first), paired
// with a deployment's reviewLabels ordering `text` before `language_standard`
// (so "Visible lettering" should lead instead).
test("buildCuratedReviewRows(): row order follows reviewLabels' own key order, not the design's param-declaration order", () => {
  const d = design([
    // Declared in the OPPOSITE order from the deployment's curated intent.
    { name: "language_standard", section: "Text", description: "Language", help: "", type: "string", default: "" },
    { name: "text", section: "Text", description: "Text", help: "", type: "string", default: "" },
  ]);
  const rows = buildCuratedReviewRows(
    d,
    { text: "Erdgeschoss", language_standard: "de-basis-din32976-gross" },
    // Key order: text (Visible lettering) BEFORE language_standard (Language).
    { text: "Visible lettering", language_standard: "Language" }
  );
  assert.deepEqual(rows, [
    { key: "curated:0:Visible lettering", label: "Visible lettering", value: "Erdgeschoss" },
    { key: "curated:1:Language", label: "Language", value: "de-basis-din32976-gross" },
  ]);
});

test("buildGuidedReviewRows(): curated rows first, then ONLY the overall Dimensions row — never @info/computed metric rows, essentialParamRows, or displayInfoRows", () => {
  const d = design([
    { name: "label", section: "Text", description: "Label", help: "", type: "string", default: "" },
    numberParam("thickness", { info: { label: null, unit: "mm" } }),
  ]);
  const rows = buildGuidedReviewRows(
    d,
    { label: "Hallo", thickness: 3 },
    { label: "Text" },
    { x: 90, y: 45, z: 3 }
  );
  assert.deepEqual(rows, [
    { key: "curated:0:Text", label: "Text", value: "Hallo" },
    { key: "dimensions", label: "Dimensions", value: "90.0 × 45.0 × 3.0 mm", headline: true },
  ]);
});

test("buildGuidedReviewRows(): no Dimensions row when size is null (no render has landed yet)", () => {
  const d = design([{ name: "label", section: "Text", description: "Label", help: "", type: "string", default: "" }]);
  const rows = buildGuidedReviewRows(d, { label: "Hallo" }, { label: "Text" }, null);
  assert.deepEqual(rows, [{ key: "curated:0:Text", label: "Text", value: "Hallo" }]);
});

// Round-6, item 3: with several curated rows, Dimensions is inserted BEFORE
// the last one (a mounting/placement concern, per a real deployment config —
// see docs/config.md), reproducing the target order named in the milestone
// brief: Visible lettering, Language, Lettering profile, Dimensions, Mounting.
test("buildGuidedReviewRows(): with 2+ curated rows, Dimensions is inserted BEFORE the last curated row (not appended after all of them)", () => {
  const d = design([
    { name: "text", section: "Text", description: "Text", help: "", type: "string", default: "" },
    { name: "language_standard", section: "Text", description: "Language", help: "", type: "string", default: "" },
    { name: "font", section: "Text", description: "Font", help: "", type: "string", default: "" },
    { name: "mounting", section: "Mounting", description: "Mounting", help: "", type: "string", default: "" },
  ]);
  const rows = buildGuidedReviewRows(
    d,
    { text: "Erdgeschoss", language_standard: "de-basis-din32976-gross", font: "DIN 32986 Taktil", mounting: "Wandmontage" },
    {
      text: "Visible lettering",
      language_standard: "Language",
      font: "Lettering profile",
      mounting: "Mounting",
    },
    { x: 150, y: 150, z: 5 }
  );
  assert.deepEqual(
    rows.map((r) => r.label),
    ["Visible lettering", "Language", "Lettering profile", "Dimensions", "Mounting"]
  );
});

test("buildGuidedReviewRows(): curated rows honour @review overrides, same as buildCuratedReviewRows", () => {
  const d = design([{ name: "label", section: "Text", description: "Label", help: "", type: "string", default: "" }]);
  const rows = buildGuidedReviewRows(
    d,
    { label: "Raum 101" },
    { label: "Text" },
    null,
    new Map([["label", "RAUM 101"]])
  );
  assert.deepEqual(rows, [{ key: "curated:0:Text", label: "Text", value: "RAUM 101" }]);
});

test("buildCuratedReviewRows(): a @review override replaces the row's value, param-by-param, before joining several params under one label", () => {
  const d = design([
    { name: "label", section: "Text", description: "Label", help: "", type: "string", default: "" },
    { name: "font", section: "Text", description: "Font", help: "", type: "string", default: "", isFont: true },
  ]);
  const rows = buildCuratedReviewRows(
    d,
    { label: "Raum 101", font: "Liberation Sans:style=Bold" },
    { label: "Text", font: "Text" },
    new Map([["label", "RAUM 101"]])
  );
  assert.deepEqual(rows, [{ key: "curated:0:Text", label: "Text", value: "RAUM 101 / Liberation Sans" }]);
});

test("buildCuratedReviewRows(): with no reviewOverrides map, behaves exactly as before (raw formatted value)", () => {
  const d = design([{ name: "label", section: "Text", description: "Label", help: "", type: "string", default: "" }]);
  const rows = buildCuratedReviewRows(d, { label: "Raum 101" }, { label: "Text" });
  assert.deepEqual(rows, [{ key: "curated:0:Text", label: "Text", value: "Raum 101" }]);
});

test("displayInfoRows(): reshapes DisplayRow[] into ReviewRow[], flagging mostly-Braille values", () => {
  const rows = displayInfoRows([
    { step: "content", label: "Braille (automatic)", value: "⠗⠁⠥⠍" },
    { step: "content", label: "Mode", value: "raised" },
  ]);
  assert.deepEqual(rows, [
    { key: "display:0:content:Braille (automatic)", label: "Braille (automatic)", value: "⠗⠁⠥⠍", large: true, auto: true },
    { key: "display:1:content:Mode", label: "Mode", value: "raised", large: false, auto: true },
  ]);
});

test("buildReviewSummaryRows(): essential rows, then @display rows, then buildReviewRows' own rows", () => {
  const d = design([numberParam("width", { info: { label: null, unit: "mm" } })]);
  const rows = buildReviewSummaryRows(
    d,
    { width: 90 },
    { x: 90, y: 45, z: 3 },
    [{ label: "Dot height", unit: "mm", value: "0.48 mm" }],
    [{ step: "content", label: "Braille", value: "⠗" }]
  );
  assert.deepEqual(rows.map((r) => r.key), [
    "essential:width",
    "display:0:content:Braille",
    "dimensions",
    "param:width",
    "computed:0:Dot height",
  ]);
});

test("buildReviewRows(): no headline row when size is null (no render has landed yet)", () => {
  const d = design([]);
  assert.deepEqual(buildReviewRows(d, {}, null, []), []);
});

test("readinessLabel(): one label per state", () => {
  assert.equal(readinessLabel("ready"), "Ready to download");
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
