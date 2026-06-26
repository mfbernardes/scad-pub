// diagnostics.ts — turn the raw OpenSCAD worker log into friendly, structured
// notices and the count badges shown on the "OpenSCAD output" panel.
//
// The notice categories are CONFIG-DRIVEN (schema.notices, built from the
// config's `notices` key): a design echoes
// `ECHO: "<context>: <marker>: <message>"` and each configured category (its
// marker, label and optional colour) becomes a friendly notice and a coloured
// count badge. OpenSCAD's own `WARNING:` lines and `assert()` failures
// (`ERROR: Assertion …`) are handled in a fixed, hardcoded way: warnings surface
// as notices; assert failures get both a notice and a count badge.
import type { NoticeCategory } from "../openscad/types";

export type DiagnosticLevel = "notice" | "warning" | "assert";

export interface Diagnostic {
  level: DiagnosticLevel;
  text: string;
  /** Optional notice/badge colour (config-driven notice categories only). */
  color?: string;
}

/** One count badge for the OpenSCAD output panel header. */
export interface BadgeCount {
  /** Stable identity (`notice:<marker>` or `assert`). */
  key: string;
  /** Badge noun (e.g. "advisories", "asserts"). */
  label: string;
  count: number;
  /** Optional fill colour; falls back to the default badge styling. */
  color?: string;
}

// An OpenSCAD echo line, e.g. `[err] ECHO: "tag: advisory: …"`. OpenSCAD-WASM
// routes ECHO to stderr, so accept both streams (like WARNING/ERROR below).
const ECHO_RE = /^\[(?:out|err)\]\s*ECHO:\s*"(.*)"\s*$/;
// Hardcoded OpenSCAD diagnostics (not configurable):
const WARNING_RE = /^\[(?:out|err)\]\s*WARNING:\s*(.*)$/;
// An `assert()` failure: OpenSCAD prints `ERROR: Assertion '…' failed …`.
const ASSERT_RE = /^\[(?:out|err)\]\s*ERROR:\s*(Assertion\b.*)$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A line classified into a diagnostic, plus the key of the badge it contributes
// to (if any — warnings get a notice but no badge). `null` for plain output
// lines. The badge's label/colour come from the category map in countBadges, so
// only the key is carried here.
interface Classified extends Diagnostic {
  badgeKey?: string;
}

// Classify one log line. Config-driven notice categories win over the hardcoded
// rules; the first matching category claims the line.
function classify(
  line: string,
  notices: NoticeCategory[]
): Classified | null {
  const echo = line.match(ECHO_RE);
  if (echo) {
    for (const n of notices) {
      // Match the design's convention `: <marker>:` and strip the marker so the
      // notice reads "tag: text size is large …" rather than repeating it.
      const re = new RegExp(`:\\s*${escapeRegExp(n.marker)}:\\s*`, "i");
      if (re.test(echo[1]))
        return {
          level: "notice",
          text: echo[1].replace(re, ": "),
          color: n.color,
          badgeKey: `notice:${n.marker}`,
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
    };
  const warn = line.match(WARNING_RE);
  if (warn) return { level: "warning", text: warn[1].trim() };
  return null;
}

/** De-duplicated, structured notices for the Diagnostics list. */
export function parseDiagnostics(
  log: string[],
  notices: NoticeCategory[]
): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const line of log) {
    const c = classify(line, notices);
    if (!c || !c.text) continue;
    const key = `${c.level}:${c.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c.color ? { level: c.level, text: c.text, color: c.color } : { level: c.level, text: c.text });
  }
  return out;
}

/**
 * Count badges for the OpenSCAD output panel: one per configured notice category
 * and one for assert failures. Categories keep their configured order; the
 * assert badge comes last. Only badges with a non-zero count are returned.
 * Counts are over raw matching log lines (not de-duplicated) so repeated notices
 * still tally.
 */
export function countBadges(
  log: string[],
  notices: NoticeCategory[]
): BadgeCount[] {
  const byKey = new Map<string, BadgeCount>();
  for (const n of notices)
    byKey.set(`notice:${n.marker}`, {
      key: `notice:${n.marker}`,
      label: n.label,
      count: 0,
      ...(n.color ? { color: n.color } : {}),
    });
  byKey.set("assert", { key: "assert", label: "asserts", count: 0 });

  for (const line of log) {
    const c = classify(line, notices);
    if (c?.badgeKey) {
      const badge = byKey.get(c.badgeKey);
      if (badge) badge.count++;
    }
  }
  return [...byKey.values()].filter((b) => b.count > 0);
}
