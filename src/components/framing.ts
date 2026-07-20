// framing.ts — pure math behind the viewer's "product stage" camera framing:
// how far back the camera sits from a model's bounding sphere so the model
// reads like a studio product shot (generously margined, never overfilling
// the canvas) at any viewport shape — a wide desktop pane and a narrow
// mobile portrait pane alike. Extracted from Viewer.tsx so it's testable
// without a WebGL context; Viewer.tsx's frameView() is the sole caller.
//
// A perspective camera's vertical field of view (fovDeg) and the viewport's
// aspect ratio (width / height) together fix the horizontal field of view:
// tan(halfH) = aspect * tan(halfV). At distance d, a bounding sphere of
// radius r projects to a fraction of the viewport's HEIGHT of
//   fracHeight = r / (d * tan(halfV))
// and, because the visible frustum's own width/height ratio always equals
// the viewport's aspect, a fraction of its WIDTH of
//   fracWidth = fracHeight / aspect.
// Those two fractions are coupled by `aspect`, not independent — so the fit
// below picks the more restrictive of two targets: reach TARGET_WIDTH_FRACTION
// of the width when the viewport is tall/narrow enough to allow it (mobile
// portrait, a roughly square pane), but back off (larger distance, smaller
// projection) whenever that width target would push the HEIGHT fraction past
// MAX_FILL_FRACTION — which is what happens on a wide/landscape desktop pane.
// The result: >=15% clear margin on every side at any aspect ratio, and a
// model that's never "aggressively zoomed" on a narrow mobile viewport.
//
// frameDistance()/frameDistanceWithInsets() below fit the model's bounding
// SPHERE and stay exported/tested for their own sake, but Viewer.tsx no
// longer calls them directly — see the "PROJECTED-BOUNDING-BOX FIT" section
// further down (frameDistanceForBox/frameDistanceForBoxWithInsets), which is
// what actually drives the camera now. A sphere is a fine, cheap proxy for a
// roughly-cubic model, but its radius is dominated by a flat/wide plate's
// diagonal — far larger than that plate's actual on-screen silhouette from a
// 3/4 angle — so fitting to it left flat-plate designs reading at ~30-40%
// of the pane instead of the intended ~60%.
//
// Pure math only; no WebGL context needed (three.js's Vector3/Matrix4 run on
// plain numbers), so this stays testable under node:test the same way it was
// before the box-fit addition.
import * as THREE from "three";

/** Hard cap on the fraction of the viewport (either axis) the model's
 *  bounding sphere may occupy — 0.68 leaves a little over 15% clear margin
 *  per side (16%), a hair of headroom past the ">=15%" requirement so
 *  rounding/aspect edge cases don't shave it below the line. */
export const MAX_FILL_FRACTION = 0.68;

/** The width fraction the fit aims for when the viewport shape allows it —
 *  the upper half of the spec's ~60-70% target band. Any viewport at or
 *  narrower than square (aspect <= 1 — a mobile portrait pane, or a desktop
 *  pane close to square) hits this exactly, since MAX_FILL_FRACTION only
 *  binds once aspect exceeds MAX_FILL_FRACTION / TARGET_WIDTH_FRACTION (a
 *  properly landscape desktop pane). A flat/elongated model's bounding
 *  sphere is dominated by its longest axis, so even a correctly-hit width
 *  target can look small in a tall, narrow mobile viewer pane if the target
 *  itself sits too low in the band — 0.66 (was 0.62) keeps the model
 *  legible there without crowding the margins on a near-square desktop
 *  pane. */
export const TARGET_WIDTH_FRACTION = 0.66;

/**
 * Camera distance from a bounding sphere of `radius` (model units) so its
 * projection respects the fill-fraction targets above, for a perspective
 * camera with vertical field of view `fovDeg` (degrees) looking at a
 * viewport of `aspect` = width / height.
 */
export function frameDistance(radius: number, aspect: number, fovDeg: number): number {
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const halfV = (fovDeg * Math.PI) / 360; // vertical half-FOV, radians
  const tanHalfV = Math.tan(halfV);
  // The height fraction implied by hitting TARGET_WIDTH_FRACTION exactly
  // (fracHeight = fracWidth * aspect — see the derivation above), clamped to
  // the hard cap. On a wide viewport (aspect > MAX/TARGET) this clamp is what
  // backs the fit off from the width target to protect the height margin.
  const fracHeight = Math.min(TARGET_WIDTH_FRACTION * safeAspect, MAX_FILL_FRACTION);
  return radius / (fracHeight * tanHalfV);
}

