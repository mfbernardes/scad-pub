// Region/colour derivation: read each region's painted fill so the layers
// binding can be generated from the drawing instead of typed by hand.

import { SHAPE_TAGS, iterElements, localName, paint } from "./dom";
import { colorKey, displayColor, parseColor } from "./colors";
import { parseViewBox } from "./geometry";
import type { Region } from "./types";

const ELEMENT_NODE = 1;

/** A `"<width>x<height>"` entry: the drawing's own canvas, which a consuming
 *  design needs to place the regions (they are imported uncentred, so it can't
 *  measure them itself). Told apart from a region by carrying no colon. */
const CANVAS_ENTRY_RE = /^\d+(?:\.\d+)?x\d+(?:\.\d+)?$/;

export function isCanvasEntry(entry: string): boolean {
  return CANVAS_ENTRY_RE.test(entry.trim());
}

/** Parse a `"120x80, walls:gray, rooms:white:2"` spec into its region names
 *  (ids), skipping the canvas entry. */
export function parseLayersArg(spec: string | null | undefined): string[] {
  return parseLayerSpec(spec ?? "")
    .entries.map((e) => e.id)
    .filter(Boolean);
}

/** One region as written in a layers spec: its id, its colour, and the relief
 *  height it names (empty when it names none and inherits the design's). */
export interface LayerEntry {
  id: string;
  color: string;
  height: string;
}

/** A written region height, as a consuming design will read it: a plain decimal,
 *  no sign and no exponent. Deliberately narrower than the browser's number
 *  input, which also accepts `1e3` and `-2` — a design's own parser typically
 *  cannot, and hard-fails the render rather than falling back. */
const HEIGHT_RE = /^(?:\d+\.?\d*|\.\d+)$/;

/** Whether a written height is one a consuming design can use: a plain positive
 *  decimal. An empty height is not "invalid" — it means "inherit the design's
 *  relief height" — so callers check for that themselves. */
export function isUsableHeight(text: string): boolean {
  const t = text.trim();
  return HEIGHT_RE.test(t) && Number(t) > 0;
}

/** The ids of regions in `spec` that wrote a height a consuming design would
 *  reject (`0`, `-1`, `1e3`, `tall`). Empty when every height is usable or
 *  omitted — the wizard blocks completion on a non-empty result. */
export function unusableHeightRegions(spec: string): string[] {
  return parseLayerSpec(spec)
    .entries.filter((e) => e.height !== "" && !isUsableHeight(e.height))
    .map((e) => e.id);
}

/** The colour a bare region token stands for: the id itself when it is a CSS
 *  colour name, or the `#hex` behind a `c<hex>` slug (see shorthandFor). */
export function expandShorthand(id: string): string {
  return /^c[0-9a-f]{6}$/i.test(id) ? `#${id.slice(1).toLowerCase()}` : id;
}

/** Split a layers spec back into its canvas entry and region entries, so the
 *  wizard can edit one region's height without disturbing the rest. */
export function parseLayerSpec(spec: string): { canvas: string; entries: LayerEntry[] } {
  let canvas = "";
  const entries: LayerEntry[] = [];
  for (const part of spec.split(",")) {
    const t = part.trim();
    if (!t) continue;
    if (isCanvasEntry(t)) {
      canvas = canvas || t;
      continue;
    }
    const [id, color, height = ""] = t.split(":").map((s) => s.trim());
    entries.push({ id, color: color || expandShorthand(id), height });
  }
  return { canvas, entries };
}

/** Serialise a canvas entry plus region entries back into a layers spec. A
 *  region with no height is written bare, so the common all-default case reads
 *  exactly as it did before heights existed. */
export function formatLayerSpec(canvas: string, entries: LayerEntry[]): string {
  const parts = entries.map((e) =>
    e.height ? `${e.id}:${e.color}:${e.height}` : shorthandFor(e.id, e.color),
  );
  return (canvas ? [canvas, ...parts] : parts).join(", ");
}

/** Map id → <g> and inkscape:label → <g> for every group. */
export function groupIndex(root: Element): {
  byId: Map<string, Element>;
  byLabel: Map<string, Element>;
} {
  const byId = new Map<string, Element>();
  const byLabel = new Map<string, Element>();
  for (const el of iterElements(root)) {
    if (localName(el) !== "g") continue;
    const gid = el.getAttribute("id");
    if (gid) byId.set(gid, el);
    const label = el.getAttributeNS
      ? el.getAttributeNS("http://www.inkscape.org/namespaces/inkscape", "label")
      : null;
    const lab = label || el.getAttribute("inkscape:label");
    if (lab) byLabel.set(lab, el);
  }
  return { byId, byLabel };
}

/** Resolve a shape's fill by walking up ancestors: [token, explicit]. Defaults to
 *  ["black", false] when nothing sets a fill. */
export function effectiveFill(el: Element): [string, boolean] {
  let node: Node | null = el;
  while (node !== null && node.nodeType === ELEMENT_NODE) {
    const token = paint(node as Element, "fill");
    if (token && token.trim().toLowerCase() !== "none") return [token.trim(), true];
    node = node.parentNode;
  }
  return ["black", false];
}

