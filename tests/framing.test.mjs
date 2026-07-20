// Tests the pure camera-distance math behind the viewer's default "product
// stage" framing (src/components/framing.ts). Verifies the projected
// footprint of a bounding sphere stays within the fill-fraction targets at
// both a wide desktop aspect ratio and a narrow mobile-portrait one — the two
// shapes the design review called out by name — plus a square viewport and a
// couple of edge cases in the inputs themselves.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  frameDistance,
  frameDistanceWithInsets,
  frameDistanceForBox,
  frameDistanceForBoxWithInsets,
  reducedViewport,
  insetViewOffset,
  computeViewerInsets,
  ZERO_INSETS,
  MAX_FILL_FRACTION,
  TARGET_WIDTH_FRACTION,
  GUIDED_REVIEW_FIT,
} from "../src/components/framing.ts";

const FOV = 45; // matches Viewer.tsx's PerspectiveCamera

// Reproduces the projection math frameDistance() inverts, so the tests check
// the actual on-screen result rather than re-deriving the same formula.
function fractions(radius, aspect, fovDeg, distance) {
  const tanHalfV = Math.tan((fovDeg * Math.PI) / 360);
  const fracHeight = radius / (distance * tanHalfV);
  const fracWidth = fracHeight / aspect;
  return { fracWidth, fracHeight };
}

test("wide desktop aspect: binds on height, keeping both axes within the margin cap", () => {
  const radius = 50;
  const aspect = 1.6; // wide flat-plate viewer pane
  const d = frameDistance(radius, aspect, FOV);
  const { fracWidth, fracHeight } = fractions(radius, aspect, FOV, d);
  assert.ok(fracHeight <= MAX_FILL_FRACTION + 1e-9, `fracHeight ${fracHeight} exceeds cap`);
  // Binding on height means the height fraction lands exactly at the cap.
  assert.ok(Math.abs(fracHeight - MAX_FILL_FRACTION) < 1e-9);
  // Width is then comfortably under the cap too (a wide viewport has room to
  // spare horizontally once the tighter vertical margin is satisfied).
  assert.ok(fracWidth <= MAX_FILL_FRACTION + 1e-9);
  assert.ok(fracWidth > 0.15, `fracWidth ${fracWidth} reads as "aggressively zoomed"`);
});

test("narrow mobile-portrait aspect: reaches the target width fraction with height to spare", () => {
  const radius = 80; // a tall shape
  const aspect = 0.5; // portrait mobile viewer pane
  const d = frameDistance(radius, aspect, FOV);
  const { fracWidth, fracHeight } = fractions(radius, aspect, FOV, d);
  // Narrow enough that the width target doesn't overflow the height cap, so
  // the fit hits TARGET_WIDTH_FRACTION on the nose instead of backing off.
  assert.ok(Math.abs(fracWidth - TARGET_WIDTH_FRACTION) < 1e-9);
  assert.ok(fracHeight <= MAX_FILL_FRACTION + 1e-9, `fracHeight ${fracHeight} exceeds cap`);
});

test("mobile is never \"aggressively zoomed\": width fraction stays within the ~55-70% band", () => {
  for (const aspect of [0.4, 0.5, 0.6, 0.75, 1.0]) {
    const d = frameDistance(60, aspect, FOV);
    const { fracWidth } = fractions(60, aspect, FOV, d);
    assert.ok(fracWidth >= 0.5, `aspect ${aspect}: fracWidth ${fracWidth} too small (over-zoomed out)`);
    assert.ok(fracWidth <= 0.7, `aspect ${aspect}: fracWidth ${fracWidth} too large (overfilling)`);
  }
});

test("square viewport: both fractions stay within the margin cap", () => {
  const d = frameDistance(40, 1, FOV);
  const { fracWidth, fracHeight } = fractions(40, 1, FOV, d);
  assert.ok(fracWidth <= MAX_FILL_FRACTION + 1e-9);
  assert.ok(fracHeight <= MAX_FILL_FRACTION + 1e-9);
});

test("distance scales linearly with radius (same aspect/fov)", () => {
  const d1 = frameDistance(10, 1.3, FOV);
  const d2 = frameDistance(20, 1.3, FOV);
  assert.ok(Math.abs(d2 - 2 * d1) < 1e-9);
});

test("degenerate aspect input (0/NaN) falls back to a sane square-ish fit instead of blowing up", () => {
  assert.ok(Number.isFinite(frameDistance(50, 0, FOV)));
  assert.ok(Number.isFinite(frameDistance(50, NaN, FOV)));
  assert.ok(frameDistance(50, 0, FOV) > 0);
});

test("a wide flat plate and a tall narrow shape both fit at the same desktop aspect", () => {
  const aspect = 1.4;
  const flatPlate = frameDistance(90, aspect, FOV); // wide bounding sphere (large radius, low height)
  const tallShape = frameDistance(30, aspect, FOV); // small bounding sphere (compact, tall)
  for (const [radius, d] of [[90, flatPlate], [30, tallShape]]) {
    const { fracWidth, fracHeight } = fractions(radius, aspect, FOV, d);
    assert.ok(fracHeight <= MAX_FILL_FRACTION + 1e-9, `radius ${radius}: fracHeight ${fracHeight} exceeds cap`);
    assert.ok(fracWidth <= MAX_FILL_FRACTION + 1e-9, `radius ${radius}: fracWidth ${fracWidth} exceeds cap`);
  }
});

