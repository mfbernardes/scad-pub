// essentials.ts — pure derivation behind the "Show all settings"/"Show
// essential settings" toggle (ParamPanel.tsx, SheetTabs.tsx). Params marked
// `// @advanced` (see docs/annotations.md) are hidden while the toggle reads
// "Show essential settings"; the count this module derives tells the visitor
// how many are currently behind it — "Show all settings (12 more)" — instead
// of leaving them to guess.
import type { Param } from "../openscad/types";
import type { Values } from "./presets";
import { isVisible } from "./visibility";

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
