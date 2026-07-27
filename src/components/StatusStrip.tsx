// StatusStrip.tsx — readiness surface (src/lib/readiness.ts's ReadinessState),
// a button that opens the Review dialog (ReviewDialog.tsx). Two presentations,
// chosen by `variant` (the caller knows its layout):
//   • "row" (desktop): a one-line strip at the top of the docked ParamPanel,
//     above its tabs. Always mounted, in every readiness state.
//   • "pill" (mobile): a raised chip in the export dock, stacked directly above
//     the Download button (AppShell's ActionDock). The mobile sheet has no room
//     to spend on status — its Half detent is ~52vh — and the dock is where the
//     decision this warns about actually gets made, so the warning rides there
//     instead: over the viewer, visible at every sheet detent, following the
//     sheet up exactly like the button it sits on.
// The pill is deliberately NOT mounted in every state: a ready model needs no
// announcement (the enabled Download button is the confirmation) and a first
// build is already narrated by the viewer's own loading overlay — so the caller
// only mounts it for `attention`/`failed`, the two states that actually want a
// look at the Review dialog.
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
  /** Presentation: full-width panel row (default) or raised dock pill. */
  variant?: "row" | "pill";
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

// The pill floats over the 3D viewer, so every state needs an OPAQUE fill —
// the row's translucent `bg-destructive/10` would take its contrast from
// whatever the model happens to be showing behind it. `--glass-bg` is the same
// surface the dock's own card uses, so a failed pill reads as part of the dock.
const TONE_PILL: Record<ReadinessState, string> = {
  building: "text-muted-foreground bg-(--glass-bg)",
  ready: "text-success bg-success-bg",
  attention: "text-warn bg-warn-bg",
  failed: "text-destructive bg-(--glass-bg)",
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

export function StatusStrip({
  readiness,
  attentionCount,
  onOpen,
  variant = "row",
  className,
}: StatusStripProps) {
  const Icon = ICON[readiness];
  const pill = variant === "pill";
  return (
    <button
      type="button"
      className={cn(
        "status-strip cursor-pointer items-center font-medium",
        pill
          ? "status-strip--pill inline-flex max-w-full gap-[0.4rem] rounded-full border border-(color:--glass-border) px-[0.7rem] py-[0.3rem] text-[0.8rem] shadow-(--elevation)"
          : "flex w-full gap-2 border-b px-3 py-[0.4rem] text-left text-[0.82rem]",
        (pill ? TONE_PILL : TONE)[readiness],
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
      <span className={cn("min-w-0 truncate", !pill && "flex-1")}>
        {label(readiness, attentionCount)}
      </span>
    </button>
  );
}
