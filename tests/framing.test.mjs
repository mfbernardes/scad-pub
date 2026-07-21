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
  insetHeightFraction,
  insetTargetShift,
  DEFAULT_FIT_FRACTION,
} from "../src/components/framing.ts";

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
        // fit isn't doing its job — a degenerate "backed off forever" result
        // would trivially pass the overfill check above.
        const bindsWidth = Math.abs(fracWidth - DEFAULT_FIT_FRACTION.width) < 1e-6;
        const bindsHeight = Math.abs(fracHeight - DEFAULT_FIT_FRACTION.height) < 1e-6;
        assert.ok(bindsWidth || bindsHeight, `neither axis bound its target (w=${fracWidth}, h=${fracHeight})`);
      });
    }
  }
}

test("a flat plate from the front view reads far larger under the box fit than the old sphere-radius fit did", () => {
  // The old code framed purely off the bounding-SPHERE radius (half the
  // diagonal: sqrt(80^2+40^2+2.5^2) ~= 89.4mm for a 160x80x5mm plate) at a
  // FIXED distance (radius * 3.4 for a non-isometric view) that depends on
  // neither the viewport's aspect ratio nor which view is showing — only on
  // the model's overall diagonal. That's fine for a roughly-cubic model, but
  // badly wrong for an anisotropic flat plate: from the FRONT view (looking
  // along -Y), the visible silhouette is 160mm wide but only 5mm tall (the
  // plate's thickness) — the old formula has no way to know that, so it
  // frames the SAME distance it would for a top-down view (160x80mm), and
  // the plate reads as a razor-thin sliver instead of filling the frame.
  const plate = SHAPES.flatPlate;
  const sphereRadius = Math.sqrt(80 * 80 + 40 * 40 + 2.5 * 2.5);
  const oldDistance = sphereRadius * 3.4; // the old non-isometric framing's own formula
  const oldFraction = projectedOccupancy(plate, ORIGIN, VIEWS.front, 1.6, FOV, oldDistance);

  const newDistance = frameDistanceForBox(plate, ORIGIN, VIEWS.front, 1.6, FOV);
  const newFraction = projectedOccupancy(plate, ORIGIN, VIEWS.front, 1.6, FOV, newDistance);

  // The old framing left the plate's height reading as a sliver...
  assert.ok(
    oldFraction.fracHeight < DEFAULT_FIT_FRACTION.height * 0.3,
    `old fit's height fraction ${oldFraction.fracHeight} should read as a thin sliver (bug being fixed)`
  );
  // ...while the new box fit reaches its target on the binding axis.
  const newBinds =
    Math.abs(newFraction.fracWidth - DEFAULT_FIT_FRACTION.width) < 1e-6 ||
    Math.abs(newFraction.fracHeight - DEFAULT_FIT_FRACTION.height) < 1e-6;
  assert.ok(newBinds, `new fit should bind its target (w=${newFraction.fracWidth}, h=${newFraction.fracHeight})`);
  // And the plate is a clear, multi-fold improvement in apparent size.
  assert.ok(newDistance < oldDistance, `new fit (${newDistance}) should sit much closer than the old one (${oldDistance})`);
});

test("the old sphere-radius fit's apparent size is aspect-blind; the box fit adapts to the viewport", () => {
  // The old formula's camera DISTANCE never depended on the viewport's
  // aspect ratio at all (only on the model's own radius/direction) — so the
  // same model reads at a wildly different fraction of the frame on a wide
  // desktop pane vs. a narrow mobile-portrait one, purely because the
  // viewport shape changed, not the model. The box fit actively compensates.
  const cube = SHAPES.cube;
  const sphereRadius = Math.sqrt(30 * 30 * 3);
  const oldDistance = sphereRadius * 3.4;
  const oldWide = projectedOccupancy(cube, ORIGIN, VIEWS.front, 1.6, FOV, oldDistance);
  const oldNarrow = projectedOccupancy(cube, ORIGIN, VIEWS.front, 0.5, FOV, oldDistance);
  // Old: the SAME distance, so the width FRACTION swings inversely with
  // aspect (fracWidth = |qx| / (depth * aspect * tanHalfV) — a wider
  // viewport divides the same absolute on-screen width by a bigger aspect,
  // reading as a SMALLER fraction of it, and vice versa).
  assert.ok(Math.abs(oldWide.fracWidth / oldNarrow.fracWidth - 0.5 / 1.6) < 0.05);

  const newWideD = frameDistanceForBox(cube, ORIGIN, VIEWS.front, 1.6, FOV);
  const newNarrowD = frameDistanceForBox(cube, ORIGIN, VIEWS.front, 0.5, FOV);
  const newWide = projectedOccupancy(cube, ORIGIN, VIEWS.front, 1.6, FOV, newWideD);
  const newNarrow = projectedOccupancy(cube, ORIGIN, VIEWS.front, 0.5, FOV, newNarrowD);
  // New: both land within the target band regardless of aspect.
  for (const f of [newWide, newNarrow]) {
    assert.ok(f.fracWidth <= DEFAULT_FIT_FRACTION.width + 1e-6);
    assert.ok(f.fracHeight <= DEFAULT_FIT_FRACTION.height + 1e-6);
  }
});

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
  // centred on it — frameDistanceForBox must handle this asymmetry directly
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

