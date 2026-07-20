// ExportAttention.tsx — the export dock's explicit "N issues to review before
// export" line. Replaces the old ambiguous amber corner dot on the Export
// button (ActionButtons.tsx) with real text, and — the visual-alignment pass
// that added this doc — the WHOLE line is now itself the "go look" action
// (a single <button>, not text plus a nested button): clicking anywhere on it
// opens the Review stage, where the full detail and every fix actually lives
// (see AttentionItems.tsx's own doc for why this line intentionally does NOT
// repeat any item's own text). Same glass-card slot family as
// ExportSuccess.tsx (see its own doc) — mounted just above it in AppShell's
// `.action-dock` when both are present: the dock grows upward, so the action
// cluster's own screen position never moves regardless of which of these two
// ride above it. Carries the `id` ActionButtons' Export button references via
// `aria-describedby`, so assistive tech gets the same signal a sighted
// visitor already sees right above the button.
import { AlertTriangle as WarningIcon, ChevronRight as ChevronIcon } from "lucide-react";
import { tn } from "../lib/i18n";
import type { AttentionItem } from "../lib/readiness";

// The id the Export button's `aria-describedby` points at, shared with the
// guided sr-only hint in ActionButtons.tsx (the two workflows never mount
// both at once). One source of truth so a rename can't silently break the
// aria wiring in the other file with no type error.
export const EXPORT_ATTENTION_HINT_ID = "export-attention-hint";

export function ExportAttention({
  attention,
  onReview,
}: {
  /** Unresolved production-readiness gaps for the current render — only the
   *  count is shown here; the full list with each item's own text and fixes
   *  lives in the Review stage this line opens (and, contextually, right
   *  under the setting itself — see AttentionItems.tsx). */
  attention: AttentionItem[];
  /** Jump to the Review stage (AppShell's handleReviewAttention). */
  onReview: () => void;
}) {
  if (attention.length === 0) return null;
  return (
    <button
      type="button"
      id={EXPORT_ATTENTION_HINT_ID}
      className="export-attention flex w-full cursor-pointer items-center gap-2 rounded-lg border border-warn/50 bg-warn-bg px-3 py-[0.55rem] text-left text-[0.82rem] shadow-(--elevation) hover:brightness-105"
      onClick={onReview}
    >
      <WarningIcon aria-hidden="true" size={16} className="shrink-0 text-warn" />
      <span className="m-0 min-w-0 flex-1 text-foreground">{tn("export.attentionLine", attention.length)}</span>
      <ChevronIcon aria-hidden="true" size={16} className="shrink-0 text-muted-foreground" />
    </button>
  );
}
