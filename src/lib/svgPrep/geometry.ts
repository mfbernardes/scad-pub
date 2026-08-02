// Coarse, best-effort geometry: enough for the "fills the canvas" / "outside the
// viewBox" hints, never for real geometry.

import { SHAPE_TAGS, iterElements, localName } from "./dom";

export type Point = [number, number];
export type Bbox = [number, number, number, number];

const NUMBER_RE = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
const COMMAND_RE = /[MmLlHhVvCcSsQqTtAaZz]/;
// Sticky: the path grammar is scanned position by position rather than
// pre-split into tokens, because an arc's two flags are single characters that
// may be written unseparated from their neighbours (`a5 5 0 0110 0`, routine
// svgo/Illustrator output). A number-shaped tokeniser reads `0110` as one
// number and every following argument lands one slot out.
const NUMBER_AT_RE = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/y;
const SEPARATOR_AT_RE = /[\s,]*/y;

export function numbers(text: string | null | undefined): number[] {
  if (!text) return [];
  return (text.match(NUMBER_RE) ?? []).map(Number);
}

/** Best-effort absolute points from a path's `d` (endpoints + control points).
 *  A malformed segment costs that segment only: the scanner discards the points
 *  it had staged for it, leaves the current point where it was, and resyncs at
 *  the next command letter.
 *  Abandoning the rest of the path instead silently shrank contentBbox, which
 *  the canvas-coverage and outside-the-viewBox checks read. */
