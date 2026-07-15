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
//
// PR9 CTA rewrite: the primary button used to read "Download {format}" — the
// universal word for "get the file", with the format riding along because the
// slicer needs it. That undersold what the button actually does (produce a
// ready-to-print 3D model, not an arbitrary file) and buried the one piece of
// information a first-time visitor needs to trust the button at all — what
// format they're about to get. The outcome now leads ("Export 3D model"); the
// format stays visible (not hidden in a tooltip — tooltips don't exist on
// touch) as a small, deliberately quiet secondary line so the button doesn't
// blow out the compact action cluster. Both strings are ordinary catalogue
// keys (`action.export` / `export.formatNote`), so a deployment can still
// override either one via `strings` same as before.
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
  const exportLabel = t("action.export");
  const formatLine = t("export.formatNote", { format: fmt });
  // A dedicated aria/title key (not a concatenation of the two visible lines)
  // so the parenthetical form stays natural per-locale rather than assuming
  // English's "X (Y)" punctuation — scripts/smoke.mjs selects `.action-export`
  // (a stable hook, not the label text, which is expected to keep evolving).
  const exportAria = t("action.exportAria", { format: fmt });

  return (
    <>
      <Button
        size="sm"
        variant="default"
        // min-w-0 lets this flex item shrink below its content's natural
        // width instead of forcing the row (and the whole cluster) wider
        // than the viewport; whitespace-normal then lets the longer format
        // line wrap onto a second line once it's squeezed that far — the
        // short main label keeps fitting on one line regardless. Verified
        // at a 320px viewport (the narrowest realistic target).
        className="action-export h-auto min-w-0 flex-col items-stretch gap-0 whitespace-normal py-[0.4rem] hover:bg-primary hover:brightness-[1.08]"
        onClick={exportModel}
        disabled={!canExport}
        aria-label={exportAria}
        title={exportAria}
      >
        <span className="inline-flex items-center justify-center gap-[0.35rem] whitespace-nowrap">
          <DownloadIcon size={16} /> {exportLabel}
        </span>
        {/* Visible, not a tooltip (tooltips fail on touch); kept small and
            light-weight (not dimmed via opacity — axe's dark-theme contrast
            check failed a semi-transparent white-on-accent-solid combination
            at this size, since small text needs 4.5:1) so the two-line
            button doesn't blow out the action cluster while staying AA. */}
        <span className="text-center text-[0.68rem] leading-tight font-normal">{formatLine}</span>
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
