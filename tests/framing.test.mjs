// Tests the pure camera-distance math behind the viewer's box-aware "product
// stage" framing (src/components/framing.ts): a flat wide plate, a tall thin
// model, and a cube, each fitted from a few named views, plus the vertical
// inset-shift math used to clear the floating export dock. Verifies the
// actual projected occupancy of the box's corners at the computed distance
// (re-derived independently here, not re-imported from framing.ts) rather
// than re-checking the same formula against itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  frameDistanceForBox,
  cameraBasis,
  edgeInset,
  singleEdgeInset,
  mergeInsets,
  clampInsets,
  insetFitFraction,
  aspectAwareFit,
  insetTargetOffset,
  MIN_USABLE_FRACTION,
  NO_INSETS,
  DEFAULT_FIT_FRACTION,
} from "../src/components/framing.ts";

// A DOM-rect-shaped literal, so the inset math can be exercised without a DOM.
const rect = (left, top, width, height) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});
const insets = (partial) => ({ ...NO_INSETS, ...partial });

const FOV = 45; // matches Viewer.tsx's PerspectiveCamera

// Independently project every corner of `box` (relative to `target`) at
// `distance` along `direction`, and return the max |NDC| on each screen axis
// — the actual on-screen occupancy the fit is supposed to respect.
function projectedOccupancy(box, target, direction, aspect, fovDeg, distance) {
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const tanHalfV = Math.tan((fovDeg * Math.PI) / 360);
  const tanHalfH = safeAspect * tanHalfV;
  let dir = direction.clone().normalize();
  const basis = new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), new THREE.Vector3(0, 0, 1));
  const right = new THREE.Vector3().setFromMatrixColumn(basis, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(basis, 1);

  let maxNdcX = 0;
  let maxNdcY = 0;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const corner = new THREE.Vector3(x, y, z);
        const rel = corner.clone().sub(target);
        const s = rel.dot(dir);
        const depth = distance - s;
        const qx = rel.dot(right);
        const qy = rel.dot(up);
        const ndcX = Math.abs(qx / (depth * tanHalfH));
        const ndcY = Math.abs(qy / (depth * tanHalfV));
        maxNdcX = Math.max(maxNdcX, ndcX);
        maxNdcY = Math.max(maxNdcY, ndcY);
      }
    }
  }
  return { fracWidth: maxNdcX, fracHeight: maxNdcY };
}

// Named view directions, mirroring src/components/views.ts's VIEW_DIRECTIONS
// (kept as plain literals here so this file doesn't depend on that module).
const VIEWS = {
  isometric: new THREE.Vector3(0.6, -1, 0.7),
  top: new THREE.Vector3(0, -0.12, 1),
  front: new THREE.Vector3(0, -1, 0),
  right: new THREE.Vector3(1, 0, 0),
};

const ORIGIN = new THREE.Vector3(0, 0, 0);

function box(hx, hy, hz) {
  return { min: new THREE.Vector3(-hx, -hy, -hz), max: new THREE.Vector3(hx, hy, hz) };
}

const SHAPES = {
  flatPlate: box(80, 40, 2.5), // 160x80x5mm plate
  tallThin: box(10, 10, 60), // a tall narrow column
  cube: box(30, 30, 30),
};

const ASPECTS = { desktop: 1.6, mobilePortrait: 0.5, square: 1 };

for (const [shapeName, shape] of Object.entries(SHAPES)) {
  for (const [viewName, dir] of Object.entries(VIEWS)) {
    for (const [aspectName, aspect] of Object.entries(ASPECTS)) {
      test(`${shapeName} from ${viewName} at ${aspectName} aspect: fits within target, doesn't overfill`, () => {
        const distance = frameDistanceForBox(shape, ORIGIN, dir, aspect, FOV);
        assert.ok(Number.isFinite(distance) && distance > 0, `distance ${distance} not finite/positive`);
        const { fracWidth, fracHeight } = projectedOccupancy(shape, ORIGIN, dir, aspect, FOV, distance);
        // Never overfills past its own target fraction (small epsilon for fp).
        assert.ok(fracWidth <= DEFAULT_FIT_FRACTION.width + 1e-6, `fracWidth ${fracWidth} exceeds width target`);
        assert.ok(fracHeight <= DEFAULT_FIT_FRACTION.height + 1e-6, `fracHeight ${fracHeight} exceeds height target`);
        // At least one axis actually binds (reaches its own target), or the
        // fit isn't doing its job: a degenerate "backed off forever" result
        // would trivially pass the overfill check above.
        const bindsWidth = Math.abs(fracWidth - DEFAULT_FIT_FRACTION.width) < 1e-6;
        const bindsHeight = Math.abs(fracHeight - DEFAULT_FIT_FRACTION.height) < 1e-6;
        assert.ok(bindsWidth || bindsHeight, `neither axis bound its target (w=${fracWidth}, h=${fracHeight})`);
      });
    }
  }
}

