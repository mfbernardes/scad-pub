// framing.ts — pure math behind the viewer's box-aware camera fit: it fits the
// model's axis-aligned bounding BOX, not a bounding sphere, whose radius a flat
// plate's diagonal dominates. docs/viewer.md derives the closed-form distance
// bound, the aspect correction and the chrome-inset rules; this file is the
// arithmetic. Pure numbers, no WebGL context — see tests/framing.test.mjs.
import * as THREE from "three";

/** Target fraction of the viewport's width/height a box's screen footprint
 *  should occupy. Independent per axis because a box's projected footprint
 *  (unlike a sphere's circular silhouette) doesn't keep width/height in a
 *  fixed ratio: the fit binds on whichever axis is tighter for a given
 *  view/aspect. */
export interface FitFraction {
  width: number;
  height: number;
}

/** The default "product shot" target: generously framed without crowding the
 *  edges, verified against a flat plate, a tall thin model, and a cube from
 *  every standard view (see framing.test.mjs). */
export const DEFAULT_FIT_FRACTION: Readonly<FitFraction> = Object.freeze({
  width: 0.66,
  height: 0.58,
});

// Aspects inside this band are left EXACTLY alone: it covers every ordinary
// desktop pane and the mobile half detent, so the correction below only ever
// rescues the two extremes (portrait phone, Full-detent strip).
const NEUTRAL_ASPECT_MIN = 0.8;
const NEUTRAL_ASPECT_MAX = 1.6;
/** Caps for the corrected axis. Below 1.0 by a real margin so a corrected fit
 *  still leaves visible margin around the model on that axis. */
const MAX_WIDTH_FIT = 0.82;
const MAX_HEIGHT_FIT = 0.8;

/**
 * `fit`, adjusted for a canvas whose aspect ratio makes one axis unable to
 * bind (docs/viewer.md). Portrait (`aspect < 0.8`) widens the width target;
 * wide landscape (`aspect > 1.6`) raises the height target; anything between
 * is returned unchanged (the same object, so callers can detect the no-op).
 *
 * Applied BEFORE `insetFitFraction`: the chrome insets then shrink whatever
 * this produced, so a corrected target still yields to the top bar, the dock
 * and the HUD rather than sliding under them.
 */
export function aspectAwareFit(fit: FitFraction, aspect: number): FitFraction {
  if (!Number.isFinite(aspect) || aspect <= 0) return fit;
  if (aspect < NEUTRAL_ASPECT_MIN) {
    return { width: Math.min(MAX_WIDTH_FIT, fit.width / Math.sqrt(aspect)), height: fit.height };
  }
  if (aspect > NEUTRAL_ASPECT_MAX) {
    return { width: fit.width, height: Math.min(MAX_HEIGHT_FIT, fit.height * Math.sqrt(aspect)) };
  }
  return fit;
}

// OpenSCAD is Z-up; Viewer.tsx sets camera.up to match once at mount and
// never changes it, so every view direction's screen basis is derived
// against this same world-up.
const WORLD_UP = new THREE.Vector3(0, 0, 1);
const ORIGIN = new THREE.Vector3(0, 0, 0);

// A view direction, normalised and defended against a zero/non-finite input
// (which would make every projection below NaN) by falling back to the
// default three-quarter view. The single place that decision is made: every
// consumer takes it via cameraBasis's `dir`.
function safeDirection(direction: THREE.Vector3): THREE.Vector3 {
  const dir = direction.clone();
  if (!Number.isFinite(dir.lengthSq()) || dir.lengthSq() < 1e-12) dir.set(0, -1, 0.5);
  return dir.normalize();
}

/** The camera's screen-space basis for a given (target -> camera) view
 *  `direction`: `right`/`up` span the image plane, perpendicular to
 *  `direction`, alongside the normalised `dir` itself so a caller that also
 *  needs the view axis doesn't repeat the guard. Uses THREE.Matrix4.lookAt()
 *  — the same function three.js's own Object3D.lookAt()/OrbitControls rely
 *  on, including its degenerate-input handling for a direction parallel to
 *  WORLD_UP (a near-top/bottom view) — rather than a hand-rolled
 *  cross-product that could silently diverge from that runtime behaviour. */
export function cameraBasis(direction: THREE.Vector3): {
  dir: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
} {
  const dir = safeDirection(direction);
  const basis = new THREE.Matrix4().lookAt(dir, ORIGIN, WORLD_UP);
  return {
    dir,
    right: new THREE.Vector3().setFromMatrixColumn(basis, 0),
    up: new THREE.Vector3().setFromMatrixColumn(basis, 1),
  };
}