export function pathPoints(d: string): Point[] {
  const pts: Point[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let start: Point | null = null;
  let cmd: string | null = null;
  let ok = true;

  const skipSep = () => {
    SEPARATOR_AT_RE.lastIndex = i;
    SEPARATOR_AT_RE.exec(d);
    i = SEPARATOR_AT_RE.lastIndex;
  };
  const num = (): number => {
    if (!ok) return NaN;
    skipSep();
    NUMBER_AT_RE.lastIndex = i;
    const m = NUMBER_AT_RE.exec(d);
    if (!m) {
      ok = false;
      return NaN;
    }
    i = NUMBER_AT_RE.lastIndex;
    const v = Number(m[0]);
    if (!Number.isFinite(v)) ok = false;
    return v;
  };
  // An arc flag is exactly one character, never a number token.
  const flag = () => {
    if (!ok) return;
    skipSep();
    if (d[i] !== "0" && d[i] !== "1") {
      ok = false;
      return;
    }
    i += 1;
  };
  const resync = () => {
    while (i < d.length && !COMMAND_RE.test(d[i])) i += 1;
    ok = true;
  };

  while (i < d.length) {
    skipSep();
    if (i >= d.length) break;
    if (COMMAND_RE.test(d[i])) {
      cmd = d[i];
      i += 1;
      if (cmd === "Z" || cmd === "z") {
        if (start !== null) {
          cx = start[0];
          cy = start[1];
        }
        continue;
      }
      skipSep();
      if (i >= d.length) break;
    }
    if (cmd === null) {
      // Leading junk before any command: nothing to attribute it to.
      resync();
      continue;
    }

    const rel: boolean = cmd === cmd.toLowerCase();
    const c: string = cmd.toUpperCase();
    // Everything this segment would contribute. Nothing reaches `pts`, `cx` or
    // `cy` until the whole segment has parsed, so abandoning `pending` IS the
    // rollback — there is no partial state to undo.
    const [x0, y0] = [cx, cy];
    const pending: Point[] = [];
    const at = (x: number, y: number): Point => [rel ? x0 + x : x, rel ? y0 + y : y];

    if (c === "M" || c === "L" || c === "T") {
      const x = num();
      const y = num();
      pending.push(at(x, y));
    } else if (c === "H") {
      pending.push([rel ? x0 + num() : num(), y0]);
    } else if (c === "V") {
      pending.push([x0, rel ? y0 + num() : num()]);
    } else if (c === "C" || c === "S" || c === "Q") {
      for (let k = 0; k < (c === "C" ? 3 : 2); k++) {
        const x = num();
        const y = num();
        pending.push(at(x, y));
      }
    } else if (c === "A") {
      num(); // rx
      num(); // ry
      num(); // x-axis-rotation
      flag(); // large-arc
      flag(); // sweep
      const x = num();
      const y = num();
      pending.push(at(x, y));
    } else {
      ok = false;
    }

    if (!ok) {
      resync();
      continue;
    }
    pts.push(...pending);
    [cx, cy] = pending[pending.length - 1];
    if (c === "M") {
      start = [cx, cy];
      // A moveto's implicit repetition is a lineto, not another moveto.
      cmd = rel ? "l" : "L";
    }
  }
  return pts;
}

// This module reads raw coordinate attributes, so a shape under a `transform`
// has to be composed into the frame the caller asked about. Only the forms that
// map an axis-aligned box to an axis-aligned box are composed —
// translate/scale/matrix without rotation or skew — because a bbox is all this
// module produces. Anything else reports "cannot measure", which is what keeps
// the answer honest rather than merely available. Refusing to measure whenever
// ANY transform was present is the alternative, and it is blind at the worst
// moment: fixViewBoxOrigin's own fix wraps the drawing in a translate, so every
// coordinate-dependent check went dark exactly after the drawing was fixed.

/** An affine transform in SVG's `matrix(a b c d e f)` order. */
type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `outer` applied to the result of `inner`. */
function compose(outer: Matrix, inner: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function applyMatrix(m: Matrix, [x, y]: Point): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

const TRANSFORM_FN_RE = /([a-zA-Z]+)\s*\(([^)]*)\)/g;

/** One element's own `transform` attribute as a matrix, or null when it uses a
 *  form this module will not measure through (rotate, skew, or anything
 *  unrecognised). A non-empty value that parses to no function at all is
 *  unrecognised too, not "no transform": treating garbage as identity would
 *  measure through something whose effect is unknown. */
function parseTransform(text: string): Matrix | null {
  let m: Matrix = IDENTITY;
  let sawAny = false;
  for (const [, name, args] of text.matchAll(TRANSFORM_FN_RE)) {
    sawAny = true;
    const n = numbers(args);
    let own: Matrix;
    if (name === "translate") own = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
    else if (name === "scale") own = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    else if (name === "matrix" && n.length === 6) {
      // A matrix with off-diagonal terms is a rotation or a skew: it does not
      // keep an axis-aligned box axis-aligned, so it is not measurable here.
      if (n[1] !== 0 || n[2] !== 0) return null;
      own = [n[0], n[1], n[2], n[3], n[4], n[5]];
    } else return null;
    m = compose(m, own);
  }
  if (sawAny) return m;
  return text.trim() === "" ? IDENTITY : null;
}

/** The composed transform from `root` down to `el`, or null when any transform
 *  on the way is one this module will not measure through. `root`'s OWN
 *  transform is excluded: the result is in root's coordinate system — the frame
 *  its `viewBox` establishes for its children — not its parent's. */
export function ancestorMatrix(el: Element, root: Element): Matrix | null {
  let m: Matrix = IDENTITY;
  let node: Element | null = el;
  while (node && node !== root) {
    const text = node.getAttribute?.("transform");
    if (text) {
      const own = parseTransform(text);
      if (own === null) return null;
      m = compose(own, m); // an ancestor's transform applies outside its child's
    }
    const parent = node.parentNode as Node | null;
    node = parent && parent.nodeType === 1 ? (parent as Element) : null;
  }
  return m;
}

function attr(el: Element, name: string, fallback = 0): number {
  const v = el.getAttribute(name);
  if (v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}

export function elementPoints(el: Element): Point[] {
  const name = localName(el);
  if (name === "path") return pathPoints(el.getAttribute("d") ?? "");
  if (name === "rect") {
    const x = attr(el, "x");
    const y = attr(el, "y");
    const w = attr(el, "width");
    const h = attr(el, "height");
    return [
      [x, y],
      [x + w, y + h],
    ];
  }
  if (name === "circle") {
    const cx = attr(el, "cx");
    const cy = attr(el, "cy");
    const r = attr(el, "r");
    return [
      [cx - r, cy - r],
      [cx + r, cy + r],
    ];
  }
  if (name === "ellipse") {
    const cx = attr(el, "cx");
    const cy = attr(el, "cy");
    const rx = attr(el, "rx");
    const ry = attr(el, "ry");
    return [
      [cx - rx, cy - ry],
      [cx + rx, cy + ry],
    ];
  }
  if (name === "line") {
    return [
      [attr(el, "x1"), attr(el, "y1")],
      [attr(el, "x2"), attr(el, "y2")],
    ];
  }
  if (name === "polyline" || name === "polygon") {
    const nums = numbers(el.getAttribute("points") ?? "");
    const out: Point[] = [];
    for (let k = 0; k + 1 < nums.length; k += 2) out.push([nums[k], nums[k + 1]]);
    return out;
  }
  return [];
}

/** The bounding box of every shape under `root`, in `root`'s own coordinate
 *  system — ancestor transforms composed in. Null when there are no shapes, or
 *  when any shape sits under a transform this module will not measure through
 *  (see ancestorMatrix): a box computed in the wrong frame is worse than no box,
 *  because callers report it as fact. */
export function contentBbox(root: Element): Bbox | null {
  const pts: Point[] = [];
  for (const el of iterElements(root)) {
    if (!SHAPE_TAGS.has(localName(el))) continue;
    const m = ancestorMatrix(el, root);
    if (m === null) return null;
    for (const p of elementPoints(el)) pts.push(applyMatrix(m, p));
  }
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function parseViewBox(root: Element): Bbox | null {
  const vb = root.getAttribute("viewBox");
  if (!vb) return null;
  const nums = numbers(vb);
  if (nums.length !== 4) return null;
  return [nums[0], nums[1], nums[2], nums[3]];
}

/** Format a number like printf `%g` (≈6 significant digits, trimmed). */
export function gFormat(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "0";
  let s = n.toPrecision(6);
  if (s.indexOf("e") < 0 && s.indexOf(".") >= 0) {
    s = s.replace(/\.?0+$/, "");
  }
  return s;
}
