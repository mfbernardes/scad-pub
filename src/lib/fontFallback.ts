// fontFallback.ts — a one-click replacement font whose family the renderer
// can actually use, shared by ParamForm's inline missing-font hint and
// AttentionItems' review-surface warning card (see readiness.ts's
// FontFallbackItem) so both compute the exact same suggestion for the exact
// same param. Extracted from ParamForm.tsx, which used to keep this private.
import type { Param } from "../openscad/types";
import { familyOf, normalizeFamily, withFamily } from "./fonts";

export interface FontFallback {
  value: string;
  label: string;
}

/**
 * A one-click replacement whose family is loaded, or null when none fits. For
 * an enum the result must be a listed choice (the dropdown can't show an
 * off-list value), so pick the first choice whose family is available; for
 * free text, graft the suggested bundled family onto the current value.
 */
export function fontFallback(
  param: Param,
  value: string,
  available: Set<string> | undefined,
  suggestion: string | null | undefined
): FontFallback | null {
  if (param.type === "enum") {
    const choice = param.choices.find((c) =>
      available?.has(normalizeFamily(familyOf(c.value)))
    );
    return choice ? { value: choice.value, label: familyOf(choice.value) } : null;
  }
  if (suggestion && normalizeFamily(suggestion) !== normalizeFamily(familyOf(value)))
    return { value: withFamily(value, suggestion), label: suggestion };
  return null;
}
