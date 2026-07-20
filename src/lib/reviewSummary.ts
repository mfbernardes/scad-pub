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
import type { DisplayRow } from "./displayRows";
import { isMostlyBraille } from "./displayRows";
import type { ReadinessState } from "./readiness";
import { isVisible } from "./visibility";
import { familyOf } from "./fonts";
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
  /** Stable React key ("dimensions", "param:<name>", "computed:<i>:<label>",
   *  "essential:<name>", "display:<i>:<step>:<label>"). */
  key: string;
  label: string;
  value: string;
  /** True only for the bounding-box headline row. */
  headline?: boolean;
  /** True for a row whose value is mostly Unicode Braille-block text (see
   *  displayRows.ts's isMostlyBraille) — the Review card renders its value
   *  larger, mirroring the same accommodation the step group's own inset
   *  preview surface gives it (QuickStart.tsx). Only ever set on a `@display`
   *  row (see `displayInfoRows` below); absent (not just false) elsewhere,
   *  matching how `headline` is only ever set on the dimensions row. */
  large?: boolean;
  /** True for a row sourced from a design's own `echo("@display", …)` —
   *  the Review card marks it with a small "generated automatically" badge,
   *  the same signal the step group's own inset preview surface carries. */
  auto?: boolean;
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

/** Middle-ellipsis truncation: keeps the START and END of a long string
 *  (usually the informative parts of free text — a filename, a sentence's
 *  opening and closing) rather than `String.prototype.slice`'s default
 *  end-truncation, which loses whatever comes after the cutoff entirely.
 *  A no-op when `value` already fits within `max`. */
export function truncateMiddle(value: string, max = 60): string {
  if (value.length <= max || max <= 1) return value;
  const keep = max - 1; // one char reserved for the ellipsis itself
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return value.slice(0, head) + "…" + value.slice(value.length - tail);
}

/** Format one ESSENTIAL parameter's live value for the Review card's summary
 *  row — deliberately distinct from `formatParamValue` above (which serves
 *  `@info`-flagged rows and reads the RENDERED `unit`): every essential
 *  parameter gets a row here, `@info`-flagged or not, so a design need not
 *  double-annotate a field just to have it show up in the summary. A `@font`
 *  field shows its FAMILY name only (stripping any `:style=…` Fontconfig
 *  properties, which mean nothing to a visitor reviewing their settings) —
 *  the same value the font-fallback attention item itself names. Long free
 *  text is middle-truncated so one field can't blow out the summary card's
 *  layout. Returns null for a value not worth a row (an empty string), same
 *  rule `formatParamValue` already applies. */
export function formatEssentialValue(param: Param, values: Values): string | null {
  const raw = values[param.name] ?? param.default;
  switch (param.type) {
    case "boolean":
      return raw ? t("dimensions.yes") : t("dimensions.no");
    case "string": {
      if (param.isFont) {
        const family = familyOf(String(raw));
        return family || null;
      }
      const s = String(raw).trim();
      return s ? truncateMiddle(s) : null;
    }
    case "enum": {
      if (param.isFont) return familyOf(String(raw)) || String(raw);
      const choice = param.choices.find((c) => c.value === String(raw));
      return choice?.label ?? String(raw);
    }
    default:
      return String(raw); // number
  }
}

/** Every currently-visible ESSENTIAL (non-`@advanced`) parameter, in design
 *  param order — the Review card's own "what you set" rows, distinct from
 *  `paramInfoRows`' narrower `@info`-flagged subset (see that function's own
 *  doc): a design need not mark a field `@info` for it to show up in the
 *  export summary a visitor is about to act on. */
export function essentialParamRows(design: Design, values: Values): ReviewRow[] {
  return design.params
    .filter((p) => !p.advanced && isVisible(p, values))
    .map((p) => ({
      key: `essential:${p.name}`,
      label: p.info?.label ?? p.description,
      value: formatEssentialValue(p, values),
    }))
    .filter((row): row is ReviewRow => row.value !== null);
}

/** A design's own `echo("@display", step, label, value)` rows (see
 *  displayRows.ts), reshaped into ReviewRow form for the Review card — the
 *  SAME rows QuickStart's step groups show inline, so the export summary and
 *  the in-context preview can never disagree about what a design generated.
 *  `large`/`auto` flag a mostly-Braille value for the Review card's larger
 *  type + "generated automatically" badge, mirroring the step group's own
 *  inset preview surface. */
