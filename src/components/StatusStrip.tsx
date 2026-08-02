// StatusStrip.tsx: the readiness surface (src/lib/readiness.ts's
// ReadinessState): a raised pill in the export dock (AppShell's ActionDock),
// stacked directly above the Download button, that opens the Review dialog
// (ReviewDialog.tsx).
//
// One presentation, both layouts. The dock is where the decision it gates
// actually gets made, so it lives there for desktop and mobile alike, over the
// viewer, out of the panel/sheet entirely, and so still visible when the desktop
// panel is collapsed to its rail. A row inside the panel would vanish with it.
//
// The caller mounts it only for the states that want a look at the Review
// dialog: `failed` and `attention`, both layouts. Mobile used to skip
// `attention` because the Download button carried a marker of its own; that
// marker is gone (see AppShell's `hasStatusPill`), so this pill is the only
// attention signal there is. A ready model needs no announcement
// (the enabled Download button is the confirmation), and a first build is
// already narrated by the viewer's own loading overlay. The unmounted states
// are still spelled out below because `readiness` can hold them and the label
// must stay exhaustive.
//
// `.status-strip` is a stable hook class for the smoke/vis scripts (see
// CLAUDE.md's script-hook convention): kept even though no stylesheet rule
// targets it.
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
  /** attention.length, only meaningful (and only read) in the "attention" state. */
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

// Warn/success/destructive tokens only (never a bespoke colour) so a
// deployment's `colors` override (which retargets these same tokens) keeps
// the pill in step with the rest of the app's status language.
//
// Every fill is OPAQUE: the pill floats over the 3D viewer, so a translucent
// tint (`bg-destructive/10` and friends) would take its contrast from whatever
// the model happens to be showing behind it. `--glass-bg` is the same
// surface the dock's own card uses, so a failed pill reads as part of the dock.
const TONE: Record<ReadinessState, string> = {
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

export function StatusStrip({ readiness, attentionCount, onOpen, className }: StatusStripProps) {
  const Icon = ICON[readiness];
  return (
    <button
      type="button"
      className={cn(
        "status-strip inline-flex max-w-full cursor-pointer items-center gap-[0.4rem] rounded-full border border-(color:--glass-border) px-[0.7rem] py-[0.3rem] text-[0.8rem] font-medium shadow-(--elevation)",
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
      <span className="min-w-0 truncate">{label(readiness, attentionCount)}</span>
    </button>
  );
}
