// ActionButtons.tsx — the export dock's compact card content, rendered
// identically in the desktop and mobile floating clusters (AppShell wraps
// both mounts in the same `.action-cluster` card — see ACTION_CLUSTER_CLASS's
// own doc) AND identically across every `ui.workflow` mode. Export/Share come
// from the AppActions context.
//
// Unification pass: this used to branch on a `workflow` prop — "tabs" got a
// two-row card (primary Download + a split "▾" trigger holding the format
// note, plus a secondary row of Share and a "More" menu with "Save image"/
// "Copy link"), "guided" got a single row of exactly two direct buttons. User
// directive: no extra buttons in ANY workflow — the guided treatment is now
// the ONLY treatment. There is no longer a `workflow` prop or a second
// rendering path; the split trigger, the format-note caption, the "More"
// menu, "Save image", and "Copy link" are gone everywhere, not just in
// guided mode. The PNG snapshot (`onSavePng`) lived only in the removed
// "More" menu, so AppShell no longer passes it down either — see AppShell's
// own doc for that plumbing.
//
// A single row: the primary "Download for 3D printing" button (produces the
// file — the app's reason to exist), plus one secondary "Share" button
// (unchanged share logic/icons — canShareNatively() still decides
// native-share-sheet vs. clipboard-copy at click time). Download's amber
// attention dot + the sr-only `#export-attention-hint` span (wired to
// Download's `aria-describedby`) apply in every workflow now, not just
// guided — see `hasAttention`/`attentionCount` below.
import { useAppActions } from "../lib/appActions";
import { Button } from "./ui/button";
import { Download as DownloadIcon, Share2 as ShareIcon } from "lucide-react";
import { t, tn } from "../lib/i18n";
import { canShareNatively } from "../lib/share";

// The id the Download button's `aria-describedby` points at, and the sr-only
// span below carries — assistive tech gets the same "N issues to review"
// signal a sighted visitor sees via the amber dot + Review stage. Was
// previously declared in the now-deleted ExportAttention.tsx (the standing
// viewer-overlay banner that owned this id); moved here since this is now
// the only place that renders an element with this id.
export const EXPORT_ATTENTION_HINT_ID = "export-attention-hint";

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
   * just "some render has ever succeeded". Gates Download so it can never act
   * on a stale or superseded result. Share is unaffected — sharing the
   * current config link never depended on a render existing. */
  canExport: boolean;
  modelFormat: string;
  /**
   * `readiness === "attention"` for the current render (see AppShell's
   * `hasExportAttention`) — wires the primary button's `aria-describedby` to
   * the sr-only `#export-attention-hint` span below and shows a small amber
   * dot on the button, mirroring the Review step-chip's own attention dot
   * (QuickStart.tsx's `quick-start__step-attention`). Export NEVER gets
   * additionally disabled by this — `canExport` alone decides that; a
   * rendered-but-uncertain model is still a real file worth having.
   */
  hasAttention?: boolean;
  /**
   * `attention.length` — the count this component needs to render the
   * sr-only `#export-attention-hint` text Download's `aria-describedby`
   * points at. Defaults to 0 so an omitted count never renders a dot even if
   * `hasAttention` is (incorrectly) true.
   */
  attentionCount?: number;
  /**
   * Guided workflow's "download while unresolved issues exist" flow
   * (AppShell's `handleDownloadClick`) — routes the primary button's click
   * through it instead of calling `exportModel` directly, so a guided
   * deployment can intercept the click with a just-in-time confirmation.
   * `handleDownloadClick` itself is workflow-aware (it only intercepts in
   * guided mode; elsewhere it calls `exportModel` straight through), so
   * AppShell can wire this up unconditionally. Falls back to `exportModel`
   * if omitted so a caller that forgets to wire it still downloads rather
   * than doing nothing.
   */
  onDownloadClick?: () => void;
}

/**
 * UX-plan 2.1: on mobile (index.css's mobile overrides) Download fills the
 * row (`flex: 1 1 auto`) and Share stays content-sized (`flex: none`) so the
 * two buttons absorb the row's full width instead of leaving dead space
 * beside it. The Download label always reads the full "Download for 3D
 * printing" (`action.export`) at every width — directive: no short-label
 * swap — so below ~360px it's Share that gives up its own text label
 * (index.css's shared tier-two rule) rather than Download ever shortening.
 */
export function ActionButtons({
  canExport,
  modelFormat,
  hasAttention = false,
  attentionCount = 0,
  onDownloadClick,
}: Props) {
  const { exportModel, copyLink } = useAppActions();
  const fmt = modelFormat.toUpperCase();
  // A dedicated aria/title key (not a concatenation of the two visible lines)
  // so the parenthetical form stays natural per-locale rather than assuming
  // English's "X (Y)" punctuation — scripts/smoke.mjs selects `.action-export`
  // (a stable hook, not the label text, which is expected to keep evolving).
  const exportAria = t("action.exportAria", { format: fmt });
  const exportLabel = t("action.export");
  const shareAria = NATIVE_SHARE ? t("action.share") : t("action.copyShareLink");
  const onDownload = onDownloadClick ?? exportModel;

  return (
    <>
      <Button
        size="sm"
        variant="default"
        className="action-export min-w-0 justify-center gap-[0.35rem] whitespace-nowrap hover:bg-primary hover:brightness-[1.08]"
        onClick={onDownload}
        disabled={!canExport}
        aria-label={exportAria}
        title={exportAria}
        aria-describedby={hasAttention ? EXPORT_ATTENTION_HINT_ID : undefined}
      >
        <DownloadIcon size={16} aria-hidden="true" className="shrink-0" />
        <span className="action-export__label min-w-0 truncate">{exportLabel}</span>
        {/* Visual "something here still needs a look" signal — same dot
            treatment as the Review step-chip's own attention dot
            (QuickStart.tsx `quick-start__step-attention`). Decorative only;
            the sr-only hint below carries the actual meaning. */}
        {hasAttention && (
          <span aria-hidden="true" className="action-export__attention size-[6px] shrink-0 rounded-full bg-warn" />
        )}
      </Button>
      {hasAttention && (
        <span id={EXPORT_ATTENTION_HINT_ID} className="sr-only">
          {tn("export.attentionLine", attentionCount)}
        </span>
      )}
      <Button
        size="sm"
        variant="outline"
        className="action-share min-w-0"
        onClick={copyLink}
        aria-label={shareAria}
        title={shareAria}
      >
        <ShareIcon size={16} aria-hidden="true" className="shrink-0" />
        <span className="action-btn-label min-w-0 truncate">{t("action.share")}</span>
      </Button>
    </>
  );
}
