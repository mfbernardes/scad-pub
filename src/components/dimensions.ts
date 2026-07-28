// dimensions.ts — builds a 3D dimension-annotation overlay for the viewer: an
// extension line + arrow-tipped dimension line + billboarded "NN.N mm" label for
// each axis of a centred model's bounding box (width × depth × height). Like the
// DimensionInfo panel, the figures are measured from the loaded mesh's bounds —
// wholly downstream of the exported geometry, purely informative, never part of a
// print.
//
// The model is centred on the origin by the Viewer, so it spans [-s/2, +s/2] on
// each axis; every annotation is derived from the half-extents below.
import * as THREE from "three";
import { mm } from "../lib/format";

// A dimension overlay group that also frees the GPU resources it created.
export interface DimensionsGroup extends THREE.Group {
  dispose(): void;
}

// Format a measurement like the reference CAD callouts — always one decimal,
// so 120 reads "120.0 mm" and 8 reads "8.0 mm". Each dimension label here is
// its own standalone billboarded sprite, so the " mm" unit is baked into
// every one rather than trailing a joined "W × D × H" string.
function mmLabel(n: number): string {
  return `${mm(n)} mm`;
}

// Relative luminance of a three.js colour (sRGB-ish), to pick a contrasting halo
// so labels stay legible whether the dimension colour is light or dark.
function isLight(c: THREE.Color): boolean {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.5;
}

// A billboarded text label, sized in world units relative to the model so it
// stays legible without overpowering small parts. Drawn on a 2× canvas for
// crispness; haloed in a contrasting colour so it reads on any viewer background.
function makeLabel(text: string, color: THREE.Color, worldHeight: number): THREE.Sprite {
  const fontPx = 64;
  const pad = fontPx * 0.4;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  const textW = ctx.measureText(text).width;
  canvas.width = Math.ceil(textW + pad * 2);
  canvas.height = Math.ceil(fontPx + pad * 2);

  // measureText is reset when the canvas is resized — restate the font.
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.lineJoin = "round";
  ctx.lineWidth = fontPx * 0.18;
  ctx.strokeStyle = isLight(color) ? "rgba(10,12,16,0.85)" : "rgba(245,247,250,0.85)";
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = `#${color.getHexString()}`;
  ctx.fillText(text, cx, cy);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldHeight * (canvas.width / canvas.height), worldHeight, 1);
  sprite.renderOrder = 2;
  return sprite;
}

// Overlay geometry, as fractions of the model's largest dimension. Module
// constants rather than inline literals because dimensionOverlayMargin below
// has to reproduce the same reach for the camera fit — the callouts sit
// OUTSIDE the model's own bounding box, so a camera fitted to that box alone
// crops them (see Viewer.tsx's frameView).
const GAP = 0.12; // how far the dimension line sits outside the box
const OVER = 0.2 * GAP; // how far the extension lines reach past it
const ARROW = 0.04; // arrowhead barb length
const LABEL_H = 0.085; // world height of the label text
// Width/height ratio of a rendered label sprite. makeLabel sizes the sprite
// from its own canvas metrics, so the true ratio depends on the text; ~2.8
// covers the widest callout these overlays produce ("NNN.N mm") and is used
// only to keep the label inside the frame, where over-estimating costs a
// slightly roomier fit and under-estimating clips the text.
const LABEL_ASPECT = 2.8;

/**
 * How far the overlay's callouts reach beyond the model's own bounding box,
 * in world units — `lateral` on both ±X (the depth and height callouts, each
 * offset sideways and carrying a wide billboarded label) and `front` on −Y
 * (the width callout under the front edge). Nothing reaches past +Y or ±Z.
 *
 * Feeding this to the camera fit is what keeps "90.0 mm" on screen: the raw
 * mesh box is up to ~1.5× narrower than the annotated envelope, so fitting
 * the box alone pushed the outer labels off the canvas edges.
 */
