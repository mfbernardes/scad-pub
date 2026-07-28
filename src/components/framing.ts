// framing.ts — pure math behind the viewer's box-aware camera fit. Replaces
// the old bounding-SPHERE framing (`radius * factor`, direction-only, no
// aspect awareness): a sphere's radius is dominated by a flat/wide plate's
// diagonal, so fitting to it left a typical flat plate reading at only
// ~30-40% of the pane instead of a proper "product shot" framing. This fits
// the model's actual axis-aligned bounding BOX instead.
//
// The camera looks at `target` from `target + direction * distance`. A world
// point's offset from `target`, projected onto the camera's own screen basis
// (`right`/`up`, perpendicular to `direction`), gives a depth-independent
// screen-axis offset `q` and a depth-along-view-axis offset `s`; its actual
// depth from the camera is `distance - s`. Requiring that point's projected
// size stay within `fill` of the frame on that axis —
//   |q| / ((distance - s) * tanHalf) <= fill
// — rearranges to a direct, closed-form bound (no search/bisection needed):
//   distance >= s + |q| / (tanHalf * fill)
// Evaluating this for both screen axes at all 8 box corners and taking the
// max gives the smallest distance at which EVERY corner is within `fill` of
// the frame on both axes simultaneously — exactly the "fits generously,
// doesn't overfill" target.
//
// Pure math only (three.js's Vector3/Matrix4 run on plain numbers, no WebGL
// context needed), so this is unit-testable under node:test — see
// tests/framing.test.mjs.
import * as THREE from "three";

/** Target fraction of the viewport's width/height a box's screen footprint
 *  should occupy. Independent per axis because a box's projected footprint
 *  (unlike a sphere's circular silhouette) doesn't keep width/height in a
 *  fixed ratio — the fit binds on whichever axis is tighter for a given
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

// OpenSCAD is Z-up; Viewer.tsx sets camera.up to match once at mount and
// never changes it, so every view direction's screen basis is derived
// against this same world-up.
const WORLD_UP = new THREE.Vector3(0, 0, 1);
const ORIGIN = new THREE.Vector3(0, 0, 0);

// A view direction, normalised and defended against a zero/non-finite input
// (which would make every projection below NaN) by falling back to the
// default three-quarter view. The single place that decision is made — every
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

/**
 * Camera distance from `target`, looking from `direction` (a unit-ish
 * vector, defensively renormalised), so a perspective camera of vertical
 * field of view `fovDeg` at viewport `aspect` (width / height) fits every
 * corner of `box` within `fit`'s fractions of the frame — see the file
 * header for the derivation. Not a sphere-radius approximation: an
 * off-centre or asymmetric box (e.g. `target` at its base, not its centre —
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

// ── Chrome insets ───────────────────────────────────────────────────────
// The viewer's floating chrome — the export dock, the HUD button column, the
// mobile top bar, the measurements panel — overlays the canvas rather than
// shrinking it (all `position: absolute`, so none of them affect the canvas's
// own flex-computed size — see index.css). A model fitted to the FULL canvas
// therefore sits partly behind them. Two moves fix that together (applied by
// Viewer.tsx's frameView): (1) shrink the fit's targets by each axis's inset
// share, so the box is asked to fit the USABLE region rather than the full
// canvas; (2) shift the orbit target so the box, unchanged in world space,
// renders centred in that usable region.
//
// This was once a single bottom scalar, for the dock alone. It is a rect now
// because the chrome isn't only at the bottom: the HUD is a right-edge
// column tall enough to cover most of a short mobile viewport, and the top
// bar spans the full width above the model.

/** Pixels of the canvas covered by chrome on each edge. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Readonly<Insets> = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** The viewport-coordinate edges of a DOM rect — the subset of
 *  `getBoundingClientRect()` this module needs, so the math stays testable
 *  without a DOM. */
export interface RectLike {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** How much of each axis must stay clear of chrome. A floor for pathological
 *  cases — a short landscape viewport can stack the top bar, the dock and the
 *  HUD over barely 190px of canvas, and honouring every inset there would
 *  shrink the model to a dot. Better to let some chrome overlap than to make
 *  the model unreadable. */
export const MIN_USABLE_FRACTION = 0.55;

/**
 * The inset a single overlay implies: it eats into the edge it intrudes
 * from *least*, by that intrusion's depth. A bottom-centred export dock
 * reaches only ~55px up from the bottom but ~730px down from the top, so it
 * reads as a bottom inset; a right-hand HUD column reads as a right inset;
 * a full-width top bar as a top inset.
 *
 * Overlays that don't overlap the canvas at all contribute nothing. An
 * overlay pinned to a CORNER would be the case this rule handles least well —
 * it is genuinely a corner box, not an edge band, so whichever edge wins
 * over-counts the other axis. Nothing passed here today is one: the viewer's
 * only corner overlay is the measurements panel, which is deliberately left
 * out of the fit entirely (see Viewer.tsx's chromeInsets).
 */
export function edgeInset(overlay: RectLike, canvas: RectLike): Insets {
  const width = canvas.right - canvas.left;
  const height = canvas.bottom - canvas.top;
  if (width <= 0 || height <= 0) return { ...NO_INSETS };
  // No overlap at all — nothing to clear.
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

/** Combine several overlays' insets by taking the deepest on each edge —
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
 *  region left by `insets` — e.g. a 100px bottom inset on an 800px-tall
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
 * Half the difference of the opposing insets, not their sum: with (say) only
 * the BOTTOM edge inset, the usable region's own centre sits `bottom / 2`
 * above the canvas centre.
 *
 * The returned scalars are applied directly —
 * `target.addScaledVector(right, off.right).addScaledVector(up, off.up)` —
 * with no negation at the call site: the sign flip is already folded in
 * here. The camera always keeps `target` at the exact centre of the frame,
 * so making the (stationary) model appear higher on screen means moving the
 * target itself the OTHER way, down and away from the model's true centre.
 * Hence a bottom inset yields a NEGATIVE `up`.
 *
 * One `worldPerPixel` serves both axes because pixels are square: the
 * horizontal world-per-pixel is `2·distance·tanHalfH / width`, and with
 * `tanHalfH = aspect·tanHalfV` and `aspect = width/height` that reduces to
 * the vertical expression.
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
