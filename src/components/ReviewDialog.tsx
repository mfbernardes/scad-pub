// ReviewDialog.tsx — "Review as a surface, not a stage" (CLAUDE.md Phase 2):
// replaces the bare AlertDialog that used to live inside ActionButtons.tsx.
// Opened either from the export dock's Download button (when the render
// isn't cleanly "ready") or from StatusStrip (informationally, any time).
// Content:
//   - a failed render: a friendly failure card (FriendlyFailureCard) — there
//     is nothing to review, only something to explain;
//   - otherwise: the curated summary (src/lib/reviewSummary.ts's
//     buildReviewSummaryRows — designs[].reviewLabels rows honouring any
//     `echo("@review", …)` override, plus a headline Dimensions row), the
//     design's own `reviewNote` if configured, and the attention cards
//     (AttentionItems.tsx) for whatever's still unresolved.
// The footer is the one thing that depends on HOW the dialog was opened, not
// on readiness: a download-triggered open offers "Download anyway" (the
// visitor already knows there's something to review) / "Go back and fix"; a
// status-triggered open offers the plain primary "Download for 3D printing"
// (still works with issues pending — the visitor is already looking at them)
// / "Close". Either action button stays disabled while `canExport` is false
// (H1) — a friendly-failure dialog's "Download anyway" is visibly present but
// inert, matching the dock's own safety gate instead of contradicting it.
import { useMemo } from "react";
import type { Design, RenderResult } from "../openscad/types";
import type { Values } from "../lib/presets";
import type { Dimensions } from "./Viewer";
import type { AttentionItem } from "../lib/readiness";
import { friendlyRenderError } from "../lib/friendlyErrors";
import { parseReviewOverrides } from "../lib/reviewOverrides";
import { buildReviewSummaryRows } from "../lib/reviewSummary";
import { useAppActions } from "../lib/appActions";
import { cn } from "../lib/utils";
import { AttentionItems } from "./AttentionItems";
import { FriendlyFailureCard } from "./FriendlyFailureCard";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

/** How the dialog was opened — see the file doc's footer paragraph. */
export type ReviewTrigger = "download" | "status";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReviewTrigger;
  design: Design;
  /** Live parameter values — attention cards' font-fallback actions act on these. */
  values: Values;
  /** Values behind the last render — what the summary rows and Dimensions
   *  actually describe (mirrors DimensionInfo.tsx's own choice). */
  renderedValues: Values;
  result: RenderResult | null;
  /** friendlyRenderError(result) — AppShell already computes this once for
   *  OutputConsole; passed through so both surfaces agree on the same mapping. */
  failure: ReturnType<typeof friendlyRenderError>;
  measured: Dimensions | null;
  attention: AttentionItem[];
  availableFontFamilies?: Set<string>;
  fontSuggestion?: string | null;
  canExport: boolean;
  onOpenMessages: () => void;
}

export function ReviewDialog({
  open,
  onOpenChange,
  trigger,
  design,
  values,
  renderedValues,
  result,
  failure,
  measured,
  attention,
  availableFontFamilies,
  fontSuggestion,
  canExport,
  onOpenMessages,
}: Props) {
  const { exportModel } = useAppActions();
  const overrides = useMemo(() => parseReviewOverrides(result?.log ?? []), [result]);
  const rows = useMemo(
    () => buildReviewSummaryRows(design, renderedValues, design.reviewLabels, measured, overrides),
    [design, renderedValues, measured, overrides]
  );

  const handleDownload = () => {
    exportModel();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="review-dialog max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Review</DialogTitle>
          <DialogDescription className="sr-only">
            {failure
              ? "The last render failed — see the details below."
              : "A summary of what will be downloaded, and anything that still needs your attention."}
          </DialogDescription>
        </DialogHeader>

        {failure ? (
          <FriendlyFailureCard info={failure} />
        ) : (
          <>
            {rows.length > 0 && (
              <dl className="review-summary m-0 flex flex-col gap-[0.4rem]">
                {rows.map((r) => (
                  <div
                    key={r.key}
                    className={cn(
                      "flex items-baseline justify-between gap-3",
                      r.headline && "border-t pt-2"
                    )}
                  >
                    <dt className={cn("text-muted-foreground", r.headline && "font-semibold text-foreground")}>
                      {r.label}
                    </dt>
                    <dd
                      className={cn(
                        "m-0 text-right text-foreground tabular-nums",
                        r.headline && "font-semibold"
                      )}
                    >
                      {r.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {design.reviewNote && (
              <p className="review-note m-0 text-[0.85rem] text-muted-foreground">{design.reviewNote}</p>
            )}
          </>
        )}

        <AttentionItems
          attention={attention}
          design={design}
          values={values}
          availableFontFamilies={availableFontFamilies}
          fontSuggestion={fontSuggestion}
          onOpenMessages={onOpenMessages}
        />

        <DialogFooter>
          {trigger === "download" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Go back and fix
              </Button>
              <Button onClick={handleDownload} disabled={!canExport}>
                Download anyway
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={handleDownload} disabled={!canExport}>
                Download for 3D printing
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
