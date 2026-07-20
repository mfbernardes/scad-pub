// Fixture-driven tests for the SVG-prep engine over the shared corner-case
// suite in tests/fixtures/svg/*.
// Category A files must import cleanly (no WARN/ERROR from the checker); Category
// B files must each raise their known issue, and the fixable ones must be
// resolved by applyFixes. The background cases are the regression guard for a
// map/pictogram that "renders as a single block": a full-canvas rectangle is
// flagged (covers-canvas) and dropped by the Fix step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

globalThis.XMLSerializer = XMLSerializer;

import {
  analyze,
  applyFixes,
  check,
  deriveLayers,
} from "../src/lib/svgPrep/index.ts";

const FIX_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "svg");
const parse = (file) =>
  new DOMParser()
    .parseFromString(readFileSync(join(FIX_DIR, file), "utf8"), "image/svg+xml")
    .documentElement;
const codes = (root, layers = []) => check(root, layers).map((f) => f.code);
const levelCodes = (root, level) =>
  check(root)
    .filter((f) => f.level === level)
    .map((f) => f.code);

// Category A: valid-but-tricky drawings that must import as proper multi-part
// relief. The engine must raise no WARN or ERROR for any of them (an INFO such
// as `undersized`/`regions-available` is fine).
const CATEGORY_A = [
  "shapes_basic.svg",
  "holes_evenodd.svg",
  "holes_nonzero.svg",
  "compound_letters.svg",
  "arcs.svg",
  "relative_paths.svg",
  "transform_translate_scale.svg",
  "transform_rotate.svg",
  "transform_matrix.svg",
  "nested_groups.svg",
  "rounded_rect.svg",
  "polygon_star.svg",
  "units_mm.svg",
  "multi_region.svg",
];

for (const file of CATEGORY_A) {
  test(`Category A imports clean (no WARN/ERROR): ${file}`, () => {
    const root = parse(file);
    assert.deepEqual(levelCodes(root, "ERROR"), [], `${file} should raise no ERROR`);
    assert.deepEqual(levelCodes(root, "WARN"), [], `${file} should raise no WARN`);
  });
}

// Category B: each file must raise its known issue code.
const CATEGORY_B = {
  "background_rect.svg": "covers-canvas",
  "background_path.svg": "covers-canvas",
  "stroke_only.svg": "stroke-only",
  "all_stroke.svg": "stroke-only",
  "text_label.svg": "text",
  "css_fills.svg": "styled-fill",
  "inkscape_layers.svg": "inkscape-trap",
  "offcanvas.svg": "content-outside-viewbox",
  "nonzero_viewbox.svg": "viewbox-origin",
  "no_viewbox.svg": "no-viewbox",
  "use_defs.svg": "ignored:use",
};

for (const [file, code] of Object.entries(CATEGORY_B)) {
  test(`Category B raises ${code}: ${file}`, () => {
    assert.ok(codes(parse(file)).includes(code), `${file} should raise ${code}`);
  });
}

// Fixable issues must be gone after applyFixes re-checks clean of that code.
const FIXABLE = {
  "background_rect.svg": "covers-canvas",
  "background_path.svg": "covers-canvas",
  "css_fills.svg": "styled-fill",
  "inkscape_layers.svg": "inkscape-trap",
  "nonzero_viewbox.svg": "viewbox-origin",
};

for (const [file, code] of Object.entries(FIXABLE)) {
  test(`applyFixes resolves ${code}: ${file}`, () => {
    const root = parse(file);
    assert.ok(codes(root).includes(code), `${file} should raise ${code} before fix`);
    const changes = applyFixes(root);
    assert.ok(changes.length > 0, `${file} fix should report a change`);
    assert.ok(!codes(root).includes(code), `${file} should be clean of ${code} after fix`);
  });
}

// The reported bug: a full-canvas background makes the whole drawing import as
// one solid block. The Fix step must drop the background rectangle while keeping
// the real artwork.
for (const file of ["background_rect.svg", "background_path.svg"]) {
  test(`removes the full-canvas background, keeps detail: ${file}`, () => {
    const root = parse(file);
    const before = check(root).filter((f) => f.code === "covers-canvas");
    assert.equal(before.length, 1, `${file} should flag one canvas background`);
    applyFixes(root);
    const svg = new XMLSerializer().serializeToString(root);
    // The black detail (a circle) survives; a covering rect/path is gone.
    assert.ok(/<circle/.test(svg), `${file} should keep its detail shapes`);
    assert.ok(
      check(root).every((f) => f.code !== "covers-canvas"),
      `${file} should no longer be a solid block`,
    );
  });
}

// Colour derivation from named/painted regions (Tier B export).
const DERIVES = {
  "multi_region.svg": "walls:gray, rooms:white",
  "inkscape_layers.svg": "walls:gray, rooms:white",
  "css_fills.svg": "wall:gray, room:white",
};

for (const [file, expected] of Object.entries(DERIVES)) {
  test(`derives a colour-layers string: ${file}`, () => {
    const root = parse(file);
    applyFixes(root); // resolve inkscape ids / css fills first
    assert.equal(deriveLayers(root), expected, `${file} layers`);
  });
}

// A one-line smoke over the whole suite: analyze() must run on every fixture
// without throwing and return a findings array.
test("analyze runs over every fixture without throwing", () => {
  for (const file of [...CATEGORY_A, ...Object.keys(CATEGORY_B)]) {
    const a = analyze(parse(file));
    assert.ok(Array.isArray(a.findings), `${file} findings`);
  }
});
