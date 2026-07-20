// friendlyErrors.ts — maps a failed RenderResult onto friendly copy: a title,
// an optional body, and a short "technical details" tail. Deliberately NOT a
// React component or hook — a pure function over the render outcome, kept
// dependency-free (besides diagnostics.ts's own regexes) so
// tests/friendlyErrors.test.mjs can drive every branch directly. A future
// caller can use this for the Notices tab's failure card and the
// render-failed toast title (useRenderPipeline.ts currently hardcodes its own
// "That combination of settings didn't work" text — the same copy this
// module's generic fallback returns).
//
// Priority, matching how a render can fail:
//  1. A fatal bootstrap failure (RenderResult.fatal — see worker.ts's
//     BootstrapError): the render pipeline never even got to running
//     OpenSCAD, so "that combination of settings didn't work" would be a
//     lie. Body is always null — there's no model-level detail to show.
//  2. A failed `assert()`: OpenSCAD halts at the FIRST one, so its authored
//     message (the string literal the design's author wrote as assert()'s
//     second argument) is the single most actionable thing to show — reused
//     verbatim, quote-stripped, as the card's body.
//  3. Any other nonzero exit: the generic "didn't work" copy, matching the
//     existing failure toast text exactly so the toast and a future Notices
//     card never say two different things for the same outcome.
//
// Reuses diagnostics.ts's ASSERT_RE/WARNING_RE (not duplicated here) so this
// mapping and the Notices list can never disagree about what counts as an
// assert/warning line.
import type { RenderResult } from "../openscad/types";
import { ASSERT_RE, WARNING_RE } from "./diagnostics";

export interface FriendlyErrorInfo {
  title: string;
  /** The assert's authored message, verbatim and unquoted — null for every
   *  other failure kind (fatal or generic), which have no model-level detail
   *  to show as a body. */
  body: string | null;
  /** A short, deduped tail of the log's ERROR:/WARNING:/bootstrap-error
   *  lines — a "Show technical details" disclosure's content. Never the
   *  whole log. */
  technical: string[];
}

export interface FriendlyErrorOptions {
  /** Cap on the number of technical detail lines kept (default 5). */
  maxTechnical?: number;
}

const DEFAULT_MAX_TECHNICAL = 5;

// A worker bootstrap failure (worker.ts's BootstrapError, caught in
// self.onmessage) logs a single `[error] <message>` line — a distinct,
// internal convention from OpenSCAD's own `[out]/[err] ERROR:`/`WARNING:`
// lines (ASSERT_RE/WARNING_RE), since bootstrap never got as far as running
// OpenSCAD at all.
const BOOTSTRAP_LOG_RE = /^\[error\]\s*(.*)$/;

// The authored message inside `assert(cond, "message")`, exactly as OpenSCAD
// prints it: `Assertion '<cond>' failed: "<message>" in file <path>, line
// <N>`. An assert() call with no message argument omits the `: "<message>"`
// part entirely (`Assertion '<cond>' failed in file <path>, line <N>`) — this
// returns null then, so the caller falls back to the raw assertion text.
function assertMessage(assertionText: string): string | null {
  const m = assertionText.match(/failed:\s*"([\s\S]*)"\s+in file\b/);
  return m ? m[1] : null;
}

/** ERROR:/WARNING:/bootstrap-error lines from the raw worker log, in order,
 *  deduped, capped to a short tail — used as `technical` for every failure
 *  kind. Naturally includes a failed assert's own raw line (condition + file
 *  + line, not just its authored message) alongside any further ERROR/WARNING
 *  lines, since OpenSCAD can still emit e.g. a font-fallback WARNING before
 *  halting at the assert. */
function technicalTail(log: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of log) {
    let text: string | null = null;
    const assertM = line.match(ASSERT_RE);
    if (assertM) text = assertM[1].trim();
    else {
      const warnM = line.match(WARNING_RE);
      if (warnM) text = `Warning: ${warnM[1].trim()}`;
      else {
        const bootM = line.match(BOOTSTRAP_LOG_RE);
        if (bootM) text = bootM[1].trim();
      }
    }
    if (text === null || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out.slice(-max);
}

/**
 * Map a failed render onto friendly copy — `null` for a missing or
 * successful result (nothing to say). See the file header for the priority
 * order.
 */
export function friendlyRenderError(
  result: RenderResult | null,
  opts: FriendlyErrorOptions = {}
): FriendlyErrorInfo | null {
  if (!result || result.ok) return null;
  const maxTechnical = opts.maxTechnical ?? DEFAULT_MAX_TECHNICAL;
  const technical = technicalTail(result.log, maxTechnical);

  if (result.fatal)
    return {
      title: "The 3D engine couldn't start — check your connection and try again.",
      body: null,
      technical,
    };

  // OpenSCAD halts at the first failed assert() — later lines matching
  // ASSERT_RE (rare: e.g. a nested/earlier assert already logged before the
  // one that actually aborted the run) are still folded into `technical`
  // above, but only the FIRST one's authored message becomes the body.
  let firstAssert: string | null = null;
  for (const line of result.log) {
    const m = line.match(ASSERT_RE);
    if (m) {
      firstAssert = m[1].trim();
      break;
    }
  }
  if (firstAssert !== null)
    return {
      title: "Preview could not be updated",
      body: assertMessage(firstAssert) ?? firstAssert,
      technical,
    };

  return { title: "That combination of settings didn't work", body: null, technical };
}
