// ReviewDialog.tsx: the pre-download review surface: a dialog a visitor can
// open and read, not a modal gate they have to dismiss.
// Opened either from the export dock's Download button (when the render
// isn't cleanly "ready") or from StatusStrip (informationally, any time).
// Content:
//   - a failed render: a friendly failure card (FriendlyFailureCard). There
//     is nothing to review, only something to explain;
//   - otherwise: the curated summary (src/lib/reviewSummary.ts's
//     buildReviewSummaryRows: designs[].reviewLabels rows honouring any
//     `echo("@review", …)` override, plus a headline Dimensions row), the
//     design's own `reviewNote` if configured, and the attention cards
//     (AttentionItems.tsx) for whatever's still unresolved.
// The footer reflects the CURRENT review state, not how the dialog was
// opened: while anything is still unresolved (a failed render or any
// attention item) it offers "Download anyway" (the visitor knows there's
// something to review) / "Go back and fix"; once the review is clean it
// offers the plain primary "Download for 3D printing" / "Close". Because it's
// keyed on the live `failure`/`attention` props, the labels flip the moment
// the last issue clears (e.g. after the "Use a bundled font" action re-renders
// cleanly), and both entry points show identical buttons for the same state.
// Either action button stays disabled while `canExport` is false (H1): a
// friendly-failure dialog's "Download anyway" is visibly present but inert,
// matching the dock's own safety gate instead of contradicting it. Mirrors
// ActionButtons' own disabled-reason treatment: a disabled <button> fires no
// pointer events, so the explanation lives on a wrapping <span title>, plus
// an aria-describedby'd sr-only note for assistive tech.
import { useMemo } from "react";
import type { Design, RenderResult } from "../openscad/types";
import type { Values } from "../lib/presets";
import type { Dimensions } from "./Viewer";
import type { AttentionItem } from "../lib/readiness";
import type { FriendlyErrorInfo } from "../lib/friendlyErrors";
import { parseReviewOverrides } from "../lib/reviewOverrides";
import { buildReviewSummaryRows } from "../lib/reviewSummary";
import { useAppActions } from "../lib/appActions";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";
import { AttentionItems } from "./AttentionItems";
import { FriendlyFailureCard } from "./FriendlyFailureCard";
import { Button } from "./ui/button";
import { ExplainedDisabledButton } from "./ExplainedDisabledButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

// Distinct from ActionButtons' DOWNLOAD_DISABLED_HINT_ID: the dock's Download
// button stays mounted behind this dialog, so a shared id would collide.
const REVIEW_DOWNLOAD_DISABLED_HINT_ID = "review-download-disabled-hint";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  design: Design;
  /** Live parameter values: attention cards' font-fallback actions act on these. */
  values: Values;
  /** Values behind the last render: what the summary rows and Dimensions
   *  actually describe (mirrors DimensionInfo.tsx's own choice). */
  renderedValues: Values;
  result: RenderResult | null;
  /** friendlyRenderError(result). AppShell already computes this once for
   *  OutputConsole; passed through so both surfaces agree on the same mapping. */
  failure: FriendlyErrorInfo | null;
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

  const hasIssues = !!failure || attention.length > 0;
  // Mirrors ActionButtons' `disabledReason`: a failed render (there's
  // nothing to review, only something to explain) beats "no render has
  // landed yet" beats "rendered, but no longer matches the live controls"
  // (readiness "ready" && !canExport, i.e. stale).
  const disabledReason = canExport
    ? null
    : failure
      ? t("review.noResultReason")
      : result
        ? t("dock.staleReason")
        : t("dock.buildingReason");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="review-dialog max-h-[85vh] overflow-y-auto overscroll-contain sm:max-w-md"
        // No coarse-pointer autofocus guard, unlike Modal.tsx and
        // DesignPicker's gallery: those hold a text field whose keyboard would
        // cover the dialog. This one is buttons and read-only rows, so
        // suppressing Radix's focus transfer would only strand focus behind it.
      >
        <DialogHeader>
          <DialogTitle>{t("review.title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {failure ? t("review.descriptionFailure") : t("review.descriptionSummary")}
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {hasIssues ? t("review.goBackAndFix") : t("common.close")}
          </Button>
          <ExplainedDisabledButton reason={disabledReason} hintId={REVIEW_DOWNLOAD_DISABLED_HINT_ID} className="w-full" onClick={handleDownload}>
            {hasIssues ? t("review.downloadAnyway") : t("action.export")}
          </ExplainedDisabledButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