export function dimensionOverlayMargin(size: THREE.Vector3): { lateral: number; front: number } {
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  // Label centre sits at GAP + GAP·0.55 + LABEL_H/2 from the box face (see
  // `dim` below); add half the sprite's own extent to reach its far edge.
  const toLabelCentre = GAP * 1.55 + LABEL_H * 0.5;
  return {
    lateral: maxDim * (toLabelCentre + (LABEL_H * LABEL_ASPECT) / 2),
    front: maxDim * (toLabelCentre + LABEL_H * 0.5),
  };
}

// Build the dimension overlay for a model of the given bounding-box `size` (mm),
// coloured `color`. Returns a group ready to add to the scene; call dispose()
// before removing it to free the line geometry, sprite textures and materials.
export function buildDimensions(size: THREE.Vector3, color: THREE.Color): DimensionsGroup {
  const group = new THREE.Group() as DimensionsGroup;
  const hx = size.x / 2;
  const hy = size.y / 2;
  const hz = size.z / 2;
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const gap = maxDim * GAP;
  const over = maxDim * OVER;
  const arrow = maxDim * ARROW;
  const labelH = maxDim * LABEL_H;

  const pts: number[] = [];
  const seg = (a: THREE.Vector3, b: THREE.Vector3) =>
    pts.push(a.x, a.y, a.z, b.x, b.y, b.z);

  // One dimension: a line from p0→p1 along `dir`, offset outward from the box by
  // two extension lines (at e0/e1), with an inward-pointing arrowhead at each end
  // (barbs splayed by `perp`), plus a billboarded label past the line midpoint.
  const dim = (
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    e0: THREE.Vector3,
    e1: THREE.Vector3,
    dir: THREE.Vector3,
    perp: THREE.Vector3,
    value: number
  ) => {
    seg(p0, p1);
    seg(e0, p0.clone().add(perp.clone().multiplyScalar(over)));
    seg(e1, p1.clone().add(perp.clone().multiplyScalar(over)));
    // Arrowheads: tip at each endpoint, barbs running back along the line.
    for (const [tip, back] of [
      [p0, dir.clone()],
      [p1, dir.clone().negate()],
    ] as const) {
      const root = tip.clone().add(back.multiplyScalar(arrow));
      seg(tip, root.clone().add(perp.clone().multiplyScalar(arrow * 0.5)));
      seg(tip, root.clone().sub(perp.clone().multiplyScalar(arrow * 0.5)));
    }
    const label = makeLabel(mmLabel(value), color, labelH);
    label.position
      .copy(p0)
      .add(p1)
      .multiplyScalar(0.5)
      .add(perp.clone().multiplyScalar(gap * 0.55 + labelH * 0.5));
    group.add(label);
  };

  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);

  // Width (X) — along the lower front edge, offset out in −Y.
  dim(
    new THREE.Vector3(-hx, -hy - gap, -hz),
    new THREE.Vector3(hx, -hy - gap, -hz),
    new THREE.Vector3(-hx, -hy, -hz),
    new THREE.Vector3(hx, -hy, -hz),
    X,
    new THREE.Vector3(0, -1, 0),
    size.x
  );
  // Depth (Y) — along the lower right edge, offset out in +X.
  dim(
    new THREE.Vector3(hx + gap, -hy, -hz),
    new THREE.Vector3(hx + gap, hy, -hz),
    new THREE.Vector3(hx, -hy, -hz),
    new THREE.Vector3(hx, hy, -hz),
    Y,
    new THREE.Vector3(1, 0, 0),
    size.y
  );
  // Height (Z) — along the front left vertical edge, offset out in −X.
  dim(
    new THREE.Vector3(-hx - gap, -hy, -hz),
    new THREE.Vector3(-hx - gap, -hy, hz),
    new THREE.Vector3(-hx, -hy, -hz),
    new THREE.Vector3(-hx, -hy, hz),
    Z,
    new THREE.Vector3(-1, 0, 0),
    size.z
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const lineMaterial = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
  const lines = new THREE.LineSegments(geometry, lineMaterial);
  lines.renderOrder = 2; // draw over the model so callouts are never occluded
  group.add(lines);

  group.dispose = () => {
    geometry.dispose();
    lineMaterial.dispose();
    for (const child of group.children) {
      if (child instanceof THREE.Sprite) {
        child.material.map?.dispose();
        child.material.dispose();
      }
    }
  };
  return group;
}
