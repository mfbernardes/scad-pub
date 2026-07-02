// Unit tests for src/lib/fonts.ts — the font name-table parser and the helpers
// that decide font availability from a known family set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fontFamilyNames,
  familyOf,
  withFamily,
  normalizeFamily,
} from "../src/lib/fonts.ts";
import { fontFamilyNames as genFontFamilyNames } from "../scripts/gen-schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FONTS = join(HERE, "..", "public", "fonts");

test("fontFamilyNames reads the embedded family from a real TTF", () => {
  const bytes = new Uint8Array(readFileSync(join(FONTS, "LiberationSans-Regular.ttf")));
  const families = fontFamilyNames(bytes).map((f) => f.toLowerCase());
  // The embedded family name is "Liberation Sans" — matched by family, not the
  // "LiberationSans-Regular.ttf" filename.
  assert.ok(families.includes("liberation sans"), `got ${JSON.stringify(families)}`);
});

test("fontFamilyNames returns [] for non-font bytes rather than throwing", () => {
  assert.deepEqual(fontFamilyNames(new Uint8Array([1, 2, 3, 4, 5])), []);
  assert.deepEqual(fontFamilyNames(new Uint8Array(0)), []);
});

// The browser (src/lib/fonts.ts) and the build (scripts/gen-schema.mjs) now
// share ONE parser (src/lib/fontNameTable.mjs). This exercises that shared core
// through both public entry points — a tripwire that the export chain and the
// build↔app parity (the app's availability check reads schema data built here)
// stay intact even if the wiring is refactored.
test("the app and gen-schema font parsers produce identical families", () => {
  for (const file of ["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf"]) {
    const bytes = readFileSync(join(FONTS, file));
    assert.deepEqual(
      fontFamilyNames(new Uint8Array(bytes)),
      genFontFamilyNames(bytes),
      `parsers disagree on ${file}`
    );
  }
  // Agree on the failure path too.
  const junk = new Uint8Array([1, 2, 3, 4, 5]);
  assert.deepEqual(fontFamilyNames(junk), genFontFamilyNames(Buffer.from(junk)));
});

test("familyOf strips fontconfig properties", () => {
  assert.equal(familyOf("Brand Display Pro:style=Regular"), "Brand Display Pro");
  assert.equal(familyOf("  Liberation Sans  "), "Liberation Sans");
  assert.equal(familyOf("Mono"), "Mono");
});

test("withFamily swaps the family but keeps the style properties", () => {
  assert.equal(withFamily("Brand Display:style=Bold", "Liberation Sans"), "Liberation Sans:style=Bold");
  assert.equal(withFamily("Brand Display", "Liberation Sans"), "Liberation Sans");
});

test("normalizeFamily is case- and whitespace-insensitive", () => {
  assert.equal(normalizeFamily("  Liberation SANS "), normalizeFamily("liberation sans"));
});