export function shapesUnder(el: Element): Element[] {
  return iterElements(el).filter((d) => SHAPE_TAGS.has(localName(d)));
}

/** The dominant fill of a group's shapes → [token, mixed, explicit]. */
function regionColor(group: Element): [string, boolean, boolean] {
  const tally = new Map<string, [number, string]>();
  const order: string[] = [];
  let explicit = false;
  for (const sh of shapesUnder(group)) {
    const [token, found] = effectiveFill(sh);
    explicit = explicit || found;
    const key = colorKey(token);
    if (!tally.has(key)) {
      tally.set(key, [0, token]);
      order.push(key);
    }
    tally.get(key)![0] += 1;
  }
  if (order.length === 0) return ["white", false, false];
  order.sort((a, b) => tally.get(b)![0] - tally.get(a)![0]);
  const token = tally.get(order[0])![1];
  return [token, order.length > 1, explicit];
}

/** Innermost `<g id>` groups that hold shapes, each with its colour, in order. A
 *  container/layer that only wraps other id-groups is skipped. */
export function deriveRegions(root: Element): Region[] {
  const idGroups = iterElements(root).filter(
    (el) => localName(el) === "g" && el.getAttribute("id") && shapesUnder(el).length > 0,
  );
  const idSet = new Set(idGroups);
  const regions: Region[] = [];
  for (const el of idGroups) {
    const wrapsRegion = iterElements(el).some((d) => d !== el && idSet.has(d));
    if (wrapsRegion) continue; // a wrapper around other regions, not a region itself
    const [token, mixed, explicit] = regionColor(el);
    regions.push({
      id: el.getAttribute("id")!,
      color: displayColor(parseColor(token), token),
      mixed,
      explicit,
      count: shapesUnder(el).length,
    });
  }
  return regions;
}

/** Prefer the bare-token shorthand when the id already names its colour — the id
 *  itself (a CSS colour name) or the `c<hex>` slug of a `#hex` colour, as
 *  produced by group-by-colour. A bare token expands back into the colour, so
 *  `"gray, c8b0000"` ≡ `"gray:gray, c8b0000:#8b0000"`. */
function shorthandFor(id: string, color: string): string {
  return id === color || (color.startsWith("#") && id === "c" + color.slice(1).toLowerCase())
    ? id
    : `${id}:${color}`;
}

/** Significant digits kept when writing a canvas dimension. Only the ratio of
 *  the two is ever used, so this is about not distorting it. */
const CANVAS_SIGNIFICANT_DIGITS = 6;

/** A positive number in plain decimal notation, trimmed, keeping
 *  CANVAS_SIGNIFICANT_DIGITS significant digits.
 *
 *  Not `gFormat`: that switches to exponent notation above ~1e6
 *  ("1.00000e+6"), which neither this module's own CANVAS_ENTRY_RE nor the
 *  consuming design's parser accepts — a viewBox of `0 0 1000000 500000` would
 *  be read back as a region id. And not a fixed number of decimal places: a
 *  viewBox is scale-free, so a fixed scale destroys a small one (`0.00005` at
 *  four places rounds to `0.0001`, doubling the aspect ratio it is there to
 *  carry). The places are therefore chosen from the value's own magnitude. */
function decimalFormat(n: number): string {
  const places = Math.min(
    100, // toFixed's own ceiling
    Math.max(0, CANVAS_SIGNIFICANT_DIGITS - Math.floor(Math.log10(n)) - 1),
  );
  return n
    .toFixed(places)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

/** The drawing's canvas as a `"<width>x<height>"` entry, or "" when it declares
 *  no viewBox. Regions are imported uncentred to keep them registered with each
 *  other, which leaves the consuming design unable to measure the drawing — this
 *  is what tells it the proportions to place them by. */
export function canvasEntry(root: Element): string {
  const vb = parseViewBox(root);
  if (vb === null) return "";
  const [, , w, h] = vb;
  if (!(w > 0) || !(h > 0)) return "";
  const [dw, dh] = [decimalFormat(w), decimalFormat(h)];
  const entry = `${dw}x${dh}`;
  // Never emit something our own reader would reject or misread. A viewBox
  // extreme enough to defeat the formatting — |n| >= 1e21, where toFixed
  // returns exponent notation, or below ~1e-100, where it underflows to zero —
  // simply forgoes the canvas hint and leaves the design corner-anchoring.
  const usable = isCanvasEntry(entry) && Number(dw) > 0 && Number(dh) > 0;
  return usable ? entry : "";
}

/** The layers spec for a drawing's regions, led by its canvas entry when the
 *  drawing declares one (see isCanvasEntry). */
export function formatLayers(regions: Region[], canvas = ""): string {
  return formatLayerSpec(
    canvas,
    regions.map((r) => ({ id: r.id, color: r.color, height: "" })),
  );
}