test("distance scales linearly with box size (same target/direction/aspect/fov)", () => {
  const small = frameDistanceForBox(box(10, 10, 10), ORIGIN, VIEWS.isometric, 1.4, FOV);
  const big = frameDistanceForBox(box(20, 20, 20), ORIGIN, VIEWS.isometric, 1.4, FOV);
  assert.ok(Math.abs(big - 2 * small) < 1e-6, `expected linear scaling: ${small} vs ${big}`);
});

test("degenerate aspect input (0/NaN) falls back to a sane square-ish fit instead of blowing up", () => {
  const d0 = frameDistanceForBox(SHAPES.cube, ORIGIN, VIEWS.front, 0, FOV);
  const dNaN = frameDistanceForBox(SHAPES.cube, ORIGIN, VIEWS.front, NaN, FOV);
  assert.ok(Number.isFinite(d0) && d0 > 0);
  assert.ok(Number.isFinite(dNaN) && dNaN > 0);
});

test("degenerate direction falls back instead of NaN/throwing", () => {
  const d = frameDistanceForBox(SHAPES.cube, ORIGIN, new THREE.Vector3(0, 0, 0), 1.5, FOV);
  assert.ok(Number.isFinite(d) && d > 0);
});

test("an off-centre box (restOnGrid: target at the base, not the box's own centre) still fits every corner", () => {
  // Mirrors Viewer.tsx's restOnGrid mode: the box sits ABOVE the orbit target
  // (target at z=0, the grid; box spans z=[0, height]) rather than being
  // centred on it. FrameDistanceForBox must handle this asymmetry directly
  // (it projects each corner individually) rather than assuming symmetry.
  const groundedBox = { min: new THREE.Vector3(-40, -20, 0), max: new THREE.Vector3(40, 20, 30) };
  const target = new THREE.Vector3(0, 0, 0);
  const distance = frameDistanceForBox(groundedBox, target, VIEWS.isometric, 1.6, FOV);
  const { fracWidth, fracHeight } = projectedOccupancy(groundedBox, target, VIEWS.isometric, 1.6, FOV, distance);
  assert.ok(fracWidth <= DEFAULT_FIT_FRACTION.width + 1e-6);
  assert.ok(fracHeight <= DEFAULT_FIT_FRACTION.height + 1e-6);
});

test("cameraBasis returns an orthonormal right/up for a regular direction", () => {
  const { right, up } = cameraBasis(new THREE.Vector3(0.6, -1, 0.7));
  assert.ok(Math.abs(right.length() - 1) < 1e-9);
  assert.ok(Math.abs(up.length() - 1) < 1e-9);
  assert.ok(Math.abs(right.dot(up)) < 1e-9, "right/up should be perpendicular");
});

test("cameraBasis stays finite for a near-top view (direction parallel to world-up)", () => {
  const { right, up } = cameraBasis(new THREE.Vector3(0, 0, 1));
  assert.ok(Number.isFinite(right.length()) && right.length() > 0);
  assert.ok(Number.isFinite(up.length()) && up.length() > 0);
});

// ── Chrome insets ───────────────────────────────────────────────────────
// The measured mobile geometry these cases use (390x785 canvas at the sheet's
// peek detent, and the overlays over it) comes from the built app driven at a
// 390x844 viewport, so the "reads as a <edge> inset" expectations below are
// the real chrome, not invented rectangles.

const CANVAS = rect(0, 0, 390, 785);

test("edgeInset: a bottom-centred export dock reads as a bottom inset", () => {
  assert.deepEqual(edgeInset(rect(32, 730, 326, 45), CANVAS), insets({ bottom: 55 }));
});

test("edgeInset: a right-hand HUD column reads as a right inset", () => {
  assert.deepEqual(edgeInset(rect(334, 64, 44, 258), CANVAS), insets({ right: 56 }));
});

test("edgeInset: a full-width top bar reads as a top inset", () => {
  assert.deepEqual(edgeInset(rect(0, 0, 390, 58), CANVAS), insets({ top: 58 }));
});

