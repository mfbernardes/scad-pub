// fontChoices.ts — builds the option list for the font selector (FontSelect)
// from what's actually installed. Pure data-in/data-out so the grouping,
// value-preservation and dedupe rules are unit-testable without React.
//
// The selector shows every face the renderer can really use (bundled ∪
// imported) under friendly names ("Liberation Sans Bold"), plus — kept
// selectable but clearly marked — any design-suggested face (enum choice) or
// currently-selected value that is NOT loaded, so a preset naming an
// unavailable font still shows what it wants and the missing-font hint can
// offer the fix (import it, or fall back).
import type { Param } from "../openscad/types";
import {
  faceKeyOf,
  familyOf,
  fontLabelOf,
  fontValueOf,
  normalizeFamily,
  styleOf,
  withFamily,
  type InstalledFont,
} from "./fonts";

/** One selectable entry of the font dropdown. */
export interface FontChoice {
  /** The OpenSCAD `font` value this entry writes (and matches) — never shown. */
  value: string;
  /** Friendly display name ("Liberation Sans Bold"). */
  label: string;
  /** Whether the renderer can use this face right now. */
  installed: boolean;
  /** For an installed face: whether it came from a user import. */
  imported?: boolean;
}

export interface FontChoiceGroups {
  /** Faces the renderer can use, in display order. */
  installed: FontChoice[];
  /** Design-suggested or currently-selected faces that are not loaded. */
  missing: FontChoice[];
}

/** Identity key of a `font` value (family + style, `"Foo"` ≡ `"Foo:style=Regular"`). */
function keyOfValue(value: string): string {
  return faceKeyOf(familyOf(value), styleOf(value));
}

/** Friendly display name of an arbitrary `font` value. */
export function fontValueLabel(value: string): string {
  return fontLabelOf(familyOf(value), styleOf(value));
}

/**
 * The grouped option list for a font parameter.
 *
 * Value preservation: an installed face's entry reuses the exact stored value
 * when the selection already names that face (so showing the list never dirties
 * the value), and an enum choice's exact value when one names it (so presets
 * and the desktop Customizer keep matching); only otherwise does it use the
 * canonical `Family[:style=Style]` form.
 */
export function buildFontChoices(
  param: Param,
  value: string,
  fonts: InstalledFont[]
): FontChoiceGroups {
  const enumChoices = param.type === "enum" ? param.choices : [];
  const valueKey = value.trim() ? keyOfValue(value) : null;

  const installedKeys = new Set<string>();
  const installed: FontChoice[] = fonts.map((face) => {
    const key = faceKeyOf(face.family, face.style);
    installedKeys.add(key);
    const enumMatch = enumChoices.find((c) => keyOfValue(c.value) === key);
    return {
      value: key === valueKey ? value : enumMatch ? enumMatch.value : fontValueOf(face),
      label: fontLabelOf(face.family, face.style),
      installed: true,
      imported: face.imported,
    };
  });

  // Design-suggested faces that aren't loaded, in the design's own order.
  const missing: FontChoice[] = [];
  const missingKeys = new Set<string>();
  for (const c of enumChoices) {
    const key = keyOfValue(c.value);
    if (installedKeys.has(key) || missingKeys.has(key)) continue;
    missingKeys.add(key);
    missing.push({
      value: key === valueKey ? value : c.value,
      label: fontValueLabel(c.value),
      installed: false,
    });
  }

  // The current selection always stays visible, even when nothing else lists
  // it (e.g. a free-typed family or a preset naming an off-list font).
  if (valueKey && !installedKeys.has(valueKey) && !missingKeys.has(valueKey))
    missing.push({ value, label: fontValueLabel(value), installed: false });

  return { installed, missing };
}

/**
 * Whether a `font` parameter's value names a family that isn't in the loaded
 * set — the "font not loaded" predicate shared by ParamRows' inline
 * FontMissingHint and readiness.ts's deriveAttention (the consolidated
 * attention chip / Review stage), so the two can never disagree about what
 * counts as missing.
 *
 * Two guards, both required: an authoritative, non-empty `available` set (we
 * can't warn about availability without one — the same "empty/undefined ->
 * no checking" rule every caller already followed), AND a non-empty family in
 * `value` — an EMPTY font field is a cleared control, not a font that failed
 * to load, so it never counts as missing regardless of what `available`
 * contains.
 */
export function isFontMissing(value: string, available: Set<string> | undefined): boolean {
  if (!available?.size) return false;
  const family = familyOf(value);
  if (!family) return false;
  return !available.has(normalizeFamily(family));
}

/**
 * A one-click replacement whose family is loaded, or null when none fits.
 * The exact logic ParamRows' inline FontMissingHint offers under a missing
 * font control (see its own `fallback` prop) — shared here so the
 * consolidated attention chip / Review stage's own "Use a bundled font"
 * action (src/lib/readiness.ts's deriveAttention) can never disagree with
 * the inline hint about what counts as a valid fallback.
 *
 * For an enum, the result must be a listed choice (the dropdown can't show
 * an off-list value), so this picks the first choice whose family is
 * available; for free text, it grafts the suggested bundled family onto the
 * current value (preserving any `:style=…` properties already present).
 */
export function fontFallback(
  param: Param,
  value: string,
  available: Set<string> | undefined,
  suggestion: string | null | undefined
): { value: string; label: string } | null {
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
