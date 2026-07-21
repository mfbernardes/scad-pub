// UpdatingChip.tsx — compact top-centre chip shown over the viewer while a
// re-render replaces an already-visible model (see ViewerStage). Auto-render
// mode only: manual mode already has StaleBanner's own "Updating…" state for
// this (StaleBanner returns null while autoRender is on, so the two can
// never both show), and showing both would double-message the same thing.
import { Spinner } from "./ui/spinner";

export function UpdatingChip() {
  return (
    <div
      className="updating-chip pointer-events-none flex items-center gap-2 whitespace-nowrap rounded-lg border border-(color:--glass-border) bg-(--glass-bg) py-[0.35rem] pl-[0.7rem] pr-[0.7rem] text-[0.82rem] font-medium text-muted-foreground shadow-(--elevation)"
      role="status"
      aria-live="polite"
    >
      <Spinner className="size-3.5" />
      Updating…
    </div>
  );
}