test("edgeInset: a top-left corner box reads as a top inset down to its lower edge", () => {
  // The nearest-edge rule at its weakest: a corner box has no single honest
  // edge, and the loser's axis is over-counted. Nothing the viewer feeds in is
  // one: the measurements panel, its only corner overlay, is left out of the
  // fit entirely (Viewer.tsx's chromeInsets), but the behaviour is pinned
  // here so a future caller knows what it would get.
  assert.deepEqual(edgeInset(rect(12, 64, 278, 36), CANVAS), insets({ top: 100 }));
});

test("edgeInset: an overlay clear of the canvas contributes nothing", () => {
  assert.deepEqual(edgeInset(rect(0, 900, 390, 50), CANVAS), insets({}));
  assert.deepEqual(edgeInset(rect(400, 0, 40, 40), CANVAS), insets({}));
});

test("edgeInset: a degenerate (zero-sized) canvas contributes nothing", () => {
  assert.deepEqual(edgeInset(rect(0, 0, 10, 10), rect(0, 0, 0, 0)), insets({}));
});

test("mergeInsets: same-edge overlays don't stack — the deepest wins", () => {
  const merged = mergeInsets([insets({ top: 58 }), insets({ top: 100 }), insets({ right: 56 })]);
  assert.deepEqual(merged, insets({ top: 100, right: 56 }));
});

test("clampInsets: insets that already fit are returned untouched", () => {
  const wanted = insets({ top: 100, bottom: 55, right: 56 });
  assert.deepEqual(clampInsets(wanted, 390, 785), wanted);
});

test("clampInsets: an over-stuffed axis is scaled down proportionally, keeping the axis usable", () => {
  // A short landscape viewer: top bar + dock + panel would eat nearly all of it.
  const clamped = clampInsets(insets({ top: 120, bottom: 60, left: 10 }), 844, 187);
  const usable = 187 - clamped.top - clamped.bottom;
  assert.ok(
    Math.abs(usable - 187 * MIN_USABLE_FRACTION) < 1e-9,
    `expected ${MIN_USABLE_FRACTION} of the axis left clear, got ${usable / 187}`
  );
  // Proportional: the two edges keep their 2:1 ratio, so the centring stays honest.
  assert.ok(Math.abs(clamped.top / clamped.bottom - 2) < 1e-9);
  // The untouched axis is left alone.
  assert.equal(clamped.left, 10);
});

test("insetFitFraction: no insets returns the fractions unchanged", () => {
  const fit = insetFitFraction(DEFAULT_FIT_FRACTION, 390, 800, insets({}));
  assert.equal(fit.width, DEFAULT_FIT_FRACTION.width);
  assert.equal(fit.height, DEFAULT_FIT_FRACTION.height);
});

test("insetFitFraction: each axis shrinks by its own insets' share of the canvas", () => {
  // 100px of vertical inset out of an 800px canvas -> usable is 700/800 = 87.5%.
  const fit = insetFitFraction(DEFAULT_FIT_FRACTION, 400, 800, insets({ bottom: 100, right: 40 }));
  assert.ok(Math.abs(fit.height - DEFAULT_FIT_FRACTION.height * 0.875) < 1e-9);
  assert.ok(Math.abs(fit.width - DEFAULT_FIT_FRACTION.width * 0.9) < 1e-9);
});

test("insetFitFraction: opposing insets on one axis both count", () => {
  const oneSide = insetFitFraction(DEFAULT_FIT_FRACTION, 400, 800, insets({ top: 200 }));
  const bothSides = insetFitFraction(DEFAULT_FIT_FRACTION, 400, 800, insets({ top: 100, bottom: 100 }));
  assert.ok(Math.abs(oneSide.height - bothSides.height) < 1e-9);
});

test("insetFitFraction: pathological insets floor instead of collapsing to ~0", () => {
  const fit = insetFitFraction(DEFAULT_FIT_FRACTION, 400, 800, insets({ top: 10000 }));
  assert.ok(fit.height >= DEFAULT_FIT_FRACTION.height * 0.2 - 1e-9);
});

test("insetTargetOffset: no insets (or a non-positive canvas/distance) means no offset", () => {
  assert.deepEqual(insetTargetOffset(200, FOV, 800, insets({})), { right: 0, up: 0 });
  assert.deepEqual(insetTargetOffset(200, FOV, 0, insets({ bottom: 50 })), { right: 0, up: 0 });
  assert.deepEqual(insetTargetOffset(0, FOV, 800, insets({ bottom: 50 })), { right: 0, up: 0 });
});

