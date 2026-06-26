// LogPanel.tsx — shows OpenSCAD's echo/stderr output, with count badges for the
// config-driven notice categories (each in its configured colour) and for
// hardcoded assert failures.
import { useState } from "react";
import { countBadges } from "../lib/diagnostics";
import type { NoticeCategory } from "../openscad/types";

// Pick black or white text for a badge whose background is a config-supplied
// colour, so the count stays legible (WCAG contrast) regardless of the hue.
// Only #rgb / #rrggbb are parsed; other CSS colour forms fall back to the
// default badge text colour (the consumer is responsible for its contrast,
// like the rest of the `colors`/notice colour config).
function badgeTextColor(color?: string): string | undefined {
  if (!color) return undefined;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return undefined;
  let hex = m[1];
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.4 ? "#000" : "#fff";
}

export function LogPanel({
  log,
  notices,
}: {
  log: string[];
  notices: NoticeCategory[];
}) {
  const [open, setOpen] = useState(false);
  const badges = countBadges(log, notices);
  return (
    <div className="log-panel">
      <button className="log-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} OpenSCAD output
        {badges.map((b) => (
          <span
            key={b.key}
            className={`badge${b.key === "assert" ? " badge-assert" : ""}`}
            style={
              b.color
                ? { background: b.color, color: badgeTextColor(b.color) }
                : undefined
            }
          >
            {b.count} {b.label}
          </span>
        ))}
      </button>
      {open && (
        <pre className="log">
          {log.length ? log.join("\n") : "(no output yet)"}
        </pre>
      )}
    </div>
  );
}
