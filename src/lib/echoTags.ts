// echoTags.ts — shared parsing core for the `echo("@tag", …)` conventions
// (computedInfo.ts's `@info`, reviewOverrides.ts's `@review`). Both read a
// design's own ECHO output from the OpenSCAD worker log and turn a
// fixed-arity, comma-separated argument list into structured rows — the same
// `[out]`/`[err]` ECHO line shape, the same quote-pair matching (not
// comma-splitting, so a label/value containing a comma is still handled
// correctly), and the same "strip quotes off a quoted string, pass anything
// else through verbatim" value formatting. Each call site still owns its own
// public shape and its own dedup semantics (never / last-write-wins-by-param)
// — this module only removes the duplicated regex + quote-stripping those two
// used to hand-roll independently.
//
// No build-time component: gen-schema.mjs never parses either tag; the app
// only scans the worker's log for them after a render.
import { escapeRegExp } from "./diagnostics";

/**
 * Match every `[out]`/`[err]` ECHO line for a fixed-arity `echo("@tag", …)`
 * convention:
 *   echo("@tag", "<arg1>", ..., "<argN>", <valueExpr>)
 * -> ECHO: "@tag", "<arg1>", ..., "<argN>", <value-repr>
 * The first `quotedArgCount` arguments are always double-quoted string
 * literals (a label/param name); the FINAL argument is captured as the raw
 * remainder of the line (can be a bare number/bool/undef, a quoted string, or
 * a bracketed vector) so callers format it themselves. Matching on quote
 * pairs (not comma-splitting) means a quoted argument or the raw value
 * containing an embedded comma is still handled correctly. Returns one array
 * of captured groups per matching line, in log order — `quotedArgCount` plain
 * strings followed by the raw final-argument text.
 */
export function parseEchoTag(log: string[], tag: string, quotedArgCount: number): string[][] {
  const escapedTag = escapeRegExp(tag);
  const re = new RegExp(
    `^\\[(?:out|err)\\]\\s*ECHO:\\s*"${escapedTag}"` +
      `,\\s*"([^"]*)"`.repeat(quotedArgCount) +
      `,\\s*([\\s\\S]*)$`
  );
  const out: string[][] = [];
  for (const line of log) {
    const m = re.exec(line);
    if (!m) continue;
    out.push(m.slice(1));
  }
  return out;
}

/**
 * Format the raw OpenSCAD repr of an echoed argument for display: strip
 * quotes from a quoted string, and pass anything else (numbers, booleans,
 * undef, vectors) through exactly as OpenSCAD printed it.
 */
export function formatEchoValue(raw: string): string {
  const trimmed = raw.trim();
  const quoted = /^"([^"]*)"$/.exec(trimmed);
  return quoted ? quoted[1] : trimmed;
}
