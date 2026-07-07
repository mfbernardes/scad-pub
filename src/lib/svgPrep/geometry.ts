// Coarse, best-effort geometry: enough for the "fills the canvas" / "outside the
// viewBox" hints, never for real geometry.

import { SHAPE_TAGS, iterElements, localName } from "./dom";

export type Point = [number, number];
export type Bbox = [number, number, number, number];

const NUMBER_RE = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
const PATH_TOKEN_RE = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

export function numbers(text: string | null | undefined): number[] {
  if (!text) return [];
  return (text.match(NUMBER_RE) ?? []).map(Number);
}

/** Best-effort absolute points from a path's `d` (endpoints + control points). */
export function pathPoints(d: string): Point[] {
  const toks = d.match(PATH_TOKEN_RE) ?? [];
  const pts: Point[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let start: Point | null = null;
  let cmd: string | null = null;

  const num = (): number => {
    const value = Number(toks[i]);
    i += 1;
    return value;
  };

  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i][0])) {
      cmd = toks[i];
      i += 1;
      if (cmd === "Z" || cmd === "z") {
        if (start !== null) {
          cx = start[0];
          cy = start[1];
        }
        continue;
      }
    }
    if (cmd === null || i >= toks.length) {
      i += 1;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toUpperCase();
    if (c === "M") {
      const x = num();
      const y = num();
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      start = [cx, cy];
      pts.push([cx, cy]);
      cmd = rel ? "l" : "L";
    } else if (c === "L" || c === "T") {
      const x = num();
      const y = num();
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      pts.push([cx, cy]);
    } else if (c === "H") {
      const x = num();
      cx = rel ? cx + x : x;
      pts.push([cx, cy]);
    } else if (c === "V") {
      const y = num();
      cy = rel ? cy + y : y;
      pts.push([cx, cy]);
    } else if (c === "C") {
      for (let k = 0; k < 2; k++) {
        const x = num();
        const y = num();
        pts.push([rel ? cx + x : x, rel ? cy + y : y]);
      }
      const x = num();
      const y = num();
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      pts.push([cx, cy]);
    } else if (c === "S" || c === "Q") {
      let x = num();
      let y = num();
      pts.push([rel ? cx + x : x, rel ? cy + y : y]);
      x = num();
      y = num();
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      pts.push([cx, cy]);
    } else if (c === "A") {
      for (let k = 0; k < 5; k++) num();
      const x = num();
      const y = num();
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      pts.push([cx, cy]);
    } else {
      i += 1;
    }
    if (pts.some((p) => Number.isNaN(p[0]) || Number.isNaN(p[1]))) break;
  }
  return pts.filter((p) => !Number.isNaN(p[0]) && !Number.isNaN(p[1]));
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
