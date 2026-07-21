// Tests the presentation-only bundled-preset NAME parsing PresetPicker's
// bundled-preset list uses (src/lib/presetCard.ts) — see docs/config.md's
// "Bundled presets" note for the documented convention.
import { test } from "node:test";
import assert from "node:assert/strict";

const { parsePresetCardName } = await import("../src/lib/presetCard.ts");

test("a trailing parenthetical becomes the badge", () => {
  assert.deepEqual(parsePresetCardName("Erdgeschoss (Deutsch)"), {
    title: "Erdgeschoss",
    badge: "Deutsch",
  });
});

test("a leading 'Category | ' prefix becomes the overline, alongside a badge", () => {
  assert.deepEqual(parsePresetCardName("Basisschrift | a–z (Deutsch)"), {
    overline: "Basisschrift",
    title: "a–z",
    badge: "Deutsch",
  });
});

test("an overline with no badge", () => {
  assert.deepEqual(parsePresetCardName("Category | Title"), {
    overline: "Category",
    title: "Title",
  });
});

test("a plain name with neither renders as just a title", () => {
  assert.deepEqual(parsePresetCardName("Plain Name"), { title: "Plain Name" });
});

test("surrounding whitespace is trimmed", () => {
  assert.deepEqual(parsePresetCardName("  Erdgeschoss (Deutsch)  "), {
    title: "Erdgeschoss",
    badge: "Deutsch",
  });
});

test("a name ending in a parenthetical that isn't preceded by a space is left alone", () => {
  // No whitespace before "(word)" -> not treated as a trailing badge.
  assert.deepEqual(parsePresetCardName("Foo(bar)"), { title: "Foo(bar)" });
});

test("nested/multiple parens: only the trailing one splits off", () => {
  assert.deepEqual(parsePresetCardName("Setting (default) (Deutsch)"), {
    title: "Setting (default)",
    badge: "Deutsch",
  });
});

test("degrades gracefully when the overline/title split would be empty", () => {
  // Nothing after the pipe -> falls back to a plain title rather than an
  // empty label.
  assert.deepEqual(parsePresetCardName("Category | (Deutsch)"), {
    title: "Category |",
    badge: "Deutsch",
  });
});
