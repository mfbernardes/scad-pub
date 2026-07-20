// CountBadges — the per-category notice/assert count chips, coloured by the
// config (each notice category's `color`) or, absent that, by whether the
// category is a genuine `attention` concern (see diagnostics.ts's
// `badgeVariant` — UX plan item 4.2: an informational-only notice must not
// paint the same amber as a real unresolved issue). Shown in the
// OutputConsole's Notices tab. The visible chip is just the number (compact
// by design), but each carries an `aria-label` naming the category too,
// plural-correct via `noticeLabel` (config's optional `labelOne` — see
// NoticeCategory.labelOne) — so assistive tech never hears a bare "1"
// without knowing what it counts.
import { Badge } from "./ui/badge";
import { badgeTextColor, badgeVariant, noticeLabel, type BadgeCount } from "../lib/diagnostics";

export function CountBadges({ badges }: { badges: BadgeCount[] }) {
  return (
    <>
      {badges.map((b) => (
        <Badge
          key={b.key}
          variant={badgeVariant(b)}
          className={`px-2 min-w-5 justify-center${b.key === "assert" ? " badge-assert" : ""}`}
          style={b.color ? { background: b.color, color: badgeTextColor(b.color) } : undefined}
          aria-label={`${b.count} ${noticeLabel(b.label, b.count, b.labelOne)}`}
        >
          {b.count}
        </Badge>
      ))}
    </>
  );
}