// ═══════════════════════════════════════════════════════════════════════
// INSET-AWARE FRAMING — round-2 review, item 1: "the viewer must calculate
// fit using the actual unobscured viewport, excluding header, export
// toolbar, issue banner, visible bottom sheet, viewer controls." The
// functions above fit a model to the FULL canvas rectangle; everything below
// re-targets that same fit to a smaller rectangle inset from the canvas's
// edges by floating chrome (the HUD's right-hand strip, the export dock's
// bottom card, a small top margin for the stale-preview banner/dimension
// panel) — the model is centred in THAT rect, at TARGET_WIDTH_FRACTION/
// MAX_FILL_FRACTION of ITS size, not the raw canvas's.
//
// Two independent moves accomplish this, both applied through
// PerspectiveCamera.setViewOffset() (Viewer.tsx's applyFraming/refit):
//  1. RESCALE — frameDistance() above already turns a radius + aspect + fov
//     into a distance; feeding it the REDUCED rect's aspect (not the
//     canvas's) makes the model occupy the target fraction of the reduced
//     rect once rendered, at whatever absolute pixel size that implies.
//  2. RECENTRE — setViewOffset can also point that same-size projection at
//     an off-centre window of a larger virtual frame. Choosing
//     fullWidth/fullHeight = the reduced rect's OWN pixel size (not the
//     canvas's) and rendering the actual, larger canvas as the "window"
//     simultaneously (a) reproduces, pixel-for-pixel, what a standalone
//     camera sized to the reduced rect would show — which is exactly the
//     rescale frameDistance() above was calibrated for — and (b) positions
//     that image so the reduced rect's own centre lands on the canvas at
//     (insets.left + reducedWidth/2, insets.top + reducedHeight/2), i.e.
//     dead-centre of the unobscured area, not the canvas.
// insetViewOffset() below returns exactly the 4 args setViewOffset needs
// (width/height stay the caller's own canvas size); frameDistanceWithInsets()
// is frameDistance() fed the same reduced rect's aspect. The two are always
// used together — see Viewer.tsx's applyFraming().
//
// Derivation (for the curious/next editor): expanding
// PerspectiveCamera.updateProjectionMatrix()'s view-offset branch (three.js's
// own formula: left += offsetX*width/fullWidth; top -= offsetY*height/
// fullHeight; width *= view.width/fullWidth; height *= view.height/
// fullHeight) with fullWidth=reducedWidth, fullHeight=reducedHeight,
// offsetX=-insets.left, offsetY=-insets.top, view.width=canvasWidth,
// view.height=canvasHeight shows the final projected aspect always collapses
// back to canvasWidth/canvasHeight (so circles stay circles — no anisotropic
// stretch despite asymmetric insets), and the screen-space pixel where a
// point at the orbit target (camera-space x=y=0, always true here — the
// controls target is the model's own centre) lands is exactly
// (insets.left + reducedWidth/2, insets.top + reducedHeight/2): the reduced
// rect's centre. framing.test.mjs's insets suite checks the resulting
// occupancy directly rather than re-deriving this algebra.

/** Pixel margins to exclude from the fit on each edge — floating chrome that
 *  sits on top of the canvas (HUD strip, export dock, banners) but isn't
 *  itself part of the canvas's own box (which already shrinks to clear the
 *  mobile bottom sheet — see Viewer.tsx's mount sizing). All non-negative;
 *  {0,0,0,0} (ZERO_INSETS) recovers the original whole-canvas fit exactly. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const ZERO_INSETS: Readonly<Insets> = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

// However large the insets get (e.g. a very short mobile viewport with both
// the export dock and a tall banner reserved), never let the reduced rect
// collapse toward zero — that would blow frameDistance()'s aspect ratio up
// toward 0/Infinity and make the "fit" undefined. Floors each axis at a
// quarter of the raw canvas, so the fit degrades to "smaller than ideal but
// still a sane, finite frame" instead of NaN/Infinity in a pathological inset
// set — this is a last-resort safety net, not a target any real layout in
// this app should ever actually hit.
const MIN_REDUCED_FRACTION = 0.25;

/** The unobscured sub-rectangle's own pixel size: `width`/`height` (the
 *  canvas) minus `insets` on each edge, floored per MIN_REDUCED_FRACTION. */
