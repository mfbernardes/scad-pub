// diagnostics.ts — turn the raw OpenSCAD worker log into friendly, structured
// notices and the count badges shown on the "OpenSCAD output" panel.
//
// Advisory categories are CONFIG-DRIVEN (schema.advisories, built from the
// config's `advisories` key): a design echoes
// `ECHO: "<context>: <marker>: <message>"` and each configured category (its
// marker, label and optional colour) becomes a friendly notice and a coloured
// count badge. OpenSCAD's own `WARNING:` lines and `assert()` failures
// (`ERROR: Assertion …`) are handled in a fixed, hardcoded way: warnings surface
// as notices; assert failures get both a notice and a count badge.
import type { AdvisoryCategory } from "../openscad/types";

export type DiagnosticLevel = "advisory" | "warning" | "assert";

export interface Diagnostic {
  level: DiagnosticLevel;
  text: string;
  /** Optional notice/badge colour (advisory categories only). */
  color?: string;
}

/** One count badge for the OpenSCAD output panel header. */
export interface BadgeCount {
  /** Stable identity (`advisory:<marker>` or `assert`). */
  key: string;
  /** Badge noun (e.g. "advisories", "asserts"). */
  label: string;
  count: number;
  /** Optional fill colour; falls back to the default badge styling. */
  color?: string;
}

// An OpenSCAD echo line, e.g. `[out] ECHO: "nameplate: advisory: …"`.
const ECHO_RE = /^\[out\]\s*ECHO:\s*"(.*)"\s*$/;
// Hardcoded OpenSCAD diagnostics (not configurable):
const WARNING_RE = /^\[(?:out|err)\]\s*WARNING:\s*(.*)$/;
// An `assert()` failure: OpenSCAD prints `ERROR: Assertion '…' failed …`.
const ASSERT_RE = /^\[(?:out|err)\]\s*ERROR:\s*(Assertion\b.*)$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A line classified into a diagnostic, plus the badge it contributes to (if
// any — warnings get a notice but no badge). `null` for plain output lines.
interface Classified extends Diagnostic {
  badgeKey?: string;
  badgeLabel?: string;
}

// Classify one log line. Config-driven advisory categories win over the
// hardcoded rules; the first matching advisory category claims the line.
function classify(
  line: string,
  advisories: AdvisoryCategory[]
): Classified | null {
  const echo = line.match(ECHO_RE);
  if (echo) {
    for (const a of advisories) {
      // Match the design's convention `: <marker>:` and strip the marker so the
      // notice reads "nameplate: tactile content …" rather than repeating it.
      const re = new RegExp(`:\\s*${escapeRegExp(a.marker)}:\\s*`, "i");
      if (re.test(echo[1]))
        return {
          level: "advisory",
          text: echo[1].replace(re, ": "),
          color: a.color,
          badgeKey: `advisory:${a.marker}`,
          badgeLabel: a.label,
        };
    }
    return null;
  }
  const assertM = line.match(ASSERT_RE);
  if (assertM)
    return {
      level: "assert",
      text: assertM[1].trim(),
      badgeKey: "assert",
      badgeLabel: "asserts",
    };
  const warn = line.match(WARNING_RE);
  if (warn) return { level: "warning", text: warn[1].trim() };
  return null;
}

/** De-duplicated, structured notices for the Diagnostics list. */
export function parseDiagnostics(
  log: string[],
  advisories: AdvisoryCategory[]
): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const line of log) {
    const c = classify(line, advisories);
    if (!c || !c.text) continue;
    const key = `${c.level}:${c.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c.color ? { level: c.level, text: c.text, color: c.color } : { level: c.level, text: c.text });
  }
  return out;
}

/**
 * Count badges for the OpenSCAD output panel: one per advisory category and one
 * for assert failures. Categories keep their configured order; the assert badge
 * comes last. Only badges with a non-zero count are returned. Counts are over
 * raw matching log lines (not de-duplicated) so repeated notices still tally.
 */
export function countBadges(
  log: string[],
  advisories: AdvisoryCategory[]
): BadgeCount[] {
  const byKey = new Map<string, BadgeCount>();
  for (const a of advisories)
    byKey.set(`advisory:${a.marker}`, {
      key: `advisory:${a.marker}`,
      label: a.label,
      count: 0,
      ...(a.color ? { color: a.color } : {}),
    });
  byKey.set("assert", { key: "assert", label: "asserts", count: 0 });

  for (const line of log) {
    const c = classify(line, advisories);
    if (c?.badgeKey) {
      const badge = byKey.get(c.badgeKey);
      if (badge) badge.count++;
    }
  }
  return [...byKey.values()].filter((b) => b.count > 0);
}