test("insetTargetOffset: a bottom inset moves the target DOWN so the model rides up", () => {
  // The camera keeps `target` dead centre, so clearing chrome at the bottom
  // means moving the target away from the model's centre, not toward it.
  const { up, right } = insetTargetOffset(200, FOV, 800, insets({ bottom: 100 }));
  assert.ok(up < 0, `expected a negative up offset, got ${up}`);
  assert.equal(right, 0);
});

test("insetTargetOffset: a right inset (the HUD column) moves the target right so the model shifts left", () => {
  const { right, up } = insetTargetOffset(200, FOV, 800, insets({ right: 100 }));
  assert.ok(right > 0, `expected a positive right offset, got ${right}`);
  assert.equal(up, 0);
});

test("insetTargetOffset: equal opposing insets cancel — a centred model stays centred", () => {
  const off = insetTargetOffset(200, FOV, 800, insets({ top: 90, bottom: 90, left: 40, right: 40 }));
  assert.equal(off.up, 0);
  assert.equal(off.right, 0);
});

test("insetTargetOffset: a bigger inset (or a farther camera) offsets more; a taller canvas offsets less", () => {
  const base = Math.abs(insetTargetOffset(200, FOV, 800, insets({ bottom: 100 })).up);
  assert.ok(base > 0);
  assert.ok(Math.abs(insetTargetOffset(200, FOV, 800, insets({ bottom: 200 })).up) > base, "bigger inset -> bigger offset");
  assert.ok(Math.abs(insetTargetOffset(400, FOV, 800, insets({ bottom: 100 })).up) > base, "farther camera -> bigger world-space offset for the same pixel inset");
  assert.ok(Math.abs(insetTargetOffset(200, FOV, 1600, insets({ bottom: 100 })).up) < base, "taller canvas -> the same pixel inset is a smaller world offset");
});

// Where the box's own centre lands on screen, in pixels from the canvas top /
// left, once `offset` has been applied to the orbit target: the whole point
// of the inset math, re-derived here rather than re-imported.
function projectedCentrePx(dir, distance, offset, canvasWidthPx, canvasHeightPx) {
  const { dir: unit, right, up } = cameraBasis(dir);
  const target = ORIGIN.clone().addScaledVector(right, offset.right).addScaledVector(up, offset.up);
  const tanHalfV = Math.tan((FOV * Math.PI) / 360);
  const tanHalfH = (canvasWidthPx / canvasHeightPx) * tanHalfV;
  const rel = ORIGIN.clone().sub(target);
  const depth = distance - rel.dot(unit);
  const ndcX = rel.dot(right) / (depth * tanHalfH);
  const ndcY = rel.dot(up) / (depth * tanHalfV);
  return {
    x: canvasWidthPx / 2 + ndcX * (canvasWidthPx / 2),
    y: canvasHeightPx / 2 - ndcY * (canvasHeightPx / 2), // NDC-Y up positive -> pixel-Y down positive
  };
}

test("the fit + offset pair actually recentres the model in the clear region (integration check)", () => {
  // A flat plate from the front view, against chrome on three edges: a dock at
  // the bottom, a HUD column on the right, a top bar above.
  const canvasWidthPx = 390;
  const canvasHeightPx = 800;
  const chrome = insets({ top: 58, bottom: 160, right: 56 });
  const dir = VIEWS.front;
  const fit = insetFitFraction(DEFAULT_FIT_FRACTION, canvasWidthPx, canvasHeightPx, chrome);
  const distance = frameDistanceForBox(SHAPES.flatPlate, ORIGIN, dir, canvasWidthPx / canvasHeightPx, FOV, fit);
  const offset = insetTargetOffset(distance, FOV, canvasHeightPx, chrome);
  const centre = projectedCentrePx(dir, distance, offset, canvasWidthPx, canvasHeightPx);

  const clearCentreX = (chrome.left + (canvasWidthPx - chrome.right)) / 2;
  const clearCentreY = (chrome.top + (canvasHeightPx - chrome.bottom)) / 2;
  assert.ok(
    Math.abs(centre.x - clearCentreX) < canvasWidthPx * 0.03,
    `model centred at x=${centre.x}px, clear region centre is x=${clearCentreX}px`
  );
  assert.ok(
    Math.abs(centre.y - clearCentreY) < canvasHeightPx * 0.03,
    `model centred at y=${centre.y}px, clear region centre is y=${clearCentreY}px`
  );
});