export function reducedViewport(
  width: number,
  height: number,
  insets: Insets
): { width: number; height: number } {
  const safeW = width > 0 && Number.isFinite(width) ? width : 1;
  const safeH = height > 0 && Number.isFinite(height) ? height : 1;
  return {
    width: Math.max(safeW - insets.left - insets.right, safeW * MIN_REDUCED_FRACTION, 1),
    height: Math.max(safeH - insets.top - insets.bottom, safeH * MIN_REDUCED_FRACTION, 1),
  };
}

/** frameDistance(), but calibrated against the INSET-reduced rect's aspect
 *  ratio rather than the raw canvas's — the distance a caller should combine
 *  with insetViewOffset() (same width/height/insets) to fit+centre a model
 *  of the given bounding-sphere `radius` into the unobscured area. */
export function frameDistanceWithInsets(
  radius: number,
  width: number,
  height: number,
  insets: Insets,
  fovDeg: number
): number {
  const { width: rw, height: rh } = reducedViewport(width, height, insets);
  return frameDistance(radius, rw / rh, fovDeg);
}

/** The 4 args (besides the caller's own canvas `width`/`height`, passed
 *  through unchanged as setViewOffset's own trailing width/height) for
 *  `camera.setViewOffset(fullWidth, fullHeight, offsetX, offsetY, width,
 *  height)` that recentres the projection on the insets-reduced rect — see
 *  this section's derivation comment above. */
export interface ViewOffset {
  fullWidth: number;
  fullHeight: number;
  offsetX: number;
  offsetY: number;
}

export function insetViewOffset(width: number, height: number, insets: Insets): ViewOffset {
  const { width: fullWidth, height: fullHeight } = reducedViewport(width, height, insets);
  return { fullWidth, fullHeight, offsetX: -insets.left, offsetY: -insets.top };
}

// ═══════════════════════════════════════════════════════════════════════
// PROJECTED-BOUNDING-BOX FIT — visual-alignment round-3, item 1: frameDistance()
// above fits the model's bounding SPHERE, which is the right conservative
// choice for a roughly-cubic/round model but drastically over-estimates the
// on-screen footprint of a flat, wide part (a common shape for this kind of
// design — a thin flat plate with text/relief on its face). A 160×80×5mm
// example plate's bounding sphere has radius ~89mm (half its diagonal), but
// from the default 3/4-elevated "product" angle its actual silhouette is
// much smaller than a sphere that size would project — so fitting to the
// sphere leaves the plate reading at
// ~30-40% of the pane instead of the intended ~60%.
//
// The fix: project the model's actual axis-aligned bounding-box CORNERS (not
// a circumscribing sphere) onto the camera's image plane at the candidate
// distance, and solve for the distance that makes the corners' own screen
// footprint hit the same TARGET_WIDTH_FRACTION / MAX_FILL_FRACTION targets
// frameDistance() uses. Unlike a sphere (isotropic — its silhouette is always
// a circle, so width and height occupancy are coupled by one formula), a
// box's projected width and height occupancy are NOT simply proportional to
// each other: the near corners (closer to the camera along the view
// direction) foreshorten less than the far corners, and which corners are
// "near" depends on the view direction itself. So each axis is solved
// independently (by bisection — the projected footprint shrinks strictly
// monotonically as distance grows, for any fixed direction) and the two
// candidate distances are combined the same way the sphere fit's closed-form
// solution effectively does: take the LARGER of "hit the width target" and
// "hit the height cap", so whichever axis would otherwise overflow its own
// bound is the one that actually determines the final framing, with the
// other axis landing under its own target (same "binds on height on a wide
// pane, binds on width on a narrow one" behaviour as frameDistance()).
//
// The camera basis (right/up axes for a given look direction) is derived
// with THREE.Matrix4.lookAt() — the exact function three.js's own
// Object3D.lookAt()/OrbitControls rely on, including its degenerate-input
// handling (direction parallel to world-up, e.g. a near-top/bottom view) —
// rather than hand-rolling a cross-product that would silently diverge from
// runtime behaviour on that edge case.

