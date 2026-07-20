// readiness.ts — pure derivation of "attention" items: real, verifiable gaps
// between a render that SUCCEEDED and a render that's actually production-
// ready. A design can render successfully while its selected font family
// isn't loaded — Fontconfig silently substitutes a fallback, dimensions/
// spacing can shift, yet nothing about the render itself failed. "Rendered"
// and "ready to ship" are NOT the same claim; this module is what tells them
// apart, feeding both the checklist's "Preview" row (checklist.ts) and the
// warning-card surfaces (AttentionItems.tsx) / export-button indicator
// (ActionButtons.tsx). Mirrors checklist.ts's own
// "STATUS, NOT THEATER" discipline: every item keys off real, checkable
// state, never an assumption.
import type { Param } from "../openscad/types";
import type { Values } from "./presets";
import { familyOf } from "./fonts";
import { fontFallback, isFontMissing } from "./fontChoices";
import { noticeLabel } from "./diagnostics";
import { isVisible } from "./visibility";

/**
 * A `font` parameter whose selected family isn't in the loaded set — `type is
 * string|enum && isFont`, checked via fontChoices.ts's shared `isFontMissing`
 * predicate (also used by ParamRows' own contextual warning card, see its
 * `missingFont`), so every warning-card surface can never disagree about what
 * counts as "missing" — including all agreeing that an EMPTY font value (a
 * cleared control) never counts, even if `availableFontFamilies` is
 * non-empty.
 */
export interface FontFallbackItem {
  kind: "font-fallback";
  /** The parameter's name — the `data-param` hook target `focusParam` scrolls to. */
  param: string;
  /** The missing family, as typed/selected (not normalised) — for display. */
  family: string;
  /**
   * A one-click loaded-family replacement for this param, or null when none
   * fits (e.g. an enum with no loaded choice) — the exact target
   * fontChoices.ts's `fontFallback` computes, the same function ParamRows'
   * contextual warning card uses. Powers every warning-card surface's own
   * "Use a bundled font" action (AttentionItems.tsx); absent this, that
   * action is simply omitted.
   */
  fallback: { value: string; label: string } | null;
}

/** A pending notice in a config category flagged `attention: true` (see
 *  `NoticeCategory.attention` in src/openscad/types.ts and docs/config.md's
 *  Notice badges section). Excluded from the attention LIST/COUNT (but still
 *  visible in Messages/Technical details) when its category is flagged
 *  `subsumedByFont` and a font-fallback item is also present this render —
 *  see `deriveAttention`'s own doc. */
export interface NoticeAttentionItem {
  kind: "notice";
  marker: string;
  label: string;
  count: number;
}

export type AttentionItem = FontFallbackItem | NoticeAttentionItem;

/**
 * One notice category's live pending count this render, alongside its
 * config-declared `attention` flag. The caller (AppShell) already computes
 * per-category counts via diagnostics.ts's `countBadges`; this just pairs
 * that count with the flag so `deriveAttention` can decide which categories
 * matter, without reaching back into the raw log itself.
 */
export interface NoticeAttentionInput {
  marker: string;
  label: string;
  /** Optional singular form of `label` (see NoticeCategory.labelOne) —
   *  resolved against `count` via diagnostics.ts's `noticeLabel` so the
   *  produced item's own `label` is already display-ready. */
  labelOne?: string;
  attention: boolean;
  count: number;
  /**
   * Config's `notices[].subsumedByFont` (see docs/config.md's Notice badges
   * section): this category's own attention item is a SYMPTOM of a missing
   * font (e.g. a "text is tall and may overflow" advisory that only fires
   * because a substitute font's metrics differ from the intended one), not a
   * distinct, independently-actionable problem. `deriveAttention` drops it
   * from the returned list — and therefore from every count that sums that
   * list — whenever a font-fallback item is ALSO present this render, so
   * fixing the one real cause (the missing font) doesn't still read as "2
   * issues". Default false/undefined: a category with no explicit
   * `subsumedByFont` always counts as its own distinct issue, exactly as
   * before this field existed.
   */
  subsumedByFont?: boolean;
}

export interface DeriveAttentionInputs {
  /** The active design's full parameter list (unfiltered by section/view) —
   *  same list ParamForm derives its sections from. */
  params: Param[];
  values: Values;
  /**
   * Normalised (see `normalizeFamily`) family names the renderer can
   * actually use right now — bundled ∪ imported, the same set ParamRows'
   * contextual warning card checks font params against. Empty -> no font
   * checking (we can't be authoritative about availability without it, so
   * we don't warn — same rule ParamRows follows).
   */
  availableFontFamilies: Set<string>;
  /** A bundled family to offer as a one-click fallback — the same value
   *  ParamRows' contextual warning card uses (AppShell's `fontSuggestion`). Feeds
   *  each font-fallback item's own `fallback` target. */
  fontSuggestion?: string | null;
  /** Notice categories with their live pending counts this render. */
  notices: NoticeAttentionInput[];
}

