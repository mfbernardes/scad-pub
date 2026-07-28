// essentials.ts — the pure derivation behind the "Show all settings"/"Show
// essential settings" toggle (EssentialsToggle.tsx, rendered at the end of
// ParamForm in both layouts). Params marked `// @advanced` (see
// docs/annotations.md) are hidden while the toggle reads "Show essential
// settings"; the count below tells the visitor how many are currently behind
// it — "Show all settings (12 more)" — instead of leaving them to guess.
//
// That count is also the toggle's own render gate, which is why this module is
// one function and not two: a zero means the control would do nothing if
// pressed, so it doesn't render, so there is no zero-count label left to
// build. (There used to be an `essentialsToggleLabel` here whose job was
// wording that case as a plain, count-less "Show all settings" — a label for a
// button that revealed nothing.)
import type { Param } from "../openscad/types";
import type { Values } from "./presets";
import { isVisible } from "./visibility";

/**
 * The number of `@advanced` params the essentials toggle is currently
 * hiding: advanced AND visible under their own `@showIf` for the current
 * `values` (a param a `@showIf` already hides isn't "one more setting" the
 * toggle would reveal — it wouldn't show up either way).
 *
 * With `showAdvanced` on, the same number is instead how many advanced params
 * are on screen — i.e. how many "Show essential settings" would take away.
 * Either way, zero means the toggle has no work to do; see EssentialsToggle.
 */
export function hiddenAdvancedCount(params: Param[], values: Values): number {
  let n = 0;
  for (const p of params) {
    if (p.advanced && isVisible(p, values)) n++;
  }
  return n;
}
