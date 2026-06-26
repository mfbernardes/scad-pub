// Diagnostics.tsx — friendly, structured notices parsed from the OpenSCAD log:
// the designs' config-driven notice categories, OpenSCAD's own warnings, and
// assert failures, surfaced above the verbose log so they aren't missed.
import { useMemo } from "react";
import { parseDiagnostics, type DiagnosticLevel } from "../lib/diagnostics";
import type { NoticeCategory } from "../openscad/types";

const ICON: Record<DiagnosticLevel, string> = {
  notice: "ⓘ",
  warning: "⚠",
  assert: "✗",
};

export function Diagnostics({
  log,
  notices,
}: {
  log: string[];
  notices: NoticeCategory[];
}) {
  const items = useMemo(
    () => parseDiagnostics(log, notices),
    [log, notices]
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
