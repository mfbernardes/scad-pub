// editOnModel.test.mjs — the DOM-free logic behind on-model text editing:
// the click-vs-drag gesture gate, the editor position clamping, and the
// design's editOnModel-param lookup. These are the bits worth pinning without
// a browser; the three.js raycast + React wiring are exercised by smoke.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isModelClick,
  clampEditorPosition,
  editOnModelParam,
  CLICK_MOVE_THRESHOLD_PX,
  EDITOR_MARGIN_PX,
} from "../src/lib/editOnModel.ts";

test("isModelClick: a still (or tiny) pointer pair is a click", () => {
  assert.equal(isModelClick({ down: { x: 100, y: 100 }, up: { x: 100, y: 100 } }), true);
  // Just under the threshold (3-4-5 triangle, 5px) still counts.
  assert.equal(isModelClick({ down: { x: 0, y: 0 }, up: { x: 3, y: 4 } }), true);
});

test("isModelClick: movement past the threshold is a drag, not a click", () => {
  assert.equal(isModelClick({ down: { x: 0, y: 0 }, up: { x: 3, y: 5 } }), false); // ~5.83px
  assert.equal(isModelClick({ down: { x: 0, y: 0 }, up: { x: 40, y: 0 } }), false);
});

test("isModelClick: multi-touch or a missing down is never a click", () => {
  assert.equal(
    isModelClick({ down: { x: 10, y: 10 }, up: { x: 10, y: 10 }, multiTouch: true }),
    false
  );
  assert.equal(isModelClick({ down: null, up: { x: 10, y: 10 } }), false);
});

test("isModelClick: the threshold is configurable and exported", () => {
  assert.equal(CLICK_MOVE_THRESHOLD_PX, 5);
  // A 10px move counts as a click under a generous 20px threshold.
  assert.equal(
    isModelClick({ down: { x: 0, y: 0 }, up: { x: 10, y: 0 }, threshold: 20 }),
    true
  );
});

const BOUNDS = { width: 800, height: 600 };
const EDITOR = { width: 240, height: 80 };

test("clampEditorPosition (desktop): a mid-canvas hit sits just below it, centred", () => {
  const pos = clampEditorPosition({ x: 400, y: 300 }, BOUNDS, EDITOR, { mobile: false });
  assert.equal(pos.left, 400 - EDITOR.width / 2); // centred on the hit
  assert.equal(pos.top, 300 + EDITOR_MARGIN_PX); // below the hit
});

test("clampEditorPosition (desktop): a hit near an edge is pulled fully inside", () => {
  // Top-left corner hit: the card would spill off the top and left, so it's
  // clamped to the margin on both axes.
  const tl = clampEditorPosition({ x: 0, y: 0 }, BOUNDS, EDITOR, { mobile: false });
  assert.equal(tl.left, EDITOR_MARGIN_PX);
  assert.equal(tl.top, EDITOR_MARGIN_PX);
  // Bottom-right corner hit: clamped to the far margins, whole card inside.
  const br = clampEditorPosition({ x: 800, y: 600 }, BOUNDS, EDITOR, { mobile: false });
  assert.equal(br.left, BOUNDS.width - EDITOR.width - EDITOR_MARGIN_PX);
  assert.equal(br.top, BOUNDS.height - EDITOR.height - EDITOR_MARGIN_PX);
});

test("clampEditorPosition (chip / no hit): centred on desktop, top-anchored on mobile", () => {
  const desktop = clampEditorPosition(null, BOUNDS, EDITOR, { mobile: false });
  assert.equal(desktop.left, (BOUNDS.width - EDITOR.width) / 2);
  assert.equal(desktop.top, (BOUNDS.height - EDITOR.height) / 2);
  const mobile = clampEditorPosition(null, BOUNDS, EDITOR, { mobile: true });
  assert.equal(mobile.left, (BOUNDS.width - EDITOR.width) / 2);
  assert.equal(mobile.top, EDITOR_MARGIN_PX); // pinned to the top, clear of the keyboard
});

test("clampEditorPosition (mobile): a hit is pinned into the top ~40% of the viewer", () => {
  // A hit low in the viewport still resolves to the top region so the on-screen
  // keyboard can't cover the editor.
  const pos = clampEditorPosition({ x: 400, y: 560 }, BOUNDS, EDITOR, { mobile: true });
  assert.ok(pos.top <= BOUNDS.height * 0.4, `top ${pos.top} should be in the top 40%`);
  assert.ok(pos.top >= EDITOR_MARGIN_PX);
});

test("clampEditorPosition: an editor larger than the bounds still yields the margin", () => {
  // Degenerate case (card wider AND taller than a tiny viewer): never NaN,
  // never negative — falls back to the margin so the card at least starts
  // on-screen rather than being pushed off it.
  const tiny = { width: 100, height: 100 };
  const big = { width: 240, height: 200 };
  const pos = clampEditorPosition({ x: 50, y: 50 }, tiny, big, { mobile: false });
  assert.equal(pos.left, EDITOR_MARGIN_PX);
  assert.equal(pos.top, EDITOR_MARGIN_PX);
});

const design = (params) => ({ id: "d", label: "D", file: "d.scad", sections: [], presets: [], params });

test("editOnModelParam returns the flagged string param, or null", () => {
  const withEdit = design([
    { name: "w", section: "S", type: "number", default: 1 },
    { name: "label", section: "Text", type: "string", default: "Hi", editOnModel: true },
  ]);
  assert.equal(editOnModelParam(withEdit)?.name, "label");
  // No flagged param -> null.
  const without = design([{ name: "label", section: "Text", type: "string", default: "Hi" }]);
  assert.equal(editOnModelParam(without), null);
});
