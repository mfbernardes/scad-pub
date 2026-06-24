// LogPanel.tsx — shows OpenSCAD's echo/stderr output, including the repo's
// non-fatal tactile layout advisories (a useful accessibility signal).
import { useState } from "react";

export function LogPanel({ log }: { log: string[] }) {
  const [open, setOpen] = useState(false);
  const advisories = log.filter((l) => /advisory|ECHO/i.test(l)).length;
  return (
    <div className="log-panel">
      <button className="log-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} OpenSCAD output
        {advisories > 0 && <span className="badge">{advisories} advisories</span>}
      </button>
      {open && (
        <pre className="log">
          {log.length ? log.join("\n") : "(no output yet)"}
        </pre>
      )}
    </div>
  );
}
