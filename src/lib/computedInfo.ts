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
export interface ComputedInfo {
  label: string;
  unit: string;
  /** Already formatted for display (quotes stripped, booleans as Yes/No, unit
   *  suffix appended) — same shape DimensionInfo expects from formatValue(). */
  value: string;
}

// Matches `[out]`/`[err]` ECHO lines from the fixed 4-arg convention:
//   echo("@info", "<label>", "<unit>", <value>)
// -> ECHO: "@info", "<label>", "<unit>", <value-repr>
// Label/unit are always double-quoted (string literals); the value can be a
// bare number/bool/undef, a quoted string, or a bracketed vector — captured as
// the remainder of the line (group 3) and formatted by formatComputedValue.
// Matching on quote-pairs (not comma-splitting) means a label/unit containing
// a comma, or a vector value containing commas, is still handled correctly.
const COMPUTED_RE =
  /^\[(?:out|err)\]\s*ECHO:\s*"@info",\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)",\s*([\s\S]*)$/;

// Format the raw OpenSCAD repr of the 4th echo arg for display: strip quotes
// from a quoted string, map true/false to Yes/No (parity with DimensionInfo's
// formatValue for boolean params), and pass everything else (numbers, undef,
// vectors) through as OpenSCAD printed it. Appends the unit suffix the same
// way DimensionInfo does: `value + " " + unit`, only when unit is non-empty.
function formatComputedValue(raw: string, unit: string): string {
  const trimmed = raw.trim();
  let base: string;
  if (trimmed === "true") base = "Yes";
  else if (trimmed === "false") base = "No";
  else if (/^"(?:[^"\\]|\\.)*"$/.test(trimmed)) {
    // Quoted string: strip the wrapping quotes and un-escape \" and \\.
    base = trimmed.slice(1, -1).replace(/\\(["\\])/g, "$1");
  } else base = trimmed; // number, undef, vector — printed as-is
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
  for (const line of log) {
    const m = line.match(COMPUTED_RE);
    if (!m) continue;
    const [, label, unit, rawValue] = m;
    out.push({ label, unit, value: formatComputedValue(rawValue, unit) });
  }
  return out;
}
