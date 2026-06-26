// Diagnostics.tsx — friendly, structured notices parsed from the OpenSCAD log:
// the designs' config-driven advisory categories, OpenSCAD's own warnings, and
// assert failures, surfaced above the verbose log so they aren't missed.
import { useMemo } from "react";
import { parseDiagnostics, type DiagnosticLevel } from "../lib/diagnostics";
import type { AdvisoryCategory } from "../openscad/types";

const ICON: Record<DiagnosticLevel, string> = {
  advisory: "ⓘ",
  warning: "⚠",
  assert: "✗",
};

export function Diagnostics({
  log,
  advisories,
}: {
  log: string[];
  advisories: AdvisoryCategory[];
}) {
  const items = useMemo(
    () => parseDiagnostics(log, advisories),
    [log, advisories]
  );
  if (!items.length) return null;
  return (
    <ul
      className="diagnostics"
      aria-label="Advisories, warnings and assert failures"
      aria-live="polite"
    >
      {items.map((d, i) => (
        <li key={i} className={`diag diag-${d.level}`}>
          <span
            className="diag-icon"
            aria-hidden
            style={d.color ? { color: d.color } : undefined}
          >
            {ICON[d.level]}
          </span>
          <span className="diag-text">{d.text}</span>
        </li>
      ))}
    </ul>
  );
}
