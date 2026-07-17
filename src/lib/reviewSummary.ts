// reviewSummary.ts — pure derivation behind PR18's Review stage
// (src/components/QuickStart.tsx's terminal "Review" step): the row list for
// "what will actually be produced" — bounding box + per-design `@info` params
// + runtime `echo("@info", …)` rows — and the readiness line's label/dot for
// a given src/lib/readiness.ts `ReadinessState`.
//
// The row-building half is a DELIBERATE extraction of what used to live only
// in DimensionInfo.tsx (the viewer's measurements panel): that component now
// calls the same functions this module exports, so the two surfaces that both
// read the SAME rendered output — the floating measurements panel and the
// Review card — can never drift apart on what a row says or how a value is
// formatted. Kept dependency-free of React (like computedInfo.ts) so
// tests/reviewSummary.test.mjs can exercise every branch directly.
import type { Design, Param } from "../openscad/types";
import type { Values } from "./presets";
import type { ComputedInfo } from "./computedInfo";
import type { ReadinessState } from "./readiness";
import { isVisible } from "./visibility";
import { STATE_STYLES } from "./renderStatus";
import { t } from "./i18n";

/** Axis-aligned bounding-box size in millimetres — structurally the same
 *  shape as Viewer.tsx's own `Dimensions`, kept local so this dependency-
 *  light lib module never has to import a component file just for a type. */
export interface BoundingBoxSize {
  x: number;
  y: number;
  z: number;
}

export interface ReviewRow {
  /** Stable React key ("dimensions", "param:<name>", "computed:<i>:<label>"). */
  key: string;
  label: string;
  value: string;
  /** True only for the bounding-box headline row. */
  headline?: boolean;
}

/** One millimetre figure, always with at least one decimal (90 -> "90.0"). */
export function mm(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/** The bounding-box headline value, e.g. "120.0 × 80.0 × 6.0 mm". */
export function formatBoundingBox(size: BoundingBoxSize): string {
  return `${mm(size.x)} × ${mm(size.y)} × ${mm(size.z)} mm`;
}

/** Format a parameter's value for display, appending the optional `@info`
 *  unit. Returns null when there's nothing worth showing (e.g. an empty
 *  string) — the rule DimensionInfo has always applied. */
export function formatParamValue(param: Param, values: Values): string | null {
  const raw = values[param.name] ?? param.default;
  const unit = param.info?.unit ? ` ${param.info.unit}` : "";
  switch (param.type) {
    case "boolean":
      return raw ? t("dimensions.yes") : t("dimensions.no");
    case "string": {
      const s = String(raw).trim();
      return s ? s + unit : null;
    }
    case "enum": {
      const choice = param.choices.find((c) => c.value === String(raw));
      return (choice?.label ?? String(raw)) + unit;
    }
    default:
      return String(raw) + unit; // number
  }
}

/** The `@info`-flagged, currently-visible params with a non-empty formatted
 *  value, in design param order — the exact set/order DimensionInfo has
 *  always shown beneath the bounding-box headline. */
export function paramInfoRows(design: Design, values: Values): ReviewRow[] {
  return design.params
    .filter((p) => p.info && isVisible(p, values))
    .map((p) => ({
      key: `param:${p.name}`,
      label: p.info!.label ?? p.description,
      value: formatParamValue(p, values),
    }))
    .filter((row): row is ReviewRow => row.value !== null);
}

/**
 * The full row list for a "what will actually be produced" summary: the
 * bounding-box headline (only when a size is known — e.g. before any render
 * has landed), then every visible `@info` param row, then every runtime
 * computed-info row, in that fixed order. DimensionInfo's own order, shared
 * verbatim by QuickStart's Review stage.
 */
export function buildReviewRows(
  design: Design,
  values: Values,
  size: BoundingBoxSize | null,
  computed: ComputedInfo[]
): ReviewRow[] {
  const rows: ReviewRow[] = [];
  if (size) {
    rows.push({ key: "dimensions", label: t("dimensions.heading"), value: formatBoundingBox(size), headline: true });
  }
  rows.push(...paramInfoRows(design, values));
  computed.forEach((c, i) => rows.push({ key: `computed:${i}:${c.label}`, label: c.label, value: c.value }));
  return rows;
}

/** The Review stage's readiness line text for a given src/lib/readiness.ts
 *  state — "building" covers the rare case Review is visited before any
 *  render has landed yet (readinessState's `renderOk === null`). */
export function readinessLabel(readiness: ReadinessState): string {
  switch (readiness) {
    case "ready":
      return t("quickstart.reviewReady");
    case "attention":
      return t("quickstart.reviewAttention");
    case "failed":
      return t("quickstart.reviewFailed");
    case "building":
      return t("quickstart.reviewBuilding");
  }
}

/** The readiness dot's colour class — reuses renderStatus.ts's own green/red/
 *  grey tokens so the Review line's dot matches the same vocabulary the
 *  Output bell and the checklist's Preview row already wear elsewhere.
 *  "attention" has no renderStatus.ts counterpart (it isn't a render outcome
 *  — see readiness.ts), so it's handled as its own case with the same
 *  `bg-warn` token the attention chip/checklist already use. This IS the
 *  single source for that state->dot-colour mapping — GettingStarted.tsx's
 *  checklist Preview row calls this directly (checklist.ts's PreviewStatus is
 *  the same 4-value union as ReadinessState) rather than keeping its own
 *  copy. */
export function readinessDotClass(readiness: ReadinessState): string {
  if (readiness === "attention") return "bg-warn";
  const state = readiness === "ready" ? "ok" : readiness === "failed" ? "error" : "loading";
  return STATE_STYLES[state].dot;
}

/** Whether the readiness dot should pulse — only the transient "building" state. */
export function readinessPulse(readiness: ReadinessState): boolean {
  return readiness === "building" && !!STATE_STYLES.loading.pulse;
}
