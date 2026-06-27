// CountBadges — the per-category notice/assert count chips, coloured by the
// config (each notice category's `color`). Shown in the OutputConsole's
// Notices tab.
import { Badge } from "./ui/badge";
import { badgeTextColor, type BadgeCount } from "../lib/diagnostics";

export function CountBadges({ badges }: { badges: BadgeCount[] }) {
  return (
    <>
      {badges.map((b) => (
        <Badge
          key={b.key}
          variant={b.key === "assert" ? "destructive" : "warn"}
          className={`px-2 min-w-5 justify-center${b.key === "assert" ? " badge-assert" : ""}`}
          style={b.color ? { background: b.color, color: badgeTextColor(b.color) } : undefined}
        >
          {b.count}
        </Badge>
      ))}
    </>
  );
}
