// ActionButtons.tsx — the export dock's compact action card content, rendered
// identically in the desktop and mobile floating clusters (AppShell wraps
// both mounts in the same `.action-cluster` card — see ACTION_CLUSTER_CLASS's
// own doc). Export/Share come from the AppActions context; the PNG snapshot
// is AppShell-local glue (it needs the viewer ref) and stays a prop.
//
// Visual-alignment pass (mockup target: a compact card at the viewer's lower
// right on desktop, a single-row bar between the preview and the sheet on
// mobile — see AppShell's `.action-dock`/`.action-cluster` CSS doc for the
// responsive layout that turns these two rows into one on mobile): two rows.
//
//   Row 1 (`.action-row--primary`): the primary "Download for 3D printing"
//   button (produces the file — the app's reason to exist) with an attached
//   split "▾" trigger that opens a small menu holding the format note
//   (`export.formatNote`, e.g. "3MF · for slicers and print services") as an
//   informational label — nothing else lives there; format is fixed at build
//   time, so there's nothing to pick between.
//
//   Row 2 (`.action-row--secondary`): two equal, text-labelled secondary
//   buttons — "Share" (unchanged share logic/icons — canShareNatively()
//   still decides native-share-sheet vs. clipboard-copy at click time) and
//   "More", a menu holding "Save image" (the PNG snapshot that used to be
//   its own always-visible ghost button) and, only on a device where Share
//   goes native, "Copy link" — a clipboard-only fallback (copyLinkClipboard)
//   so a plain shareable link stays reachable even when Share itself never
//   offers one.
//
// On mobile the two rows collapse into a single row (index.css's
// `.action-cluster`/`.action-row--secondary` mobile overrides — CSS only,
// keyed off `.app-shell__mobile`, not a JS isMobile branch) — this component
// itself is unchanged between layouts.
import { useAppActions } from "../lib/appActions";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  ChevronDown as ChevronDownIcon,
  Download as DownloadIcon,
  Image as ImageIcon,
  Link2 as LinkIcon,
  MoreHorizontal as MoreIcon,
  Share2 as ShareIcon,
} from "lucide-react";
import { t, tn } from "../lib/i18n";
import { EXPORT_ATTENTION_HINT_ID } from "./ExportAttention";
import { canShareNatively } from "../lib/share";

// Whether the Share button will actually hand off to the native OS share
// sheet on this device, rather than falling back to a clipboard copy — the
// same capability check copyLink()/shareUrl() apply when the button is
// clicked (see share.ts's own doc). Computed once at module load: the
// capability is a property of the device/browser, not of any render, so it
// can't change over the session — re-deriving it on every render would just
// repeat the same matchMedia() call for no benefit. Also gates whether the
// More menu's "Copy link" fallback appears at all (see the module doc above).
const NATIVE_SHARE = canShareNatively();

interface Props {
  /** A successful render that still matches the live controls (see
   * useRenderPipeline's `exportable` / docs/architecture-review.md H1) — not
   * just "some render has ever succeeded". Gates Download and the "Save
   * image" menu entry so neither can ever act on a stale or superseded
   * result. Share/"Copy link" are unaffected — sharing the current config
   * link never depended on a render existing. */
  canExport: boolean;
  modelFormat: string;
  onSavePng: () => void;
  /**
   * `readiness === "attention"` for the current render (see AppShell's
   * `hasExportAttention`) — wires the primary button's `aria-describedby` to
   * an element carrying the same "N issues to review" text. In "tabs"
   * workflow that's the visible `.export-attention` line riding above this
   * card (see ExportAttention.tsx), which owns `id="export-attention-hint"`
   * there. In "guided" workflow `ExportAttention` is never mounted (see
   * AppShell's `showExportAttentionBanner`), so `GuidedActionButtons` below
   * renders its own sr-only element carrying that id instead — see
   * `attentionCount`. Export NEVER gets additionally disabled by this —
   * `canExport` alone decides that; a rendered-but-uncertain model is still a
   * real file worth having.
   */
  hasAttention?: boolean;
  /**
   * Guided workflow only: `attention.length` — the count `GuidedActionButtons`
   * needs to (a) render the sr-only `#export-attention-hint` text the
   * Download button's `aria-describedby` points at, and (b) show a small
   * amber dot on the button, mirroring the Review step-chip's own attention
   * dot (QuickStart.tsx's `quick-start__step-attention`), as a visual "this
   * will route you to Review" signal. Ignored in "tabs" mode. Defaults to 0
   * so an omitted count never renders a dot even if `hasAttention` is
   * (incorrectly) true.
   */
  attentionCount?: number;
  /**
   * Wave 1's `ui.workflow` (default `"tabs"`, see docs/config.md). `"tabs"`
   * renders the split-button/More-menu markup below exactly as before.
   * `"guided"` renders exactly two direct buttons — Download and Share, no
   * dropdowns — via `GuidedActionButtons` below.
   */
  workflow?: "tabs" | "guided";
  /**
   * Guided-workflow only: routes the primary button's click through
   * AppShell's own "download while unresolved issues exist" flow
   * (`handleDownloadClick`) instead of calling `exportModel` directly — see
   * that callback's own doc. Ignored (and `exportModel` used directly) in
   * tabs mode, and falls back to `exportModel` if omitted so a guided caller
   * that forgets to wire it still downloads rather than doing nothing.
   */
  onDownloadClick?: () => void;
}