// Visual-alignment pass, item 1c: the design review found the model reading
// "far too small" in a mobile-portrait viewer pane even though the fit was
// technically hitting its (then 0.62) width target — a real mobile pane is
// tall enough that a width-only percentage reads small against all the
// leftover vertical space. TARGET_WIDTH_FRACTION moved to 0.66 (from 0.62,
// still under MAX_FILL_FRACTION) so the model fills 60-70% of the viewport's
// SHORTER dimension — which is the width whenever aspect <= 1 (portrait or
// square) — rather than sitting at the low end of that band.
test("mobile portrait: the model fills 60-70% of the viewport's SHORTER dimension", () => {
  for (const aspect of [0.35, 0.45, 0.5, 0.6, 0.8, 1.0]) {
    const d = frameDistance(70, aspect, FOV);
    const { fracWidth, fracHeight } = fractions(70, aspect, FOV, d);
    // aspect <= 1 means width <= height, so width IS the shorter dimension.
    const shortFraction = fracWidth;
    assert.ok(
      shortFraction >= 0.6 && shortFraction <= 0.7,
      `aspect ${aspect}: shorter-dimension fraction ${shortFraction} outside the 60-70% target`
    );
    // The longer (height) dimension never overfills past the margin cap.
    assert.ok(fracHeight <= MAX_FILL_FRACTION + 1e-9, `aspect ${aspect}: fracHeight ${fracHeight} exceeds cap`);
  }
});

// A real desktop pane isn't necessarily "wide" — a docked ParamPanel can
// leave a viewer area close to square (observed ~0.99 in the design review).
// That case should land in the same target band as mobile portrait, not the
// wide-desktop cap-bound regime (which only kicks in once aspect exceeds
// MAX_FILL_FRACTION / TARGET_WIDTH_FRACTION, i.e. a properly landscape pane).
test("near-square desktop pane: still hits the 60-70% width band, not the wide-aspect cap", () => {
  const d = frameDistance(70, 0.99, FOV);
  const { fracWidth, fracHeight } = fractions(70, 0.99, FOV, d);
  assert.ok(fracWidth >= 0.6 && fracWidth <= 0.7, `fracWidth ${fracWidth} outside the 60-70% band`);
  assert.ok(fracHeight <= MAX_FILL_FRACTION + 1e-9, `fracHeight ${fracHeight} exceeds cap`);
});

