// AdvisoryBadge.tsx — compact, clickable notice indicator in the top bar. Shows
// the same per-category, config-coloured count chips as the OutputConsole (via
// CountBadges) so the two always match; clicking opens the Output console.
import { CountBadges } from "./CountBadges";
import type { BadgeCount } from "../lib/diagnostics";

interface Props {
  badges: BadgeCount[];
  onClick: () => void;
  className?: string;
}

export function AdvisoryBadge({ badges, onClick, className = "" }: Props) {
  const total = badges.reduce((sum, b) => sum + b.count, 0);
  if (total === 0) return null;

  return (
    <button
      className={`advisory-badge ${className}`.trim()}
      onClick={onClick}
      aria-label={`${total} ${total === 1 ? "notice" : "notices"} — open output console`}
      title="Open output console"
    >
      <CountBadges badges={badges} />
    </button>
  );
}
