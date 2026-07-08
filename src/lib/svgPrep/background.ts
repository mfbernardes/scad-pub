// Canvas-background detection: find a solid rectangle that covers (nearly) the
// whole viewBox. OpenSCAD's import() ignores fill/stroke and fills EVERY closed
// shape, so a full-canvas rectangle — the "artboard"/background many editors emit
// — imports as one solid block that buries every other shape inside it (the
// drawing extrudes as a single featureless slab). Detected here so the checker
// can warn and the Fix step can drop it. Restricted to genuine rectangles
// covering the canvas: a ring/frame (a rect with a hole) or a non-rectangular
// silhouette is real artwork and is never flagged.

import { SHAPE_TAGS, iterElements, localName } from "./dom";
import { elementPoints, parseViewBox } from "./geometry";

// A rectangle must span at least this fraction of the viewBox on BOTH axes to
// count as a background. High enough that ordinary large artwork (a pictogram
// that reaches the edges on one axis) is not swept up, low enough to catch an
// artboard drawn a hair inside the frame.
const COVER_FRAC = 0.9;

/** Whether any ancestor of (or the element itself) carries a transform — in
 *  which case its raw coordinates can't be trusted against the viewBox, so we
 *  don't judge it a background. */
function transformedContext(el: Element): boolean {
  let node: Node | null = el;
  while (node && (node as Element).getAttribute) {
    if ((node as Element).getAttribute("transform")) return true;
    node = node.parentNode;
  }
  return false;
}

function numAttr(el: Element, name: string, vbSpan: number, fallback: number): number {
  const raw = el.getAttribute(name);
  if (raw === null || raw.trim() === "") return fallback;
  const t = raw.trim();
  if (t.endsWith("%")) {
    const p = parseFloat(t.slice(0, -1));
    return Number.isNaN(p) ? fallback : (p / 100) * vbSpan;
  }
  const n = parseFloat(t);
  return Number.isNaN(n) ? fallback : n;
}

/** Whether a point set is (approximately) the four corners of its own
 *  axis-aligned bounding box — i.e. a rectangle. Duplicated/closing points are
 *  tolerated; anything with a point off the corners (a triangle, an L-shape) is
 *  not a rectangle. */
function isAxisAlignedRectangle(pts: Array<[number, number]>): boolean {
  if (pts.length < 4) return false;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const eps = Math.max(1e-6, 1e-3 * Math.max(x1 - x0, y1 - y0));
  const corners = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const seen = [false, false, false, false];
  for (const [px, py] of pts) {
    let onCorner = false;
    for (let c = 0; c < 4; c++) {
      if (Math.abs(px - corners[c][0]) <= eps && Math.abs(py - corners[c][1]) <= eps) {
        seen[c] = true;
        onCorner = true;
        break;
      }
    }
    if (!onCorner) return false; // a point away from every corner → not a rectangle
  }
  return seen.every(Boolean);
}

// A shape's axis-aligned box, or null when it isn't a solid (hole-free)
// rectangle. A <path>/<polygon> qualifies only when it is a single subpath whose
// points form a rectangle; a <rect> always qualifies (a rounded <rect> still
// buries the canvas). Circles/ellipses/lines/polylines never qualify.
function solidRectBox(el: Element, vbW: number, vbH: number): [number, number, number, number] | null {
  const name = localName(el);
  if (name === "rect") {
    const x = numAttr(el, "x", vbW, 0);
    const y = numAttr(el, "y", vbH, 0);
    const w = numAttr(el, "width", vbW, 0);
    const h = numAttr(el, "height", vbH, 0);
    if (w <= 0 || h <= 0) return null;
    return [x, y, x + w, y + h];
  }
  if (name === "path") {
    const d = el.getAttribute("d") ?? "";
    // More than one subpath (a second M) means a frame/ring with a hole — real
    // artwork, never a solid background.
    if ((d.match(/[Mm]/g)?.length ?? 0) !== 1) return null;
    const pts = elementPoints(el);
    if (!isAxisAlignedRectangle(pts)) return null;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  if (name === "polygon") {
    const pts = elementPoints(el);
    if (!isAxisAlignedRectangle(pts)) return null;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  return null;
}

function coversViewBox(
  box: [number, number, number, number],
  vb: [number, number, number, number],
): boolean {
  const [bx0, by0, bx1, by1] = box;
  const [vx, vy, vw, vh] = vb;
  if (vw <= 0 || vh <= 0) return false;
  const spanW = bx1 - bx0;
  const spanH = by1 - by0;
  if (spanW < COVER_FRAC * vw || spanH < COVER_FRAC * vh) return false;
  // And it must actually sit over the canvas (not a same-size box off to one side).
  const marginX = 0.05 * vw;
  const marginY = 0.05 * vh;
  return (
    bx0 <= vx + marginX &&
    by0 <= vy + marginY &&
    bx1 >= vx + vw - marginX &&
    by1 >= vy + vh - marginY
  );
}

/**
 * The shapes that cover the whole canvas as a solid rectangle — the backgrounds
 * that would make the drawing import as one solid block. Returned only when at
 * least one OTHER importable shape exists (a lone full-canvas rectangle is a
 * deliberate solid tile, not a background burying detail). Skipped entirely when
 * transforms make coordinates unreliable.
 */
export function canvasBackgrounds(root: Element): Element[] {
  const vb = parseViewBox(root);
  if (vb === null) return [];
  const [, , vw, vh] = vb;
  const shapes = iterElements(root).filter((el) => SHAPE_TAGS.has(localName(el)));
  const backgrounds: Element[] = [];
  for (const el of shapes) {
    if (transformedContext(el)) continue;
    const box = solidRectBox(el, vw, vh);
    if (box && coversViewBox(box, vb)) backgrounds.push(el);
  }
  // Only a background if it buries something else; keep at least one shape.
  if (backgrounds.length === 0 || backgrounds.length >= shapes.length) return [];
  return backgrounds;
}
