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
  m = /^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(t);
  if (m) {
    const clamp = (v: string) => Math.min(255, Math.max(0, Math.round(parseFloat(v))));
    return [clamp(m[1]), clamp(m[2]), clamp(m[3])];
  }
  return null;
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/** An OpenSCAD-friendly colour value: a CSS name when known, else hex. */
export function displayColor(rgb: Rgb | null, original: string | null | undefined): string {
  if (rgb) {
    const name = RGB_TO_NAME.get(rgb.join(","));
    if (name) return name;
    return `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`;
  }
  return (original ?? "").trim().toLowerCase();
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
