// Tests dimensionOverlayMargin — the reach of the dimension overlay's callouts
// beyond the model's own bounding box (src/components/dimensions.ts). The
// camera fit adds this margin when the ruler is on, so the outer "NN.N mm"
// labels stay on the canvas instead of being cropped at its edges; getting it
// wrong is invisible to the geometry tests, hence this. buildDimensions itself
// needs a canvas (label sprites) and isn't exercised here.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { dimensionOverlayMargin } from "../src/components/dimensions.ts";

const size = (x, y, z) => new THREE.Vector3(x, y, z);

test("dimensionOverlayMargin: scales linearly with the model's largest dimension", () => {
  const small = dimensionOverlayMargin(size(90, 45, 4.5));
  const big = dimensionOverlayMargin(size(180, 90, 9));
  assert.ok(Math.abs(big.lateral - 2 * small.lateral) < 1e-9);
  assert.ok(Math.abs(big.front - 2 * small.front) < 1e-9);
});

test("dimensionOverlayMargin: keyed to the LARGEST dimension, not the axis it borders", () => {
  // A flat plate and a tall column of the same maxDim get the same margin —
  // the overlay sizes its gap/labels off maxDim alone (see buildDimensions).
  const plate = dimensionOverlayMargin(size(90, 45, 4.5));
  const column = dimensionOverlayMargin(size(10, 10, 90));
  assert.deepEqual(plate, column);
});

test("dimensionOverlayMargin: reaches past the dimension line itself, and further sideways than forward", () => {
  const maxDim = 90;
  const margin = dimensionOverlayMargin(size(maxDim, 45, 4.5));
  // The dimension line sits at 0.12·maxDim outside the box; the label lives
  // beyond it, so both margins must clear that.
  assert.ok(margin.front > 0.12 * maxDim, `front margin ${margin.front} doesn't clear the dimension line`);
  assert.ok(margin.lateral > 0.12 * maxDim, `lateral margin ${margin.lateral} doesn't clear the dimension line`);
  // Sideways is the bigger reach: the ±X labels stick out by half their WIDTH,
  // the −Y one only by half its height.
  assert.ok(margin.lateral > margin.front);
});

test("dimensionOverlayMargin: a degenerate (zero) size stays finite and positive", () => {
  const margin = dimensionOverlayMargin(size(0, 0, 0));
  assert.ok(Number.isFinite(margin.lateral) && margin.lateral > 0);
  assert.ok(Number.isFinite(margin.front) && margin.front > 0);
});
