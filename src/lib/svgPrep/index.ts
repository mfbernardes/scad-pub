// Generic SVG-preparation engine: check an SVG for OpenSCAD's geometry-only
// `import()`, apply safe fixes, and derive a region -> colour binding string.
// Pure DOM logic (no framework, no design specifics) so it runs in the browser
// wizard and in Node tests alike.

export {
  SVG_NS,
  INK_NS,
  SHAPE_TAGS,
  TEXT_TAGS,
  IGNORED_TAGS,
  hasAnyTransform,
  paint,
  iterElements,
  localName,
} from "./dom";
export {
  NAMED_COLORS,
  parseColor,
  displayColor,
  colorKey,
  slugForColor,
} from "./colors";
export type { Rgb } from "./colors";
export { check } from "./check";
export { applyFixes, fixInkscapeIds, fixViewBoxOrigin } from "./fixes";
export { groupByColor } from "./groupByColor";
export type { GroupByColorResult } from "./groupByColor";
export {
  parseLayersArg,
  groupIndex,
  deriveRegions,
  formatLayers,
  effectiveFill,
} from "./regions";
export { contentBbox, parseViewBox, gFormat } from "./geometry";
export type { Point, Bbox } from "./geometry";
export type { Finding, Level, Region } from "./types";

import { check } from "./check";
import { applyFixes } from "./fixes";
import { groupByColor } from "./groupByColor";
import { deriveRegions, formatLayers, parseLayersArg } from "./regions";
import type { Finding, Region } from "./types";

/** A region binding is only meaningful with 2+ distinct regions; a single
 *  colour degrades to a blank string (no per-region split). */
export function deriveLayers(root: Element): string {
  const regions = deriveRegions(root);
  return regions.length >= 2 ? formatLayers(regions) : "";
}

export interface Analysis {
  findings: Finding[];
  regions: Region[];
  /** The layers value derived from the regions' fills (blank for < 2 regions). */
  derivedLayers: string;
  hasErrors: boolean;
  hasWarnings: boolean;
}

/** One-call analysis for a step in the wizard: run the checks and read out the
 *  regions and the derived layers string. */
export function analyze(root: Element, layersArg = ""): Analysis {
  const regions = deriveRegions(root);
  const findings = check(root, parseLayersArg(layersArg));
  return {
    findings,
    regions,
    derivedLayers: regions.length >= 2 ? formatLayers(regions) : "",
    hasErrors: findings.some((f) => f.level === "ERROR"),
    hasWarnings: findings.some((f) => f.level === "WARN"),
  };
}

/** Parse SVG text into its root element (browser DOMParser). Throws on invalid
 *  XML or a non-`<svg>` root. */
export function parseSvg(text: string): Element {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error(err.textContent || "Not a valid SVG/XML file");
  const root = doc.documentElement;
  if (!root || root.localName !== "svg") throw new Error("Root element is not <svg>");
  return root;
}

/** Serialise a prepared SVG root back to text (browser XMLSerializer). */
export function serializeSvg(root: Element): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(root)}\n`;
}

/** Run group-by-colour once when the drawing has no named regions yet, so that
 *  painting alone defines the regions. Its idempotent "already grouped" and
 *  benign "single colour" outcomes are swallowed; other notes are returned. */
export function autoGroupByColor(root: Element): string[] {
  if (deriveRegions(root).length > 0) return [];
  const { changes, error } = groupByColor(root);
  if (error) {
    if (error.includes("already inside a named") || error.includes("only one fill colour")) {
      return [];
    }
    return [`Group by colour: ${error}`];
  }
  return changes;
}

export interface PrepareOptions {
  /** True iff the field binds a derived layers string to a second parameter. */
  deriveColours: boolean;
}

export interface PrepareResult {
  /** The fixed, serialised SVG to import. */
  svg: string;
  /** The derived layers string (possibly "") when deriveColours, else null. */
  layers: string | null;
  /** Residual check findings after fixes/grouping. */
  findings: Finding[];
  /** The named regions in effect (empty when colours are not derived). */
  regions: Region[];
  /** Human-readable changes made by fixes and grouping. */
  changes: string[];
}

/**
 * The wizard ⇄ host contract in one call: fix the drawing, optionally derive its
 * colour regions, and return the serialised SVG plus the layers string. The host
 * applies `svg` to the `@svg` parameter and, when non-null, `layers` to the
 * `layers=` target, then re-renders.
 */
export function prepareSvg(root: Element, opts: PrepareOptions): PrepareResult {
  const changes = [...applyFixes(root)];
  let layers: string | null = null;
  let regions: Region[] = [];
  if (opts.deriveColours) {
    changes.push(...autoGroupByColor(root));
    regions = deriveRegions(root);
    layers = regions.length >= 2 ? formatLayers(regions) : "";
  }
  const findings = check(root, layers ? parseLayersArg(layers) : []);
  return { svg: serializeSvg(root), layers, findings, regions, changes };
}
