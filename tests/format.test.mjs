// Unit tests for src/lib/format.ts — the shared display formatting behind the
// viewer's measurements panel (DimensionInfo.tsx) and the pre-download review
// summary (reviewSummary.ts): millimetre figures and a parameter's current
// value rendered the same way wherever a visitor sees it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mm, formatParamValue } from "../src/lib/format.ts";

function numberParam(name, overrides = {}) {
  return { name, section: "Main", description: name, help: "", type: "number", default: 0, ...overrides };
}

test("mm(): always shows at least one decimal", () => {
  assert.equal(mm(90), "90.0");
  assert.equal(mm(12.34), "12.3");
  assert.equal(mm(12.36), "12.4");
});

test("formatParamValue(): number gets its @info unit appended", () => {
  const p = numberParam("thickness", { info: { label: null, unit: "mm" } });
  assert.equal(formatParamValue(p, { thickness: 3 }), "3 mm");
});

test("formatParamValue(): boolean renders as Yes/No", () => {
  const p = { name: "engrave", section: "Main", description: "Engrave", help: "", type: "boolean", default: false };
  assert.equal(formatParamValue(p, { engrave: true }), "Yes");
  assert.equal(formatParamValue(p, { engrave: false }), "No");
});

test("formatParamValue(): an empty string value formats to null (nothing worth showing)", () => {
  const p = { name: "label", section: "Main", description: "Label", help: "", type: "string", default: "" };
  assert.equal(formatParamValue(p, { label: "  " }), null);
  assert.equal(formatParamValue(p, { label: "Hello" }), "Hello");
});

test("formatParamValue(): a font param shows the dropdown's friendly name, not the raw Fontconfig string", () => {
  // String-typed font param: "Family:style=Style" → "Family Style".
  const strFont = { name: "font", section: "Main", description: "Font", help: "", type: "string", default: "", isFont: true };
  assert.equal(formatParamValue(strFont, { font: "Liberation Sans:style=Bold" }), "Liberation Sans Bold");
  // The redundant Regular face collapses to the bare family, like the selector.
  assert.equal(formatParamValue(strFont, { font: "Liberation Sans:style=Regular" }), "Liberation Sans");
  // An empty font value is nothing worth showing.
  assert.equal(formatParamValue(strFont, { font: "  " }), null);

  // Quoted-string enum font param (a design-suggested face list): the enum
  // choice's value/label IS the raw string, so it must still be humanised.
  const enumFont = {
    name: "font",
    section: "Main",
    description: "Font",
    help: "",
    type: "enum",
    default: "Liberation Sans:style=Bold",
    isFont: true,
    choices: [{ value: "Liberation Sans:style=Bold", label: "Liberation Sans:style=Bold" }],
  };
  assert.equal(formatParamValue(enumFont, { font: "Liberation Sans:style=Bold" }), "Liberation Sans Bold");
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
  };
  assert.equal(formatParamValue(p, { style: "a" }), "Style A");
  assert.equal(formatParamValue(p, { style: "unknown" }), "unknown");
});

