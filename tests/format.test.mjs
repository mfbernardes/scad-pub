// Unit tests for src/lib/format.ts: the shared display formatting behind the
// viewer's measurements panel (DimensionInfo.tsx) and the pre-download review
// summary (reviewSummary.ts): millimetre figures and a parameter's current
// value rendered the same way wherever a visitor sees it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mm, formatParamValue } from "../src/lib/format.ts";
import { rebind, defaultTag, overridesForLocale } from "../src/lib/i18n.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const generatedSchema = JSON.parse(
  readFileSync(join(HERE, "..", "src", "generated", "designs.json"), "utf-8")
);

// Mirrors tests/i18n.test.mjs's own helper: restores the module-level binding
// i18n.ts's init produced, so a test that rebinds away from it (to exercise
// mm()'s locale sensitivity) leaves the file exactly as it found it.
function restoreDefaultBinding() {
  rebind(defaultTag, null, overridesForLocale(generatedSchema.strings, defaultTag, defaultTag));
}

function numberParam(name, overrides = {}) {
  return { name, section: "Main", description: name, help: "", type: "number", default: 0, ...overrides };
}

test("mm(): always shows at least one decimal", () => {
  assert.equal(mm(90), "90.0");
  assert.equal(mm(12.34), "12.3");
  assert.equal(mm(12.36), "12.4");
});

test("mm(): never groups digits — a CAD callout is a technical readout, not prose", () => {
  // Ungrouped in English ("1234.5", not "1,234.5") and, critically, still
  // ungrouped in German: de's grouping separator is a dot, which in an
  // ungrouped decimal position would misread as the decimal point itself.
  assert.equal(mm(1234.5), "1234.5");
  try {
    rebind("de", null, {});
    assert.equal(mm(1234.5), "1234,5");
  } finally {
    restoreDefaultBinding();
  }
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

