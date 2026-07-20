// Unit tests for src/lib/fontChoices.ts — the grouped option list behind the
// font selector: every installed face under a friendly name, design-suggested
// or selected-but-missing faces kept visible, and stored/enum values preserved
// so listing never dirties a value or breaks preset matching.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFontChoices, fontValueLabel, fontFallback, isFontMissing } from "../src/lib/fontChoices.ts";

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

// fontFallback (moved from ParamRows.tsx to be shared with readiness.ts's
// deriveAttention — PR22's consolidated attention chip and Review stage both
// offer a "Use a bundled font" action driven by this same target selection).
test("fontFallback: a string param grafts the suggested family onto the current value, preserving :style=", () => {
  const target = fontFallback(stringParam, "Comic Sans MS:style=Bold", new Set(["liberation sans"]), "Liberation Sans");
  assert.deepEqual(target, { value: "Liberation Sans:style=Bold", label: "Liberation Sans" });
});

test("fontFallback: a string param with no suggestion (or already matching) yields null", () => {
  assert.equal(fontFallback(stringParam, "Comic Sans MS", new Set(["liberation sans"]), null), null);
  assert.equal(fontFallback(stringParam, "Comic Sans MS", new Set(["liberation sans"]), undefined), null);
  // Suggestion already matches the current family — nothing to change.
  assert.equal(fontFallback(stringParam, "Liberation Sans", new Set(["liberation sans"]), "Liberation Sans"), null);
});

test("fontFallback: an enum param picks the first listed choice whose family is loaded", () => {
  const param = enumParam(["Nope One", "Liberation Sans:style=Bold", "Nope Two"]);
  const target = fontFallback(param, "Nope One", new Set(["liberation sans"]), null);
  assert.deepEqual(target, { value: "Liberation Sans:style=Bold", label: "Liberation Sans" });
});

test("fontFallback: an enum param with no loaded choice yields null, even with a string suggestion", () => {
  const param = enumParam(["Nope One", "Nope Two"]);
  assert.equal(fontFallback(param, "Nope One", new Set(["liberation sans"]), "Liberation Sans"), null);
});

test("fontFallback: an enum param never matches against an empty/undefined available set", () => {
  const param = enumParam(["Nope One"]);
  assert.equal(fontFallback(param, "Nope One", undefined, null), null);
  assert.equal(fontFallback(param, "Nope One", new Set(), null), null);
});

test("fontFallback: a string param's suggestion doesn't depend on `available` at all (free text has no list to check against)", () => {
  assert.deepEqual(fontFallback(stringParam, "Comic Sans MS", undefined, "Liberation Sans"), {
    value: "Liberation Sans",
    label: "Liberation Sans",
  });
});

// isFontMissing — the "font not loaded" predicate shared by ParamRows'
// FontMissingHint and readiness.ts's deriveAttention (see A2's fix: the two
// used to diverge on an EMPTY font value, ParamRows showing a bogus "'' isn't
// loaded" hint that readiness.ts's own loop already correctly skipped).
test("isFontMissing: an empty value is never missing, regardless of the available set", () => {
  assert.equal(isFontMissing("", new Set(["liberation sans"])), false);
  assert.equal(isFontMissing("", new Set()), false);
  assert.equal(isFontMissing("", undefined), false);
});

test("isFontMissing: no checking without an authoritative (non-empty) available set", () => {
  assert.equal(isFontMissing("Comic Sans MS", undefined), false);
  assert.equal(isFontMissing("Comic Sans MS", new Set()), false);
});

test("isFontMissing: true for a family absent from the available set, false when present", () => {
  assert.equal(isFontMissing("Comic Sans MS", new Set(["liberation sans"])), true);
  assert.equal(isFontMissing("Liberation Sans:style=Bold", new Set(["liberation sans"])), false);
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
