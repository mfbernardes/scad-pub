// StatusStrip.tsx — readiness surface (src/lib/readiness.ts's ReadinessState),
// a button that opens the Review dialog (ReviewDialog.tsx). Two presentations,
// chosen by `compact` (the caller knows its layout):
//   • full row (desktop): a one-line strip at the top of the docked ParamPanel,
//     above its tabs.
//   • compact chip (mobile): icon + short label, mounted ON the sheet's tab row
//     (SheetTabs) rather than taking a whole row above it — the sheet's Half
//     detent is ~385px tall, so a full-width status row there costs a parameter.
//     It stays inside the peek header either way: BottomSheet measures the peek
//     height down to the row marked `data-sheet-peek-end`, which wraps the tabs
//     AND this chip (see BottomSheet's own layout-effect doc). Keeping the chip
//     in the row — rather than hiding it while "ready" — also keeps the measured
//     peek height constant as readiness changes.
// `.status-strip` is a stable hook class for the smoke/vis scripts (see
// CLAUDE.md's script-hook convention) — kept even though no stylesheet rule
// targets it, and kept on BOTH presentations.
import {
  CircleCheck as ReadyIcon,
  TriangleAlert as AttentionIcon,
  CircleX as FailedIcon,
  Loader2 as BuildingIcon,
} from "lucide-react";
import type { ReadinessState } from "../lib/readiness";
import { cn } from "../lib/utils";
import { t, tn } from "../lib/i18n";

export interface StatusStripProps {
  readiness: ReadinessState;
  /** attention.length — only meaningful (and only read) in the "attention" state. */
  attentionCount: number;
  onOpen: () => void;
  /** Render the compact chip (mobile tab row) instead of the full-width row. */
  compact?: boolean;
  className?: string;
}

const ICON: Record<ReadinessState, typeof ReadyIcon> = {
  building: BuildingIcon,
  ready: ReadyIcon,
  attention: AttentionIcon,
  failed: FailedIcon,
};

// Warn/success/destructive tokens only — never a bespoke colour — so a
// deployment's `colors` override (which retargets these same tokens) keeps
// the strip in step with the rest of the app's status language.
const TONE: Record<ReadinessState, string> = {
  building: "text-muted-foreground",
  ready: "text-success bg-success-bg",
  attention: "text-warn bg-warn-bg",
  failed: "text-destructive bg-destructive/10",
};

function label(readiness: ReadinessState, attentionCount: number): string {
  switch (readiness) {
    case "building":
      return t("status.building");
    case "ready":
      return t("status.ready");
    case "attention":
      return tn("review.issueCount", attentionCount);
    case "failed":
      return t("status.failed");
  }
}

// The chip's own wording — the same states in the width a tab row can spare.
// The full sentence above stays the chip's accessible name (`aria-label`), so
// nothing is lost to a screen reader by shortening the visible text.
function shortLabel(readiness: ReadinessState, attentionCount: number): string {
  switch (readiness) {
    case "building":
      return t("status.buildingShort");
    case "ready":
      return t("status.readyShort");
    case "attention":
      return tn("review.issueCountShort", attentionCount);
    case "failed":
      return t("status.failedShort");
  }
}

export function StatusStrip({
  readiness,
  attentionCount,
  onOpen,
  compact = false,
  className,
}: StatusStripProps) {
  const Icon = ICON[readiness];
  const full = label(readiness, attentionCount);
  return (
    <button
      type="button"
      className={cn(
        "status-strip cursor-pointer items-center font-medium",
        compact
          ? "status-strip--compact inline-flex shrink-0 gap-[0.3rem] rounded-(--radius-sm) px-[0.45rem] py-[0.25rem] text-[0.78rem] whitespace-nowrap"
          : "flex w-full gap-2 border-b px-3 py-[0.4rem] text-left text-[0.82rem]",
        TONE[readiness],
        className
      )}
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={compact ? full : undefined}
      title={t("status.reviewTitle")}
    >
      <Icon
        size={14}
        aria-hidden="true"
        className={cn("shrink-0", readiness === "building" && "animate-spin motion-reduce:animate-none")}
      />
      {compact ? (
        <span aria-hidden="true">{shortLabel(readiness, attentionCount)}</span>
      ) : (
        <span className="min-w-0 flex-1 truncate">{full}</span>
      )}
    </button>
  );
}
