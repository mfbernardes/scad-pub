// Tests the pure SVG-presence helpers behind src/lib/svgFiles.ts: which SVG
// filenames the renderer can resolve (bundled assets ∪ imports) and whether an
// @svg control's value names a missing one. The SVG mirror of the missing-font
// hint's availability logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSvgFile, svgBaseName, svgPresent, isSvgMissing } from "../src/lib/svgFiles.ts";

test("isSvgFile: only .svg names (case-insensitive), trimmed", () => {
  assert.equal(isSvgFile("panel.svg"), true);
  assert.equal(isSvgFile("PANEL.SVG"), true);
  assert.equal(isSvgFile("  logo.svg  "), true);
  assert.equal(isSvgFile("font.ttf"), false);
  assert.equal(isSvgFile("data.dat"), false);
  assert.equal(isSvgFile(""), false);
});

test("svgBaseName: strips any directory part", () => {
  assert.equal(svgBaseName("logo.svg"), "logo.svg");
  assert.equal(svgBaseName("sub/logo.svg"), "logo.svg");
  assert.equal(svgBaseName("a\\b\\logo.svg"), "logo.svg");
});

test("svgPresent: keeps only SVGs, keyed by basename", () => {
  const present = svgPresent(["panel.svg", "emblem.svg", "font.ttf", "art/logo.svg"]);
  assert.deepEqual([...present].sort(), ["emblem.svg", "logo.svg", "panel.svg"]);
});

test("isSvgMissing: a value not in the present set is missing", () => {
  const present = svgPresent(["panel.svg", "emblem.svg"]);
  assert.equal(isSvgMissing("removed.svg", present), true);
  assert.equal(isSvgMissing("panel.svg", present), false);
  // Bundled asset referenced by a path still matches on basename.
  assert.equal(isSvgMissing("art/panel.svg", present), false);
});

test("isSvgMissing: never reports missing when it can't be authoritative", () => {
  // Empty present set (no assets, no imports): don't warn.
  assert.equal(isSvgMissing("anything.svg", new Set()), false);
  // Empty / non-SVG value: nothing to warn about.
  const present = svgPresent(["panel.svg"]);
  assert.equal(isSvgMissing("", present), false);
  assert.equal(isSvgMissing("   ", present), false);
  assert.equal(isSvgMissing("notasvg", present), false);
});
