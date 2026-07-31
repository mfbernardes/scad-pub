// readiness.ts: pure derivation of "attention" items: real, verifiable gaps
// between a render that SUCCEEDED and a render that's actually production-
// ready. A design can render successfully while its selected font family
// isn't loaded. Fontconfig silently substitutes a fallback, dimensions/
// spacing can shift, yet nothing about the render itself failed. "Rendered"
// and "ready to ship" are NOT the same claim; this module is what tells them
// apart. AppShell.tsx is the sole caller: it feeds deriveAttention a font-param
// scan, config `notices[]` categories (via badges + noticeAttentionInputs),
// and any attention-flagged OpenSCAD diagnostic (a bare WARNING:/assert
// failure, see DeriveAttentionInputs' `diagnostics` field) that isn't already
// one of those notice categories, then threads the structured result to the
// status strip, the export dock, and ReviewDialog's attention cards
// (AttentionItems.tsx), see docs/config.md's "Attention notices join OpenSCAD
// warnings, assertions, and missing fonts in the pre-download review dialog"
// contract. Pure functions, no React.
import type { Param } from "../openscad/types";
import type { Values } from "./presets";
import { familyOf, normalizeFamily } from "./fonts";
import { isVisible } from "./visibility";
import { selectPlural } from "./i18n";

/**
 * A `font` parameter whose selected family isn't in the loaded set:
 * `type is string|enum && isFont`. An empty font value (a cleared control)
 * never counts as missing, and neither does any family when
 * `availableFontFamilies` is empty (we can't be authoritative about
 * availability without it, so we don't warn).
 */
export interface FontFallbackItem {
  kind: "font-fallback";
  /** The parameter's name: AttentionItems.tsx uses it to look the param up,
   *  read its current value, and write the chosen fallback back. */
  param: string;
  /** The missing family, as typed/selected (not normalised), for display. */
  family: string;
}

/** A pending notice in a config category flagged `attention: true` (see
 *  `NoticeCategory.attention` in src/openscad/types.ts and docs/config.md's
 *  Notice badges section). */
export interface NoticeAttentionItem {
  kind: "notice";
  marker: string;
  label: string;
  count: number;
}

/**
 * An attention-flagged OpenSCAD diagnostic that ISN'T a config `notices[]`
 * category: i.e. one of diagnostics.ts's hardcoded, non-configurable rules:
 * a bare `WARNING:` line, or an `assert()` failure's raw text
 * (`Diagnostic.level` "warning"/"assert", both always `attention: true`).
 * See `DeriveAttentionInputs.diagnostics` for the contract a caller must
 * honour when supplying these.
 */
export interface DiagnosticAttentionItem {
  kind: "diagnostic";
  /** The diagnostic's own text (diagnostics.ts's `Diagnostic.text`), shown
   *  verbatim: a bare warning's message, or an assert's raw failure text. */
  text: string;
}

export type AttentionItem = FontFallbackItem | NoticeAttentionItem | DiagnosticAttentionItem;

/**
 * One notice category's live pending count this render, alongside its
 * config-declared `attention` flag. The caller (AppShell) already computes
 * per-category counts via diagnostics.ts's `countBadges`; this pairs
 * that count with the flag so `deriveAttention` can decide which categories
 * matter, without reaching back into the raw log itself.
 */
export interface NoticeAttentionInput {
  marker: string;
  /** Both CLDR forms (see `NoticeCategory.label`): resolved to the one this
   *  item's live `count` calls for via `selectPlural`, so a single pending
   *  notice never reads as "1 alerts". */
  label: { one: string; other: string };
  attention: boolean;
  count: number;
  /** Whether this category's notices are a SYMPTOM of a missing font rather
   *  than their own independently-actionable issue (see
   *  `NoticeCategory.subsumedByFont`). While a substitute font is active, and
   *  it's unambiguous which font param that is: a pending notice here is
   *  folded into the font-fallback item instead of listed separately. */
  subsumedByFont?: boolean;
}

