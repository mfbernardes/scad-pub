// StatusStrip.tsx — one-line readiness surface (src/lib/readiness.ts's
// ReadinessState), a button that opens the Review dialog (ReviewDialog.tsx).
// Desktop: mounted at the top of the docked ParamPanel, above its tabs.
// Mobile: mounted inside SheetTabs, above the tab row, so it's part of the
// bottom sheet's always-visible peek header (BottomSheet measures the peek
// height from the sheet's top down to the tab row's bottom edge, so anything
// above the tabs — this strip included — is included in that measurement for
// free; see BottomSheet's own layout-effect doc). `.status-strip` is a
// stable hook class for the smoke/vis scripts (see CLAUDE.md's script-hook
// convention) — kept even though no stylesheet rule targets it.
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

export function StatusStrip({ readiness, attentionCount, onOpen, className }: StatusStripProps) {
  const Icon = ICON[readiness];
  const text = label(readiness, attentionCount);
  return (
    <button
      type="button"
      className={cn(
        "status-strip flex w-full cursor-pointer items-center gap-2 border-b px-3 py-[0.4rem] text-left text-[0.82rem] font-medium",
        TONE[readiness],
        className
      )}
      onClick={onOpen}
      aria-haspopup="dialog"
      title={t("status.reviewTitle")}
    >
      <Icon
        size={14}
        aria-hidden="true"
        className={cn("shrink-0", readiness === "building" && "animate-spin motion-reduce:animate-none")}
      />
      <span className="min-w-0 flex-1 truncate">{text}</span>
    </button>
  );
}
