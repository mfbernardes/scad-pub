// reviewSummary.ts — pure derivation of a review summary's row list: a
// design's curated `designs[].reviewLabels` config (see docs/config.md),
// each label's live formatted value (honouring any `echo("@review", …)`
// override — see reviewOverrides.ts), plus one overall bounding-box
// "Dimensions" row. No React; dependency-free besides the schema/values
// types, so a future review surface (the status strip/dialog Phase 2 builds
// on top of this) can drive it directly, and tests/reviewSummary.test.mjs can
// exercise every branch without a DOM harness.
//
// Deliberately a SINGLE row-list builder (`buildReviewSummaryRows`), unlike
// an earlier exploration that grew three overlapping ones — a design either
// curates reviewLabels or it doesn't; there's no second "everything" variant
// to keep in sync.
//
// Value formatting (`mm`/`formatReviewValue`, re-exported here so existing
// importers of this module — including tests/reviewSummary.test.mjs — are
// unaffected) is src/lib/format.ts's shared `mm`/`formatParamValue`, the same
// functions DimensionInfo.tsx's `@info` rows use — see that module's own doc.
// A review summary and the viewer's measurements panel can never disagree
// about what a value says, because they're now the same code, not a
// hand-kept-in-sync copy.
import type { Design } from "../openscad/types";
import type { Values } from "./presets";
import { isVisible } from "./visibility";
import { mm, formatParamValue } from "./format";

export { mm };

/** Axis-aligned bounding-box size in millimetres — structurally the same
 *  shape as Viewer.tsx's own `Dimensions`, kept local so this dependency-
 *  light lib module never has to import a component file just for a type. */
export interface BoundingBoxSize {
  x: number;
  y: number;
  z: number;
}

export interface ReviewRow {
  /** Stable key ("dimensions" or "curated:<i>:<label>"). */
  key: string;
  label: string;
  value: string;
  /** True only for the bounding-box row. */
  headline?: boolean;
}

/** The bounding-box row's value, e.g. "120.0 × 80.0 × 6.0 mm". */
export function formatBoundingBox(size: BoundingBoxSize): string {
  return `${mm(size.x)} × ${mm(size.y)} × ${mm(size.z)} mm`;
}

/** Format a parameter's current value for display, appending its optional
 *  `@info` unit — format.ts's `formatParamValue` (booleans as Yes/No, enums
 *  by choice label, empty strings excluded). Returns null when there's
 *  nothing worth showing. Kept under this module's existing export name so
 *  callers (including tests/reviewSummary.test.mjs) are unaffected. */
export const formatReviewValue = formatParamValue;

/**
 * The review summary's row list: one row per `designs[].reviewLabels` entry
 * (see docs/config.md), in the order its keys first appear in that object —
 * a deployment's own curation order, not necessarily the design's
 * param-declaration order. Several params sharing one label merge into a
 * SINGLE row, their formatted values joined by " / ". A param whose value
 * isn't worth a row (`formatReviewValue` returns null) or that's currently
 * hidden by `@showIf` contributes nothing to its label's row.
 *
 * `reviewOverrides` (reviewOverrides.ts's `echo("@review", param, value)`
 * map) lets a param's row show what the design actually RENDERED instead of
 * its raw stored value — e.g. a lettering profile that uppercases free text:
 * typed "Raum 101", printed "RAUM 101". When a param has an override, that
 * value is used verbatim (skipping `formatReviewValue` entirely, including
 * its "empty string -> no row" rule — an override is always author-supplied,
 * never blank by accident). Absent an override, a param's row is formatted
 * exactly as before.
 *
 * Finally, when `size` is known, one overall bounding-box "Dimensions" row
 * is appended after the curated rows — never the other `@info`/computed
 * metric rows (dot diameter, cell spacing, plate thickness, …), which stay
 * available elsewhere. Returns `[]` when `reviewLabels` is unset and `size`
 * is null.
 */
export function buildReviewSummaryRows(
  design: Design,
  values: Values,
  reviewLabels: Record<string, string> | undefined,
  size: BoundingBoxSize | null,
  reviewOverrides?: Map<string, string>
): ReviewRow[] {
  const rows: ReviewRow[] = [];
  if (reviewLabels) {
    const order: string[] = [];
    const byLabel = new Map<string, string[]>();
    const paramByName = new Map(design.params.map((p) => [p.name, p]));
    for (const paramName of Object.keys(reviewLabels)) {
      const param = paramByName.get(paramName);
      if (!param) continue;
      if (!isVisible(param, values)) continue;
      const label = reviewLabels[paramName];
      const override = reviewOverrides?.get(paramName);
      const value = override !== undefined ? override : formatReviewValue(param, values);
      if (value === null) continue;
      if (!byLabel.has(label)) {
        byLabel.set(label, []);
        order.push(label);
      }
      byLabel.get(label)!.push(value);
    }
    order.forEach((label, i) => {
      rows.push({ key: `curated:${i}:${label}`, label, value: byLabel.get(label)!.join(" / ") });
    });
  }
  if (size) {
    rows.push({ key: "dimensions", label: "Dimensions", value: formatBoundingBox(size), headline: true });
  }
  return rows;
}
