// Unit tests for the Files tab's schema-driven task-card derivation
// (src/lib/filesCards.ts, PR19 item 1; simplified to two cards in the
// round-2 review pass). Mirrors tests/readiness.test.mjs's style (a
// synthetic baseline, overrides per test) — no DOM/React harness needed
// since this module is dependency-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFilesCards, graphicAccept, missingFontFamilies } from "../src/lib/filesCards.ts";

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

test("deriveFilesCards: a design with no font/svg params and no fileImport shows neither card", () => {
  const info = deriveFilesCards([stringParam({ name: "label" })], null);
  assert.deepEqual(info, { showFontCard: false, showGraphicCard: false });
});

test("deriveFilesCards: a string `isFont` param shows the font card only", () => {
  const info = deriveFilesCards([stringParam({ name: "font", isFont: true })], null);
  assert.deepEqual(info, { showFontCard: true, showGraphicCard: false });
});

test("deriveFilesCards: an enum `isFont` param shows the font card too", () => {
  const info = deriveFilesCards([enumParam({ name: "font", isFont: true })], null);
  assert.deepEqual(info, { showFontCard: true, showGraphicCard: false });
});

test("deriveFilesCards: a string `svg` param shows the graphic card even with no fileImport", () => {
  const info = deriveFilesCards([stringParam({ name: "artwork", svg: { layers: null } })], null);
  assert.deepEqual(info, { showFontCard: false, showGraphicCard: true });
});

test("deriveFilesCards: a design with both shows both cards (order-independent)", () => {
  const info = deriveFilesCards(
    [
      stringParam({ name: "font", isFont: true }),
      stringParam({ name: "artwork", svg: { layers: "layer_colors" } }),
    ],
    null
  );
  assert.deepEqual(info, { showFontCard: true, showGraphicCard: true });
});

test("deriveFilesCards: a number/boolean param never trips either flag", () => {
  const info = deriveFilesCards(
    [
      { name: "n", section: "S", description: "N", help: "N", type: "number", default: 1 },
      { name: "b", section: "S", description: "B", help: "B", type: "boolean", default: true },
    ],
    null
  );
  assert.deepEqual(info, { showFontCard: false, showGraphicCard: false });
});

test("deriveFilesCards: an empty param list with no fileImport shows neither card", () => {
  assert.deepEqual(deriveFilesCards([], null), { showFontCard: false, showGraphicCard: false });
});

// The graphic card is gated purely on the design owning an @svg param — the
// round-2 review's "Custom graphic … for designs that support it". A
// deployment's fileImport.accept (which admits SVGs globally for the import
// picker) must NOT make a font-only or plain design advertise "Import an SVG
// graphic".
test("deriveFilesCards: fileImport that accepts anything does NOT show the graphic card without an @svg param", () => {
  const info = deriveFilesCards([stringParam({ name: "label" })], {});
  assert.deepEqual(info, { showFontCard: false, showGraphicCard: false });
});

test("deriveFilesCards: a global fileImport.accept naming svg does NOT show the graphic card without an @svg param", () => {
  const info = deriveFilesCards([], { accept: ".svg,image/svg+xml" });
  assert.deepEqual(info, { showFontCard: false, showGraphicCard: false });
});

test("deriveFilesCards: an @svg param shows the graphic card regardless of fileImport.accept", () => {
  const info = deriveFilesCards([stringParam({ name: "artwork", svg: { layers: null } })], { accept: ".dat" });
  assert.deepEqual(info, { showFontCard: false, showGraphicCard: true });
});

test("graphicAccept: unset accept falls back to the plain SVG default", () => {
  assert.equal(graphicAccept(undefined), ".svg,image/svg+xml");
});

test("graphicAccept: an accept string with no svg-relevant token falls back to the SVG default", () => {
  assert.equal(graphicAccept(".dat"), ".svg,image/svg+xml");
});

test("graphicAccept: an accept string is narrowed to just its svg-relevant tokens", () => {
  assert.equal(graphicAccept(".dat, .svg, image/svg+xml"), ".svg,image/svg+xml");
});

test("graphicAccept: a single svg-only token passes through unchanged", () => {
  assert.equal(graphicAccept(".svg"), ".svg");
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
