// Colour parsing and naming used to derive a region -> colour binding from a
// drawing's fills.

export type Rgb = readonly [number, number, number];

export const NAMED_COLORS: Record<string, Rgb> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  darkgray: [169, 169, 169],
  darkgrey: [169, 169, 169],
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
  red: [255, 0, 0],
  green: [0, 128, 0],
  lime: [0, 255, 0],
  blue: [0, 0, 255],
  navy: [0, 0, 128],
  yellow: [255, 255, 0],
  gold: [255, 215, 0],
  orange: [255, 165, 0],
  brown: [165, 42, 42],
  purple: [128, 0, 128],
  pink: [255, 192, 203],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  teal: [0, 128, 128],
  olive: [128, 128, 0],
  maroon: [128, 0, 0],
  beige: [245, 245, 220],
};

// First name wins when several share an RGB (e.g. gray before grey).
const RGB_TO_NAME = new Map<string, string>();
for (const [name, rgb] of Object.entries(NAMED_COLORS)) {
  const key = rgb.join(",");
  if (!RGB_TO_NAME.has(key)) RGB_TO_NAME.set(key, name);
}

/** A colour token → [r, g, b], or null if not understood. */
export function parseColor(token: string | null | undefined): Rgb | null {
  if (!token) return null;
  const t = token.trim().toLowerCase();
  if (t === "none" || t === "transparent" || t === "currentcolor") return null;
  if (t in NAMED_COLORS) return NAMED_COLORS[t];

  let m = /^#([0-9a-f]{3})$/.exec(t);
  if (m) {
    const h = m[1];
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  m = /^#([0-9a-f]{6})$/.exec(t);
  if (m) {
    const h = m[1];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  // Functional forms, in both the legacy comma syntax and the modern
  // space-separated one, with the alpha component read and discarded (a relief
  // has no opacity). Real exports reach here constantly — Illustrator writes
  // `rgb()`, Figma writes `rgba()` — and every token that misses becomes an
  // unparseable paint that can only be slugged, never named or grouped by
  // equality with the same colour written another way.
  m = /^rgba?\(([^)]*)\)$/.exec(t);
  if (m) {
    const n = channels(m[1], 3);
    if (n) return [byte(n[0]), byte(n[1]), byte(n[2])];
    return null;
  }
  m = /^hsla?\(([^)]*)\)$/.exec(t);
  if (m) {
    const n = channels(m[1], 3);
    if (n) return hslToRgb(n[0], n[1], n[2]);
    return null;
  }
  return null;
}

/** The leading `count` numeric components of a functional colour's argument
 *  list, or null when it is not that shape. Splits on commas or whitespace (CSS
 *  accepts both), tolerates the `/ alpha` suffix of the modern syntax, and
 *  reads a percentage as its fraction of 255 — which is what `rgb(100% 0% 0%)`
 *  means, and close enough for hsl's saturation/lightness because hslToRgb
 *  divides by 255 again. */
function channels(args: string, count: number): number[] | null {
  const parts = args
    .replace(/\//g, " ")
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length < count) return null;
  const out: number[] = [];
  for (const part of parts.slice(0, count)) {
    const pct = part.endsWith("%");
    const v = parseFloat(pct ? part.slice(0, -1) : part);
    if (!Number.isFinite(v)) return null;
    out.push(pct ? (v / 100) * 255 : v);
  }
  return out;
}

function byte(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

/** hue in degrees, saturation/lightness as `channels` returns them (0–255). */
function hslToRgb(hDeg: number, s255: number, l255: number): Rgb {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  const s = Math.min(1, Math.max(0, s255 / 255));
  const l = Math.min(1, Math.max(0, l255 / 255));
  if (s === 0) return [byte(l * 255), byte(l * 255), byte(l * 255)];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [byte(channel(h + 1 / 3) * 255), byte(channel(h) * 255), byte(channel(h - 1 / 3) * 255)];
}

/** Whether a colour token can be painted into a CSS swatch. Uses the browser's
 *  own CSS parser when available (so it accepts every CSS colour, not only the
 *  ones we name), and falls back to a best-effort check in non-DOM (test)
 *  contexts. A derived region colour that fails this is still handed to OpenSCAD
 *  verbatim: it cannot be previewed as a swatch. */
export function isRenderableColor(token: string | null | undefined): boolean {
  if (!token) return false;
  const t = token.trim();
  if (!t) return false;
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
    return CSS.supports("color", t);
  }
  if (parseColor(t) !== null) return true;
  return (
    /^#([0-9a-f]{4}|[0-9a-f]{8})$/i.test(t) ||
    /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(t)
  );
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/** An OpenSCAD-friendly colour value: a CSS name when known, else hex.
 *
 *  An unparseable paint (a `url(#gradient)` reference, a colour space this
 *  module does not model) still has to be carried, but never verbatim: the
 *  layers spec separates its entries with `,` and its fields with `:`, so a
 *  token holding either — `rgba(255,0,0,0.5)` above all — is shredded into junk
 *  regions when parseLayerSpec reads it back. Strip both, and the whitespace
 *  that would make the entry unreadable. Case survives for `url(#…)`, whose
 *  fragment reference is case-sensitive. */
export function displayColor(rgb: Rgb | null, original: string | null | undefined): string {
  if (rgb) {
    const name = RGB_TO_NAME.get(rgb.join(","));
    if (name) return name;
    return `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`;
  }
  const stripped = (original ?? "").replace(/[\s,:]+/g, "");
  // A token that was nothing but separators leaves no usable colour; fall back
  // to the same default effectiveFill uses when nothing paints a shape.
  if (!stripped) return "black";
  return /^url\(/i.test(stripped) ? stripped : stripped.toLowerCase();
}

/** A stable identity for a colour so equal colours group however they are written. */
export function colorKey(token: string | null | undefined): string {
  const rgb = parseColor(token);
  if (rgb) return `rgb:${rgb.join(",")}`;
  return `name:${(token ?? "").trim().toLowerCase()}`;
}

/** A unique, valid id derived from a colour (its CSS name, or c<hex>). */
export function slugForColor(token: string, taken: Set<string>): string {
  const rgb = parseColor(token);
  const disp = displayColor(rgb, token);
  let base = disp.toLowerCase().replace(/[^0-9a-z]/g, "");
  if (!base || /^[0-9]/.test(base) || disp.startsWith("#")) {
    base = "c" + disp.toLowerCase().replace(/[^0-9a-z]/g, "");
  }
  let name = base;
  let i = 2;
  while (taken.has(name)) {
    name = `${base}${i}`;
    i += 1;
  }
  taken.add(name);
  return name;
}
