// readiness.ts — pure derivation of "attention" items: real, verifiable gaps
// between a render that SUCCEEDED and a render that's actually production-
// ready. A design can render successfully while its selected font family
// isn't loaded — Fontconfig silently substitutes a fallback, dimensions/
// spacing can shift, yet nothing about the render itself failed. "Rendered"
// and "ready to ship" are NOT the same claim; this module is what tells them
// apart, feeding both the checklist's "Preview" row (checklist.ts) and the
// Customize tab's attention chip / export-button indicator (CustomizeTab.tsx
// / ActionButtons.tsx). Mirrors checklist.ts's own "STATUS, NOT THEATER"
// discipline: every item keys off real, checkable state, never an assumption.
import type { Param } from "../openscad/types";
import type { Values } from "./presets";
import { familyOf, normalizeFamily } from "./fonts";
import { isVisible } from "./visibility";

/**
 * A `font` parameter whose selected family isn't in the loaded set — the
 * exact predicate ParamRows' own inline FontMissingHint uses (see
 * `missingFont` there: `type is string|enum && isFont`, compared by
 * normalised family against the authoritative available set). Reused here
 * rather than reinvented, so the chip and the inline hint can never disagree
 * about what counts as "missing".
 */
export interface FontFallbackItem {
  kind: "font-fallback";
  /** The parameter's name — the `data-param` hook target `focusParam` scrolls to. */
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
   * actually use right now — bundled ∪ imported, the same set ParamRows'
   * FontMissingHint checks font params against. Empty -> no font checking
   * (we can't be authoritative about availability without it, so we don't
   * warn — same rule ParamRows follows).
   */
  availableFontFamilies: Set<string>;
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
 * view — and it's exactly the case the attention chip's "switch to All
 * settings, then focus" action exists for.
 *
 * Order: font fallbacks first (in design param order), then flagged notices
 * (in config order) — deterministic, no randomness.
 */
export function deriveAttention(inputs: DeriveAttentionInputs): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (inputs.availableFontFamilies.size) {
    for (const p of inputs.params) {
      if ((p.type !== "string" && p.type !== "enum") || !p.isFont) continue;
      if (!isVisible(p, inputs.values)) continue;
      const value = String(inputs.values[p.name] ?? "");
      const family = familyOf(value);
      if (!family) continue;
      if (!inputs.availableFontFamilies.has(normalizeFamily(family))) {
        items.push({ kind: "font-fallback", param: p.name, family });
      }
    }
  }
  for (const n of inputs.notices) {
    if (n.attention && n.count > 0) {
      items.push({ kind: "notice", marker: n.marker, label: n.label, count: n.count });
    }
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
