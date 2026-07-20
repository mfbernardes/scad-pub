// computedInfo.ts — turn OpenSCAD's own `echo("@info", label, unit, value)`
// convention into structured "calculated value" rows for the measurements
// panel (DimensionInfo). This is a SEPARATE, purely-runtime mechanism from the
// comment-based `// @info` annotation gen-schema.mjs attaches to Customizer
// params (see Param.info in openscad/types.ts) — that one only works for real,
// visible Customizer params; this one lets a design surface an internal,
// OpenSCAD-computed value (one gen-schema's static parser could never know)
// from anywhere in its source, including inside a `/* [Hidden] */` section or
// a conditional. See also diagnostics.ts, which this intentionally does not
// extend (different concern: notices/badges vs. measurement rows).
//
// Parses the fixed 4-arg `echo("@info", "<label>", "<unit>", <value>)`
// convention via echoTags.ts's shared core (regex + quote-stripping) —
// mirrors displayRows.ts's `echo("@display", …)` parser and
// reviewOverrides.ts's `echo("@review", …)` one, which share that same core;
// see echoTags.ts's own doc for the log-line shape all three have in common.
import { parseEchoTag, formatEchoValue } from "./echoTags";

export interface ComputedInfo {
  label: string;
  unit: string;
  /** Already formatted for display (quotes stripped, unit suffix appended). */
  value: string;
}

// Format the raw OpenSCAD repr of the value arg for display (echoTags.ts's
// formatEchoValue), then append the unit suffix the same way DimensionInfo
// does: `value + " " + unit`, only when non-empty.
function formatComputedValue(raw: string, unit: string): string {
  const base = formatEchoValue(raw);
  return unit ? `${base} ${unit}` : base;
}

/**
 * Extract "calculated value" rows from the raw OpenSCAD worker log, in the
 * order the design echoed them (author-controlled — no re-sorting). Rows are
 * NOT de-duplicated: a design may legitimately echo the same label from
 * different branches (only one of which fires per render), so a genuine
 * repeat is preserved rather than silently dropped.
 */
export function parseComputedInfo(log: string[]): ComputedInfo[] {
  const out: ComputedInfo[] = [];
  for (const [label, unit, rawValue] of parseEchoTag(log, "@info", 2)) {
    out.push({ label, unit, value: formatComputedValue(rawValue, unit) });
  }
  return out;
}
