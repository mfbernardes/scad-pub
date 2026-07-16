// Unit tests for src/lib/fontChoices.ts — the grouped option list behind the
// font selector: every installed face under a friendly name, design-suggested
// or selected-but-missing faces kept visible, and stored/enum values preserved
// so listing never dirties a value or breaks preset matching.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFontChoices, fontValueLabel } from "../src/lib/fontChoices.ts";

const FONTS = [
  { family: "Atkinson Hyperlegible", style: "Regular", imported: false },
  { family: "Liberation Sans", style: "Regular", imported: false },
  { family: "Liberation Sans", style: "Bold", imported: false },
  { family: "DejaVu Sans", style: "Bold", imported: true },
];

const base = { name: "font", section: "S", description: "Font", help: "" };
const stringParam = { ...base, type: "string", default: "", isFont: true };
const enumParam = (choices) => ({
  ...base,
  type: "enum",
  default: choices[0],
  choices: choices.map((value) => ({ value, label: value })),
  isFont: true,
});

test("fontValueLabel is the friendly face name, never the Fontconfig string", () => {
  assert.equal(fontValueLabel("Fictional Display Face:style=Regular"), "Fictional Display Face");
  assert.equal(fontValueLabel("Liberation Sans:style=Bold"), "Liberation Sans Bold");
  assert.equal(fontValueLabel("Liberation Sans"), "Liberation Sans");
});

test("every installed face is listed with a friendly label and canonical value", () => {
  const { installed, missing } = buildFontChoices(stringParam, "Liberation Sans", FONTS);
  assert.deepEqual(
    installed.map((c) => [c.value, c.label, c.imported]),
    [
      ["Atkinson Hyperlegible", "Atkinson Hyperlegible", false],
      ["Liberation Sans", "Liberation Sans", false],
      ["Liberation Sans:style=Bold", "Liberation Sans Bold", false],
      ["DejaVu Sans:style=Bold", "DejaVu Sans Bold", true],
    ]
  );
  // The selected value names an installed face — nothing is "missing".
  assert.deepEqual(missing, []);
});

test("an installed face's entry reuses the stored value that already names it", () => {
  // A preset stored "Atkinson Hyperlegible:style=Regular"; the entry must carry
  // that exact string so the dropdown selects it without rewriting the value.
  const value = "Atkinson Hyperlegible:style=Regular";
  const { installed } = buildFontChoices(stringParam, value, FONTS);
  assert.equal(installed.find((c) => c.label === "Atkinson Hyperlegible").value, value);
});

test("an installed face named by an enum choice reuses the choice's exact value", () => {
  const param = enumParam([
    "Fictional Display Face:style=Regular",
    "Atkinson Hyperlegible:style=Regular",
    "Liberation Sans:style=Bold",
  ]);
  const { installed, missing } = buildFontChoices(param, param.default, FONTS);
  // Installed faces the enum names keep the enum's value form (preset parity)…
  assert.equal(
    installed.find((c) => c.label === "Atkinson Hyperlegible").value,
    "Atkinson Hyperlegible:style=Regular"
  );
  assert.equal(
    installed.find((c) => c.label === "Liberation Sans Bold").value,
    "Liberation Sans:style=Bold"
  );
  // …while the not-installed suggestion stays visible, clearly not installed.
  assert.deepEqual(
    missing.map((c) => [c.value, c.label, c.installed]),
    [["Fictional Display Face:style=Regular", "Fictional Display Face", false]]
  );
});

test("a selected value nothing lists stays visible as a missing entry", () => {
  const { missing } = buildFontChoices(stringParam, "Comic Sans MS:style=Bold", FONTS);
  assert.deepEqual(missing, [
    { value: "Comic Sans MS:style=Bold", label: "Comic Sans MS Bold", installed: false },
  ]);
});

test("a selected missing enum choice is listed once, under the stored value", () => {
  const param = enumParam(["Fictional Display Face:style=Regular"]);
  const { missing } = buildFontChoices(param, "Fictional Display Face:style=Regular", FONTS);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].value, "Fictional Display Face:style=Regular");
});

test("an empty value yields no phantom entry", () => {
  const { installed, missing } = buildFontChoices(stringParam, "", FONTS);
  assert.equal(installed.length, FONTS.length);
  assert.deepEqual(missing, []);
});

test("with nothing installed, the design's suggestions still show as missing", () => {
  const param = enumParam(["A", "B:style=Bold"]);
  const { installed, missing } = buildFontChoices(param, "A", []);
  assert.deepEqual(installed, []);
  assert.deepEqual(
    missing.map((c) => [c.value, c.label]),
    [
      ["A", "A"],
      ["B:style=Bold", "B Bold"],
    ]
  );
});
