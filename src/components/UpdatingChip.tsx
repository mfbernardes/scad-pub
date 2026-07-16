// UpdatingChip.tsx — compact top-centre chip shown over the viewer while a
// re-render replaces an already-visible model (see ViewerStage). Auto-render
// mode only: manual mode already has StaleBanner's own "Updating…" state for
// this, and showing both would double-message the same thing (see
// ViewerStage's gating comment). The full explanatory sentence rides as the
// title/aria-label; the visible label stays one short clause so it doesn't
// crowd the canvas.
//
// Invariant: a design switch never shows this chip. useRenderPipeline's
// resetForDesign clears `result` in the SAME state update that changes the
// design, so ViewerStage's loading overlay takes over instead — there is
// never "a previous design's result to keep showing" for this chip to
// caption. The retention rule (see ViewerStage's retainedResult doc) is also
// explicit that a design switch must never keep design A's geometry on
// screen under design B.
import { Spinner } from "./ui/spinner";
import { t } from "../lib/i18n";

export function UpdatingChip() {
  const full = t("loading.updatingPreview");
  // Visible label: the sentence's first clause only, so the chip stays one
  // line; the full sentence is still available to sighted users via the
  // native title tooltip and to AT via aria-label.
  const label = full.split(/[…,]/)[0].trim();
  return (
    <div
      className="updating-chip pointer-events-none flex items-center gap-2 whitespace-nowrap rounded-lg border border-(color:--glass-border) bg-(--glass-bg) px-[0.7rem] py-[0.35rem] text-[0.82rem] font-medium text-muted-foreground shadow-(--elevation)"
      role="status"
      aria-live="polite"
      title={full}
      aria-label={full}
    >
      <Spinner className="size-3.5" />
      {label}
    </div>
  );
}
