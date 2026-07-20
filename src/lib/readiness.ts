// readiness.ts — pure derivation of "attention" items: real, verifiable gaps
// between a render that SUCCEEDED and a render that's actually production-
// ready. A design can render successfully while its selected font family
// isn't loaded — Fontconfig silently substitutes a fallback, dimensions/
// spacing can shift, yet nothing about the render itself failed. "Rendered"
// and "ready to ship" are NOT the same claim; this module is what tells them
// apart. It's a structured extraction of the flat message list AppShell.tsx
// currently builds inline (its own `attentionIssues` memo, which feeds
// ActionButtons' pre-download review dialog) — a future caller can use this
// to render distinct font/notice affordances instead of a plain string list.
// AppShell itself is not rewired to consume this yet. Pure functions, no
// React.
import type { Param } from "../openscad/types";
import type { Values } from "./presets";
import { familyOf, normalizeFamily } from "./fonts";
import { isVisible } from "./visibility";

/**
 * A `font` parameter whose selected family isn't in the loaded set —
 * `type is string|enum && isFont`, mirroring the check AppShell.tsx's
 * `attentionIssues` memo already does. An empty font value (a cleared
 * control) never counts as missing, and neither does any family when
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
  /** Optional singular form of `label` (see `NoticeCategory.labelOne`) —
   *  used in place of `label` whenever `count` is exactly 1, so a single
   *  pending notice never reads as "1 alerts". */
  labelOne?: string;
  attention: boolean;
  count: number;
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
}

/**
 * The visible-in-design font params whose selected family isn't loaded, plus
 * any flagged notice category with a pending notice this render.
 *
 * "Visible-in-design" means `@showIf`-visible (`isVisible`): a hidden
 * control's value is still sent to OpenSCAD unchanged, but it's not
 * something a visitor can currently see or act on, so it doesn't clutter the
 * attention list.
 *
 * Order: font fallbacks first (in design param order), then flagged notices
 * (in config order) — deterministic, no randomness.
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

/**
 * The count of GENUINE notice cards among `attention` — the `kind: "notice"`
 * items (a config `notices[]` category flagged `attention: true` with a
 * pending count this render), never `kind: "font-fallback"` items. A font
 * fallback is a readiness gap, not a design notice, so folding it into "how
 * many notices" double-counts the same problem through two different
 * vocabularies. A future notice-count badge should read this instead of
 * re-deriving its own count from `attention`.
 */
export function noticeAttentionCount(attention: AttentionItem[]): number {
  return attention.reduce((n, a) => n + (a.kind === "notice" ? 1 : 0), 0);
}