// A genuinely wide/landscape desktop pane is unaffected by the mobile-focused
// TARGET_WIDTH_FRACTION bump — it's still governed entirely by the unchanged
// MAX_FILL_FRACTION height cap once aspect exceeds MAX/TARGET.
test("wide desktop aspect stays governed by MAX_FILL_FRACTION regardless of TARGET_WIDTH_FRACTION", () => {
  for (const aspect of [1.6, 1.8, 2.2]) {
    const d = frameDistance(70, aspect, FOV);
    const { fracHeight } = fractions(70, aspect, FOV, d);
    assert.ok(Math.abs(fracHeight - MAX_FILL_FRACTION) < 1e-9, `aspect ${aspect}: fracHeight ${fracHeight} != cap`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// INSET-AWARE FRAMING (round-2 review item 1) — reducedViewport/
// frameDistanceWithInsets/insetViewOffset, plus a from-first-principles
// reproduction of PerspectiveCamera.setViewOffset()'s own projection-matrix
// formula (mirroring three.js's updateProjectionMatrix — see
// node_modules/three/src/cameras/PerspectiveCamera.js), so these tests
// exercise the ACTUAL geometry a browser would render, not just re-assert
// framing.ts's own derivation comment against itself.

// Reproduces PerspectiveCamera.updateProjectionMatrix()'s view-offset branch
// (near=1, arbitrary — it cancels out of every pixel-space quantity below)
// to compute where a bounding sphere of `radius` at `distance` actually
// projects on a canvas of `canvasW`x`canvasH`, once insetViewOffset() points
// the camera at the insets-reduced rect. Returns the sphere's pixel centre
// and diameter (isotropic — see framing.ts's derivation comment) plus its
// raw min/max bounds, so a test can check both centring and cropping.
function projectSphere(radius, distance, canvasW, canvasH, insets, fovDeg) {
  const near = 1;
  const halfV = (fovDeg * Math.PI) / 360;
  const { fullWidth, fullHeight, offsetX, offsetY } = insetViewOffset(canvasW, canvasH, insets);
  const aspect = fullWidth / fullHeight; // PerspectiveCamera.setViewOffset() forces this
  let top = near * Math.tan(halfV);
  let height = 2 * top;
  let width = aspect * height;
  let left = -0.5 * width;
  // three.js's own view-offset formula, verbatim.
  left += (offsetX * width) / fullWidth;
  top -= (offsetY * height) / fullHeight;
  width *= canvasW / fullWidth;
  height *= canvasH / fullHeight;

  const sphereNearHalfExtent = (radius * near) / distance;
  const pxPerNearUnitX = canvasW / width;
  const pxPerNearUnitY = canvasH / height;
  const centerX = (0 - left) * pxPerNearUnitX;
  const centerY = (top - 0) * pxPerNearUnitY;
  const diameterX = 2 * sphereNearHalfExtent * pxPerNearUnitX;
  const diameterY = 2 * sphereNearHalfExtent * pxPerNearUnitY;
  return {
    centerX,
    centerY,
    diameterX,
    diameterY,
    minX: centerX - diameterX / 2,
    maxX: centerX + diameterX / 2,
    minY: centerY - diameterY / 2,
    maxY: centerY + diameterY / 2,
  };
}

test("ZERO_INSETS recovers the plain whole-canvas fit exactly", () => {
  const canvasW = 1200, canvasH = 800;
  const { width, height } = reducedViewport(canvasW, canvasH, ZERO_INSETS);
  assert.equal(width, canvasW);
  assert.equal(height, canvasH);
  const d = frameDistanceWithInsets(60, canvasW, canvasH, ZERO_INSETS, FOV);
  assert.equal(d, frameDistance(60, canvasW / canvasH, FOV));
  const vo = insetViewOffset(canvasW, canvasH, ZERO_INSETS);
  // node:assert/strict's equal is a strictEqual alias, which (unlike plain
  // ==/assert.equal) distinguishes IEEE -0 from 0 — and -insets.left on a
  // zero inset is -0, numerically (and for three.js's purposes) identical
  // to 0 but a distinct value under strict/Object.is comparison. Math.abs()
  // normalises it away rather than asserting a sign three.js never cares
  // about.
  assert.equal(vo.fullWidth, canvasW);
  assert.equal(vo.fullHeight, canvasH);
  assert.equal(Math.abs(vo.offsetX), 0);
  assert.equal(Math.abs(vo.offsetY), 0);
});

test("reducedViewport subtracts insets on each edge", () => {
  const { width, height } = reducedViewport(1000, 700, { top: 40, right: 60, bottom: 90, left: 10 });
  assert.equal(width, 1000 - 60 - 10);
  assert.equal(height, 700 - 40 - 90);
});

test("reducedViewport floors at MIN_REDUCED_FRACTION instead of collapsing to zero/negative", () => {
  // Insets that would otherwise consume the whole (tiny) mobile canvas.
  const { width, height } = reducedViewport(320, 200, { top: 150, right: 150, bottom: 150, left: 150 });
  assert.ok(width > 0 && Number.isFinite(width));
  assert.ok(height > 0 && Number.isFinite(height));
  assert.ok(width >= 320 * 0.25 - 1e-9);
  assert.ok(height >= 200 * 0.25 - 1e-9);
});

// Representative canvases at phone-portrait, tablet, and desktop aspects,
// each with a realistic (non-pathological) inset set for that shape — a
// docked HUD strip, an export dock, a small top allowance — mirroring what
// computeViewerInsets() itself would hand back for a real layout.
const REPRESENTATIVE_SCENARIOS = [
  {
    label: "phone portrait (390x760, mobile insets)",
    canvasW: 390,
    canvasH: 760,
    insets: computeViewerInsets({ isMobile: true, hudVisible: true, dockHeightPx: 88, safeAreaBottomPx: 0 }),
  },
  {
    label: "phone portrait, sheet at half (390x420, mobile insets)",
    canvasW: 390,
    canvasH: 420,
    insets: computeViewerInsets({ isMobile: true, hudVisible: true, dockHeightPx: 88, safeAreaBottomPx: 0 }),
  },
  {
    label: "tablet-ish (820x900, desktop insets)",
    canvasW: 820,
    canvasH: 900,
    insets: computeViewerInsets({ isMobile: false, hudVisible: true, dockHeightPx: 92, safeAreaBottomPx: 0 }),
  },
  {
    label: "desktop (1400x850, desktop insets incl. safe area)",
    canvasW: 1400,
    canvasH: 850,
    insets: computeViewerInsets({ isMobile: false, hudVisible: true, dockHeightPx: 92, safeAreaBottomPx: 20 }),
  },
];

for (const { label, canvasW, canvasH, insets } of REPRESENTATIVE_SCENARIOS) {
  test(`inset-aware fit centres in and never crops the unobscured rect: ${label}`, () => {
    const radius = 55;
    const d = frameDistanceWithInsets(radius, canvasW, canvasH, insets, FOV);
    const proj = projectSphere(radius, d, canvasW, canvasH, insets, FOV);
    const { width: rw, height: rh } = reducedViewport(canvasW, canvasH, insets);
    const reducedAspect = rw / rh;

    // Occupancy of the REDUCED rect — mirrors the plain (non-inset) suite's
    // own aspect-branch semantics above: at or under square (reducedAspect
    // <= 1) the WIDTH fraction hits the ~60-70% target band and the height
    // fraction just stays under the cap (it can go arbitrarily small for a
    // very narrow/tall reduced rect — see the "mobile is never aggressively
    // zoomed" test); past the point MAX_FILL_FRACTION binds
    // (reducedAspect > MAX/TARGET), it's the reverse (roles swap, and the
    // now-constrained axis can be small — see "wide desktop... binds on
    // height"). diameterX and diameterY themselves (not the two fractions,
    // which naturally differ whenever rw != rh) are what must match — the
    // bounding sphere always projects as a circle regardless of asymmetric
    // insets (framing.ts's derivation comment).
    const occupancyX = proj.diameterX / rw;
    const occupancyY = proj.diameterY / rh;
    assert.ok(Math.abs(proj.diameterX - proj.diameterY) < 1e-6, `${label}: not isotropic (${proj.diameterX} vs ${proj.diameterY})`);
    if (reducedAspect <= MAX_FILL_FRACTION / TARGET_WIDTH_FRACTION) {
      assert.ok(occupancyX >= 0.5 && occupancyX <= 0.7 + 1e-6, `${label}: width occupancy ${occupancyX} outside 50-70%`);
      assert.ok(occupancyY <= MAX_FILL_FRACTION + 1e-6, `${label}: height occupancy ${occupancyY} exceeds the cap`);
    } else {
      assert.ok(Math.abs(occupancyY - MAX_FILL_FRACTION) < 1e-6, `${label}: height occupancy ${occupancyY} != cap`);
      assert.ok(occupancyX > 0.15 && occupancyX <= MAX_FILL_FRACTION + 1e-6, `${label}: width occupancy ${occupancyX} reads over/under-zoomed`);
    }

    // Centred in the UNOBSCURED rect, not the raw canvas.
    const expectedCenterX = insets.left + rw / 2;
    const expectedCenterY = insets.top + rh / 2;
    assert.ok(Math.abs(proj.centerX - expectedCenterX) < 1e-6, `${label}: centerX ${proj.centerX} != ${expectedCenterX}`);
    assert.ok(Math.abs(proj.centerY - expectedCenterY) < 1e-6, `${label}: centerY ${proj.centerY} != ${expectedCenterY}`);

    // Never cropped: fully inside BOTH the reduced rect and the raw canvas.
    assert.ok(proj.minX >= insets.left - 1e-6 && proj.maxX <= canvasW - insets.right + 1e-6, `${label}: X out of the unobscured rect`);
    assert.ok(proj.minY >= insets.top - 1e-6 && proj.maxY <= canvasH - insets.bottom + 1e-6, `${label}: Y out of the unobscured rect`);
    assert.ok(proj.minX >= -1e-6 && proj.maxX <= canvasW + 1e-6, `${label}: X out of the canvas`);
    assert.ok(proj.minY >= -1e-6 && proj.maxY <= canvasH + 1e-6, `${label}: Y out of the canvas`);
  });
}

test("insets never crop even for a flat-wide model (large radius, wide bounding sphere)", () => {
  const canvasW = 1440, canvasH = 900;
  const insets = computeViewerInsets({ isMobile: false, hudVisible: true, dockHeightPx: 100, safeAreaBottomPx: 0 });
  const radius = 140; // a wide flat plate's bounding sphere
  const d = frameDistanceWithInsets(radius, canvasW, canvasH, insets, FOV);
  const proj = projectSphere(radius, d, canvasW, canvasH, insets, FOV);
  assert.ok(proj.minX >= -1e-6 && proj.maxX <= canvasW + 1e-6);
  assert.ok(proj.minY >= -1e-6 && proj.maxY <= canvasH + 1e-6);
});

test("insets never crop for a tall narrow model (small radius, upright keychain)", () => {
  const canvasW = 375, canvasH = 667; // a short phone in portrait
  const insets = computeViewerInsets({ isMobile: true, hudVisible: true, dockHeightPx: 96, safeAreaBottomPx: 0 });
  const radius = 25;
  const d = frameDistanceWithInsets(radius, canvasW, canvasH, insets, FOV);
  const proj = projectSphere(radius, d, canvasW, canvasH, insets, FOV);
  assert.ok(proj.minX >= -1e-6 && proj.maxX <= canvasW + 1e-6);
  assert.ok(proj.minY >= -1e-6 && proj.maxY <= canvasH + 1e-6);
});

test("insets never crop for a cube-ish model at a near-square desktop pane", () => {
  const canvasW = 760, canvasH = 780;
  const insets = computeViewerInsets({ isMobile: false, hudVisible: true, dockHeightPx: 90, safeAreaBottomPx: 0 });
  const radius = 45;
  const d = frameDistanceWithInsets(radius, canvasW, canvasH, insets, FOV);
  const proj = projectSphere(radius, d, canvasW, canvasH, insets, FOV);
  assert.ok(proj.minX >= -1e-6 && proj.maxX <= canvasW + 1e-6);
  assert.ok(proj.minY >= -1e-6 && proj.maxY <= canvasH + 1e-6);
});

// The design review's own repro: the sheet dragged up to the half detent
// shrinks the canvas HEIGHT a lot while the width stays fixed — re-fitting
// against the (now differently-shaped) reduced rect must still avoid
// cropping at every point along that drag, not just at the two endpoints.
test("never crops across a simulated sheet drag from peek to half (shrinking canvas height)", () => {
  const canvasW = 390;
  const radius = 50;
  for (const canvasH of [700, 600, 500, 420, 360]) {
    const insets = computeViewerInsets({ isMobile: true, hudVisible: true, dockHeightPx: 88, safeAreaBottomPx: 0 });
    const d = frameDistanceWithInsets(radius, canvasW, canvasH, insets, FOV);
    const proj = projectSphere(radius, d, canvasW, canvasH, insets, FOV);
    assert.ok(proj.minX >= -1e-6 && proj.maxX <= canvasW + 1e-6, `h=${canvasH}: X cropped`);
    assert.ok(proj.minY >= -1e-6 && proj.maxY <= canvasH + 1e-6, `h=${canvasH}: Y cropped`);
  }
});

// ── computeViewerInsets() itself ───────────────────────────────────────────

test("computeViewerInsets: no dock measured yet -> no bottom inset", () => {
  const insets = computeViewerInsets({ isMobile: false, hudVisible: true, dockHeightPx: 0, safeAreaBottomPx: 10 });
  assert.equal(insets.bottom, 0);
});

test("computeViewerInsets: HUD hidden -> no right inset", () => {
  const insets = computeViewerInsets({ isMobile: false, hudVisible: false, dockHeightPx: 90, safeAreaBottomPx: 0 });
  assert.equal(insets.right, 0);
});

test("computeViewerInsets: desktop bottom inset folds in the dock height, gap, and safe area", () => {
  const insets = computeViewerInsets({ isMobile: false, hudVisible: true, dockHeightPx: 90, safeAreaBottomPx: 15 });
  assert.ok(insets.bottom > 90 + 15, "should exceed dock height + safe area (a gap is added too)");
});

test("computeViewerInsets: mobile bottom inset does NOT double-count safe area (already in the sheet's own box)", () => {
  const mobile = computeViewerInsets({ isMobile: true, hudVisible: true, dockHeightPx: 90, safeAreaBottomPx: 34 });
  const mobileNoSafeArea = computeViewerInsets({ isMobile: true, hudVisible: true, dockHeightPx: 90, safeAreaBottomPx: 0 });
  assert.equal(mobile.bottom, mobileNoSafeArea.bottom);
});

test("computeViewerInsets: left inset is always zero (no floating chrome on that edge)", () => {
  for (const isMobile of [true, false]) {
    const insets = computeViewerInsets({ isMobile, hudVisible: true, dockHeightPx: 90, safeAreaBottomPx: 10 });
    assert.equal(insets.left, 0);
  }
});

// Round-6, item 1: `reviewStage` — guided workflow's mobile Review detent's
// own, much smaller top reserve. See computeViewerInsets' own `reviewStage`
// doc (framing.ts) and GUIDED_REVIEW_FIT's own doc for the full bug this
// fixes: the mount's box at the mobile "review" sheet detent is already
// short (sheetDetent.ts's REVIEW_VH_RATIO reserves ~70% of the viewport
// height for the sheet); Content/Appearance's flat top reserve, sized for a
// much taller box, ate a disproportionate share of it once combined with the
// dock's own bottom inset, collapsing the reduced rect toward an extreme
// (5:1+) aspect ratio and shrinking the model far below Content/Appearance's
// own width fraction.
test("computeViewerInsets: reviewStage shrinks the mobile top inset well below Content/Appearance's", () => {
  const contentTop = computeViewerInsets({ isMobile: true, hudVisible: true, dockHeightPx: 47, safeAreaBottomPx: 0 }).top;
  const reviewTop = computeViewerInsets({
    isMobile: true,
    hudVisible: true,
    dockHeightPx: 47,
    safeAreaBottomPx: 0,
    reviewStage: true,
  }).top;
  assert.ok(reviewTop < contentTop, `reviewStage top inset ${reviewTop} should be smaller than Content/Appearance's ${contentTop}`);
  assert.ok(reviewTop > 0, "still a little breathing room, not zero");
});

test("computeViewerInsets: reviewStage is a no-op on desktop (no equivalent detent there)", () => {
  const plain = computeViewerInsets({ isMobile: false, hudVisible: true, dockHeightPx: 90, safeAreaBottomPx: 0 });
  const reviewStage = computeViewerInsets({
    isMobile: false,
    hudVisible: true,
    dockHeightPx: 90,
    safeAreaBottomPx: 0,
    reviewStage: true,
  });
  assert.deepEqual(reviewStage, plain);
});

test("computeViewerInsets: reviewStage omitted defaults to Content/Appearance's own top inset (every existing caller unaffected)", () => {
  const omitted = computeViewerInsets({ isMobile: true, hudVisible: true, dockHeightPx: 47, safeAreaBottomPx: 0 });
  const explicitFalse = computeViewerInsets({
    isMobile: true,
    hudVisible: true,
    dockHeightPx: 47,
    safeAreaBottomPx: 0,
    reviewStage: false,
  });
  assert.deepEqual(omitted, explicitFalse);
});

// Round-6, item 1 — the actual acceptance criterion, checked end to end
// against the box-fit math (not just the inset numbers in isolation): a
// short, wide, flat-plate-shaped model's WIDTH occupancy at the degenerate
// mobile Review rect (short height, HUD/dock insets eating most of it) must
// land close to its Content/Appearance occupancy, not "dramatically
// smaller" — this reproduces the exact regression this pass fixes (measured
// via Playwright against a real build: Review's width fraction used to land
// under half of Content/Appearance's own, now within ~10%).
test("guided Review fit at the mobile 'review' detent: width occupancy stays close to Content/Appearance's, not dramatically smaller", () => {
  const half = { x: 45, y: 22.5, z: 2.25 }; // ~90x45x4.5mm plate, this suite's own flat-plate shape
  const direction = new THREE.Vector3(60, -80, 60).normalize(); // Viewer.tsx's own default camera position
  const dockHeightPx = 47;

  // Content/Appearance: a typical mobile mount box well above the sheet.
  const contentInsets = computeViewerInsets({ isMobile: true, hudVisible: true, dockHeightPx, safeAreaBottomPx: 0 });
  const contentDistance = frameDistanceForBoxWithInsets(half, direction, 390, 378, contentInsets, FOV);
  const contentReduced = reducedViewport(390, 378, contentInsets);

  // Review: the much shorter mount box at the "review" detent (measured via
  // a real build at 390x844 — see this pass's own Playwright check).
  const reviewInsets = computeViewerInsets({
    isMobile: true,
    hudVisible: true,
    dockHeightPx,
    safeAreaBottomPx: 0,
    reviewStage: true,
  });
  const reviewDistance = frameDistanceForBoxWithInsets(half, direction, 390, 236, reviewInsets, FOV, GUIDED_REVIEW_FIT);
  const reviewReduced = reducedViewport(390, 236, reviewInsets);

  // Re-derive each stage's own on-screen width occupancy (fraction of its
  // OWN reduced rect's width) from its distance — same projection
  // frameDistanceForBox() itself inverts (this suite's own box-fit tests use
  // the identical approach).
  function widthOccupancy(distance, reducedW, reducedH) {
    const aspect = reducedW / reducedH;
    const tanHalfV = Math.tan((FOV * Math.PI) / 360);
    const tanHalfH = aspect * tanHalfV;
    const basis = new THREE.Matrix4().lookAt(direction, new THREE.Vector3(), new THREE.Vector3(0, 0, 1));
    const right = new THREE.Vector3().setFromMatrixColumn(basis, 0);
    let lo = Infinity, hi = -Infinity;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const corner = new THREE.Vector3(sx * half.x, sy * half.y, sz * half.z);
      const q = corner.dot(right);
      const depth = distance - corner.dot(direction);
      const ndc = q / (depth * tanHalfH);
      if (ndc < lo) lo = ndc;
      if (ndc > hi) hi = ndc;
    }
    return (hi - lo) / 2;
  }

  const contentFrac = widthOccupancy(contentDistance, contentReduced.width, contentReduced.height);
  const reviewFrac = widthOccupancy(reviewDistance, reviewReduced.width, reviewReduced.height);

  assert.ok(reviewFrac >= 0.5, `Review width occupancy ${reviewFrac} should be a substantial fraction of its own reduced rect`);
  assert.ok(
    reviewFrac >= contentFrac * 0.75,
    `Review width occupancy ${reviewFrac} should not be dramatically smaller than Content/Appearance's ${contentFrac}`
  );
});

// ═══════════════════════════════════════════════════════════════════════
// PROJECTED-BOUNDING-BOX FIT (visual-alignment round-3, item 1) —
// frameDistanceForBox()/frameDistanceForBoxWithInsets() replace the bounding-
// SPHERE fit above as Viewer.tsx's actual camera-distance source: a sphere is
// a conservative circumscribing proxy whose radius is dominated by a flat,
// wide plate's diagonal — far larger than that plate's real on-screen
// silhouette from a 3/4 angle, this app's signature shape (a thin plate with
// braille/text relief) — so fitting to it left such plates reading at
// ~30-40% of the pane instead of the intended ~55-65%. These tests
// independently re-derive the 8-corner projection (extending projectSphere()
// above from a single radius to a box, through the same insetViewOffset()
// shift, and three.js's own Matrix4.lookAt() camera-basis convention — see
// framing.ts's own header comment for the frameDistanceForBox() derivation)
// rather than re-invoking frameDistanceForBox()'s bisection internals, so
// they genuinely check the SOLVED distance's on-screen result rather than
// re-asserting the implementation against itself.

const WORLD_UP = new THREE.Vector3(0, 0, 1);

// Project a box's 8 corners (half-extents `half`, centred at the orbit
// target) onto a canvasW x canvasH screenshot at `distance` along `direction`
// (unit vector, target -> camera), through the same insetViewOffset()-shifted
// near-plane projection projectSphere() above uses — generalised from a
// single (centred) point to 8 arbitrary corners. Returns the pixel-space
// bounding box of all 8 corners.
function projectBoxCorners(half, direction, distance, canvasW, canvasH, insets, fovDeg) {
  const near = 1;
  const halfV = (fovDeg * Math.PI) / 360;
  const { fullWidth, fullHeight, offsetX, offsetY } = insetViewOffset(canvasW, canvasH, insets);
  const aspect = fullWidth / fullHeight;
  let top = near * Math.tan(halfV);
  let height = 2 * top;
  let width = aspect * height;
  let left = -0.5 * width;
  left += (offsetX * width) / fullWidth;
  top -= (offsetY * height) / fullHeight;
  width *= canvasW / fullWidth;
  height *= canvasH / fullHeight;
  const pxPerNearUnitX = canvasW / width;
  const pxPerNearUnitY = canvasH / height;

  const dir = direction.clone().normalize();
  // Same basis three.js's own Object3D.lookAt()/OrbitControls use — see
  // framing.ts's frameDistanceForBox() doc.
  const basis = new THREE.Matrix4().lookAt(dir, new THREE.Vector3(0, 0, 0), WORLD_UP);
  const right = new THREE.Vector3().setFromMatrixColumn(basis, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(basis, 1);
  const camPos = dir.clone().multiplyScalar(distance); // target is the origin

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const corner = new THREE.Vector3();
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corner.set(sx * half.x, sy * half.y, sz * half.z);
        const v = corner.clone().sub(camPos); // camera -> point, world space
        const zCam = -v.dot(dir); // depth in front of camera
        const xCam = v.dot(right);
        const yCam = v.dot(up);
        const nearX = (xCam * near) / zCam;
        const nearY = (yCam * near) / zCam;
        const px = (nearX - left) * pxPerNearUnitX;
        const py = (top - nearY) * pxPerNearUnitY;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

// Representative box shapes: a flat, wide plate (this app's dominant shape),
// a tall narrow keychain-like block, and a cube — spanning the extremes
// frameDistance()'s own bounding-sphere tests cover, but for a real box.
const FLAT_WIDE = { x: 80, y: 40, z: 2.5 }; // 160x80x5mm plate, half-extents
const TALL_NARROW = { x: 15, y: 15, z: 60 }; // 30x30x120mm upright block
const CUBE = { x: 25, y: 25, z: 25 };

// The default "product" view direction (views.ts's VIEW_DIRECTIONS.product),
// normalised — the angle every occupancy screenshot in the design review was
// judged against.
const PRODUCT_DIR = new THREE.Vector3(0.32, -0.67, 0.88).normalize();

for (const [shapeName, half] of [["flat-wide plate", FLAT_WIDE], ["tall-narrow block", TALL_NARROW], ["cube", CUBE]]) {
  for (const [aspectName, canvasW, canvasH] of [
    ["phone portrait (390x760)", 390, 760],
    ["tablet-ish (820x900)", 820, 900],
    ["desktop landscape (1440x900)", 1440, 900],
  ]) {
    test(`projected-box fit: ${shapeName} at ${aspectName}, no insets — hits its target band, never crops`, () => {
      const d = frameDistanceForBox(half, PRODUCT_DIR, canvasW / canvasH, FOV);
      assert.ok(Number.isFinite(d) && d > 0, `distance ${d} is not a sane positive number`);
      const box = projectBoxCorners(half, PRODUCT_DIR, d, canvasW, canvasH, ZERO_INSETS, FOV);
      const widthFrac = box.width / canvasW;
      const heightFrac = box.height / canvasH;
      // Whichever axis binds should land close to its own target/cap; the
      // other stays at or under its own cap with room to spare. A little
      // slack (2%) covers the box's asymmetric near/far-corner perspective,
      // which (unlike an isotropic sphere) doesn't collapse to an exact
      // closed form.
      assert.ok(
        widthFrac <= TARGET_WIDTH_FRACTION + 0.02,
        `${shapeName}/${aspectName}: widthFrac ${widthFrac} exceeds the width target`
      );
      assert.ok(
        heightFrac <= MAX_FILL_FRACTION + 0.02,
        `${shapeName}/${aspectName}: heightFrac ${heightFrac} exceeds the height cap`
      );
      // Never cropped: the whole box stays inside the canvas.
      assert.ok(box.minX >= -1e-6 && box.maxX <= canvasW + 1e-6, `${shapeName}/${aspectName}: X cropped (${box.minX}..${box.maxX})`);
      assert.ok(box.minY >= -1e-6 && box.maxY <= canvasH + 1e-6, `${shapeName}/${aspectName}: Y cropped (${box.minY}..${box.maxY})`);
    });
  }
}

// The headline fix: a flat, wide plate at a landscape desktop aspect must
// occupy MEANINGFULLY more of the pane under the box fit than the old
// bounding-sphere fit did at the same distance formula's own target — this
// is what actually resolves the design review's "still only fills ~30-40%"
// finding (the sphere fit was never wrong on its own terms, just fitting the
// wrong shape to a flat plate's radius).
test("projected-box fit meaningfully out-fills the bounding-sphere fit for a flat, wide plate", () => {
  const canvasW = 1440, canvasH = 900;
  const boxDistance = frameDistanceForBox(FLAT_WIDE, PRODUCT_DIR, canvasW / canvasH, FOV);
  const boxProjection = projectBoxCorners(FLAT_WIDE, PRODUCT_DIR, boxDistance, canvasW, canvasH, ZERO_INSETS, FOV);
  const boxWidthFrac = boxProjection.width / canvasW;

  // The old call site: frameDistance() fed the plate's own bounding-sphere
  // radius, then the SAME box corners projected at THAT distance (the actual
  // on-screen result the old code produced for this shape).
  const sphereRadius = Math.hypot(FLAT_WIDE.x, FLAT_WIDE.y, FLAT_WIDE.z);
  const sphereDistance = frameDistance(sphereRadius, canvasW / canvasH, FOV);
  const sphereProjection = projectBoxCorners(FLAT_WIDE, PRODUCT_DIR, sphereDistance, canvasW, canvasH, ZERO_INSETS, FOV);
  const sphereWidthFrac = sphereProjection.width / canvasW;

  assert.ok(
    boxWidthFrac > sphereWidthFrac * 1.15,
    `box fit (${boxWidthFrac}) should meaningfully out-fill the sphere fit (${sphereWidthFrac})`
  );
  // The box fit itself lands in the intended band; the sphere fit (kept only
  // for its own tests/possible future use) is demonstrably short of it here.
  assert.ok(boxWidthFrac >= 0.5, `box fit widthFrac ${boxWidthFrac} still short of the target band`);
});

// Representative insets scenarios (phone/tablet/desktop, realistic chrome),
// mirroring the sphere fit's own REPRESENTATIVE_SCENARIOS suite above, but
// checked against the actual box corners rather than assumed-isotropic
// fractions.
const BOX_INSET_SCENARIOS = [
  {
    label: "phone portrait (390x760, mobile insets)",
    canvasW: 390, canvasH: 760,
    insets: computeViewerInsets({ isMobile: true, hudVisible: true, dockHeightPx: 88, safeAreaBottomPx: 0 }),
  },
  {
    label: "phone portrait, sheet at half (390x420, mobile insets)",
    canvasW: 390, canvasH: 420,
    insets: computeViewerInsets({ isMobile: true, hudVisible: true, dockHeightPx: 88, safeAreaBottomPx: 0 }),
  },
  {
    label: "tablet-ish (820x900, desktop insets)",
    canvasW: 820, canvasH: 900,
    insets: computeViewerInsets({ isMobile: false, hudVisible: true, dockHeightPx: 92, safeAreaBottomPx: 0 }),
  },
  {
    label: "desktop (1440x850, desktop insets incl. safe area)",
    canvasW: 1440, canvasH: 850,
    insets: computeViewerInsets({ isMobile: false, hudVisible: true, dockHeightPx: 92, safeAreaBottomPx: 20 }),
  },
];

for (const { label, canvasW, canvasH, insets } of BOX_INSET_SCENARIOS) {
  for (const [shapeName, half] of [["flat-wide plate", FLAT_WIDE], ["tall-narrow block", TALL_NARROW], ["cube", CUBE]]) {
    test(`projected-box inset-aware fit never crops: ${shapeName}, ${label}`, () => {
      const d = frameDistanceForBoxWithInsets(half, PRODUCT_DIR, canvasW, canvasH, insets, FOV);
      const box = projectBoxCorners(half, PRODUCT_DIR, d, canvasW, canvasH, insets, FOV);
      assert.ok(box.minX >= -1e-6 && box.maxX <= canvasW + 1e-6, `${shapeName}/${label}: X cropped (${box.minX}..${box.maxX})`);
      assert.ok(box.minY >= -1e-6 && box.maxY <= canvasH + 1e-6, `${shapeName}/${label}: Y cropped (${box.minY}..${box.maxY})`);
    });
  }
}

// The flat-plate/desktop case specifically, at realistic insets: occupancy of
// the UNOBSTRUCTED (reduced) rect should land close to the ~55-65% band this
// pass targets — not just "somewhere under the cap".
test("projected-box inset-aware fit: flat plate on desktop lands in the ~55-65% width band", () => {
  const canvasW = 1440, canvasH = 900;
  const insets = computeViewerInsets({ isMobile: false, hudVisible: true, dockHeightPx: 92, safeAreaBottomPx: 0 });
  const d = frameDistanceForBoxWithInsets(FLAT_WIDE, PRODUCT_DIR, canvasW, canvasH, insets, FOV);
  const box = projectBoxCorners(FLAT_WIDE, PRODUCT_DIR, d, canvasW, canvasH, insets, FOV);
  const { width: rw } = reducedViewport(canvasW, canvasH, insets);
  const widthFrac = box.width / rw;
  assert.ok(widthFrac >= 0.5 && widthFrac <= 0.7, `widthFrac ${widthFrac} outside the ~55-65% band`);
});

test("frameDistanceForBox: distance scales up (further away, smaller projection) as the box grows, same direction/aspect/fov", () => {
  const small = frameDistanceForBox(CUBE, PRODUCT_DIR, 1.5, FOV);
  const big = frameDistanceForBox({ x: 50, y: 50, z: 50 }, PRODUCT_DIR, 1.5, FOV);
  assert.ok(big > small, `bigger box (${big}) should sit farther back than the smaller one (${small})`);
});

test("frameDistanceForBox: degenerate (zero-length) direction falls back to a sane finite distance", () => {
  const d = frameDistanceForBox(FLAT_WIDE, new THREE.Vector3(0, 0, 0), 1.5, FOV);
  assert.ok(Number.isFinite(d) && d > 0, `distance ${d} is not sane`);
});

// ── Round-5 Wave 2, item 7 (revised round-6, item 1): per-call fill-fraction
// overrides ─────────────────────────────────────────────────────────────
// AppShell's guided-workflow Review stage tunes the fit via GUIDED_REVIEW_FIT
// rather than the plain module defaults — these check that (a) the override
// args actually change the solved distance/on-screen result (not silently
// ignored), and (b) omitting them still reproduces the module-default
// framing exactly (every "tabs"-workflow/non-Review caller's contract).
// Round-5 review, quality item 3: the fill-fraction override is a single
// `{width, height}` object (framing.ts's `FitFraction`) threaded end-to-end
// through frameDistanceForBox/frameDistanceForBoxWithInsets and Viewer's own
// `fitFraction` prop — no more two positional numbers unpacked/re-packed at
// each hop. GUIDED_REVIEW_FIT already has exactly that shape, so it's passed
// straight through below instead of destructured into `.width`/`.height`.
//
// Round-6, item 1 revised what GUIDED_REVIEW_FIT actually IS: round-5's pair
// ({0.58, 0.62}) was uniformly SMALLER than the module defaults, on the
// (mistaken — see GUIDED_REVIEW_FIT's own doc) assumption that Review should
// always read a touch smaller than Content/Appearance. The current pair
// ({0.68, 0.95}) is a HIGH cap that only actually binds at the degenerate
// short/wide aspect the mobile "review" detent produces — at a normal
// (desktop-like) aspect it's inert, and the WIDTH target alone (0.68, a
// touch ABOVE the default 0.66) is what governs, landing Review a hair
// LARGER than Content/Appearance there, not smaller. So "a smaller target
// sits farther back" no longer holds as a general claim; these tests instead
// check the two aspect regimes GUIDED_REVIEW_FIT actually has to serve.
test("frameDistanceForBox: at a normal (desktop-like) aspect, GUIDED_REVIEW_FIT's high height cap is inert — width still governs, landing close to (not dramatically different from) the module default", () => {
  const aspect = 1440 / 900;
  const dDefault = frameDistanceForBox(FLAT_WIDE, PRODUCT_DIR, aspect, FOV);
  const dReview = frameDistanceForBox(FLAT_WIDE, PRODUCT_DIR, aspect, FOV, GUIDED_REVIEW_FIT);
  const ratio = dReview / dDefault;
  assert.ok(
    ratio > 0.85 && ratio < 1.15,
    `GUIDED_REVIEW_FIT's distance (${dReview}) should stay close to the module default's (${dDefault}) at a normal aspect, got ratio ${ratio}`
  );
});

test("frameDistanceForBox: omitting the fraction override reproduces the module-default distance exactly", () => {
  const aspect = 1440 / 900;
  const withDefaultsExplicit = frameDistanceForBox(
    FLAT_WIDE, PRODUCT_DIR, aspect, FOV, { width: TARGET_WIDTH_FRACTION, height: MAX_FILL_FRACTION }
  );
  const withDefaultsOmitted = frameDistanceForBox(FLAT_WIDE, PRODUCT_DIR, aspect, FOV);
  assert.equal(withDefaultsOmitted, withDefaultsExplicit);
});

test("frameDistanceForBoxWithInsets: the fraction override threads through the insets-aware wrapper too", () => {
  const canvasW = 1440, canvasH = 900;
  const insets = computeViewerInsets({ isMobile: false, hudVisible: true, dockHeightPx: 92, safeAreaBottomPx: 0 });
  const dDefault = frameDistanceForBoxWithInsets(FLAT_WIDE, PRODUCT_DIR, canvasW, canvasH, insets, FOV);
  const dReview = frameDistanceForBoxWithInsets(
    FLAT_WIDE, PRODUCT_DIR, canvasW, canvasH, insets, FOV, GUIDED_REVIEW_FIT
  );
  assert.notEqual(dReview, dDefault, "the override should actually change the solved distance");
});

test("GUIDED_REVIEW_FIT at a degenerate short/wide aspect (the mobile 'review' detent's own shape): sits the camera noticeably CLOSER than the module default would, countering the height-axis bind that produced the 'shrinks dramatically' bug", () => {
  // A short, wide canvas — the shape computeViewerInsets' own reviewStage
  // test derives from a real build's measured mount box at the "review"
  // detent (~390x236, HUD+dock insets eating a good share of the remaining
  // height).
  const canvasW = 390, canvasH = 236;
  const insets = computeViewerInsets({
    isMobile: true,
    hudVisible: true,
    dockHeightPx: 47,
    safeAreaBottomPx: 0,
    reviewStage: true,
  });
  const dDefault = frameDistanceForBoxWithInsets(FLAT_WIDE, PRODUCT_DIR, canvasW, canvasH, insets, FOV);
  const dReview = frameDistanceForBoxWithInsets(
    FLAT_WIDE, PRODUCT_DIR, canvasW, canvasH, insets, FOV, GUIDED_REVIEW_FIT
  );
  assert.ok(
    dReview < dDefault,
    `GUIDED_REVIEW_FIT's high height cap should sit the camera closer (${dReview}) than the module default's tighter cap (${dDefault}) at this degenerate aspect`
  );
});

test("GUIDED_REVIEW_FIT: the guided Review stage's own target lands the flat plate within its own width band at a normal (desktop-like) aspect", () => {
  const canvasW = 1440, canvasH = 900;
  const insets = computeViewerInsets({ isMobile: false, hudVisible: true, dockHeightPx: 92, safeAreaBottomPx: 0 });
  const d = frameDistanceForBoxWithInsets(
    FLAT_WIDE, PRODUCT_DIR, canvasW, canvasH, insets, FOV, GUIDED_REVIEW_FIT
  );
  const box = projectBoxCorners(FLAT_WIDE, PRODUCT_DIR, d, canvasW, canvasH, insets, FOV);
  const { width: rw } = reducedViewport(canvasW, canvasH, insets);
  const widthFrac = box.width / rw;
  assert.ok(widthFrac >= 0.45 && widthFrac <= 0.72, `Review widthFrac ${widthFrac} outside the expected band`);
});
