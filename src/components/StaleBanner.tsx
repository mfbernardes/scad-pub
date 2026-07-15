// StaleBanner.tsx — floating "preview out of date" alert over the viewer. This
// is the primary signal that what you're looking at no longer matches the
// controls: auto-render is off and a parameter changed since the last render.
// The whole banner is the render call-to-action. While a manual render runs it
// shows progress, so heavy renders — the main reason auto-render is ever off —
// aren't silent. It renders nothing while the preview is live (auto-render on,
// or nothing has changed), so the viewer chrome stays clean in the common case.
import { RefreshCw as RefreshIcon } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";
import { pauseReasonText } from "../lib/pauseReason";
import type { PauseReason } from "../lib/renderState";

interface Props {
  autoRender: boolean;
  rendering: boolean;
  /** Auto-render off AND params/preset/design changed since the last render. */
  stalePreview: boolean;
  /** Why live preview is off ("heavy" brake / "manual-design" start), or null
   *  when there's nothing to explain (the user paused it themselves). When
   *  set, an extra muted line explains it and the reason folds into
   *  aria-label — see renderState.ts's PauseReason doc. */
  pauseReason: PauseReason;
  onRender: () => void;
  className?: string;
}

export function StaleBanner({ autoRender, rendering, stalePreview, pauseReason, onRender, className = "" }: Props) {
  // Auto-render keeps the preview live — the banner is a manual-mode concern only.
  if (autoRender) return null;
  if (!rendering && !stalePreview) return null;

  const reasonText = pauseReason ? pauseReasonText(pauseReason) : null;
  const baseLabel = rendering ? t("stale.ariaUpdating") : t("stale.ariaOutOfDate");
  const ariaLabel = reasonText ? `${baseLabel} — ${reasonText}` : baseLabel;

  return (
    <button
      type="button"
      className={cn(
        // Positioning comes from the .stale-banner CSS block (per-layout offsets).
        "stale-banner group flex cursor-pointer flex-col items-start gap-[0.15rem] whitespace-nowrap rounded-lg border border-(color:--glass-border) bg-(--glass-bg) py-[0.35rem] pl-[0.7rem] pr-[0.4rem] text-[0.82rem] font-medium text-foreground shadow-(--elevation) enabled:hover:border-brand",
        rendering && "cursor-default pr-[0.7rem] text-muted-foreground",
        className
      )}
      onClick={rendering ? undefined : onRender}
      disabled={rendering}
      aria-label={ariaLabel}
    >
      <span className="inline-flex items-center gap-2">
        {rendering ? (
          <>
            <Spinner className="size-4" /> {t("stale.updating")}
          </>
        ) : (
          <>
            {/* Amber pulsing dot — "attention, but not an error". */}
            <span
              className="size-[7px] shrink-0 animate-[pill-pulse_1.4s_ease-in-out_infinite] rounded-full bg-warn motion-reduce:animate-none"
              aria-hidden="true"
            />
            {t("stale.banner")}
            <span className="inline-flex items-center gap-[0.3rem] rounded-(--radius-sm) bg-primary px-2 py-[0.2rem] font-semibold text-primary-foreground group-hover:brightness-[1.08]">
              <RefreshIcon size={14} /> {t("stale.update")}
            </span>
          </>
        )}
      </span>
      {/* Compact explanation line — why live preview is off, not just that it
          is. aria-hidden: already folded into the button's own aria-label
          above, so AT wouldn't hear it twice. */}
      {reasonText && (
        <span className="text-[0.72rem] font-normal text-muted-foreground" aria-hidden="true">
          {reasonText}
        </span>
      )}
    </button>
  );
}
