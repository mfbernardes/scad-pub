// Diagnostics.tsx — friendly, structured notices parsed from the OpenSCAD log:
// the designs' non-fatal tactile-layout advisories and OpenSCAD's own warnings,
// surfaced above the verbose log so they aren't missed.
import { useMemo } from "react";
import { parseDiagnostics } from "../lib/diagnostics";

export function Diagnostics({ log }: { log: string[] }) {
  const items = useMemo(() => parseDiagnostics(log), [log]);
  if (!items.length) return null;
  return (
    <ul
      className="diagnostics"
      aria-label="Layout advisories and warnings"
      aria-live="polite"
    >
      {items.map((d, i) => (
        <li key={i} className={`diag diag-${d.level}`}>
          <span className="diag-icon" aria-hidden>
            {d.level === "warning" ? "⚠" : "ⓘ"}
          </span>
          <span className="diag-text">{d.text}</span>
        </li>
      ))}
    </ul>
  );
}
