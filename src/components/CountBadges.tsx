// CountBadges — the per-category notice/assert count chips, coloured by the
// config (each notice category's `color`). Shown in the OutputConsole's
// Notices tab. A category not flagged `attention: true` renders neutral
// ("secondary") rather than amber — an informational note shouldn't read as
// urgent just because it has a count (see CLAUDE.md item 6a); asserts are
// always destructive-red, and any category's own explicit `color` override
// always wins visually regardless of its attention flag.
import { Badge } from "./ui/badge";
import { badgeTextColor, type BadgeCount } from "../lib/diagnostics";

export function CountBadges({ badges }: { badges: BadgeCount[] }) {
  return (
    <>
      {badges.map((b) => (
        <Badge
          key={b.key}
          variant={b.key === "assert" ? "destructive" : b.attention ? "warn" : "secondary"}
          className={`px-2 min-w-5 justify-center${b.key === "assert" ? " badge-assert" : ""}`}
          style={b.color ? { background: b.color, color: badgeTextColor(b.color) } : undefined}
        >
          {b.count}
        </Badge>
      ))}
    </>
  );
}
