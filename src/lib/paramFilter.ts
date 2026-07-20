// paramFilter.ts — the essentials/all "settings view" filter (see
// src/lib/useExperience.ts). `isShown` composes with `@showIf` visibility
// (src/lib/visibility.ts) under the exact same UI-only contract: a param
// hidden by the view keeps its value and is still sent to OpenSCAD unchanged,
// exactly like a `@showIf`-hidden one. The helpers here answer the two
// questions the Customize tab's chrome needs — "how many params are hidden
// right now because of the view" and "of those, how many carry a non-default
// value" — by reusing src/lib/paramDiff.ts's comparison semantics rather than
// re-implementing value-equality.
import type { Param } from "../openscad/types";
import type { Values } from "./presets";
import type { SettingsView } from "./useExperience";
import { isVisible } from "./visibility";
import { changedParams } from "./paramDiff";

/** Whether a parameter's control should be shown: visible per `@showIf` AND
 *  (the view is "all", or the parameter isn't `@advanced`). Same UI-only
 *  contract as `isVisible` alone — a filtered-out parameter's value is
 *  unchanged and still sent to OpenSCAD. */
export function isShown(p: Param, values: Values, view: SettingsView): boolean {
  return isVisible(p, values) && (view === "all" || !p.advanced);
}

/**
 * The params hidden *because of* the essentials view: visible under "all"
 * (i.e. `@showIf`-visible) but demoted by `@advanced` — so `isShown` is false
 * only for the view's sake, not because a `@showIf` condition also hides it.
 * Always empty in the "all" view (nothing is hidden by the view there).
 */
export function hiddenAdvancedParams(params: Param[], values: Values, view: SettingsView): Param[] {
  if (view === "all") return [];
  return params.filter((p) => p.advanced && isVisible(p, values));
}

/** Count of `hiddenAdvancedParams` — the number badge the Customize tab's
 *  bottom summary and toggle-adjacent copy need. */
export function hiddenAdvancedCount(params: Param[], values: Values, view: SettingsView): number {
  return hiddenAdvancedParams(params, values, view).length;
}

/**
 * Of the params hidden by the view, the subset whose current value differs
 * from `defaults` — i.e. a change made (or inherited from a preset/share
 * link) that the essentials view is currently obscuring. Declaration order,
 * matching `changedParams`.
 */
export function hiddenAdvancedDiff(
  params: Param[],
  values: Values,
  defaults: Values,
  view: SettingsView
): Param[] {
  return changedParams(hiddenAdvancedParams(params, values, view), defaults, values);
}

/** Whether a parameter matches a lowercased search query — the same fields
 *  (variable name, label, full help text) ParamForm's own search filters on,
 *  factored out so the essentials-view "N hidden settings match — Show them"
 *  note counts by the identical rule the visible results use. `q` must
 *  already be lowercased (callers normalise it once, not per-param). */
export function paramMatchesQuery(p: Param, q: string): boolean {
  if (!q) return true;
  return (
    p.name.toLowerCase().includes(q) ||
    p.description.toLowerCase().includes(q) ||
    p.help.toLowerCase().includes(q)
  );
}

/**
 * Params hidden by the essentials view that would otherwise match a search
 * query — the set behind "N matching settings are in All settings". Always
 * empty in the "all" view or for an empty query.
 */
export function hiddenSearchMatches(
  params: Param[],
  values: Values,
  view: SettingsView,
  q: string
): Param[] {
  if (!q) return [];
  return hiddenAdvancedParams(params, values, view).filter((p) => paramMatchesQuery(p, q));
}
