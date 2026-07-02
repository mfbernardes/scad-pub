// OutputToggle.tsx — the "Output console" bell: a ringing bell + pending-notice
// count badge that toggles the notices/log console. Rendered inline in the
// desktop action cluster (with an "Output" label) and icon-only in the mobile
// top bar. Extracted so the same bell/badge logic serves both without drift.
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { Bell as BellIcon, BellRing as BellRingIcon } from "lucide-react";

interface Props {
  outputOpen: boolean;
  /** How many notices/warnings are pending — shown as a count badge when > 0. */
  noticeCount?: number;
  onToggleOutput: () => void;
  /** Icon-only (no "Output" label); the count becomes a corner badge. */
  compact?: boolean;
  className?: string;
}

export function OutputToggle({
  outputOpen,
  noticeCount = 0,
  onToggleOutput,
  compact = false,
  className,
}: Props) {
  const hasNotices = noticeCount > 0;
  // A bell (ringing when notices are pending) reads far more clearly to a maker
  // than a bare glyph — and a real count badge beats a dot.
  const BellGlyph = hasNotices ? BellRingIcon : BellIcon;

  return (
    <Button
      size={compact ? "icon" : "sm"}
      variant={compact ? "outline" : "ghost"}
      className={cn(
        "relative",
        outputOpen && (compact ? "border-brand text-brand" : "bg-card text-brand hover:bg-card"),
        hasNotices && "text-warn",
        className
      )}
      onClick={onToggleOutput}
      aria-label={`${outputOpen ? "Close" : "Open"} output console${
        hasNotices ? ` (${noticeCount} notice${noticeCount === 1 ? "" : "s"})` : ""
      }`}
      aria-pressed={outputOpen}
      title="Output console — notices & log"
    >
      <BellGlyph size={16} />
      {!compact && "Output"}
      {hasNotices && (
        <span
          className={cn(
            "inline-flex h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded-full bg-warn px-[0.3rem] text-[0.7rem] font-bold leading-none text-[#1c1f24] tabular-nums [[data-theme=light]_&]:text-white",
            compact && "pointer-events-none absolute top-[2px] right-[2px] shadow-[0_0_0_2px_var(--panel)]"
          )}
          aria-hidden="true"
        >
          {noticeCount}
        </span>
      )}
    </Button>
  );
}