/**
 * The visible-in-design font params whose selected family isn't loaded, plus
 * any flagged notice category with a pending notice this render.
 *
 * "Visible-in-design" means `@showIf`-visible (`isVisible`), deliberately NOT
 * filtered by the essentials/all settings view: a parameter demoted to "all
 * settings" still keeps its stored value and is still sent to OpenSCAD
 * unchanged (see paramFilter.ts's own doc), so a font fallback hiding behind
 * "all settings" is just as real a production-readiness gap as one in plain
 * view — and it's exactly the case the Review stage's "switch to All
 * settings, then focus" action exists for.
 *
 * Order: font fallbacks first (in design param order), then flagged notices
 * (in config order) — deterministic, no randomness.
 *
 * THREE-TIER HONESTY (subsumedByFont): a notice category can be flagged
 * `subsumedByFont` (config's `notices[].subsumedByFont`) to mark it a
 * SYMPTOM of a missing font rather than its own distinct, actionable
 * problem — e.g. a "text may overflow" advisory that only fires because a
 * substitute font's metrics differ from the intended one. Whenever a font-
 * fallback item is ALSO present this render AND there's no ambiguity about
 * WHICH font the notice actually relates to, such a category's own pending
 * notice is excluded from the returned list (and therefore from every
 * count/badge that sums it) — fixing the one real cause reads as "1 issue",
 * not "2". The moment no font-fallback exists (the font resolved, or there
 * was never a font problem), a `subsumedByFont` category's pending notice
 * counts exactly like any other flagged category — a genuine problem with a
 * LOADED font still surfaces. The excluded notice is never hidden entirely:
 * it's still parsed into `diagnostics.ts`'s raw list, so Messages/Technical
 * details still shows it — only the CURATED list/count this function
 * returns treats it as non-distinct.
 *
 * UNAMBIGUOUS-SINGLE-FONT GUARD: a design with two-or-more `@font` params
 * can have one font resolved and a DIFFERENT one missing — subsuming the
 * notice in that case would hide a real gap about the resolved font behind
 * an unrelated one's fallback. So the subsumption above only fires when
 * there's no such ambiguity: either the design declares exactly one
 * font-bearing param (there's only ever one font a notice COULD be about),
 * or exactly one font-fallback item was actually produced this render (only
 * one candidate font the notice could be blamed on, even if the design
 * declares more). Either condition alone is sufficient — see
 * `fontParamCount`/`items.length` below. A design with 2+ font params AND
 * 2+ simultaneous fallback items never subsumes; the notice counts as its
 * own distinct issue, same as a category with no `subsumedByFont` at all.
 */
export function deriveAttention(inputs: DeriveAttentionInputs): AttentionItem[] {
  const fontParamCount = inputs.params.filter(
    (p) => (p.type === "string" || p.type === "enum") && p.isFont
  ).length;
  const items: AttentionItem[] = [];
  for (const p of inputs.params) {
    if ((p.type !== "string" && p.type !== "enum") || !p.isFont) continue;
    if (!isVisible(p, inputs.values)) continue;
    const value = String(inputs.values[p.name] ?? "");
    if (!isFontMissing(value, inputs.availableFontFamilies)) continue;
    items.push({
      kind: "font-fallback",
      param: p.name,
      family: familyOf(value),
      fallback: fontFallback(p, value, inputs.availableFontFamilies, inputs.fontSuggestion),
    });
  }
  const hasFontFallback = items.length > 0;
  // See "UNAMBIGUOUS-SINGLE-FONT GUARD" above: subsumption only applies when
  // there's no question which font a subsumed notice is actually about.
  const unambiguousFontFallback = fontParamCount === 1 || items.length === 1;
  for (const n of inputs.notices) {
    if (!n.attention || n.count <= 0) continue;
    if (hasFontFallback && n.subsumedByFont && unambiguousFontFallback) continue;
    items.push({
      kind: "notice",
      marker: n.marker,
      label: noticeLabel(n.label, n.count, n.labelOne),
      count: n.count,
    });
  }
  return items;
}

export type ReadinessState = "building" | "failed" | "attention" | "ready";

/**
 * Overall readiness from a render outcome + its attention items.
 *
 * `renderOk` mirrors the render pipeline's own tri-state: `true` (succeeded),
 * `false` (failed), or `null` (nothing has landed yet — still bootstrapping
 * or mid-render; callers combine this with their own "currently rendering"
 * flag the same way, e.g. checklist.ts's preview row already special-cases
 * `rendering` before falling back to `resultOk`).
 *
 * Precedence — failed > attention > ready: a failed render always wins
 * (there is nothing to be "ready" about); otherwise any attention item
 * downgrades an otherwise-successful render from "ready" to "attention" —
 * it rendered, but not necessarily what the controls actually say.
 */
export function readinessState(renderOk: boolean | null, attention: AttentionItem[]): ReadinessState {
  if (renderOk === null) return "building";
  if (renderOk === false) return "failed";
  return attention.length > 0 ? "attention" : "ready";
}

/**
 * Round-6, item 5: the count of GENUINE notice cards among `attention` — the
 * `kind: "notice"` items (a config `notices[]` category flagged
 * `attention: true` with a pending count this render), never `kind:
 * "font-fallback"` items. A font fallback is a READINESS gap, not a design
 * NOTICE: it already has its own carrier in guided workflow (the Review
 * chip's amber dot, the contextual card in Appearance, and Review's own full
 * issue card — see ActionButtons.tsx's `hasAttention` doc), so folding it
 * into a "how many notices" count double-counts the same problem through two
 * different vocabularies and, worse, can show a non-zero notice count next to
 * a Notices panel that has no actual notice CARD to match it (a font-only
 * gap still renders its own attention card via AttentionItems, but under the
 * "attention"/readiness umbrella, not "notice"). This is the single source
 * AppShell's guided header-bell badge count reads — GuidedMobileHeader
 * (mobile) and CommandBar (desktop) never re-derive it independently, so the
 * two layouts can't disagree about what counts as a "notice".
 */
export function noticeAttentionCount(attention: AttentionItem[]): number {
  return attention.reduce((n, a) => n + (a.kind === "notice" ? 1 : 0), 0);
}
