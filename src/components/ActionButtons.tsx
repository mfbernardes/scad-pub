// ActionButtons.tsx — the shared "produce a file" row, rendered identically in
// the desktop ActionCluster and the mobile floating cluster (same compact glass
// pill in both). Export/Share come from the AppActions context; the PNG snapshot
// is AppShell-local glue (it needs the viewer ref) and stays a prop.
//
// This row is purely about getting a result OUT: Export is the filled primary
// (the app's reason to exist), PNG and Share are quiet ghost secondaries. The
// Output console toggle now rides in the top bar (as a status-bearing bell) in
// both layouts, so it's no longer here. Render-mode (auto-render) and the "needs
// re-render" call-to-action live elsewhere — the params footer and the viewer's
// StaleBanner respectively — so this bar has a single, stable shape.
import { useAppActions } from "../lib/appActions";
import { Button } from "./ui/button";
import { Download as DownloadIcon, Image as ImageIcon, Link2 as LinkIcon } from "lucide-react";
import { t } from "../lib/i18n";

interface Props {
  /** A successful render that still matches the live controls (see
   * useRenderPipeline's `exportable` / docs/architecture-review.md H1) — not
   * just "some render has ever succeeded". Gates both Download and Image so
   * neither can ever act on a stale or superseded result. */
  canExport: boolean;
  modelFormat: string;
  onSavePng: () => void;
}

export function ActionButtons({ canExport, modelFormat, onSavePng }: Props) {
  const { exportModel, copyLink } = useAppActions();
  const fmt = modelFormat.toUpperCase();
  // Same key drives both the visible label and the aria-label, so they never
  // drift apart — scripts/smoke.mjs selects [aria-label^="Download "].
  const downloadLabel = t("action.download", { format: fmt });

  return (
    <>
      {/* "Download", not "Export": the universal word for "get the file". The
          format rides along because the slicer needs it. */}
      <Button
        size="sm"
        variant="default"
        className="hover:bg-primary hover:brightness-[1.08]"
        onClick={exportModel}
        disabled={!canExport}
        aria-label={downloadLabel}
      >
        <DownloadIcon size={16} /> {downloadLabel}
      </Button>
      <Button size="sm" variant="ghost" onClick={onSavePng} disabled={!canExport} aria-label={t("action.saveImage")}>
        <ImageIcon size={16} /> {t("action.image")}
      </Button>
      <Button size="sm" variant="ghost" onClick={copyLink} aria-label={t("action.copyShareLink")}>
        <LinkIcon size={16} /> {t("action.share")}
      </Button>
    </>
  );
}