/** Axis-aligned bounding box, in the same world space as `target`. */
export interface Box3Like {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

const _corner = new THREE.Vector3();
const _rel = new THREE.Vector3();

/** How far past "just fits" a model must grow, as a fraction of the current
 *  framing's distance, before Viewer.tsx's outgrew-the-frame refit (its
 *  geometry-swap effect) reacts. A margin rather than a hard clip line, so an
 *  ordinary render-to-render change doesn't retrigger a refit the visitor
 *  would read as the camera jumping around underneath them. */
export const OUTGROW_REFIT_RATIO = 0.15;

/**
 * Whether a model needing `requiredDistance` to fit the current frame (i.e.
 * `frameDistanceForBox` run against the box's NEW size, from the camera's
 * current position/direction) has outgrown a camera actually sitting at
 * `currentDistance` — split out from that geometry math so the margin is
 * unit-testable on its own. See `OUTGROW_REFIT_RATIO` for the default.
 */
export function outgrowsFrame(
  requiredDistance: number,
  currentDistance: number,
  ratio: number = OUTGROW_REFIT_RATIO
): boolean {
  return (
    Number.isFinite(requiredDistance) &&
    Number.isFinite(currentDistance) &&
    currentDistance > 0 &&
    requiredDistance > currentDistance * (1 + ratio)
  );
}

/**
 * Camera distance from `target`, looking from `direction` (a unit-ish
 * vector, defensively renormalised), so a perspective camera of vertical
 * field of view `fovDeg` at viewport `aspect` (width / height) fits every
 * corner of `box` within `fit`'s fractions of the frame, see the file
 * header for the derivation. Not a sphere-radius approximation: an
 * off-centre or asymmetric box (e.g. `target` at its base, not its centre,
 * see Viewer.tsx's `restOnGrid` mode) is handled correctly because every
 * corner is projected individually.
 */
export function frameDistanceForBox(
  box: Box3Like,
  target: THREE.Vector3,
  direction: THREE.Vector3,
  aspect: number,
  fovDeg: number,
  fit: FitFraction = DEFAULT_FIT_FRACTION
): number {
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const halfV = (fovDeg * Math.PI) / 360;
  const tanHalfV = Math.tan(halfV);
  const tanHalfH = safeAspect * tanHalfV;

  const { dir, right, up } = cameraBasis(direction);

  let maxDistance = 1e-3; // floor: never return a non-positive/degenerate distance
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        _corner.set(x, y, z);
        _rel.subVectors(_corner, target);
        const s = _rel.dot(dir);
        const qx = _rel.dot(right);
        const qy = _rel.dot(up);
        maxDistance = Math.max(
          maxDistance,
          s + Math.abs(qx) / (tanHalfH * fit.width),
          s + Math.abs(qy) / (tanHalfV * fit.height)
        );
      }
    }
  }
  return maxDistance;
}

// The viewer's floating chrome overlays the canvas rather than shrinking it, so
// a model fitted to the full canvas sits partly behind it; `insetFitFraction`
// and `insetTargetOffset` below are the two halves of the correction
// Viewer.tsx's frameView applies. See docs/viewer.md.

/** Pixels of the canvas covered by chrome on each edge. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Readonly<Insets> = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** The viewport-coordinate edges of a DOM rect: the subset of
 *  `getBoundingClientRect()` this module needs, so the math stays testable
 *  without a DOM. */
