// OutputToggle.tsx: the "Output console" bell: an icon-only, ringing bell that
// toggles the notices/log console. Rides in the top bar of both layouts (desktop
// CommandBar + mobile top bar). A pending-message count shows as a corner badge
// unless `showCount` says otherwise; absent that badge, the corner doubles as
// the render-status indicator (a status dot).
//
// The bell counts MESSAGES, never issues, and it never claims urgency: the
// readiness pill (StatusStrip, driven by src/lib/readiness.ts) is the single
// owner of "something needs your attention", because it is the surface that
// gates Download and opens the dialog explaining it. The two tallies are not
// the same number and never were: the bell counts log lines (informational
// notices included, one per line), while the pill counts actionable items
// (a missing font has no log line at all; a `subsumedByFont` category folds
// into the font item; a category with five pending lines is one item). Showing
// both at once invites the reading that one of them is lying, so the caller
// hides this count while the pill is up (`showCount`), and the bell carries no
// amber of its own for an attention-flagged notice.
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import {
  deriveRenderStatus,
  renderAnnouncement,
  STATE_STYLES,
  type RenderStatusInput,
} from "../lib/renderStatus";
import { Bell as BellIcon, BellRing as BellRingIcon } from "lucide-react";
import { t, tn } from "../lib/i18n";

interface Props {
  outputOpen: boolean;
  /** How many notices/warnings are pending: shown as a corner count badge when
   *  > 0 and `showCount` is true. */
  noticeCount?: number;
  /** A value that changes exactly when the pending messages change (their
   *  content, not merely how many). What the spoken region below keys off:
   *  `diagnostics` is re-derived per render, so a count alone cannot tell a
   *  replaced set from an unchanged one. Omitted -> the count stands in. */
  noticeKey?: string;
  /**
   * Whether the corner may carry the numeric count. Callers set it false while
   * the readiness pill is on screen (AppShell's `hasStatusPill`) so only one
   * count is visible at a time, see the file comment for why the two tallies
   * differ. The ringing glyph, `data-notice-count` and the aria-label still
   * report that messages are pending, so the number is all that's suppressed.
   */
  showCount?: boolean;
  onToggleOutput: () => void;
  /**
   * When provided, the bell doubles as the render-status indicator: a small
   * status-coloured dot rides its corner (red failed / pulsing while working or
   * stale), so a separate StatusPill isn't needed. The pending-notice count,
   * when it is both present and shown, takes the corner instead, which means
   * suppressing the count can REVEAL a dot the badge was covering.
   */
  status?: RenderStatusInput;
  className?: string;
}

