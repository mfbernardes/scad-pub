// essentials.ts — pure derivation behind the "Show all settings"/"Show
// essential settings" toggle (EssentialsToggle.tsx, rendered at the end of
// ParamForm in both layouts). Params marked
// `// @advanced` (see docs/annotations.md) are hidden while the toggle reads
// "Show essential settings"; the count this module derives tells the visitor
// how many are currently behind it — "Show all settings (12 more)" — instead
// of leaving them to guess.
import type { Param } from "../openscad/types";
import type { Values } from "./presets";
import { isVisible } from "./visibility";
import { t, tn } from "./i18n";

/**
 * The number of `@advanced` params the essentials toggle is currently
 * hiding: advanced AND visible under their own `@showIf` for the current
 * `values` (a param a `@showIf` already hides isn't "one more setting" the
 * toggle would reveal — it wouldn't show up either way).
 */
export function hiddenAdvancedCount(params: Param[], values: Values): number {
  let n = 0;
  for (const p of params) {
    if (p.advanced && isVisible(p, values)) n++;
  }
  return n;
}

/**
 * The essentials toggle's REVEAL-side label (EssentialsToggle.tsx): "Show all
 * settings (N more)" when `@advanced` params are currently hidden, the plain
 * "Show all settings" when the count is zero. The hide side's label
 * (`settings.showEssential`) stays in the caller since it's unconditional.
 *
 * One wording, both layouts. The abbreviated variant ("+N more" / "All
 * settings") existed only for the mobile toolbar chip; the toggle is a
 * full-width row at the end of the form now, which has room for the sentence
 * that actually says what the control does.
 */
export function essentialsToggleLabel(params: Param[], values: Values): string {
  const hiddenCount = hiddenAdvancedCount(params, values);
  if (hiddenCount === 0) return t("settings.showAll");
  return tn("settings.showAllCount", hiddenCount);
}