export interface DeriveAttentionInputs {
  /** The active design's full parameter list (unfiltered by section/view):
   *  same list ParamForm derives its sections from. */
  params: Param[];
  values: Values;
  /**
   * Normalised (see `normalizeFamily`) family names the renderer can
   * actually use right now: bundled ∪ imported, the same set ParamForm's
   * contextual warning card checks font params against. Empty -> no font
   * checking (we can't be authoritative about availability without it, so
   * we don't warn: same rule ParamForm follows).
   */
  availableFontFamilies: Set<string>;
  /** Notice categories with their live pending counts this render. */
  notices: NoticeAttentionInput[];
  /**
   * The texts of attention-flagged OpenSCAD diagnostics that are NOT already
   * one of the `notices` categories above: i.e. diagnostics.ts's Diagnostic list
   * filtered to `attention === true && level !== "notice"` (a `level:
   * "notice"` diagnostic IS a config notice category and is already covered
   * by `notices`; including it again here would double-count it). The caller
   * (AppShell) also excludes a currently-FAILED render's own diagnostics,
   * see its own comment: those are already explained by the Review dialog's
   * friendly-failure card, so repeating them as attention items would only
   * show the same message twice. Defaults to none, so existing callers/tests
   * that don't pass it are unaffected.
   */
  diagnostics?: string[];
}

/**
 * The visible-in-design font params whose selected family isn't loaded,
 * attention-flagged OpenSCAD diagnostics (bare warnings/asserts) not already
 * covered by a notice category, and any flagged notice category with a
 * pending notice this render.
 *
 * "Visible-in-design" means `@showIf`-visible (`isVisible`): a hidden
 * control's value is still sent to OpenSCAD unchanged, but it's not
 * something a visitor can currently see or act on, so it doesn't clutter the
 * attention list.
 *
 * Order: font fallbacks first (in design param order), then diagnostics (in
 * log order), then flagged notices (in config order). Deterministic, no
 * randomness.
 *
 * A category flagged `subsumedByFont` is skipped entirely while a substitute
 * font is in play: its notices only exist BECAUSE the family isn't loaded, so
 * listing them beside the font-fallback item they're a symptom of would read
 * as two separate problems. The fold only applies when it's unambiguous which
 * font the notices are about: a design with several font params, several of
 * them simultaneously missing, keeps the notice listed on its own.
 */
export function deriveAttention(inputs: DeriveAttentionInputs): AttentionItem[] {
  const items: AttentionItem[] = [];
  // `fontFallbackCount` is the visible missing fonts: each one gets its own
  // attention card. `missingFontCount` is EVERY missing font, including
  // `@showIf`-hidden ones: a hidden control's value is still sent to OpenSCAD,
  // so a hidden missing font can be the real cause of a subsumable notice even
  // though it shows no card. Ambiguity is judged on the latter: otherwise a
  // notice caused by a second, hidden missing font would be folded away with no
  // card left to carry it.
  let fontFallbackCount = 0;
  let missingFontCount = 0;
  for (const p of inputs.params) {
    if ((p.type !== "string" && p.type !== "enum") || !p.isFont) continue;
    const value = String(inputs.values[p.name] ?? "");
    const family = familyOf(value);
    if (!family) continue; // a cleared control, not a missing font
    if (!inputs.availableFontFamilies.size) continue;
    if (inputs.availableFontFamilies.has(normalizeFamily(family))) continue;
    missingFontCount++;
    if (!isVisible(p, inputs.values)) continue; // counts toward ambiguity, but no card
    items.push({ kind: "font-fallback", param: p.name, family });
    fontFallbackCount++;
  }
  for (const text of inputs.diagnostics ?? []) {
    items.push({ kind: "diagnostic", text });
  }
  for (const n of inputs.notices) {
    if (!n.attention || n.count <= 0) continue;
    // Fold a symptom notice into the font-fallback item only when there's a
    // visible fallback to fold into (fontFallbackCount > 0) AND exactly one
    // font is missing overall (missingFontCount === 1), so it's unambiguous
    // which font the notice is about. 2+ missing fonts (visible or hidden)
    // leave it standing on its own.
    if (n.subsumedByFont && fontFallbackCount > 0 && missingFontCount === 1) continue;
    const label = selectPlural(n.count, n.label);
    items.push({ kind: "notice", marker: n.marker, label, count: n.count });
  }
  return items;
}

export type ReadinessState = "building" | "failed" | "attention" | "ready";

/**
 * Overall readiness from a render outcome + its attention items.
 *
 * `renderOk` mirrors the render pipeline's own tri-state: `true` (succeeded),
 * `false` (failed), or `null` (nothing has landed yet, still bootstrapping
 * or mid-render; callers combine this with their own "currently rendering"
 * flag the same way).
 *
 * Precedence: failed > attention > ready: a failed render always wins
 * (there is nothing to be "ready" about); otherwise any attention item
 * downgrades an otherwise-successful render from "ready" to "attention".
 * It rendered, but not necessarily what the controls actually say.
 */
export function readinessState(renderOk: boolean | null, attention: AttentionItem[]): ReadinessState {
  if (renderOk === null) return "building";
  if (renderOk === false) return "failed";
  return attention.length > 0 ? "attention" : "ready";
}