export function OutputToggle({
  outputOpen,
  noticeCount = 0,
  noticeKey,
  showCount = true,
  onToggleOutput,
  status,
  className,
}: Props) {
  const hasNotices = noticeCount > 0;
  const showBadge = hasNotices && showCount;
  // A bell (ringing when notices are pending) reads far more clearly to a maker
  // than a bare glyph, and it keeps saying "there's something in here" even
  // when the count itself is suppressed.
  const BellGlyph = hasNotices ? BellRingIcon : BellIcon;

  // Render-status dot (only when asked to double as the status indicator).
  // Only the states worth a maker's attention wear a dot: working, failed, or a
  // stale preview. A happy "ok" stays neutral (no green): the viewer already
  // shows the fresh geometry, and idle/loading are covered by the viewer overlay.
  const derived = status ? deriveRenderStatus(status) : null;
  const dot =
    derived &&
    (derived.state === "rendering" || derived.state === "error" || derived.state === "stale")
      ? STATE_STYLES[derived.state]
      : null;

  // "message", never "notice"/"alert"/"attention": this is a count, not a
  // verdict (see the file comment), and the readiness pill/Download's amber
  // dot own the wording for "something needs your attention" — a screen
  // reader user switching between the two controls should hear two distinct
  // claims, not the same one twice.
  const announcement = status ? renderAnnouncement(status) : null;
  const messagesArrived = useArrivingMessages(noticeCount, noticeKey ?? String(noticeCount));

  const action = outputOpen ? t("common.close") : t("common.open");
  const bellLabel = hasNotices
    ? tn("console.bellLabel", noticeCount, { action })
    : t("console.bellLabelEmpty", { action });

  return (
    <>
    <Button
      size="icon"
      variant="outline"
      className={cn("relative", outputOpen && "border-brand text-brand", className)}
      onClick={onToggleOutput}
      aria-label={bellLabel}
      aria-pressed={outputOpen}
      title="Messages"
      // How many messages are pending, independent of whether the badge is
      // currently rendering them: the stable hook the smoke suite reads to
      // know which half of the `showCount` contract applies, so the check
      // doesn't hang off the aria-label's English copy.
      data-notice-count={noticeCount}
    >
      <BellGlyph size={16} />
      {showBadge ? (
        <span
          // The same neutral "secondary" treatment Badge's own variant uses
          // elsewhere: a message count is not a verdict, so it never wears
          // --warn. Urgency belongs to the readiness pill alone (see the file
          // comment above), which keeps the bell from ever contradicting it.
          // `.output-toggle__count` is a stable hook class for the smoke suite
          // (see CLAUDE.md's script-hook convention): no stylesheet targets it.
          className="output-toggle__count pointer-events-none absolute top-[2px] right-[2px] inline-flex h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded-full bg-secondary px-[0.3rem] text-[0.7rem] font-bold leading-none tabular-nums text-secondary-foreground shadow-[0_0_0_2px_var(--panel)]"
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
    </Button>
      {/* Siblings of the bell, not children of it: the button carries an
          explicit aria-label, so anything inside it is name-computation
          territory rather than reliably-announced content. All three are
          sr-only (absolutely positioned), so they cost the bar no layout.

          The readout and the announcement want different text, hence two
          regions: `.render-status` is the stable hook the smoke/capture scripts
          poll for "N ms" and is deliberately not spoken. */}
      {derived && (
        <span className="render-status sr-only" aria-hidden="true">
          {`Render status: ${derived.text}`}
        </span>
      )}
      <span className="render-announce sr-only" role="status" aria-live="polite">
        {announcement ? t(announcement.key, announcement.vars) : ""}
      </span>
      {/* Messages arriving is its own status update, and the bell cannot make
          it: a count living in an aria-label on an unfocused button is never
          spoken. The tally, not the whole list — re-reading every line on every
          render is what dropping `aria-live` from the list itself was about,
          see OutputConsole. The child is keyed by arrival: replacing the node
          is what a screen reader treats as new content, and two consecutive
          arrivals can legitimately produce identical text. */}
      <span className="output-announce sr-only" role="status" aria-live="polite">
        {messagesArrived ? (
          <span key={messagesArrived.epoch}>
            {tn("output.messagesPending", noticeCount, { count: noticeCount })}
          </span>
        ) : null}
      </span>
    </>
  );
}

/**
 * Whether the pending messages just changed, with an epoch that increments per
 * change so the caller can force a fresh node.
 *
 * Keyed on a content signature, not a tally: `diagnostics` is re-parsed from
 * the current render's log every time, so one render's three notices being
 * replaced by three different ones is an arrival a count comparison cannot see.
 * Clears itself after a beat, so the region is quiet between renders and the
 * next change reads as new rather than as a standing label.
 */
function useArrivingMessages(count: number, signature: string): { epoch: number } | null {
  const seen = useRef(signature);
  const [state, setState] = useState<{ epoch: number } | null>(null);
  // Adjusted during render, not in an effect: React re-renders before painting,
  // so the region carries the announcement in the same frame the messages
  // land. `count === 0` is not an arrival — a cleared console, or a design with
  // no messages, has nothing to say.
  if (signature !== seen.current) {
    seen.current = signature;
    setState(count === 0 ? null : (prev) => ({ epoch: (prev?.epoch ?? 0) + 1 }));
  }
  // The clear lives in its own effect keyed on the state itself, so a second
  // arrival inside the window (or StrictMode's double invoke) restarts the
  // timer rather than leaving the region holding text with none left to clear
  // it.
  useEffect(() => {
    if (!state) return;
    const timer = setTimeout(() => setState(null), 2000);
    return () => clearTimeout(timer);
  }, [state]);
  return state;
}
