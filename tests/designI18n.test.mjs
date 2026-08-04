// Tests src/lib/designI18n.ts's pure projection of a design-translation
// sidecar (scripts/lib/design-strings.mjs validates the sidecar itself at
// build time; this only covers applying an ALREADY-VALID one to a Design).
import { test } from "node:test";
import assert from "node:assert/strict";
import { localizeDesign, localizeEcho } from "../src/lib/designI18n.ts";

// A minimal Design-shaped fixture: structurally sufficient for these tests,
// which run untyped under node:test (same idiom as tests/reviewSummary.test.mjs).
function design(overrides = {}) {
  return {
    id: "fixture",
    label: "Fixture",
    file: "fixture.scad",
    presets: [],
    description: "A little widget.",
    sections: ["Main", "Advanced"],
    collapsedSections: ["Advanced"],
    reviewLabels: { text: "Text" },
    reviewNote: "Prints exactly as typed.",
    params: [
      { name: "text", section: "Main", description: "The label to engrave.", help: "Letters and digits.", type: "string", default: "hi" },
      {
        name: "width",
        section: "Main",
        description: "Plate width.",
        help: "In millimetres.",
        type: "number",
        default: 10,
        info: { label: null, unit: "mm" },
      },
      {
        name: "style",
        section: "Advanced",
        description: "Visual style.",
        help: "",
        type: "enum",
        default: "flat",
        choices: [
          { value: "flat", label: "Flat" },
          { value: "raised", label: "Raised" },
        ],
      },
    ],
    ...overrides,
  };
}

test("localizeDesign: undefined strings returns the SAME reference", () => {
  const d = design();
  assert.strictEqual(localizeDesign(d, undefined), d);
});

test("localizeDesign: an empty object returns the SAME reference", () => {
  const d = design();
  assert.strictEqual(localizeDesign(d, {}), d);
});

test("localizeDesign: a sidecar with only 'echo' entries returns the SAME reference (echo never touches Design)", () => {
  const d = design();
  assert.strictEqual(localizeDesign(d, { echo: { "Total width": "Gesamtbreite" } }), d);
});

test("localizeDesign: description/help/reviewLabels/reviewNote translate; the original design is untouched", () => {
  const d = design();
  const out = localizeDesign(d, {
    description: "Ein kleines Widget.",
    params: {
      text: { description: "Der zu gravierende Text.", help: "Buchstaben und Zahlen." },
    },
    reviewLabels: { text: "Gravurtext" },
    reviewNote: "Wird exakt wie eingegeben gedruckt.",
  });
  assert.notStrictEqual(out, d);
  assert.equal(out.description, "Ein kleines Widget.");
  assert.equal(out.params.find((p) => p.name === "text").description, "Der zu gravierende Text.");
  assert.equal(out.params.find((p) => p.name === "text").help, "Buchstaben und Zahlen.");
  assert.deepEqual(out.reviewLabels, { text: "Gravurtext" });
  assert.equal(out.reviewNote, "Wird exakt wie eingegeben gedruckt.");
  // The original Design object is never mutated.
  assert.equal(d.description, "A little widget.");
  assert.equal(d.params.find((p) => p.name === "text").description, "The label to engrave.");
  assert.deepEqual(d.reviewLabels, { text: "Text" });
});

test("localizeDesign: a param the sidecar doesn't mention keeps its authored text", () => {
  const d = design();
  const out = localizeDesign(d, { params: { text: { description: "Der Text." } } });
  const width = out.params.find((p) => p.name === "width");
  assert.equal(width.description, "Plate width.");
  assert.equal(width.help, "In millimetres.");
});

test("localizeDesign: sections/collapsedSections/params[].section rename coherently from ONE map; an untranslated section keeps its name everywhere", () => {
  const d = design();
  const out = localizeDesign(d, { sections: { Main: "Haupt" } });
  assert.deepEqual(out.sections, ["Haupt", "Advanced"]);
  assert.deepEqual(out.collapsedSections, ["Advanced"]); // untranslated: unchanged
  assert.equal(out.params.find((p) => p.name === "text").section, "Haupt");
  assert.equal(out.params.find((p) => p.name === "style").section, "Advanced"); // untranslated
});

test("localizeDesign: translating the collapsed section renames it in collapsedSections too", () => {
  const d = design();
  const out = localizeDesign(d, { sections: { Advanced: "Erweitert" } });
  assert.deepEqual(out.sections, ["Main", "Erweitert"]);
  assert.deepEqual(out.collapsedSections, ["Erweitert"]);
  assert.equal(out.params.find((p) => p.name === "style").section, "Erweitert");
});

test("localizeDesign: enum choice LABELS translate by declared VALUE; the value itself never changes", () => {
  const d = design();
  const out = localizeDesign(d, { params: { style: { choices: { flat: "Flach", raised: "Erhöht" } } } });
  const choices = out.params.find((p) => p.name === "style").choices;
  assert.deepEqual(choices, [
    { value: "flat", label: "Flach" },
    { value: "raised", label: "Erhöht" },
  ]);
});

test("localizeDesign: a choices map that only translates SOME values leaves the rest as authored", () => {
  const d = design();
  const out = localizeDesign(d, { params: { style: { choices: { flat: "Flach" } } } });
  const choices = out.params.find((p) => p.name === "style").choices;
  assert.deepEqual(choices, [
    { value: "flat", label: "Flach" },
    { value: "raised", label: "Raised" },
  ]);
});

test("localizeDesign: @info label/unit translate independently; a null label still falls back correctly downstream", () => {
  const d = design();
  const out = localizeDesign(d, { params: { width: { info: { label: "Breite" } } } });
  const info = out.params.find((p) => p.name === "width").info;
  assert.equal(info.label, "Breite");
  assert.equal(info.unit, "mm"); // untouched: sidecar didn't set it
});

test("localizeDesign: parameter NAMES are never translated (they're -D render args and stored/URL state keys)", () => {
  const d = design();
  const out = localizeDesign(d, { params: { text: { description: "Der Text." } } });
  assert.deepEqual(
    out.params.map((p) => p.name),
    ["text", "width", "style"]
  );
});

test("localizeEcho: a matching source string translates", () => {
  assert.equal(localizeEcho({ echo: { "Total width": "Gesamtbreite" } }, "Total width"), "Gesamtbreite");
});

test("localizeEcho: a miss (no sidecar, or no entry for this source string) returns the source unchanged", () => {
  assert.equal(localizeEcho(undefined, "Total width"), "Total width");
  assert.equal(localizeEcho({ echo: {} }, "Total width"), "Total width");
  assert.equal(localizeEcho({ echo: { "Other label": "x" } }, "Total width"), "Total width");
});
