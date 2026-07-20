// Tests the standard camera-view directions (src/components/views.ts).
// Mostly a static data table, but the default "product" direction encodes a
// specific design decision (visual-alignment pass, item 1b: the previous
// direction read almost edge-on for a flat plate lying in the XY plane, this
// app's most common shape) worth pinning down so a future edit can't
// silently drift back into that regime.
import { test } from "node:test";
import assert from "node:assert/strict";
import { VIEW_DIRECTIONS, VIEW_OPTIONS, DEFAULT_VIEW } from "../src/components/views.ts";

// Elevation above the XY plane and azimuth (turn off dead-front, i.e. off
// -Y) for a view direction, in degrees — the same two numbers the design
// review specified the "product" target in ("turned ~20-25°, elevated
// ~50-60°").
function elevationAndAzimuth([x, y, z]) {
  const len = Math.hypot(x, y, z);
  const elevation = (Math.asin(z / len) * 180) / Math.PI;
  const azimuth = (Math.atan2(Math.abs(x), -y) * 180) / Math.PI;
  return { elevation, azimuth };
}

test("default view is \"product\"", () => {
  assert.equal(DEFAULT_VIEW, "product");
});

test("every VIEW_OPTIONS id has a VIEW_DIRECTIONS entry and vice versa", () => {
  const optionIds = VIEW_OPTIONS.map((o) => o.id).sort();
  const directionIds = Object.keys(VIEW_DIRECTIONS).sort();
  assert.deepEqual(optionIds, directionIds);
});

test("every direction is non-degenerate (non-zero length)", () => {
  for (const [name, dir] of Object.entries(VIEW_DIRECTIONS)) {
    assert.ok(Math.hypot(...dir) > 1e-9, `${name}: direction is ~zero`);
  }
});

// The regression this test guards: [0.55, -1, 0.4] (elevation ~19°) read
// almost edge-on for a thin flat plate — the fit needs enough elevation to
// read the plate's face, not just its edge. Bounds match the design review's
// stated target range, not the exact tuned vector, so a small future nudge
// within the intended "studio product shot" look doesn't spuriously fail.
test("product view: elevated ~50-60° and turned ~20-25° off dead-front, not edge-on", () => {
  const { elevation, azimuth } = elevationAndAzimuth(VIEW_DIRECTIONS.product);
  assert.ok(elevation >= 40 && elevation <= 65, `elevation ${elevation}° outside the studio-shot range`);
  assert.ok(azimuth >= 10 && azimuth <= 35, `azimuth ${azimuth}° outside the studio-shot range`);
});

// Top/bottom are nudged slightly off-axis to dodge OrbitControls gimbal lock
// (see views.ts's own doc) — confirm they still read as near-vertical looks,
// i.e. this test isn't accidentally exercised by the "product" change above.
test("top/bottom stay near-vertical (gimbal-lock dodge, not a real tilt)", () => {
  for (const name of ["top", "bottom"]) {
    const { elevation } = elevationAndAzimuth(VIEW_DIRECTIONS[name]);
    assert.ok(Math.abs(Math.abs(elevation) - 90) < 15, `${name}: elevation ${elevation}° not near-vertical`);
  }
});
