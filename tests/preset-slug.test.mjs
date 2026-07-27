// Unit tests for scripts/lib/preset-slug.mjs — the preset-thumbnail slug
// rule for designs[].presets.images' directory form (see docs/config.md).
// Must match taktildots' tools/render-preset-images.sh Python slug() byte
// for byte; several cases below are drawn directly from that repo's real
// scadpub.config.json presetImages map (a repo this rule was reverse-
// engineered from), so a regression here would also break its migration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { presetSlug, slugifyPresetNames } from "../scripts/lib/preset-slug.mjs";

test("presetSlug: lowercases and collapses spaces/punctuation to single dashes", () => {
  assert.equal(presetSlug("Office (English US)"), "office-english-us");
  assert.equal(presetSlug("Flexibel | Aufzug"), "flexibel-aufzug");
});

test("presetSlug: a trailing parenthetical language tag folds in cleanly", () => {
  assert.equal(
    presetSlug("Recipes — Grade 2 (English US)"),
    "recipes-grade-2-english-us"
  );
});

test("presetSlug: the '|' and em/en-dash separators collapse like any other punctuation", () => {
  assert.equal(
    presetSlug("EG — Erdgeschoss, Flachschild (Deutsch)"),
    "eg-erdgeschoss-flachschild-deutsch"
  );
});

test("presetSlug: non-ASCII German letters (ü, ß) are not [a-z0-9] and become dashes", () => {
  // Real name from taktildots' signage presetImages map.
  assert.equal(
    presetSlug("Tür | Büro, vier Senkbohrungen (Deutsch)"),
    "t-r-b-ro-vier-senkbohrungen-deutsch"
  );
  // Real name from taktildots' learning_tile presetImages map: "Große"
  // lowercases to "große", and "ß" (already lowercase) still isn't [a-z0-9].
  assert.equal(
    presetSlug("Basisschrift | Große Fliesen 40 mm, Kinder (Deutsch)"),
    "basisschrift-gro-e-fliesen-40-mm-kinder-deutsch"
  );
});

test("presetSlug: a name that is ENTIRELY non-ASCII/space collapses to an empty string", () => {
  // The awkward degenerate case: every character is outside [a-z0-9], so the
  // whole string is one run collapsing to a single '-', then stripped away.
  assert.equal(presetSlug("ä ö ü ß"), "");
});

test("presetSlug: '×' becomes 'x' (kept as an alphanumeric), unlike other punctuation", () => {
  // Real names from taktildots' map design: without the '×'->'x' special
  // case these would lose the dimension entirely ("90-70" instead of "90x70").
  assert.equal(presetSlug("Klein — 90×70 mm (Deutsch)"), "klein-90x70-mm-deutsch");
  assert.equal(presetSlug("Groß — 160×120 mm (Deutsch)"), "gro-160x120-mm-deutsch");
});

test("slugifyPresetNames: two names that slug identically are disambiguated in order", () => {
  // Real pair from taktildots' learning_tile presetImages map: both names
  // are "Punctuation | English UEB: " followed by punctuation-only content,
  // so both slug to the same base and the second gets a numeric suffix.
  const names = [
    "Punctuation | English UEB: - : ; ' (English US)",
    "Punctuation | English UEB: . , ? ! (English US)",
  ];
  const slugs = slugifyPresetNames(names);
  assert.equal(slugs.get(names[0]), "punctuation-english-ueb-english-us");
  assert.equal(slugs.get(names[1]), "punctuation-english-ueb-english-us-2");
});

test("slugifyPresetNames: a third repeat gets '-3', matching insertion order", () => {
  const names = ["A!", "A?", "A."];
  const slugs = slugifyPresetNames(names);
  assert.equal(slugs.get("A!"), "a");
  assert.equal(slugs.get("A?"), "a-2");
  assert.equal(slugs.get("A."), "a-3");
});

test("slugifyPresetNames: distinct slugs are left untouched", () => {
  const names = ["Salz (Deutsch)", "Zucker (Deutsch)"];
  const slugs = slugifyPresetNames(names);
  assert.equal(slugs.get("Salz (Deutsch)"), "salz-deutsch");
  assert.equal(slugs.get("Zucker (Deutsch)"), "zucker-deutsch");
});
