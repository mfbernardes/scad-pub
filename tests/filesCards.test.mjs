// Unit tests for the Files tab's schema-driven task-card derivation
// (src/lib/filesCards.ts, PR19 item 1). Mirrors tests/readiness.test.mjs's
// style (a synthetic baseline, overrides per test) — no DOM/React harness
// needed since this module is dependency-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFilesCards, missingFontFamilies } from "../src/lib/filesCards.ts";

function stringParam(overrides = {}) {
  return {
    name: "p",
    section: "Section",
    description: "P",
    help: "P",
    type: "string",
    default: "",
    ...overrides,
  };
}

function enumParam(overrides = {}) {
  return {
    name: "p",
    section: "Section",
    description: "P",
    help: "P",
    type: "enum",
    default: "a",
    choices: [{ value: "a", label: "A" }],
    ...overrides,
  };
}

test("deriveFilesCards: a design with no font/svg params shows neither card", () => {
  const info = deriveFilesCards([stringParam({ name: "label" })]);
  assert.deepEqual(info, { showFontCard: false, showSvgCard: false });
});

test("deriveFilesCards: a string `isFont` param shows the font card only", () => {
  const info = deriveFilesCards([stringParam({ name: "font", isFont: true })]);
  assert.deepEqual(info, { showFontCard: true, showSvgCard: false });
});

test("deriveFilesCards: an enum `isFont` param shows the font card too", () => {
  const info = deriveFilesCards([enumParam({ name: "font", isFont: true })]);
  assert.deepEqual(info, { showFontCard: true, showSvgCard: false });
});

test("deriveFilesCards: a string `svg` param shows the SVG card only", () => {
  const info = deriveFilesCards([stringParam({ name: "artwork", svg: { layers: null } })]);
  assert.deepEqual(info, { showFontCard: false, showSvgCard: true });
});

test("deriveFilesCards: a design with both shows both cards (order-independent)", () => {
  const info = deriveFilesCards([
    stringParam({ name: "font", isFont: true }),
    stringParam({ name: "artwork", svg: { layers: "layer_colors" } }),
  ]);
  assert.deepEqual(info, { showFontCard: true, showSvgCard: true });
});

test("deriveFilesCards: a number/boolean param never trips either flag", () => {
  const info = deriveFilesCards([
    { name: "n", section: "S", description: "N", help: "N", type: "number", default: 1 },
    { name: "b", section: "S", description: "B", help: "B", type: "boolean", default: true },
  ]);
  assert.deepEqual(info, { showFontCard: false, showSvgCard: false });
});

test("deriveFilesCards: an empty param list shows neither card", () => {
  assert.deepEqual(deriveFilesCards([]), { showFontCard: false, showSvgCard: false });
});

test("missingFontFamilies: extracts font-fallback families in order, ignoring notice items", () => {
  const families = missingFontFamilies([
    { kind: "font-fallback", param: "titleFont", family: "Nope One" },
    { kind: "notice", marker: "alert", label: "alerts", count: 2 },
    { kind: "font-fallback", param: "bodyFont", family: "Nope Two" },
  ]);
  assert.deepEqual(families, ["Nope One", "Nope Two"]);
});

test("missingFontFamilies: no attention items -> empty list", () => {
  assert.deepEqual(missingFontFamilies([]), []);
});

test("missingFontFamilies: attention items with no font-fallback -> empty list", () => {
  assert.deepEqual(
    missingFontFamilies([{ kind: "notice", marker: "alert", label: "alerts", count: 1 }]),
    []
  );
});
