// Generic SVG-preparation engine: check an SVG for OpenSCAD's geometry-only
// `import()`, apply safe fixes, and derive a region -> colour binding string.
// Pure DOM logic (no framework, no design specifics) so it runs in the browser
// wizard and in Node tests alike.
//
// This barrel is the module's PUBLIC surface, kept to what consumers actually
// import: the wizard (src/components/SvgWizard.tsx) and the tests. Seventeen
// names here had no importer outside src/lib/svgPrep/ at all — every DOM helper,
// every colour internal — which made the module look like a general-purpose SVG
// toolkit rather than the one pipeline it is. Import within the module from the
// file that owns the name; add a re-export here only when something outside
// needs it.

export {
  parseColor,
  displayColor,
  isRenderableColor,
} from "./colors";
export type { Rgb } from "./colors";
export { check } from "./check";
// applyFixes/deriveRegions/deriveLayers/analyze are exported FOR THE TESTS as
// well as the wizard: they are the seams the fixture suite drives the pipeline
// through, one stage at a time, rather than only end-to-end via prepareSvg.
export { applyFixes, fixViewBoxOrigin } from "./fixes";
export { groupByColor } from "./groupByColor";
export type { GroupByColorResult, GroupByColorErrorCode } from "./groupByColor";
export {
  parseLayersArg,
  parseLayerSpec,
  formatLayerSpec,
  isCanvasEntry,
  canvasEntry,
  isUsableHeight,
  unusableHeightRegions,
  deriveRegions,
  formatLayers,
} from "./regions";
export type { LayerEntry } from "./regions";
export { contentBbox, gFormat } from "./geometry";
export type { Point, Bbox } from "./geometry";
export { SvgPrepError } from "./types";
export type { Change, Finding, Level, Region, Vars, VarValue } from "./types";

import { check } from "./check";
import { applyFixes } from "./fixes";
import { groupByColor } from "./groupByColor";
import { canvasEntry, deriveRegions, formatLayers, parseLayersArg } from "./regions";
import { SvgPrepError, type Change, type Finding, type Region } from "./types";

export { MAX_RELIABLE_REGIONS } from "./limits";

/** A region binding is only meaningful with 2+ distinct regions; a single
 *  colour degrades to a blank string (no per-region split). The one place that
 *  rule is written — it was spelled out identically at three call sites, which
 *  is two chances for one of them to disagree about what "no regions" means. */
function layersFor(root: Element, regions: Region[]): string {
  return regions.length >= 2 ? formatLayers(regions, canvasEntry(root)) : "";
}

export function deriveLayers(root: Element): string {
  return layersFor(root, deriveRegions(root));
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
  const findings = check(root, parseLayersArg(layersArg), regions);
  return {
    findings,
    regions,
    derivedLayers: layersFor(root, regions),
    hasErrors: findings.some((f) => f.level === "ERROR"),
    hasWarnings: findings.some((f) => f.level === "WARN"),
  };
}

/** Parse SVG text into its root element (browser DOMParser). Throws
 *  SvgPrepError ("not-xml"/"not-svg") on invalid XML or a non-`<svg>` root;
 *  `not-xml`'s `.message` keeps the parser's own detail, which isn't itself
 *  translatable (see svgPrepText.ts's prepErrorText). */
export function parseSvg(text: string): Element {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  // getElementsByTagName, not querySelector: the DOM subset this module targets
  // (see dom.ts) is the intersection of the browser's and @xmldom/xmldom's, and
  // querySelector is browser-only — which left this, the wizard's ONE terminal
  // error path, unreachable from a test.
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new SvgPrepError("not-xml", err.textContent || "Not a valid SVG/XML file");
  const root = doc.documentElement;
  if (!root || root.localName !== "svg") throw new SvgPrepError("not-svg", "Root element is not <svg>");
  return root;
}

/** Serialise a prepared SVG root back to text (browser XMLSerializer). */
export function serializeSvg(root: Element): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(root)}\n`;
}

/** Run group-by-colour once when the drawing has no named regions yet, so that
 *  painting alone defines the regions. Its idempotent "already grouped" and
 *  benign "single colour" outcomes are swallowed; other notes are returned as
 *  a Change carrying the error's own code (resolved via `svgPrep.group.<code>`
 *  in svgPrepText.ts, not `svgPrep.change.<code>` — same code, a different
 *  family of display text, since "no shapes to group" reads differently as an
 *  auto-run aside than a Change would elsewhere). */
function autoGroupByColor(root: Element): Change[] {
  if (deriveRegions(root).length > 0) return [];
  const { changes, error } = groupByColor(root);
  if (error) {
    if (error.code === "already-grouped" || error.code === "one-colour") return [];
    return [{ code: error.code }];
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
  /** Changes made by fixes and grouping, in display order. */
  changes: Change[];
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
    layers = layersFor(root, regions);
  }
  // `regions` is only populated on the deriveColours path; elsewhere check()
  // derives its own.
  const findings = check(
    root,
    layers ? parseLayersArg(layers) : [],
    opts.deriveColours ? regions : undefined
  );
  return { svg: serializeSvg(root), layers, findings, regions, changes };
}
