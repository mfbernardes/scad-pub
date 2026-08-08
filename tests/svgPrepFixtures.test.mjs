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
import { contentBbox, elementPoints } from "../src/lib/svgPrep/geometry.ts";

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

// The three transform fixtures need more than "raised no warning": two of them
// are shapes geometry.ts DELIBERATELY refuses to measure (a shear and a
// rotation do not keep an axis-aligned box axis-aligned), so every
// coordinate-dependent check silently skips them and the clean-import test
// above passes for the wrong reason — it would pass just as well if the
// transform handling were removed entirely.
//
// So assert the actual outcome for each, and the DIFFERENCE between them:
// composable transforms are composed, non-composable ones report "cannot
// measure" rather than a wrong box, and in neither case does the drawing lose
// its shapes.

test("a composable transform is composed into the measured box", () => {
  // translate(50,50) scale(1.6) over a diamond spanning ±12 about the origin:
  // 50 ± 19.2.
  const root = parse("transform_translate_scale.svg");
  const bbox = contentBbox(root);
  assert.ok(bbox, "translate/scale must be measurable");
  const [x0, y0, x1, y1] = bbox;
  for (const [got, want] of [
    [x0, 30.8],
    [y0, 30.8],
    [x1, 69.2],
    [y1, 69.2],
  ])
    assert.ok(Math.abs(got - want) < 1e-6, `${got} ≈ ${want}`);
});

test("a shear or a rotation reports 'cannot measure', not a wrong box", () => {
  // The honest answer: a bbox computed in the wrong frame is worse than none,
  // because callers report it as fact.
  for (const file of ["transform_matrix.svg", "transform_rotate.svg"]) {
    assert.equal(contentBbox(parse(file)), null, `${file} must refuse to measure`);
  }
});

test("refusing to measure is not the same as finding no geometry", () => {
  // The distinction the clean-import test cannot see. Each shape is still read;
  // only the frame it would have to be reported in is unavailable.
  for (const file of ["transform_matrix.svg", "transform_rotate.svg"]) {
    const shapes = [...parse(file).getElementsByTagName("*")].filter((el) =>
      ["rect", "path"].includes(el.nodeName)
    );
    assert.ok(shapes.length > 0, `${file} should contain a shape`);
    // Two points for a rect (opposite corners are all a bbox needs), more for a
    // path — the assertion is that the shape is READ, not how many points it
    // reduces to.
    for (const shape of shapes)
      assert.ok(elementPoints(shape).length >= 2, `${file}: ${shape.nodeName} yielded no points`);
  }
});

// Category B: each file must raise its known issue code.
const CATEGORY_B = {
  "background_rect.svg": "covers-canvas",
  "background_path.svg": "covers-canvas",
  "stroke_only.svg": "stroke-only",
  "all_stroke.svg": "stroke-only",
  "text_label.svg": "text",
  "css_fills.svg": "styled-fill",
  "inkscape_layers.svg": "inkscape-trap",
  "functional_fills.svg": "inkscape-trap",
  "offcanvas.svg": "content-outside-viewbox",
  "nonzero_viewbox.svg": "viewbox-origin",
  "no_viewbox.svg": "no-viewbox",
  "use_defs.svg": "ignored",
};

for (const [file, code] of Object.entries(CATEGORY_B)) {
  test(`Category B raises ${code}: ${file}`, () => {
    assert.ok(codes(parse(file)).includes(code), `${file} should raise ${code}`);
  });
}

test("use_defs.svg's ignored finding names the <use> tag", () => {
  const finding = check(parse("use_defs.svg")).find((f) => f.code === "ignored");
  assert.ok(finding);
  assert.equal(finding.vars.tag, "use");
});

// Fixable issues must be gone after applyFixes re-checks clean of that code.
const FIXABLE = {
  "background_rect.svg": "covers-canvas",
  "background_path.svg": "covers-canvas",
  "css_fills.svg": "styled-fill",
  "inkscape_layers.svg": "inkscape-trap",
  "functional_fills.svg": "inkscape-trap",
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
// Each string is led by the drawing's canvas entry (its viewBox size), which is
// what lets a consuming design place the uncentred regions.
const DERIVES = {
  "multi_region.svg": "100x100, walls:gray, rooms:white",
  "inkscape_layers.svg": "100x100, walls:gray, rooms:white",
  "css_fills.svg": "100x100, wall:gray, room:white",
  // Functional colour notations resolve to names, and free-text layer labels
  // are sanitised into ids: neither may put a "," or ":" into the spec.
  "functional_fills.svg":
    "100x100, Ground_floor__walls:gray, rooms__interior:white, fixtures:blue",
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