// ── Vertical inset shift ────────────────────────────────────────────────

test("insetHeightFraction: no inset returns the fraction unchanged", () => {
  assert.equal(insetHeightFraction(0.58, 800, 0), 0.58);
});

test("insetHeightFraction: a bottom inset proportionally shrinks the target", () => {
  // 100px inset out of an 800px canvas -> usable is 700/800 = 87.5% of it.
  const reduced = insetHeightFraction(0.58, 800, 100);
  assert.ok(Math.abs(reduced - 0.58 * 0.875) < 1e-9);
  assert.ok(reduced < 0.58);
});

test("insetHeightFraction: a pathologically large inset floors instead of collapsing to ~0", () => {
  const reduced = insetHeightFraction(0.58, 800, 10000);
  assert.ok(reduced >= 0.58 * 0.2 - 1e-9);
});

test("insetTargetShift: no inset (or non-positive canvas) means no shift", () => {
  assert.equal(insetTargetShift(200, FOV, 800, 0), 0);
  assert.equal(insetTargetShift(200, FOV, 0, 50), 0);
});

test("insetTargetShift: a larger inset (or distance) shifts more; a taller canvas shifts less", () => {
  const base = insetTargetShift(200, FOV, 800, 100);
  assert.ok(base > 0);
  assert.ok(insetTargetShift(200, FOV, 800, 200) > base, "bigger inset -> bigger shift");
  assert.ok(insetTargetShift(400, FOV, 800, 100) > base, "farther camera -> bigger world-space shift for the same pixel inset");
  assert.ok(insetTargetShift(200, FOV, 1600, 100) < base, "taller canvas -> the same pixel inset is a smaller world shift");
});

test("insetTargetShift: applying it actually recentres the model in the usable region (integration check)", () => {
  // Fit a flat plate from the front view with a bottom inset, then verify:
  // the box's screen-space vertical centre, after the target shift, lands
  // near the usable region's own centre (not the full canvas's).
  const canvasHeightPx = 800;
  const insetPx = 160; // a chunky dock, for a clearly-measurable effect
  const plate = SHAPES.flatPlate;
  const aspect = 1.6;
  const dir = VIEWS.front;
  const reducedHeight = insetHeightFraction(DEFAULT_FIT_FRACTION.height, canvasHeightPx, insetPx);
  const fit = { width: DEFAULT_FIT_FRACTION.width, height: reducedHeight };
  const distance = frameDistanceForBox(plate, ORIGIN, dir, aspect, FOV, fit);
  const shift = insetTargetShift(distance, FOV, canvasHeightPx, insetPx);
  const { up } = cameraBasis(dir);
  const shiftedTarget = ORIGIN.clone().addScaledVector(up, -shift);

  // Project the box's own centre (world origin) relative to the shifted
  // target, and convert its NDC-Y to a pixel offset from the canvas centre.
  const tanHalfV = Math.tan((FOV * Math.PI) / 360);
  const rel = ORIGIN.clone().sub(shiftedTarget);
  const s = rel.dot(dir.clone().normalize());
  const qy = rel.dot(up);
  const depth = distance - s;
  const ndcY = qy / (depth * tanHalfV);
  const modelCenterPx = canvasHeightPx / 2 - ndcY * (canvasHeightPx / 2); // NDC-Y up positive -> pixel-Y down positive

  // The usable region is [0, canvasHeightPx - insetPx] (inset at the bottom);
  // its own centre:
  const usableCenterPx = (canvasHeightPx - insetPx) / 2;
  assert.ok(
    Math.abs(modelCenterPx - usableCenterPx) < canvasHeightPx * 0.03,
    `model centred at ${modelCenterPx}px, usable region centre is ${usableCenterPx}px`
  );
});