test("the fit keeps the model clear of the chrome it was told about (integration check)", () => {
  // Same setup, but checking occupancy rather than centring: every corner must
  // land inside the region the insets leave clear.
  const canvasWidthPx = 390;
  const canvasHeightPx = 405; // the sheet's half detent
  const chrome = insets({ top: 100, bottom: 55, right: 56 });
  const dir = VIEWS.isometric;
  const fit = insetFitFraction(DEFAULT_FIT_FRACTION, canvasWidthPx, canvasHeightPx, chrome);
  const aspect = canvasWidthPx / canvasHeightPx;
  const distance = frameDistanceForBox(SHAPES.flatPlate, ORIGIN, dir, aspect, FOV, fit);
  const offset = insetTargetOffset(distance, FOV, canvasHeightPx, chrome);
  const { dir: unit, right, up } = cameraBasis(dir);
  const target = ORIGIN.clone().addScaledVector(right, offset.right).addScaledVector(up, offset.up);
  const tanHalfV = Math.tan((FOV * Math.PI) / 360);
  const tanHalfH = aspect * tanHalfV;

  for (const x of [SHAPES.flatPlate.min.x, SHAPES.flatPlate.max.x]) {
    for (const y of [SHAPES.flatPlate.min.y, SHAPES.flatPlate.max.y]) {
      for (const z of [SHAPES.flatPlate.min.z, SHAPES.flatPlate.max.z]) {
        const rel = new THREE.Vector3(x, y, z).sub(target);
        const depth = distance - rel.dot(unit);
        const px = canvasWidthPx / 2 + (rel.dot(right) / (depth * tanHalfH)) * (canvasWidthPx / 2);
        const py = canvasHeightPx / 2 - (rel.dot(up) / (depth * tanHalfV)) * (canvasHeightPx / 2);
        assert.ok(px >= chrome.left - 1, `corner at x=${px}px runs under the left chrome`);
        assert.ok(px <= canvasWidthPx - chrome.right + 1, `corner at x=${px}px runs under the HUD column`);
        assert.ok(py >= chrome.top - 1, `corner at y=${py}px runs under the top bar`);
        assert.ok(py <= canvasHeightPx - chrome.bottom + 1, `corner at y=${py}px runs under the dock`);
      }
    }
  }
});

// ── aspectAwareFit: rescue an axis that provably cannot bind ────────────────

test("aspectAwareFit leaves ordinary (near-square) aspects exactly alone", () => {
  // The neutral band covers every desktop viewer pane and the mobile sheet's
  // half detent, so the tuned defaults are untouched there: identity, not
  // merely equal values, so a caller can detect the no-op.
  for (const aspect of [0.8, 1, 1.34, 1.6]) {
    assert.equal(aspectAwareFit(DEFAULT_FIT_FRACTION, aspect), DEFAULT_FIT_FRACTION, `aspect ${aspect}`);
  }
});

test("aspectAwareFit widens the width target on a portrait canvas", () => {
  // A 390x730 phone viewer: width binds for a wide flat plate, and the height
  // target can never be reached, so the model read small in an empty frame.
  const fit = aspectAwareFit(DEFAULT_FIT_FRACTION, 390 / 730);
  assert.ok(fit.width > DEFAULT_FIT_FRACTION.width, "width target should grow");
  assert.ok(fit.width <= 0.82, "…but stay capped so the model keeps a margin");
  assert.equal(fit.height, DEFAULT_FIT_FRACTION.height, "the non-binding axis is untouched");
});

test("aspectAwareFit raises the height target on a short wide canvas", () => {
  // The bottom sheet's full-detent model strip: ~390x132.
  const fit = aspectAwareFit(DEFAULT_FIT_FRACTION, 390 / 132);
  assert.ok(fit.height > DEFAULT_FIT_FRACTION.height, "height target should grow");
  assert.ok(fit.height <= 0.8, "…but stay capped");
  assert.equal(fit.width, DEFAULT_FIT_FRACTION.width, "the non-binding axis is untouched");
});

