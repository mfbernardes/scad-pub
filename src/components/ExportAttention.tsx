// ExportAttention.tsx — the export dock's explicit "N issues to review" line
// (PR22's "consolidated truthful readiness" milestone). Replaces the old
// ambiguous amber corner dot on the Export button (ActionButtons.tsx) with
// real text plus a "Review" action that jumps to wherever the gap can
// actually be resolved. Same glass-card slot family as ExportSuccess.tsx
// (see its own doc) — mounted just above it in AppShell's `.action-dock`
// when both are present: the dock grows upward, so the action cluster's own
// screen position never moves regardless of which of these two ride above
// it. Carries the `id` ActionButtons' Export button references via
// `aria-describedby`, so assistive tech gets the same signal a sighted
// visitor already sees right above the button.
import { t, tn } from "../lib/i18n";
import { attentionItemText } from "./AttentionItems";
import type { AttentionItem } from "../lib/readiness";
import { Button } from "./ui/button";

export function ExportAttention({
  attention,
  onReview,
}: {
  /** Unresolved production-readiness gaps for the current render — only the
   *  count and the first item's short text are shown here; the full list
   *  lives in the Customize tab's attention chip and the Review stage. */
  attention: AttentionItem[];
  /** Jump to wherever the gap can be resolved (AppShell's handleReviewAttention). */
  onReview: () => void;
}) {
  const first = attention[0];
  if (!first) return null;
  return (
    <div
      id="export-attention-hint"
      className="export-attention flex max-w-[min(22rem,calc(100vw-1.5rem))] items-center gap-2 rounded-lg border glass-card px-3 py-[0.55rem] text-[0.82rem]"
      role="status"
    >
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warn" />
      <p className="m-0 min-w-0 flex-1 text-foreground">
        {tn("export.attentionSummary", attention.length, { detail: attentionItemText(first, true) })}
      </p>
      <Button size="sm" variant="ghost" className="export-attention__review shrink-0" onClick={onReview}>
        {t("export.attentionReview")}
      </Button>
    </div>
  );
}
