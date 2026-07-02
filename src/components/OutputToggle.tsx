// OutputToggle.tsx — the "Output console" bell: a ringing bell + pending-notice
// count badge that toggles the notices/log console. Rendered inline in the
// desktop action cluster (with an "Output" label) and icon-only in the mobile
// top bar. Extracted so the same bell/badge logic serves both without drift.
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { deriveRenderStatus, STATE_STYLES, type RenderStatusInput } from "./StatusPill";
import { Bell as BellIcon, BellRing as BellRingIcon } from "lucide-react";

interface Props {
  outputOpen: boolean;
  /** How many notices/warnings are pending — shown as a count badge when > 0. */
  noticeCount?: number;
  onToggleOutput: () => void;
  /** Icon-only (no "Output" label); the count becomes a corner badge. */
  compact?: boolean;
  /**
   * When provided, the bell doubles as the render-status indicator: a small
   * status-coloured dot rides its corner (green ok / red failed / pulsing while
   * working, …), so a separate StatusPill isn't needed. The pending-notice
   * count, when there is one, takes the corner instead.
   */
  status?: RenderStatusInput;
  className?: string;
}

export function OutputToggle({
  outputOpen,
  noticeCount = 0,
  onToggleOutput,
  compact = false,
  status,
  className,
}: Props) {
  const hasNotices = noticeCount > 0;
  // A bell (ringing when notices are pending) reads far more clearly to a maker
  // than a bare glyph — and a real count badge beats a dot.
  const BellGlyph = hasNotices ? BellRingIcon : BellIcon;

  // Render-status dot (only when asked to double as the status indicator).
  // Idle/loading show nothing — the viewer overlay covers "warming up".
  const derived = status ? deriveRenderStatus(status) : null;
  const dot = derived && derived.state !== "idle" && derived.state !== "loading"
    ? STATE_STYLES[derived.state]
    : null;

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
      {hasNotices ? (
        <span
          className={cn(
            "inline-flex h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded-full bg-warn px-[0.3rem] text-[0.7rem] font-bold leading-none text-[#1c1f24] tabular-nums [[data-theme=light]_&]:text-white",
            compact && "pointer-events-none absolute top-[2px] right-[2px] shadow-[0_0_0_2px_var(--panel)]"
          )}
          aria-hidden="true"
        >
          {noticeCount}
        </span>
      ) : (
        dot && (
          <span
            className={cn(
              "pointer-events-none absolute top-[3px] right-[3px] size-[8px] rounded-full shadow-[0_0_0_2px_var(--panel)]",
              dot.dot,
              dot.pulse && "animate-[pill-pulse_1s_ease-in-out_infinite] motion-reduce:animate-none"
            )}
            aria-hidden="true"
          />
        )
      )}
      {/* Keep the render status available to assistive tech (mirrors StatusPill). */}
      {derived && (
        <span className="sr-only" role="status" aria-live="polite">
          {`Render status: ${derived.text}`}
        </span>
      )}
    </Button>
  );
}