/** OpenSCAD's world convention: +Z is up. Camera.up is set to this once at
 *  mount (Viewer.tsx) and never changes, so every view direction's basis is
 *  derived against it here too. */
const WORLD_UP = new THREE.Vector3(0, 0, 1);
const ORIGIN = new THREE.Vector3(0, 0, 0);

/** A model's axis-aligned bounding-box HALF-size (mm) — half of
 *  `box.getSize()` on each axis. The fit below assumes the box is centred at
 *  the orbit target, mirroring frameDistance()'s own sphere-radius
 *  assumption (both are approximations once the user has panned the target
 *  away from the model's actual centre — an existing, accepted simplification,
 *  not something this change alters). */
export interface BoxHalfExtents {
  x: number;
  y: number;
  z: number;
}

const _corner = new THREE.Vector3();

// The projected occupancy (fraction of the FULL viewport axis, i.e. 0..~1+)
// of a set of pre-projected per-corner (q, s) pairs at candidate `distance`:
// q is the corner's camera-space offset along the screen axis (independent
// of distance — see the derivation below), s is its offset along the view
// direction (so `distance - s` is that corner's actual depth from the
// camera). `tanHalf` is the half-FOV tangent for that axis (horizontal or
// vertical).
//
// Derivation: for a camera at `target + direction * distance` looking at
// `target` with the basis (right, up, direction) computed by lookAt() below,
// a world point P projects (in camera space) to x_cam = dot(P - target,
// right) and y_cam = dot(P - target, up) — BOTH INDEPENDENT of `distance`,
// because `right`/`up` are, by construction, orthogonal to `direction`, and
// only the `direction`-aligned component of the camera's own offset from the
// target survives the dot product. Only the depth, z_cam = distance -
// dot(P - target, direction), depends on `distance`. NDC_x = x_cam / (z_cam *
// tanHalfH) (and the analogous NDC_y), ranging -1..1 across the full
// viewport axis; a corner's occupancy contribution is its NDC value, and the
// box's occupancy on that axis is (max NDC - min NDC) / 2 across all 8
// corners.
function boxAxisOccupancy(qs: number[], ss: number[], tanHalf: number, distance: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < qs.length; i++) {
    const depth = distance - ss[i];
    const ndc = qs[i] / (depth * tanHalf);
    if (ndc < lo) lo = ndc;
    if (ndc > hi) hi = ndc;
  }
  return (hi - lo) / 2;
}

