// readiness.ts — pure derivation of "attention" items: real, verifiable gaps
// between a render that SUCCEEDED and a render that's actually production-
// ready. A design can render successfully while its selected font family
// isn't loaded — Fontconfig silently substitutes a fallback, dimensions/
// spacing can shift, yet nothing about the render itself failed. "Rendered"
// and "ready to ship" are NOT the same claim; this module is what tells them
// apart. AppShell.tsx is the sole caller: it feeds deriveAttention a font-param
// scan, config `notices[]` categories (via badges + noticeAttentionInputs),
// and any attention-flagged OpenSCAD diagnostic (a bare WARNING:/assert
// failure — see DeriveAttentionInputs' `diagnostics` field) that isn't already
// one of those notice categories, then threads the structured result to the
// status strip, the export dock, and ReviewDialog's attention cards
// (AttentionItems.tsx) — see docs/config.md's "Attention notices join OpenSCAD
// warnings, assertions, and missing fonts in the pre-download review dialog"
// contract. Pure functions, no React.
import type { Param } from "../openscad/types";
import type { Values } from "./presets";
import { familyOf, normalizeFamily } from "./fonts";
import { isVisible } from "./visibility";

/**
 * A `font` parameter whose selected family isn't in the loaded set —
 * `type is string|enum && isFont`. An empty font value (a cleared control)
 * never counts as missing, and neither does any family when
 * `availableFontFamilies` is empty (we can't be authoritative about
 * availability without it, so we don't warn).
 */
export interface FontFallbackItem {
  kind: "font-fallback";
  /** The parameter's name — a future caller's `focusParam`-style hook target. */
  param: string;
  /** The missing family, as typed/selected (not normalised) — for display. */
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
 * category — i.e. one of diagnostics.ts's hardcoded, non-configurable rules:
 * a bare `WARNING:` line, or an `assert()` failure's raw text
 * (`Diagnostic.level` "warning"/"assert", both always `attention: true`).
 * Restores the pre-Phase-2 contract (docs/config.md: "Attention notices join
 * OpenSCAD warnings, assertions, and missing fonts in the pre-download review
 * dialog") now that attention is a structured list rather than a flat string
 * dump — see `DeriveAttentionInputs.diagnostics` for how a caller supplies
 * these without double-counting a config-notice-category diagnostic (`level:
 * "notice"`), which is already represented as a `NoticeAttentionItem` above.
 */
export interface DiagnosticAttentionItem {
  kind: "diagnostic";
  /** The diagnostic's own text (diagnostics.ts's `Diagnostic.text`), shown
   *  verbatim — a bare warning's message, or an assert's raw failure text. */
  text: string;
}

export type AttentionItem = FontFallbackItem | NoticeAttentionItem | DiagnosticAttentionItem;

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
  /** Optional singular form of `label` (see `NoticeCategory.labelOne`) —
   *  used in place of `label` whenever `count` is exactly 1, so a single
   *  pending notice never reads as "1 alerts". */
  labelOne?: string;
  attention: boolean;
  count: number;
}

/**
 * One attention-flagged diagnostic to surface as a `DiagnosticAttentionItem`
 * — see that type's doc for what qualifies (a bare warning/assert, never a
 * config-notice-category diagnostic).
 */
export interface DiagnosticAttentionInput {
  text: string;
}

export interface DeriveAttentionInputs {
  /** The active design's full parameter list (unfiltered by section/view) —
   *  same list ParamForm derives its sections from. */
  params: Param[];
  values: Values;
  /**
   * Normalised (see `normalizeFamily`) family names the renderer can
   * actually use right now — bundled ∪ imported, the same set ParamForm's
   * contextual warning card checks font params against. Empty -> no font
   * checking (we can't be authoritative about availability without it, so
   * we don't warn — same rule ParamForm follows).
   */
  availableFontFamilies: Set<string>;
  /** Notice categories with their live pending counts this render. */
  notices: NoticeAttentionInput[];
  /**
   * Attention-flagged OpenSCAD diagnostics that are NOT already one of the
   * `notices` categories above — i.e. diagnostics.ts's Diagnostic list
   * filtered to `attention === true && level !== "notice"` (a `level:
   * "notice"` diagnostic IS a config notice category and is already covered
   * by `notices`; including it again here would double-count it). The caller
   * (AppShell) also excludes a currently-FAILED render's own diagnostics —
   * see its own comment: those are already explained by the Review dialog's
   * friendly-failure card, so repeating them as attention items would just
   * show the same message twice. Defaults to none, so existing callers/tests
   * that don't pass it are unaffected.
   */
  diagnostics?: DiagnosticAttentionInput[];
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
 * log order), then flagged notices (in config order) — deterministic, no
 * randomness.
 */
export function deriveAttention(inputs: DeriveAttentionInputs): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const p of inputs.params) {
    if ((p.type !== "string" && p.type !== "enum") || !p.isFont) continue;
    if (!isVisible(p, inputs.values)) continue;
    const value = String(inputs.values[p.name] ?? "");
    const family = familyOf(value);
    if (!family) continue; // a cleared control, not a missing font
    if (!inputs.availableFontFamilies.size) continue;
    if (inputs.availableFontFamilies.has(normalizeFamily(family))) continue;
    items.push({ kind: "font-fallback", param: p.name, family });
  }
  for (const d of inputs.diagnostics ?? []) {
    items.push({ kind: "diagnostic", text: d.text });
  }
  for (const n of inputs.notices) {
    if (!n.attention || n.count <= 0) continue;
    const label = n.count === 1 && n.labelOne ? n.labelOne : n.label;
    items.push({ kind: "notice", marker: n.marker, label, count: n.count });
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
 * flag the same way).
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