export interface RectLike {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** How much of each axis must stay clear of chrome. A floor for pathological
 *  cases: a short landscape viewport can stack the top bar, the dock and the
 *  HUD over barely 190px of canvas, and honouring every inset there would
 *  shrink the model to a dot. Better to let some chrome overlap than to make
 *  the model unreadable. */
export const MIN_USABLE_FRACTION = 0.55;

/**
 * The inset a single overlay implies: it eats into the edge it intrudes
 * from *least*, by that intrusion's depth. Overlays that don't overlap the
 * canvas contribute nothing. Right for an edge band, worst for a CORNER box —
 * which is why neither of the viewer's two corner overlays goes through here
 * (docs/viewer.md; Viewer.tsx's CHROME_OVERLAYS).
 */
export function edgeInset(overlay: RectLike, canvas: RectLike): Insets {
  const width = canvas.right - canvas.left;
  const height = canvas.bottom - canvas.top;
  if (width <= 0 || height <= 0) return { ...NO_INSETS };
  // No overlap at all: nothing to clear.
  if (overlay.right <= canvas.left || overlay.left >= canvas.right) return { ...NO_INSETS };
  if (overlay.bottom <= canvas.top || overlay.top >= canvas.bottom) return { ...NO_INSETS };

  const clampW = (v: number) => Math.min(Math.max(v, 0), width);
  const clampH = (v: number) => Math.min(Math.max(v, 0), height);
  const fromTop = clampH(overlay.bottom - canvas.top);
  const fromBottom = clampH(canvas.bottom - overlay.top);
  const fromLeft = clampW(overlay.right - canvas.left);
  const fromRight = clampW(canvas.right - overlay.left);

  const nearest = Math.min(fromTop, fromBottom, fromLeft, fromRight);
  if (nearest === fromTop) return { ...NO_INSETS, top: fromTop };
  if (nearest === fromBottom) return { ...NO_INSETS, bottom: fromBottom };
  if (nearest === fromLeft) return { ...NO_INSETS, left: fromLeft };
  return { ...NO_INSETS, right: fromRight };
}

/**
 * The inset an overlay implies when the caller already knows which edge it
 * should be charged to: its depth from that edge, clamped to the canvas, with
 * the other three edges left clear.
 *
 * A corner overlay's right answer depends on what ELSE is on screen, which this
 * module cannot see, so the choice stays with the caller and only the
 * arithmetic lives here, tested. See docs/viewer.md.
 */
export function singleEdgeInset(
  overlay: RectLike,
  canvas: RectLike,
  edge: keyof Insets
): Insets {
  const width = canvas.right - canvas.left;
  const height = canvas.bottom - canvas.top;
  if (width <= 0 || height <= 0) return { ...NO_INSETS };
  // No overlap at all: nothing to clear. Same two guards as edgeInset.
  if (overlay.right <= canvas.left || overlay.left >= canvas.right) return { ...NO_INSETS };
  if (overlay.bottom <= canvas.top || overlay.top >= canvas.bottom) return { ...NO_INSETS };

  const clamp = (v: number, size: number) => Math.min(Math.max(v, 0), size);
  switch (edge) {
    case "top": return { ...NO_INSETS, top: clamp(overlay.bottom - canvas.top, height) };
    case "bottom": return { ...NO_INSETS, bottom: clamp(canvas.bottom - overlay.top, height) };
    case "left": return { ...NO_INSETS, left: clamp(overlay.right - canvas.left, width) };
    case "right": return { ...NO_INSETS, right: clamp(canvas.right - overlay.left, width) };
  }
}

/** Combine several overlays' insets by taking the deepest on each edge:
 *  two overlays on the same edge don't stack, the further-reaching one wins. */
export function mergeInsets(insets: Insets[]): Insets {
  return insets.reduce<Insets>(
    (acc, i) => ({
      top: Math.max(acc.top, i.top),
      right: Math.max(acc.right, i.right),
      bottom: Math.max(acc.bottom, i.bottom),
      left: Math.max(acc.left, i.left),
    }),
    { ...NO_INSETS }
  );
}

/** Scale insets down, per axis and proportionally (so the two edges keep
 *  their relative weight and the centring stays honest), until each axis
 *  keeps at least `minUsable` of the canvas clear. */
export function clampInsets(
  insets: Insets,
  canvasWidthPx: number,
  canvasHeightPx: number,
  minUsable: number = MIN_USABLE_FRACTION
): Insets {
  const scaleAxis = (a: number, b: number, size: number): [number, number] => {
    const budget = size * (1 - minUsable);
    const total = a + b;
    if (size <= 0 || total <= budget || total <= 0) return [a, b];
    const k = budget / total;
    return [a * k, b * k];
  };
  const [left, right] = scaleAxis(insets.left, insets.right, canvasWidthPx);
  const [top, bottom] = scaleAxis(insets.top, insets.bottom, canvasHeightPx);
  return { top, right, bottom, left };
}

/** Reduce the fill fractions so a box fit against them targets the usable
 *  region left by `insets`: e.g. a 100px bottom inset on an 800px-tall
 *  canvas asks for 0.58 of the *700px* usable strip, expressed as a
 *  (smaller) fraction of the full 800px canvas. Floors each axis at 20% of
 *  its original target so a pathologically large inset degrades to "smaller
 *  than ideal" rather than collapsing to ~0. */
export function insetFitFraction(
  fit: FitFraction,
  canvasWidthPx: number,
  canvasHeightPx: number,
  insets: Insets
): FitFraction {
  const usable = (size: number, a: number, b: number) =>
    size <= 0 ? 1 : Math.max(0, 1 - (a + b) / size);
  return {
    width: Math.max(fit.width * usable(canvasWidthPx, insets.left, insets.right), fit.width * 0.2),
    height: Math.max(fit.height * usable(canvasHeightPx, insets.top, insets.bottom), fit.height * 0.2),
  };
}

/**
 * How far to move the orbit target, in the camera's own screen basis, so a
 * model already fitted to `distance` renders centred in the region `insets`
 * leaves clear instead of in the middle of the whole canvas.
 *
 * The returned scalars are applied directly —
 * `target.addScaledVector(right, off.right).addScaledVector(up, off.up)` —
 * with no negation at the call site: the sign flip is folded in here, so a
 * bottom inset yields a NEGATIVE `up`. See docs/viewer.md.
 */
export function insetTargetOffset(
  distance: number,
  fovDeg: number,
  canvasHeightPx: number,
  insets: Insets
): { right: number; up: number } {
  if (canvasHeightPx <= 0 || !(distance > 0)) return { right: 0, up: 0 };
  const tanHalfV = Math.tan((fovDeg * Math.PI) / 360);
  const worldPerPixel = (2 * distance * tanHalfV) / canvasHeightPx;
  return {
    right: ((insets.right - insets.left) / 2) * worldPerPixel,
    up: ((insets.top - insets.bottom) / 2) * worldPerPixel,
  };
}