// Solve (by bisection) for the distance at which boxAxisOccupancy() hits
// `target` exactly. Occupancy is strictly monotonically decreasing in
// distance once distance exceeds every corner's own `s` (so every corner has
// positive depth) — it diverges to +Infinity as distance approaches that
// bound from above and falls to 0 as distance -> Infinity — so a target in
// (0, Infinity) always has a unique root in that domain. Returns 0 (a
// sentinel meaning "this axis places no requirement on distance") if the
// corners have ~zero spread on this screen axis (an edge-on/degenerate
// view), since no finite distance would make a ~zero-width silhouette hit a
// positive target.
function solveAxisDistance(qs: number[], ss: number[], tanHalf: number, target: number): number {
  const spread = Math.max(...qs) - Math.min(...qs);
  if (spread < 1e-9) return 0;
  const sMax = Math.max(...ss);
  const lo0 = sMax + 1e-6;
  // Grow the upper bound until occupancy drops at or below target (starting
  // from a step scaled to the lower bound itself so this converges in a
  // bounded handful of doublings regardless of the box/camera's absolute
  // scale).
  let step = Math.max(Math.abs(lo0), 1);
  let hi = lo0 + step;
  for (let guard = 0; guard < 200 && boxAxisOccupancy(qs, ss, tanHalf, hi) > target; guard++) {
    step *= 2;
    hi = lo0 + step;
  }
  let lo = lo0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (boxAxisOccupancy(qs, ss, tanHalf, mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Camera distance from an axis-aligned bounding box of half-size `half`
 * (assumed centred at the orbit target) so its PROJECTED footprint —
 * accounting for real perspective foreshortening across all 8 corners, not
 * the conservative bounding-sphere circle frameDistance() uses — respects
 * the same fill-fraction targets, looking from `direction` (unit vector,
 * target -> camera; renormalised defensively) with a perspective camera of
 * vertical FOV `fovDeg` at viewport `aspect` = width / height.
 */
/** A fit's target/cap fill fractions as ONE value — the shape
 *  `frameDistanceForBox`/`frameDistanceForBoxWithInsets`/Viewer's own
 *  `fitFraction` prop all share, end to end, instead of two positional
 *  numbers unpacked/re-packed at each hop (round-5 review, quality item 3).
 *  `width` mirrors `TARGET_WIDTH_FRACTION`'s role, `height` mirrors
 *  `MAX_FILL_FRACTION`'s. */
export interface FitFraction {
  width: number;
  height: number;
}

/** The module-default fit, as the same `FitFraction` shape — every existing
 *  caller (including every "tabs"-workflow one) that omits the override
 *  parameter keeps this exact framing. */
export const DEFAULT_FIT_FRACTION: Readonly<FitFraction> = Object.freeze({
  width: TARGET_WIDTH_FRACTION,
  height: MAX_FILL_FRACTION,
});

export function frameDistanceForBox(
  half: BoxHalfExtents,
  direction: THREE.Vector3,
  aspect: number,
  fovDeg: number,
  // Round-5 Wave 2 (item 7): optional per-call override for the fill-fraction
  // targets, defaulting to the module constants every prior caller implicitly
  // used — so every existing call site (including every "tabs"-workflow one)
  // keeps its exact framing. AppShell's guided workflow is the one caller
  // that actually overrides this, tuning the guided Review stage down to a
  // slightly smaller on-screen fraction than Content/Appearance — see
  // AppShell's own `fitFraction`/`GUIDED_REVIEW_FIT` doc.
  fitFraction: FitFraction = DEFAULT_FIT_FRACTION
): number {
  const { width: targetWidthFraction, height: maxFillFraction } = fitFraction;
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const halfV = (fovDeg * Math.PI) / 360;
  const tanHalfV = Math.tan(halfV);
  const tanHalfH = safeAspect * tanHalfV;

  let dir = direction.clone();
  if (!Number.isFinite(dir.lengthSq()) || dir.lengthSq() < 1e-12) dir = new THREE.Vector3(0, -1, 0.5);
  dir.normalize();

  // Same basis three.js's own Object3D.lookAt()/OrbitControls use (including
  // its degenerate-input nudge for a direction parallel to WORLD_UP) — see
  // this section's header comment.
  const basis = new THREE.Matrix4().lookAt(dir, ORIGIN, WORLD_UP);
  const right = new THREE.Vector3().setFromMatrixColumn(basis, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(basis, 1);

  const qx: number[] = [];
  const qy: number[] = [];
  const s: number[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        _corner.set(sx * half.x, sy * half.y, sz * half.z);
        qx.push(_corner.dot(right));
        qy.push(_corner.dot(up));
        s.push(_corner.dot(dir));
      }
    }
  }

  const dWidth = solveAxisDistance(qx, s, tanHalfH, targetWidthFraction);
  const dHeight = solveAxisDistance(qy, s, tanHalfV, maxFillFraction);
  // The larger candidate is the one whose target actually binds (mirrors
  // frameDistance()'s own "back off once the width target would overflow the
  // height cap" behaviour); a tiny positive floor guards the pathological
  // case where the box has ~zero extent on both screen axes (both solves
  // returned the "no requirement" 0 sentinel).
  return Math.max(dWidth, dHeight, 1e-3);
}

/** frameDistanceForBox(), but calibrated against the INSET-reduced rect's
 *  aspect ratio — the box-fit analogue of frameDistanceWithInsets(). */
export function frameDistanceForBoxWithInsets(
  half: BoxHalfExtents,
  direction: THREE.Vector3,
  width: number,
  height: number,
  insets: Insets,
  fovDeg: number,
  fitFraction?: FitFraction
): number {
  const { width: rw, height: rh } = reducedViewport(width, height, insets);
  return frameDistanceForBox(half, direction, rw / rh, fovDeg, fitFraction);
}

// ── Guided-workflow per-stage fit targets (round-5 Wave 2, item 7; revised
// round-6, item 1) ─────────────────────────────────────────────────────────
// The spec's ~60-70% (Content/Appearance) and ~55-65% (Review) target BANDS
// for how much of the unobscured viewer the model should fill. Content/
// Appearance uses the plain module defaults above (TARGET_WIDTH_FRACTION
// 0.66 / MAX_FILL_FRACTION 0.68 — already comfortably inside 60-70%, and
// shared with "tabs" workflow, which has no per-stage notion to begin with).
//
// Round-5 picked a noticeably SMALLER pair for Review ({0.58, 0.62}) to
// "back off a touch" from the export dock/sheet edge. That reasoning held
// fine on desktop (Review's viewer area there is basically the same shape as
// Content/Appearance's — no sheet, no detent), but on mobile it silently
// combined with a SEPARATE bug (computeViewerInsets' flat, Content-sized top
// reserve applied unchanged at Review's much shorter "review" detent — see
// TOP_INSET_REVIEW_MOBILE_PX's own doc below): the reduced rect at that
// detent had already collapsed toward a short, extremely wide sliver
// (measured ~5:1+ on a typical phone), so `frameDistanceForBox`'s HEIGHT
// axis bound hard regardless of either target, and the model rendered at
// roughly a QUARTER of Content/Appearance's own width fraction — "shrinks
// dramatically", not "backs off a touch".
//
// With the insets fix bringing that aspect back down to a sane ~2:1, the
// height target here does double duty: on mobile Review, where that aspect
// is still meaningfully wider than Content/Appearance's own portrait-ish
// pane, a HIGH cap (0.95) is what actually lets the model reach a
// comparable WIDTH fraction — a short, wide rect can (and should) let a flat
// wide model fill much more of its own short axis than a tall pane ever
// needs to, precisely because that axis is scarce there. On desktop, where
// Review's viewer area keeps a normal (non-degenerate, roughly Content-like)
// aspect, this same high cap is inert: the model's own footprint reaches
// this fit's WIDTH target (0.68 — a touch above Content/Appearance's 0.66,
// not below it) long before it would ever need 95% of the height, so WIDTH
// keeps binding there exactly as it does at Content/Appearance, just
// slightly larger — see framing.test.mjs's own coverage and this pass's
// Playwright measurements (Content vs. Review width fraction, both
// viewports) for the empirical check, not just this derivation.
export const GUIDED_REVIEW_FIT: FitFraction = { width: 0.68, height: 0.95 };

// ── Layout-facing inset geometry ──────────────────────────────────────────
// Turns the app shell's own live layout facts (measured dock height, whether
// the HUD is showing, mobile vs. desktop) into the Insets above. Kept as pure
// numeric/boolean input -> Insets output (no DOM reads) so it's unit-testable
// the same way as the projection math; AppShell.tsx supplies the live
// numbers (dockRef's ResizeObserver, useIsMobile, useSafeAreaBottom).
export interface ViewerInsetInputs {
  /** Below the 860px breakpoint (src/lib/useIsMobile.ts) — the export dock's
   *  own bottom offset (and so how much of its height plus the offset must
   *  be excluded) differs by layout; see AppShell's `.action-dock` CSS doc. */
  isMobile: boolean;
  /** Whether ViewerHUD is actually rendered (AppShell's `hudProps.visible` —
   *  false before any successful render exists). No HUD, no right inset. */
  hudVisible: boolean;
  /** The export dock's own live-measured height (px) — AppShell's dockRef
   *  ResizeObserver, the same measurement already backing --action-dock-h.
   *  0 before the dock has ever mounted/measured (no bottom inset yet). */
  dockHeightPx: number;
  /** iOS home-indicator inset (useSafeAreaBottom) — folded into the bottom
   *  inset on desktop, where the dock's own CSS `bottom` adds it explicitly;
   *  skipped on mobile, where it's already baked into the sheet's own
   *  `--sheet-top` (and so into the canvas's own box) — see the mobile
   *  branch below. */
  safeAreaBottomPx: number;
  /** Round-6, item 1: true while guided workflow's mobile Review stage is
   *  active (AppShell's `isGuidedReview`, mobile only — desktop never passes
   *  this). The canvas's own box (mount.clientWidth/clientHeight in
   *  Viewer.tsx) ALREADY tracks the real unobscured area above the sheet —
   *  `.app-shell__mobile-viewer`'s `bottom: var(--sheet-top)` shrinks it live
   *  as the sheet's detent changes (index.css) — so at Review's own taller
   *  "review" detent (sheetDetent.ts's REVIEW_VH_RATIO, ~70vh) that box is
   *  already quite short: on a typical 390x844 phone, roughly 180-240px tall
   *  before any inset is even subtracted. TOP_INSET_MOBILE_PX's flat 80px
   *  reserve — sized for Content/Appearance's much taller box, as a
   *  conservative allowance for the stale-preview banner/dimension panel
   *  that might float over the canvas's top edge — eats a disproportionate
   *  share of that short box once combined with the dock's own bottom
   *  inset: the reduced rect's height could collapse to a sliver only a few
   *  percent of the canvas's own height, driving its aspect ratio to
   *  extreme (5:1+) values. `frameDistanceForBox`'s per-axis solve (this
   *  file's own "PROJECTED-BOUNDING-BOX FIT" section) then has the HEIGHT
   *  axis bind severely against that near-degenerate rect, backing the
   *  camera off far past what the WIDTH target alone would ever ask for —
   *  which is what actually produced the "shrinks dramatically" bug this
   *  flag fixes, not the GUIDED_REVIEW_FIT targets themselves (see that
   *  constant's own doc). `reviewStage` swaps in
   *  TOP_INSET_REVIEW_MOBILE_PX — a small breathing-room reserve, not a
   *  banner-sized one — instead. Ignored on desktop (no equivalent detent
   *  there) and safe to pass `false`/omit everywhere else — every other
   *  mount keeps `TOP_INSET_MOBILE_PX`, unchanged. */
  reviewStage?: boolean;
}

// Gap between the canvas's own unobscured edge and the chrome it clears —
// mirrors the CSS gap the dock/HUD already use above the sheet/viewer edge
// (0.75rem desktop, 0.6rem mobile — see .action-dock's own doc in index.css)
// at a 16px root font size (this app never overrides html { font-size }).
const DOCK_GAP_DESKTOP_PX = 16;
const DOCK_GAP_MOBILE_PX = 10;
// The HUD's own icon-button column: size-10 (40px) buttons plus their right
// offset (0.75rem) and a little breathing room past the glass edge — mobile
// drops to size-9 (item 2 of this pass), so its strip is a little narrower.
const HUD_STRIP_DESKTOP_PX = 64;
const HUD_STRIP_MOBILE_PX = 56;
// A small top margin so the model doesn't crowd the stale/updating banner
// (top-centre) or the dimension-info panel (top-left) when either is
// showing — both float at a modest fixed offset from the canvas's own top
// edge (index.css's `.stale-banner`/`.dimension-info`), so a flat reserve
// (not a live measurement) keeps this simple and avoids the model visibly
// resizing every time a banner blips in and out. Mobile adds its floating
// top bar's own height.
const TOP_INSET_DESKTOP_PX = 48;
const TOP_INSET_MOBILE_PX = 80;
// Round-6, item 1: guided workflow's mobile Review stage's own, much smaller
// top reserve — see `reviewStage`'s own doc above for why TOP_INSET_MOBILE_PX
// is disproportionate there. Not zero: still a little breathing room above
// the model (a stale-preview banner CAN still float over Review — e.g. a
// background re-render still catching up right as the visitor jumps to
// Review — and this at least keeps the model clear of the canvas's bare top
// edge), just no longer sized as if the box were Content/Appearance's own
// much taller one.
const TOP_INSET_REVIEW_MOBILE_PX = 16;

export function computeViewerInsets({
  isMobile,
  hudVisible,
  dockHeightPx,
  safeAreaBottomPx,
  reviewStage = false,
}: ViewerInsetInputs): Insets {
  const gap = isMobile ? DOCK_GAP_MOBILE_PX : DOCK_GAP_DESKTOP_PX;
  // dockHeightPx <= 0 means the dock hasn't measured yet (or isn't mounted) —
  // no bottom inset rather than a bare gap floating with nothing to clear.
  const dockSpan = dockHeightPx > 0 ? dockHeightPx + gap : 0;
  const bottom = dockSpan === 0 ? 0 : dockSpan + (isMobile ? 0 : safeAreaBottomPx);
  const right = hudVisible ? (isMobile ? HUD_STRIP_MOBILE_PX : HUD_STRIP_DESKTOP_PX) : 0;
  const top = isMobile
    ? (reviewStage ? TOP_INSET_REVIEW_MOBILE_PX : TOP_INSET_MOBILE_PX)
    : TOP_INSET_DESKTOP_PX;
  return { top, right, bottom, left: 0 };
}
