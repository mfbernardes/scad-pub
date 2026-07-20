// displayRows.ts — turns a design's own `echo("@display", step, label,
// value)` convention into read-only "automatic preview" rows for QuickStart: a
// SEPARATE, purely-runtime mechanism modeled directly on computedInfo.ts's
// `echo("@info", …)` parser (see its own doc for the shared shape), but tied
// to a STEP rather than the measurements panel. Where `@info` feeds a
// figures list, `@display` feeds a generated-content preview a design wants
// to show right where a visitor is working on the input that produces it —
// e.g. the Braille cell pattern generated from a plain-text label, shown
// directly under that step's own parameter controls. No build-time
// component: gen-schema.mjs never sees this tag; the app only scans the
// worker's log for it after a render.
//
// Parses the fixed 4-arg `echo("@display", "<step>", "<label>", <value>)`
// convention via echoTags.ts's shared core (regex + quote-stripping) —
// mirrors computedInfo.ts's `echo("@info", …)` parser and
// reviewOverrides.ts's `echo("@review", …)` one, which share that same core;
// see echoTags.ts's own doc for the log-line shape all three have in common.
import { parseEchoTag, formatEchoValue } from "./echoTags";

export interface DisplayRow {
  /** The `@step` id this row belongs to (QuickStart.tsx's step.id / quickStart.ts's QuickStartStep.id) — NOT validated against the design's declared steps here; a row naming an unknown/no-longer-stepped id is simply never matched by displayRowsForStep and so never rendered. */
  step: string;
  label: string;
  /** Already formatted for display (quotes stripped, exactly as OpenSCAD printed a non-string value). */
  value: string;
}

/**
 * Extract `@display` rows from the raw OpenSCAD worker log. Unlike
 * computedInfo.ts's `@info` rows (never de-duplicated — a design's repeated
 * echo of the same label is preserved as two rows), `@display` rows key off
 * (step, label): a later echo for the SAME (step, label) pair overwrites an
 * earlier one — "last write wins" — since a design re-echoing its own
 * generated preview (e.g. from inside a loop, or a fallback branch after a
 * primary one) means "this is the current value", not "show it twice". Row
 * order follows first-occurrence order of each (step, label) pair, with the
 * winning (last) value.
 */
export function parseDisplayRows(log: string[]): DisplayRow[] {
  const map = new Map<string, DisplayRow>();
  for (const [step, label, rawValue] of parseEchoTag(log, "@display", 2)) {
    map.set(`${step} ${label}`, { step, label, value: formatEchoValue(rawValue) });
  }
  return [...map.values()];
}

/** Rows belonging to one step, in the order parseDisplayRows returned them. */
export function displayRowsForStep(rows: DisplayRow[], stepId: string): DisplayRow[] {
  return rows.filter((r) => r.step === stepId);
}

// Unicode Braille Patterns block (U+2800–U+28FF) — every 6/8-dot Braille
// cell glyph, including the blank cell (U+2800). Used to detect a row whose
// value is Braille TEXT (as opposed to an ordinary generated string, e.g. a
// computed part number) so it can be given the larger, more legible
// typographic treatment dot patterns need at normal body-text size — a
// generic typographic accommodation, not a Braille-specific code path (any
// design emitting mostly-U+2800-block text gets the same treatment).
const BRAILLE_CHAR_RE = /[⠀-⣿]/;

/**
 * Whether `value`'s non-whitespace characters are MOSTLY (over half) Unicode
 * Braille-block glyphs — the threshold for the larger (~1.5em) preview
 * rendering. An empty/all-whitespace value is never "mostly" anything.
 */
export function isMostlyBraille(value: string): boolean {
  const chars = Array.from(value).filter((c) => !/\s/.test(c));
  if (chars.length === 0) return false;
  const brailleCount = chars.filter((c) => BRAILLE_CHAR_RE.test(c)).length;
  return brailleCount / chars.length > 0.5;
}
