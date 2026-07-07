// Region/colour derivation: read each region's painted fill so the layers
// binding can be generated from the drawing instead of typed by hand.

import { SHAPE_TAGS, iterElements, localName, paint } from "./dom";
import { colorKey, displayColor, parseColor } from "./colors";
import type { Region } from "./types";

const ELEMENT_NODE = 1;

/** Parse a `"walls:gray, rooms:white"` spec into its region names (ids). */
export function parseLayersArg(spec: string | null | undefined): string[] {
  const names: string[] = [];
  for (const part of (spec ?? "").split(",")) {
    const t = part.trim();
    if (!t) continue;
    const id = t.split(":", 1)[0].trim();
    if (id) names.push(id);
  }
  return names;
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
export function formatLayers(regions: Region[]): string {
  return regions
    .map((r) =>
      r.id === r.color ||
      (r.color.startsWith("#") && r.id === "c" + r.color.slice(1).toLowerCase())
        ? r.id
        : `${r.id}:${r.color}`,
    )
    .join(", ");
}