test("aspectAwareFit degrades smoothly and never exceeds its caps", () => {
  // Monotonic in the direction of the correction, and bounded at both extremes
  // — a pathological aspect must not ask for a fit fraction near 1 (or above).
  const widths = [0.7, 0.5, 0.3, 0.1].map((a) => aspectAwareFit(DEFAULT_FIT_FRACTION, a).width);
  for (let i = 1; i < widths.length; i++) assert.ok(widths[i] >= widths[i - 1], "monotonic");
  for (const w of widths) assert.ok(w <= 0.82, `width fit ${w} exceeds its cap`);
  const heights = [2, 4, 10, 40].map((a) => aspectAwareFit(DEFAULT_FIT_FRACTION, a).height);
  for (const h of heights) assert.ok(h <= 0.8, `height fit ${h} exceeds its cap`);
});

test("aspectAwareFit returns the input unchanged for a degenerate aspect", () => {
  for (const bad of [0, -1, NaN, Infinity]) {
    assert.equal(aspectAwareFit(DEFAULT_FIT_FRACTION, bad), DEFAULT_FIT_FRACTION, `aspect ${bad}`);
  }
});

test("a portrait-corrected fit still yields to the chrome insets", () => {
  // Order matters: aspectAwareFit runs FIRST and insetFitFraction shrinks its
  // output, so a corrected target can never slide under the top bar or dock.
  const corrected = aspectAwareFit(DEFAULT_FIT_FRACTION, 390 / 730);
  const withChrome = insetFitFraction(corrected, 390, 730, insets({ top: 58, bottom: 45 }));
  assert.ok(withChrome.height < corrected.height, "insets still shrink the height target");
  assert.ok(withChrome.width <= corrected.width, "and never grow the width target");
});

// ── singleEdgeInset: the caller-chosen edge for a corner overlay ────────────

test("singleEdgeInset charges a corner overlay to the edge the caller names", () => {
  // The mobile HUD's collapsed trigger: a 44px button in the top-right corner.
  const hud = rect(334, 64, 44, 44);
  // Left to edgeInset it reads as a right-edge band across the whole height…
  assert.deepEqual(edgeInset(hud, CANVAS), insets({ right: CANVAS.right - 334 }));
  // …but charged to the top it costs only its own depth from that edge.
  assert.deepEqual(singleEdgeInset(hud, CANVAS, "top"), insets({ top: 108 }));
});

test("singleEdgeInset measures each edge from the right side of the canvas", () => {
  const box = rect(40, 60, 100, 80); // left 40, top 60, right 140, bottom 140
  assert.deepEqual(singleEdgeInset(box, CANVAS, "top"), insets({ top: 140 }));
  assert.deepEqual(singleEdgeInset(box, CANVAS, "left"), insets({ left: 140 }));
  assert.deepEqual(singleEdgeInset(box, CANVAS, "right"), insets({ right: CANVAS.right - 40 }));
  assert.deepEqual(singleEdgeInset(box, CANVAS, "bottom"), insets({ bottom: CANVAS.bottom - 60 }));
});

test("singleEdgeInset clamps to the canvas and ignores an overlay clear of it", () => {
  // Extends past both edges: the inset can never exceed the canvas.
  const huge = rect(-50, -50, 1000, 2000);
  assert.deepEqual(singleEdgeInset(huge, CANVAS, "top"), insets({ top: CANVAS.bottom }));
  // Entirely outside: contributes nothing, same as edgeInset.
  const away = rect(2000, 2000, 40, 40);
  assert.deepEqual(singleEdgeInset(away, CANVAS, "top"), insets({}));
  // Degenerate canvas.
  assert.deepEqual(singleEdgeInset(rect(0, 0, 10, 10), rect(0, 0, 0, 0), "top"), insets({}));
});

test("charging a corner overlay to one edge only helps if it is charged ONCE", () => {
  // Why Viewer.tsx's CHROME_OVERLAYS spells the general HUD entry
  // `.viewer-hud:not(.viewer-hud--collapsed)`: insets merge by taking the
  // DEEPEST per edge, so an overlay matched by both entries would keep its
  // right-edge band next to the top charge and gain nothing.
  const hud = rect(334, 64, 44, 44);
  const bothWays = mergeInsets([singleEdgeInset(hud, CANVAS, "top"), edgeInset(hud, CANVAS)]);
  assert.equal(bothWays.right, CANVAS.right - 334, "matching both entries keeps the band");
  const onceOnly = mergeInsets([singleEdgeInset(hud, CANVAS, "top")]);
  assert.deepEqual(onceOnly, insets({ top: 108 }), "matching one entry costs the top only");
});
