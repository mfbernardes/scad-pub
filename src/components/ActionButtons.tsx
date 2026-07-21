// ActionButtons.tsx — the export dock's content, rendered identically in the
// desktop and mobile floating clusters (AppShell wraps both mounts in the
// same `.action-cluster` card — see ACTION_CLUSTER_CLASS's own doc). Export
// comes from the AppActions context via `exportModel`, but a click routes
// through AppShell's `onDownloadClick` first (see its own doc): only a
// "ready" render exports directly — anything else opens the Review dialog
// (ReviewDialog.tsx) instead.
//
// A single row: the primary "Download for 3D printing" button (produces the
// file — the app's reason to exist), plus one secondary "Share" button. The
// PNG snapshot moved out of this dock into the overflow surfaces (mobile's
// BarActions ⋮ menu, desktop's CommandBar — see BarActions.tsx) — the dock's
// job is strictly "get the model out", and Save-image is a lower-frequency
// action that doesn't need standing real estate here.
import { useAppActions } from "../lib/appActions";
import { Button } from "./ui/button";
import { Download as DownloadIcon, Share2 as ShareIcon, Link2 as LinkIcon } from "lucide-react";
import type { ReadinessState } from "../lib/readiness";
import { canShareNatively } from "../lib/share";

// The id the Download button's `aria-describedby` points at, and the sr-only
// span below carries — assistive tech gets the same "N issues to review"
// signal a sighted visitor sees via the amber dot + status strip.
export const EXPORT_ATTENTION_HINT_ID = "export-attention-hint";

// The id the sr-only note explaining WHY Download is currently disabled is
// published under, and the button's `aria-describedby` points at when
// disabled — a disabled button fires no pointer events, so the `title` below
// lives on a wrapping <span> instead (the button itself still carries this
// aria-describedby for assistive tech, which the wrapper's title doesn't
// reach).
export const DOWNLOAD_DISABLED_HINT_ID = "download-disabled-hint";

// Whether the Share button will actually hand off to the native OS share
// sheet on this device, rather than falling back to a clipboard copy — the
// same capability check copyLink() applies when clicked (see share.ts's own
// doc). Computed once at module load: the capability is a property of the
// device/browser, not of any render, so it can't change over the session.
const NATIVE_SHARE = canShareNatively();

interface Props {
  modelFormat: string;
  /** A successful render that still matches the live controls (see
   * useRenderPipeline's `exportable` / docs/architecture-review.md H1). Only
   * gates the direct-export path (`readiness === "ready"`) — an
   * attention/failed/building render still gets a clickable Download button,
   * just routed through the Review dialog instead of exporting. */
  canExport: boolean;
  readiness: ReadinessState;
  /** attention.length — drives the amber dot + sr-only hint. */
  attentionCount: number;
  onDownloadClick: () => void;
}

export function ActionButtons({ modelFormat, canExport, readiness, attentionCount, onDownloadClick }: Props) {
  const { copyLink } = useAppActions();
  const fmt = modelFormat.toUpperCase();
  const hasAttention = readiness === "attention";
  // The format rides in aria-label/title (a slicer needs it), not the visible
  // label — "Download for 3D printing" reads the same regardless of format.
  const exportAria = `Download ${fmt} for slicers and print services`;
  // Mirrors ActionButtons' own `disabled` gate: "building" (nothing has
  // rendered yet, so there's nothing to review either) and "ready but the
  // render no longer matches the live controls" are the only two states that
  // actually disable the button — "attention"/"failed" stay clickable,
  // routed through the Review dialog instead of exporting (see the
  // `canExport` doc above). Named so the title/aria-describedby below always
  // matches whichever branch actually disabled it.
  const disabledReason =
    readiness === "building"
      ? "Still building the preview…"
      : readiness === "ready" && !canExport
        ? "Preview out of date — render first"
        : null;
  const disabled = disabledReason !== null;

  return (
    <>
      {/* A disabled <button> fires no pointer events, so its own `title`
          never shows — the explanatory title lives on this wrapping span
          instead. Sizing classes (min-w-0, the narrow-viewport flex-1) move
          here too, so it — not the Button — is the actual `.action-cluster`
          flex item. */}
      <span className="inline-flex min-w-0 max-[360px]:flex-1" title={disabledReason ?? undefined}>
        <Button
          size="sm"
          variant="default"
          className="action-export w-full min-w-0 justify-center gap-[0.35rem] whitespace-nowrap hover:bg-primary hover:brightness-[1.08]"
          onClick={onDownloadClick}
          disabled={disabled}
          aria-label={exportAria}
          title={exportAria}
          aria-describedby={disabledReason ? DOWNLOAD_DISABLED_HINT_ID : hasAttention ? EXPORT_ATTENTION_HINT_ID : undefined}
        >
          <DownloadIcon size={16} aria-hidden="true" className="shrink-0" />
          <span className="action-export__label min-w-0 truncate">Download for 3D printing</span>
          {/* Visual "something here still needs a look" signal — same amber
              treatment as the status strip. Decorative only; the sr-only hint
              below carries the actual meaning. */}
          {hasAttention && (
            <span aria-hidden="true" className="action-export__attention size-[6px] shrink-0 rounded-full bg-warn" />
          )}
        </Button>
      </span>
      {hasAttention && (
        <span id={EXPORT_ATTENTION_HINT_ID} className="sr-only">
          {attentionCount} issue{attentionCount === 1 ? "" : "s"} to review
        </span>
      )}
      {disabledReason && (
        <span id={DOWNLOAD_DISABLED_HINT_ID} className="sr-only">
          {disabledReason}
        </span>
      )}
      {/* Share honesty: the label/icon/aria-label match what a click will
          actually do — native OS share sheet on a capable touch device, a
          plain clipboard copy everywhere else (see NATIVE_SHARE's own doc).
          copyLink() itself re-derives the same capability at click time and
          announces the outcome via a toast either way. */}
      <Button
        size="sm"
        variant="ghost"
        className="action-share min-w-0 max-[360px]:flex-none"
        onClick={copyLink}
        aria-label={NATIVE_SHARE ? "Share" : "Copy link"}
        title={NATIVE_SHARE ? "Share" : "Copy link"}
      >
        {NATIVE_SHARE ? (
          <ShareIcon size={16} aria-hidden="true" className="shrink-0" />
        ) : (
          <LinkIcon size={16} aria-hidden="true" className="shrink-0" />
        )}
        <span className="action-btn-label min-w-0 truncate">{NATIVE_SHARE ? "Share" : "Copy link"}</span>
      </Button>
    </>
  );
}
