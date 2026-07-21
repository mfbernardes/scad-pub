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

/** The camera's screen-space basis for a given (target -> camera) view
 *  `direction`: `right`/`up` span the image plane, perpendicular to
 *  `direction`. Uses THREE.Matrix4.lookAt() — the same function three.js's
 *  own Object3D.lookAt()/OrbitControls rely on, including its degenerate-
 *  input handling for a direction parallel to WORLD_UP (a near-top/bottom
 *  view) — rather than a hand-rolled cross-product that could silently
 *  diverge from that runtime behaviour. */
export function cameraBasis(direction: THREE.Vector3): { right: THREE.Vector3; up: THREE.Vector3 } {
  let dir = direction.clone();
  if (!Number.isFinite(dir.lengthSq()) || dir.lengthSq() < 1e-12) dir = new THREE.Vector3(0, -1, 0.5);
  dir.normalize();
  const basis = new THREE.Matrix4().lookAt(dir, ORIGIN, WORLD_UP);
  return {
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

  const { right, up } = cameraBasis(direction);
  let dir = direction.clone();
  if (!Number.isFinite(dir.lengthSq()) || dir.lengthSq() < 1e-12) dir = new THREE.Vector3(0, -1, 0.5);
  dir.normalize();

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

// ── Vertical inset shift ────────────────────────────────────────────────
// The floating export dock (`.action-dock`) overlays the canvas rather than
// shrinking it (it's `position: absolute`, so it doesn't affect the canvas's
// own flex-computed size — see index.css), so a model fitted to the FULL
// canvas can sit half-hidden behind it. Two moves fix that together (applied
// by Viewer.tsx's frameView): (1) shrink the fit's height target by the
// inset's share of the canvas, so the box is asked to fit the USABLE height
// (above the dock), not the full canvas; (2) shift the orbit target so the
// box, unchanged in world space, renders centred in that usable region
// rather than the full canvas.

/** Reduce a height fill fraction so a box fit against it targets the usable
 *  region above a bottom inset of `insetPx`, out of a `canvasHeightPx`-tall
 *  canvas — e.g. `insetHeightFraction(0.58, 800, 100)` asks for 0.58 of the
 *  *700px* usable strip, expressed as a (smaller) fraction of the full 800px
 *  canvas. Floors at 20% of the original target so a pathologically large
 *  inset degrades to "smaller than ideal" rather than collapsing to ~0. */
export function insetHeightFraction(fillHeight: number, canvasHeightPx: number, insetPx: number): number {
  if (canvasHeightPx <= 0) return fillHeight;
  const usableFraction = Math.max(0, 1 - insetPx / canvasHeightPx);
  return Math.max(fillHeight * usableFraction, fillHeight * 0.2);
}

/**
 * How far to shift the orbit target, opposite the screen "up" direction, so
 * a model already fitted to `distance` centres in the region ABOVE a bottom
 * inset of `insetPx` (out of a `canvasHeightPx`-tall canvas) instead of the
 * full canvas. Half the inset, not the whole inset: with only the BOTTOM
 * edge inset, the usable region's own centre sits `insetPx / 2` above the
 * full canvas's centre.
 *
 * Returns a signed scalar to apply as `target.addScaledVector(up, -shift)`
 * (Viewer.tsx) — negated because the camera always keeps `target` at the
 * exact centre of the frame, so making the (stationary) model appear higher
 * on screen means moving the target itself the OTHER way, down and away
 * from the model's true centre, not up. See Viewer.tsx's frameView for the
 * full derivation in context.
 */
export function insetTargetShift(distance: number, fovDeg: number, canvasHeightPx: number, insetPx: number): number {
  if (insetPx <= 0 || canvasHeightPx <= 0) return 0;
  const tanHalfV = Math.tan((fovDeg * Math.PI) / 360);
  const worldPerPixel = (2 * distance * tanHalfV) / canvasHeightPx;
  return (insetPx / 2) * worldPerPixel;
}
