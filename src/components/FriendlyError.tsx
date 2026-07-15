// FriendlyError.tsx — the friendly render-failure summary shown at the top of
// OutputConsole's Notices tab whenever the latest render failed: a headline,
// the failing assert's authored message (when there is one), contextual
// "fix it" actions, and a technical-details disclosure for the raw OpenSCAD
// lines. See src/lib/friendlyErrors.ts for the title/body/technical mapping
// this renders verbatim — no copy or log parsing lives in this component.
import { t } from "../lib/i18n";
import type { FriendlyErrorInfo } from "../lib/friendlyErrors";
import { Button } from "./ui/button";

interface Props {
  error: FriendlyErrorInfo;
  /**
   * True only when a previous successful render's geometry is genuinely
   * still what the viewer shows right now — the pipeline retains the last
   * same-design success on failure (renderState.ts's
   * retainedResultAfterFailure) and ViewerStage displays it dimmed, so this
   * is computed from that same wire (AppShell), never assumed. Gates the
   * "your last working preview is still shown" reassurance line below.
   */
  lastPreviewKept: boolean;
  /** Whether the essentials view is currently hiding a setting that differs
   *  from its default (paramFilter.ts's hiddenAdvancedDiff) — the exact same
   *  deterministic rule CustomizeTab's own "Review" chip uses. Never inferred
   *  from the error text itself. */
  showReviewHidden: boolean;
  onReviewSettings: () => void;
  onReviewHiddenSettings: () => void;
  onRetry: () => void;
}

export function FriendlyError({
  error,
  lastPreviewKept,
  showReviewHidden,
  onReviewSettings,
  onReviewHiddenSettings,
  onRetry,
}: Props) {
  return (
    <div className="friendly-error mx-3 mt-[0.4rem] flex flex-col gap-[0.4rem] rounded-(--radius) border border-destructive/30 bg-destructive/5 px-3 py-[0.6rem] text-[0.85rem]">
      <p className="m-0 font-semibold text-foreground">{error.title}</p>
      {error.body && <p className="m-0 text-foreground">{error.body}</p>}
      {lastPreviewKept && (
        <p className="m-0 text-muted-foreground">{t("failure.body")}</p>
      )}
      <div className="flex flex-wrap items-center gap-[0.4rem]">
        <Button variant="ghost" size="sm" onClick={onReviewSettings}>
          {t("failure.reviewSettings")}
        </Button>
        {showReviewHidden && (
          <Button variant="ghost" size="sm" onClick={onReviewHiddenSettings}>
            {t("failure.reviewHidden")}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onRetry}>
          {t("failure.retry")}
        </Button>
      </div>
      {error.technical.length > 0 && (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer select-none text-[0.8rem]">
            {t("failure.showDetails")}
          </summary>
          <pre className="log m-0 mt-[0.3rem] max-h-32 overflow-auto whitespace-pre-wrap bg-code px-2 py-[0.4rem] font-mono text-xs leading-[1.4]">
            {error.technical.join("\n")}
          </pre>
        </details>
      )}
    </div>
  );
}
