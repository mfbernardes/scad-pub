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
import { t, tn } from "../lib/i18n";

interface Props {
  /** A successful render that still matches the live controls (see
   * useRenderPipeline's `exportable` / docs/architecture-review.md H1) — not
   * just "some render has ever succeeded". Gates both Download and Image so
   * neither can ever act on a stale or superseded result. */
  canExport: boolean;
  modelFormat: string;
  onSavePng: () => void;
  attentionIssues?: string[];
}

export function ActionButtons({ canExport, modelFormat, onSavePng, attentionIssues = [] }: Props) {
  const { exportModel, copyLink } = useAppActions();
  const fmt = modelFormat.toUpperCase();
  const exportAria = t("dock.exportAria", { format: fmt });
      ? t("dock.buildingReason")
        ? t("dock.staleReason")

  return (
    <>
      {/* "Download", not "Export": the universal word for "get the file". The
          format rides along because the slicer needs it. */}
      {attentionIssues.length ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="default" disabled={!canExport} aria-label={`Download ${fmt}`}>
              <DownloadIcon size={16} /> Download {fmt}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Review before downloading</AlertDialogTitle>
              <AlertDialogDescription>
                The model rendered, but {attentionIssues.length === 1 ? "one issue needs" : `${attentionIssues.length} issues need`} your attention.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              {attentionIssues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
            <AlertDialogFooter>
              <AlertDialogCancel>Go back and fix</AlertDialogCancel>
              <AlertDialogAction onClick={exportModel}>Download anyway</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <Button
          size="sm"
          variant="default"
          className="hover:bg-primary hover:brightness-[1.08]"
          onClick={exportModel}
          disabled={!canExport}
          aria-label={`Download ${fmt}`}
        >
          <span className="action-export__label min-w-0 truncate">{t("action.export")}</span>
        </Button>
          {tn("review.issueCount", attentionCount)}
      )}
        aria-label={NATIVE_SHARE ? t("action.share") : t("dock.copyLink")}
        title={NATIVE_SHARE ? t("action.share") : t("dock.copyLink")}
        <span className="action-btn-label min-w-0 truncate">{NATIVE_SHARE ? t("action.share") : t("dock.copyLink")}</span>
      </Button>
    </>
  );
}
