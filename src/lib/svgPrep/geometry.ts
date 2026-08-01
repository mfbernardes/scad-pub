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
 *  A malformed segment costs that segment only: the scanner drops its partial
 *  points, restores the current point, and resyncs at the next command letter.
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
    // Everything this segment would contribute, rolled back together if any of
    // it fails to parse.
    const mark = pts.length;
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
      pts.length = mark;
      cx = x0;
      cy = y0;
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

export function contentBbox(root: Element): Bbox | null {
  const pts: Point[] = [];
  for (const el of iterElements(root)) {
    if (SHAPE_TAGS.has(localName(el))) pts.push(...elementPoints(el));
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
