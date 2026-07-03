// OutputToggle.tsx — the "Output console" bell: an icon-only, ringing bell that
// toggles the notices/log console. Rides in the top bar of both layouts (desktop
// CommandBar + mobile top bar). A pending-notice count shows as a corner badge;
// absent that, it doubles as the render-status indicator (a corner status dot).
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { deriveRenderStatus, STATE_STYLES, type RenderStatusInput } from "../lib/renderStatus";
import { Bell as BellIcon, BellRing as BellRingIcon } from "lucide-react";

interface Props {
  outputOpen: boolean;
  /** How many notices/warnings are pending — shown as a corner count badge when > 0. */
  noticeCount?: number;
  onToggleOutput: () => void;
  /**
   * When provided, the bell doubles as the render-status indicator: a small
   * status-coloured dot rides its corner (red failed / pulsing while working or
   * stale), so a separate StatusPill isn't needed. The pending-notice count,
   * when there is one, takes the corner instead.
   */
  status?: RenderStatusInput;
  className?: string;
}

export function OutputToggle({
  outputOpen,
  noticeCount = 0,
  onToggleOutput,
  status,
  className,
}: Props) {
  const hasNotices = noticeCount > 0;
  // A bell (ringing when notices are pending) reads far more clearly to a maker
  // than a bare glyph — and a real count badge beats a dot.
  const BellGlyph = hasNotices ? BellRingIcon : BellIcon;

  // Render-status dot (only when asked to double as the status indicator).
  // Only the states worth a maker's attention wear a dot: working, failed, or a
  // stale preview. A happy "ok" stays neutral (no green) — the viewer already
  // shows the fresh geometry — and idle/loading are covered by the viewer overlay.
  const derived = status ? deriveRenderStatus(status) : null;
  const dot =
    derived &&
    (derived.state === "rendering" || derived.state === "error" || derived.state === "stale")
      ? STATE_STYLES[derived.state]
      : null;

  return (
    <Button
      size="icon"
      variant="outline"
      className={cn(
        "relative",
        outputOpen && "border-brand text-brand",
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
      {hasNotices ? (
        <span
          className="pointer-events-none absolute top-[2px] right-[2px] inline-flex h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded-full bg-warn px-[0.3rem] text-[0.7rem] font-bold leading-none text-[#1c1f24] tabular-nums shadow-[0_0_0_2px_var(--panel)] [[data-theme=light]_&]:text-white"
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
      {/* Keep the render status available to assistive tech — and as the stable
          `render-status` hook the smoke/capture scripts read for completion. */}
      {derived && (
        <span className="render-status sr-only" role="status" aria-live="polite">
          {`Render status: ${derived.text}`}
        </span>
      )}
    </Button>
  );
}
