// computedInfo.ts: turn OpenSCAD's own `echo("@info", label, unit, value)`
// convention into structured "calculated value" rows for the measurements
// panel (DimensionInfo). This is a SEPARATE, purely-runtime mechanism from the
// comment-based `// @info` annotation gen-schema.mjs attaches to Customizer
// params (see Param.info in openscad/types.ts), that one only works for real,
// visible Customizer params; this one lets a design surface an internal,
// OpenSCAD-computed value (one gen-schema's static parser could never know)
// from anywhere in its source, including inside a `/* [Hidden] */` section or
// a conditional. See also diagnostics.ts, which this intentionally does not
// extend (different concern: notices/badges vs. measurement rows).
//
// Parses the fixed 4-arg `echo("@info", "<label>", "<unit>", <value>)`
// convention via echoTags.ts's shared core (regex + quote-stripping):
// mirrors reviewOverrides.ts's `echo("@review", …)` parser, which shares that
// same core; see echoTags.ts's own doc for the log-line shape both have in
// common.
import { parseEchoTag, formatEchoValue } from "./echoTags";

export interface ComputedInfo {
  label: string;
  unit: string;
  /** Formatted for display (quotes stripped), WITHOUT the unit suffix: the
   *  BASE value alone. The unit is appended at RENDER time instead (see
   *  DimensionInfo.tsx, which composes `value`/`unit` the same way
   *  format.ts's `formatParamValue` does for a param's own `@info` row), so
   *  `label`/`unit`/`value` can each be localized independently (AppShell's
   *  computed-info memo maps `label` AND `unit` through `localizeEcho`; a
   *  numeric `value` is never translated, see docs/config.md). */
  value: string;
}

/**
 * Extract "calculated value" rows from the raw OpenSCAD worker log, in the
 * order the design echoed them (author-controlled: no re-sorting). Rows are
 * NOT de-duplicated: a design may legitimately echo the same label from
 * different branches (only one of which fires per render), so a genuine
 * repeat is preserved rather than silently dropped.
 */
export function parseComputedInfo(log: string[]): ComputedInfo[] {
  const out: ComputedInfo[] = [];
  for (const [label, unit, rawValue] of parseEchoTag(log, "@info", 2)) {
    out.push({ label, unit, value: formatEchoValue(rawValue) });
  }
  return out;
}
