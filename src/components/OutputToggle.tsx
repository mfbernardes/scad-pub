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
import { deriveRenderStatus, STATE_STYLES, type RenderStatusInput } from "../lib/renderStatus";
import { Bell as BellIcon, BellRing as BellRingIcon } from "lucide-react";
import { t, tn } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";

interface Props {
  outputOpen: boolean;
  /** How many notices/warnings are pending: shown as a corner count badge when
   *  > 0 and `showCount` is true. */
  noticeCount?: number;
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
  showCount = true,
  onToggleOutput,
  status,
  className,
}: Props) {
  useLocale(); // subscription only: re-render this component's t()/tn() calls on a locale switch
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
  const action = outputOpen ? t("common.close") : t("common.open");
  const bellLabel = hasNotices
    ? tn("console.bellLabel", noticeCount, { action })
    : t("console.bellLabelEmpty", { action });

  // OutputConsole's own notices list only exists in the DOM while the console
  // is open AND its Notices tab is the active Radix tab, so a fresh render's
  // warnings/asserts go unannounced whenever either isn't true (WCAG 4.1.3).
  // This region lives on the bell instead, which is always mounted, and
  // announces only a RISE in the count — reopening/switching tabs doesn't
  // change noticeCount, so it stays silent for those.
  const prevCount = useRef(noticeCount);
  // `seq` forces a DOM mutation on every rise even when the announced text is
  // identical to a prior one (e.g. 0->1, 1->0, 0->1 all say "1 new message"):
  // React bails out on an unchanged string, so a repeat would otherwise never
  // reach the DOM and a screen reader would never hear it. Keying the text
  // node on `seq` makes each rise a fresh insertion instead of a same-text
  // update.
  const [announcement, setAnnouncement] = useState({ text: "", seq: 0 });
  useEffect(() => {
    if (noticeCount > prevCount.current) {
      const text = tn("console.newMessages", noticeCount - prevCount.current);
      setAnnouncement((prev) => ({ text, seq: prev.seq + 1 }));
    }
    prevCount.current = noticeCount;
  }, [noticeCount]);

  return (
    <Button
      size="icon"
      variant="outline"
      className={cn("relative", outputOpen && "border-brand text-brand", className)}
      onClick={onToggleOutput}
      aria-label={bellLabel}
      aria-pressed={outputOpen}
      title={t("console.title")}
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
      {/* Keep the render status available to assistive tech, and as the stable
          `render-status` hook the smoke/capture scripts read for completion. */}
      {derived && (
        <span className="render-status sr-only" role="status" aria-live="polite">
          {t("status.renderStatusPrefix", { status: derived.text })}
        </span>
      )}
      {/* Persistent (unlike OutputConsole's own list, which unmounts on close
          or a non-Notices tab) live region announcing a rise in the notice
          count. */}
      <span className="sr-only" role="status" aria-live="polite">
        <span key={announcement.seq}>{announcement.text}</span>
      </span>
    </Button>
  );
}
