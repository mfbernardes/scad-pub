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
// PR16: mobile forces this row to a single line (index.css's `.action-cluster`
// mobile override, keyed off `.app-shell__mobile` — CSS only, not a JS
// isMobile branch, since this component is shared verbatim by both layouts).
// To make room, Image/Share drop their visible `.action-btn-label` text on
// mobile (their accessible name lives on `aria-label` regardless, so nothing
// is lost for assistive tech) and Export's secondary format line shrinks
// further via `.action-export__format-line`. Desktop is untouched — both
// hook classes are plain no-ops there.
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
import { Download as DownloadIcon, Image as ImageIcon, Link2 as LinkIcon, Share2 as ShareIcon } from "lucide-react";
import { t } from "../lib/i18n";
import { canShareNatively } from "../lib/share";

// Whether the Share button will actually hand off to the native OS share
// sheet on this device, rather than falling back to a clipboard copy — the
// same capability check copyLink()/shareUrl() apply when the button is
// clicked (see share.ts's own doc). Computed once at module load: the
// capability is a property of the device/browser, not of any render, so it
// can't change over the session — re-deriving it on every render would just
// repeat the same matchMedia() call for no benefit.
const NATIVE_SHARE = canShareNatively();

interface Props {
  /** A successful render that still matches the live controls (see
   * useRenderPipeline's `exportable` / docs/architecture-review.md H1) — not
   * just "some render has ever succeeded". Gates both Download and Image so
   * neither can ever act on a stale or superseded result. */
  canExport: boolean;
  modelFormat: string;
  onSavePng: () => void;
  /**
   * `readiness === "attention"` for the current render (see AppShell's
   * `hasExportAttention`) — PR22 replaced the old ambiguous corner dot with
   * an explicit `.export-attention` line in the action dock above this row
   * (see ExportAttention.tsx); this only wires Export's `aria-describedby`
   * to that visible line's id, so assistive tech gets the same signal a
   * sighted visitor already sees right above the button. Export NEVER gets
   * additionally disabled by this — `canExport` alone decides that; a
   * rendered-but-uncertain model is still a real file worth having.
   */
  hasAttention?: boolean;
}

export function ActionButtons({ canExport, modelFormat, onSavePng, hasAttention = false }: Props) {
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
        aria-describedby={hasAttention ? "export-attention-hint" : undefined}
      >
        <span className="inline-flex items-center justify-center gap-[0.35rem] whitespace-nowrap">
          <DownloadIcon size={16} /> {exportLabel}
        </span>
        {/* Visible, not a tooltip (tooltips fail on touch); kept small and
            light-weight (not dimmed via opacity — axe's dark-theme contrast
            check failed a semi-transparent white-on-accent-solid combination
            at this size, since small text needs 4.5:1) so the two-line
            button doesn't blow out the action cluster while staying AA. */}
        <span className="action-export__format-line text-center text-[0.68rem] leading-tight font-normal">{formatLine}</span>
      </Button>
      <Button size="sm" variant="ghost" onClick={onSavePng} disabled={!canExport} aria-label={t("action.saveImage")}>
        <ImageIcon size={16} /> <span className="action-btn-label">{t("action.image")}</span>
      </Button>
      {/* Icon + aria-label track what this click will actually do (NATIVE_SHARE,
          above): the native share sheet on a capable touch device (Share2,
          "Share"), or a clipboard copy everywhere else (Link2, "Copy share
          link") — copyLink() itself branches the same way at click time. */}
      <Button
        size="sm"
        variant="ghost"
        onClick={copyLink}
        aria-label={NATIVE_SHARE ? t("action.share") : t("action.copyShareLink")}
      >
        {NATIVE_SHARE ? <ShareIcon size={16} /> : <LinkIcon size={16} />}{" "}
        <span className="action-btn-label">{t("action.share")}</span>
      </Button>
    </>
  );
}
