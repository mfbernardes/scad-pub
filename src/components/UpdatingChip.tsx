// UpdatingChip.tsx — compact top-centre chip shown over the viewer while a
// re-render replaces an already-visible model (see ViewerStage). Auto-render
// mode only: manual mode already has StaleBanner's own "Updating…" state for
// this, and showing both would double-message the same thing (see
// ViewerStage's gating comment). The full explanatory sentence rides as the
// title/aria-label; the visible label stays one short clause so it doesn't
// crowd the canvas.
import { Spinner } from "./ui/spinner";
import { t } from "../lib/i18n";

interface Props {
  /**
   * Non-null -> the design-switch variant ("Switching to {design}…"). Note:
   * under the current render pipeline (useRenderPipeline's resetForDesign)
   * `result` is cleared in the SAME state update that changes the design, so
   * ViewerStage never actually has "a previous result to keep showing" at
   * the moment a design switch starts — this prop exists so the copy is
   * ready the moment that changes, not because it fires today.
   */
  design?: string | null;
}

export function UpdatingChip({ design }: Props) {
  const full = design ? t("loading.switchingDesign", { design }) : t("loading.updatingPreview");
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
