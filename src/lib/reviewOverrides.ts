// reviewOverrides.ts — turns a design's own `echo("@review", param, value)`
// convention into a param-name -> rendered-value override map for a curated
// review summary (src/lib/reviewSummary.ts's row builder). A SEPARATE,
// purely-runtime mechanism modeled directly on computedInfo.ts's
// `echo("@info", …)` parser (see its own doc for the shared shape) — no
// build-time component: gen-schema.mjs never sees this tag; the app only
// scans the worker's log for it after a render.
//
// WHY: a curated review row (`designs[].reviewLabels`) normally shows a
// parameter's raw stored value, formatted the same way every other row is
// (reviewSummary.ts's row-value formatting). Some designs TRANSFORM a
// parameter's value before it reaches the printed model — e.g. a lettering
// profile that uppercases free text ("Raum 101" typed -> "RAUM 101"
// printed). Showing the raw "Raum 101" in the summary would misrepresent
// what's actually on the model. A design that echoes `"@review"` for that
// param overrides the curated row's value with what it actually rendered, so
// the summary never lies about the output. Absent this echo, a curated row
// shows the raw value exactly as it always has — this mechanism is purely
// additive.
//
// Parses the fixed 2-arg `echo("@review", "<paramName>", <value>)`
// convention via echoTags.ts's shared core (regex + quote-stripping) —
// mirrors computedInfo.ts's `echo("@info", …)` parser, which shares that same
// core; see echoTags.ts's own doc for the log-line shape both have in common.
import { parseEchoTag, formatEchoValue } from "./echoTags";

/**
 * Extract `@review` overrides from the raw OpenSCAD worker log, keyed by
 * param name. A later echo for the SAME param name overwrites an earlier one
 * — "last write wins" — since a design re-echoing its own rendered value
 * (e.g. from inside a loop, or a fallback branch after a primary one) means
 * "this is the current value", not "show it twice".
 */
export function parseReviewOverrides(log: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const [param, rawValue] of parseEchoTag(log, "@review", 1)) {
    map.set(param, formatEchoValue(rawValue));
  }
  return map;
}
