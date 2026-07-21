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
import { Download as DownloadIcon, Link2 as LinkIcon } from "lucide-react";
import type { ReadinessState } from "../lib/readiness";

// The id the Download button's `aria-describedby` points at, and the sr-only
// span below carries — assistive tech gets the same "N issues to review"
// signal a sighted visitor sees via the amber dot + status strip.
export const EXPORT_ATTENTION_HINT_ID = "export-attention-hint";

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
  const disabled = readiness === "building" || (readiness === "ready" && !canExport);

  return (
    <>
      <Button
        size="sm"
        variant="default"
        className="action-export min-w-0 justify-center gap-[0.35rem] whitespace-nowrap hover:bg-primary hover:brightness-[1.08]"
        onClick={onDownloadClick}
        disabled={disabled}
        aria-label={exportAria}
        title={exportAria}
        aria-describedby={hasAttention ? EXPORT_ATTENTION_HINT_ID : undefined}
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
      {hasAttention && (
        <span id={EXPORT_ATTENTION_HINT_ID} className="sr-only">
          {attentionCount} issue{attentionCount === 1 ? "" : "s"} to review
        </span>
      )}
      <Button size="sm" variant="ghost" onClick={copyLink} aria-label="Copy share link">
        <LinkIcon size={16} /> Share
      </Button>
    </>
  );
}
