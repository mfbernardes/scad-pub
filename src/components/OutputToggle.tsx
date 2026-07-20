// OutputToggle.tsx — the "Output console" bell: an icon-only, ringing bell that
// toggles the notices/log console. Rides in the top bar of both layouts (desktop
// CommandBar + mobile top bar). A pending-notice count shows as a corner badge;
// absent that, it doubles as the render-status indicator (a corner status dot).
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { t, tn } from "../lib/i18n";
import { deriveRenderStatus, STATE_STYLES, type RenderStatusInput } from "../lib/renderStatus";
import { Bell as BellIcon, BellRing as BellRingIcon } from "lucide-react";

interface Props {
  outputOpen: boolean;
  /** How many notices/warnings are pending — shown as a corner count badge
   *  (`variant: "count"`) or drives a corner dot's presence (`variant:
   *  "dot"`) when > 0. Always used for the accessible name either way. */
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
  /**
   * Wave 1 (round-5): `"count"` (default) is today's numeric pill badge,
   * unchanged — "tabs" workflow's every caller keeps this. `"dot"` is
   * guided workflow's own cleaner indicator: a small amber dot (matching the
   * render-status dot's own size/position, so it never overlaps/clips the
   * bell glyph the way the wider numeric pill could) instead of a digit —
   * redundant with the Review chip's own amber dot otherwise, so guided mode
   * gets ONE quiet signal here, not a second one repeating the same count as
   * text. The accessible name still announces the live count either way.
   */
  variant?: "count" | "dot";
}

/** The small corner status dot shared by the render-status indicator (below,
 *  color/pulse driven by `deriveRenderStatus`) and guided workflow's own
 *  quiet `variant: "dot"` notice indicator (round-5 review, quality item 7)
 *  — same size/position/ring treatment either way, so it never overlaps or
 *  clips the bell glyph the way the wider numeric pill can; only the color
 *  and whether it pulses differ per caller. */
function StatusDot({ colorClass, pulse }: { colorClass: string; pulse?: boolean }) {
  return (
    <span
      // `output-toggle__dot` — a stable hook class (see CLAUDE.md's "Keep
      // script hook classes") so the guided-mode smoke suite can assert the
      // header bell's quiet notice dot is present/absent without depending
      // on the underlying colour utility, which also serves the render-
      // status dot (a different caller of this same shared shell).
      className={cn(
        "output-toggle__dot pointer-events-none absolute top-[3px] right-[3px] size-[8px] rounded-full shadow-[0_0_0_2px_var(--panel)]",
        colorClass,
        pulse && "animate-[pill-pulse_1s_ease-in-out_infinite] motion-reduce:animate-none"
      )}
      aria-hidden="true"
    />
  );
}

export function OutputToggle({
  outputOpen,
  noticeCount = 0,
  onToggleOutput,
  status,
  className,
  variant = "count",
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
      aria-label={`${outputOpen ? t("output.toggleAriaClose") : t("output.toggleAriaOpen")}${
        hasNotices ? tn("output.noticesSuffix", noticeCount) : ""
      }`}
      aria-pressed={outputOpen}
      title={t("output.title")}
    >
      <BellGlyph size={16} />
      {hasNotices && variant === "count" ? (
        <span
          // --warn flips luminance between themes (light amber on dark, deep
          // amber-brown on light), so its legible text colour flips too —
          // dark-theme text pairs with --background (near-black, close to the
          // badge's own dark surfaces); light-theme text uses --on-accent
          // (white), both bridged config-overridable tokens rather than raw
          // hex, so a config colour override keeps the badge legible.
          className="pointer-events-none absolute top-[2px] right-[2px] inline-flex h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded-full bg-warn px-[0.3rem] text-[0.7rem] font-bold leading-none text-background tabular-nums shadow-[0_0_0_2px_var(--panel)] [[data-theme=light]_&]:text-primary-foreground"
          aria-hidden="true"
        >
          {noticeCount}
        </span>
      ) : hasNotices && variant === "dot" ? (
        // Guided workflow's own quiet indicator (see this component's own
        // `variant` doc) — StatusDot's shared shell, static (no pulse). No
        // digit — the Review chip's own dot plus Review's "N issue(s) to
        // review" line already carry the count; this is glance-only,
        // matching that dot's own contract.
        <StatusDot colorClass="bg-warn" />
      ) : (
        dot && <StatusDot colorClass={dot.dot} pulse={dot.pulse} />
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