export function displayInfoRows(rows: DisplayRow[]): ReviewRow[] {
  return rows.map((r, i) => ({
    key: `display:${i}:${r.step}:${r.label}`,
    label: r.label,
    value: r.value,
    large: isMostlyBraille(r.value),
    auto: true,
  }));
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

/**
 * The Review CARD's full row list (PR23's rebuilt Review stage): every
 * essential parameter's current value, then the design's own `@display`
 * rows, then `buildReviewRows`' own dimension/`@info`/computed rows, in that
 * fixed order — essential settings first (the exact fields a visitor just
 * set), the design's generated-content preview next, the physical facts
 * last. Distinct from `buildReviewRows` itself (kept unchanged, still used
 * standalone by nothing else today) so a future caller wanting the narrower
 * "physical facts only" list keeps that option.
 */
export function buildReviewSummaryRows(
  design: Design,
  values: Values,
  size: BoundingBoxSize | null,
  computed: ComputedInfo[],
  displayRows: DisplayRow[]
): ReviewRow[] {
  return [
    ...essentialParamRows(design, values),
    ...displayInfoRows(displayRows),
    ...buildReviewRows(design, values, size, computed),
  ];
}

/**
 * The guided-workflow (`ui.workflow: "guided"`) Review stage's CURATED
 * summary rows, sourced from `designs[].reviewLabels` (see docs/config.md
 * and gen-schema's typo-protected cross-check against the design's own
 * params). Distinct from `essentialParamRows` above (the tabs-mode Review
 * card's "every essential param" list): only params a deployment explicitly
 * curated show up here, in the order their label FIRST appears — round-6,
 * item 3: that's the order the params' own KEYS appear in the `reviewLabels`
 * OBJECT ITSELF (a deployment's declared curation order), not the order
 * those params happen to be declared in the design's `.scad` file. Those two
 * orders often disagree — e.g. a design might declare `language_standard`
 * before `text`, while a deployment wants "Visible lettering" (text) to lead
 * Review's summary regardless — and object-key order (not param-declaration
 * order) is what a config author actually controls when writing
 * `reviewLabels`, so it's the order Review should honour. Several params
 * sharing one label still merge into a SINGLE row (first-occurrence-in-
 * `reviewLabels` order), their formatted values joined by `" / "`. A param
 * whose value isn't worth a row (formatEssentialValue returns null — an
 * empty string) or that's currently hidden by `@showIf` contributes nothing
 * to its label's row, matching the other row builders' own "no value, no
 * row" rule. Returns [] when `reviewLabels` is unset — Review still shows
 * the plain dimension/`@info` rows via `buildReviewRows`.
 *
 * `reviewOverrides` (src/lib/reviewOverrides.ts's `echo("@review", param,
 * value)` map) lets a param's row show what the design actually RENDERED
 * instead of its raw stored value — e.g. a lettering profile that
 * uppercases free text: typed "Raum 101", printed "RAUM 101". When a param
 * has an override, that value is used verbatim (skipping
 * `formatEssentialValue` entirely, including its "empty string -> no row"
 * rule — an override is always author-supplied, never blank by accident).
 * Absent an override, a param's row is formatted exactly as before.
 */
export function buildCuratedReviewRows(
  design: Design,
  values: Values,
  reviewLabels: Record<string, string> | undefined,
  reviewOverrides?: Map<string, string>
): ReviewRow[] {
  if (!reviewLabels) return [];
  const order: string[] = [];
  const byLabel = new Map<string, string[]>();
  const paramByName = new Map(design.params.map((p) => [p.name, p]));
  for (const paramName of Object.keys(reviewLabels)) {
    const param = paramByName.get(paramName);
    if (!param) continue;
    const label = reviewLabels[paramName];
    if (!isVisible(param, values)) continue;
    const override = reviewOverrides?.get(paramName);
    const value = override !== undefined ? override : formatEssentialValue(param, values);
    if (value === null) continue;
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      order.push(label);
    }
    byLabel.get(label)!.push(value);
  }
  return order.map((label, i) => ({
    key: `curated:${i}:${label}`,
    label,
    value: byLabel.get(label)!.join(" / "),
  }));
}

/**
 * The guided-workflow Review stage's full row list: the curated summary
 * (`buildCuratedReviewRows`, from `designs[].reviewLabels` + any `@review`
 * overrides) plus exactly ONE plain row — the overall bounding-box
 * "Dimensions" headline, when a size is known — never the `@info`/computed
 * metric rows `buildReviewRows` also produces (dot diameter, cell spacing,
 * a duplicate letter-height, plate thickness, …): those stay available in
 * Messages/Technical details, but guided Review is curated-summary-plus-
 * overall-size only, short enough that the readiness state below it sits
 * above the fold on mobile. Deliberately EXCLUDES both `essentialParamRows`
 * (tabs-mode's "every essential param" list — guided Review only shows what
 * was explicitly curated) and `displayInfoRows` (a design's own `@display`/
 * Braille preview rows never belong in the guided Review screen, which is
 * verification-only) and never invents a colour row on its own.
 *
 * Round-6, item 3: Dimensions is inserted right BEFORE the last curated row
 * whenever there are 2+ of them, not appended after every curated row — a
 * deployment's `reviewLabels` order typically ends on a physical/placement
 * concern (e.g. "Mounting", "Arrow", "Button fit" — see the docs/config.md
 * examples), and Dimensions reads as one of that same physical-facts family,
 * so it belongs grouped alongside them rather than trailing the whole
 * curated block as an afterthought. A curated list of 0-1 rows has no
 * "before the last (OTHER) row" to speak of — Dimensions simply appends
 * there instead (identical to the old, pre-round-6 behaviour, and to how a
 * single curated row + Dimensions reads best: the one thing the visitor
 * curated, then the overall size).
 */
export function buildGuidedReviewRows(
  design: Design,
  values: Values,
  reviewLabels: Record<string, string> | undefined,
  size: BoundingBoxSize | null,
  reviewOverrides?: Map<string, string>
): ReviewRow[] {
  const rows = buildCuratedReviewRows(design, values, reviewLabels, reviewOverrides);
  if (size) {
    const dimensionsRow: ReviewRow = {
      key: "dimensions",
      label: t("dimensions.heading"),
      value: formatBoundingBox(size),
      headline: true,
    };
    const insertAt = rows.length > 1 ? rows.length - 1 : rows.length;
    rows.splice(insertAt, 0, dimensionsRow);
  }
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