/**
 * Guided workflow's export dock (Wave 1): exactly two direct buttons —
 * primary "Download for 3D printing" (the format note as a small caption
 * underneath, no menu) and "Share" — no split trigger, no format dropdown,
 * no More menu, no "Save image"/"Copy link" (those stay tabs-mode-only; see
 * the module doc). The primary button's click goes through `onDownload`
 * (AppShell's `handleDownloadClick`) rather than `exportModel` directly, so
 * a guided deployment's "download with unresolved issues" confirmation flow
 * can intercept it — see ActionButtons' own `onDownloadClick` doc.
 *
 * UX-plan 2.1: on mobile (index.css's guided-mobile overrides) Download
 * fills the row (`flex: 1 1 auto`) and Share stays content-sized
 * (`flex: none`) so the two buttons absorb the row's full width instead of
 * leaving dead space beside it. The Download label always reads the full
 * "Download for 3D printing" (`action.export`) at every width — directive:
 * no short-label swap — so below ~360px it's Share that gives up its own
 * text label (index.css's pre-existing shared tier-two rule) rather than
 * Download ever shortening.
 */
function GuidedActionButtons({
  canExport,
  modelFormat,
  hasAttention,
  attentionCount,
  onDownload,
}: {
  canExport: boolean;
  modelFormat: string;
  hasAttention: boolean;
  attentionCount: number;
  onDownload: () => void;
}) {
  const { copyLink } = useAppActions();
  const fmt = modelFormat.toUpperCase();
  // Directive: the primary Download label always reads "Download for 3D
  // printing" (`action.export`) at every width, no exceptions — the
  // ≤360px short-label swap (UX-plan 2.2) has been removed; Share reverts
  // to icon-only at that tier instead (index.css's pre-existing shared
  // rule) to make room on the one-row dock.
  const exportLabel = t("action.export");
  const formatLine = t("export.formatNote", { format: fmt });
  const exportAria = t("action.exportAria", { format: fmt });
  const shareAria = NATIVE_SHARE ? t("action.share") : t("action.copyShareLink");
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
        {/* Visual "pressing Download will route you to Review" signal —
            same dot treatment as the Review step-chip's own attention dot
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
      <p className="action-export-format-note px-[0.2rem] text-[0.72rem] text-muted-foreground">
        {formatLine}
      </p>
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

export function ActionButtons({
  canExport,
  modelFormat,
  onSavePng,
  hasAttention = false,
  attentionCount = 0,
  workflow = "tabs",
  onDownloadClick,
}: Props) {
  const { exportModel, copyLink, copyLinkClipboard } = useAppActions();
  const fmt = modelFormat.toUpperCase();
  const exportLabel = t("action.export");
  const formatLine = t("export.formatNote", { format: fmt });
  // A dedicated aria/title key (not a concatenation of the two visible lines)
  // so the parenthetical form stays natural per-locale rather than assuming
  // English's "X (Y)" punctuation — scripts/smoke.mjs selects `.action-export`
  // (a stable hook, not the label text, which is expected to keep evolving).
  const exportAria = t("action.exportAria", { format: fmt });
  const shareAria = NATIVE_SHARE ? t("action.share") : t("action.copyShareLink");

  if (workflow === "guided") {
    return (
      <GuidedActionButtons
        canExport={canExport}
        modelFormat={modelFormat}
        hasAttention={hasAttention}
        attentionCount={attentionCount}
        onDownload={onDownloadClick ?? exportModel}
      />
    );
  }

  return (
    <>
      {/* Row 1: primary Download button + attached split trigger (format
          info only — nothing to pick between, format is fixed at build
          time). `role="group"` names the pair for assistive tech, mirroring
          the standard split-button pattern. */}
      <div className="action-row action-row--primary flex items-stretch" role="group" aria-label={exportLabel}>
        <Button
          size="sm"
          variant="default"
          className="action-export min-w-0 flex-1 justify-center gap-[0.35rem] rounded-r-none whitespace-nowrap hover:bg-primary hover:brightness-[1.08]"
          onClick={exportModel}
          disabled={!canExport}
          aria-label={exportAria}
          title={exportAria}
          aria-describedby={hasAttention ? EXPORT_ATTENTION_HINT_ID : undefined}
        >
          <DownloadIcon size={16} aria-hidden="true" className="shrink-0" />
          <span className="action-export__label min-w-0 truncate">{exportLabel}</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="default"
              className="action-export-options shrink-0 rounded-l-none border-l border-primary-foreground/25 px-2 hover:bg-primary hover:brightness-[1.08]"
              disabled={!canExport}
              aria-label={t("action.exportOptions")}
              title={t("action.exportOptions")}
            >
              <ChevronDownIcon size={16} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="action-export-menu">
            {/* Informational only — format is fixed at build time, so this is
                the one thing worth telling a visitor about the download
                rather than an actual choice. */}
            <DropdownMenuLabel className="action-export-menu__format-note font-normal whitespace-normal">
              {formatLine}
            </DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Round-2 review item 4: the format note visible directly in the card
          on desktop (the mockup's small sublabel under the primary row),
          not hidden a click away behind the split "▾" trigger — that menu
          entry stays too (`action-export-menu__format-note` above) rather
          than being emptied out, since the split trigger needs SOME content
          when opened. `.action-export-format-note` is CSS-hidden on mobile
          (see index.css) as part of this same item's "tighter mobile
          height" ask — mobile's single-row card has no room for a second
          text line, and the split trigger there still carries the note. */}
      <p className="action-export-format-note px-[0.2rem] text-[0.72rem] text-muted-foreground">
        {formatLine}
      </p>

      {/* Row 2: two equal, text-labelled secondary actions. */}
      <div className="action-row action-row--secondary">
        <Button
          size="sm"
          variant="outline"
          className="action-share flex-1 min-w-0"
          onClick={copyLink}
          aria-label={shareAria}
          title={shareAria}
        >
          {/* Round-2 review item 3: the standard share glyph in EVERY case,
              including the clipboard-copy fallback (no native share sheet on
              this device/browser) — it's still the Share button, just backed
              by a different mechanism; the label/aria (shareAria above)
              already says "Copy share link" there, so the icon change adds
              no ambiguity. The More menu's own dedicated "Copy link" entry
              below is a genuinely distinct, always-a-clipboard-copy action
              and keeps the chain-link glyph. */}
          <ShareIcon size={16} aria-hidden="true" className="shrink-0" />
          <span className="action-btn-label min-w-0 truncate">{t("action.share")}</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="action-more flex-1 min-w-0"
              aria-label={t("action.more")}
              title={t("action.more")}
            >
              <MoreIcon size={16} aria-hidden="true" className="shrink-0" />
              <span className="action-btn-label min-w-0 truncate">{t("action.more")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="action-more-menu">
            <DropdownMenuItem
              className="action-more-menu__save-image"
              onClick={onSavePng}
              disabled={!canExport}
            >
              <ImageIcon size={15} aria-hidden="true" /> {t("action.saveImage")}
            </DropdownMenuItem>
            {/* Only when Share itself goes native (see the module doc above):
                a plain clipboard copy would otherwise have no way in. */}
            {NATIVE_SHARE && (
              <DropdownMenuItem className="action-more-menu__copy-link" onClick={copyLinkClipboard}>
                <LinkIcon size={15} aria-hidden="true" /> {t("action.copyShareLink")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
