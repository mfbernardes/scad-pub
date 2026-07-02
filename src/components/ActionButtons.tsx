// ActionButtons.tsx — the shared output row, rendered in both the desktop
// ActionCluster (roomy) and the mobile footer (compact). Export/Share come from
// the AppActions context; the PNG snapshot and output toggle are AppShell-local
// glue (they need the viewer ref / console state) and stay props.
//
// This row is now purely about getting a result OUT: Export is the filled
// primary (the app's reason to exist), PNG and Share are quiet secondaries, and
// the Output console toggle is a utility fenced off with a divider. Render-mode
// (auto-render) and the "needs re-render" call-to-action live elsewhere — the
// params footer and the viewer's StaleBanner respectively — so this bar has a
// single, stable shape that never lurches between auto and manual modes.
import { useAppActions } from "../lib/appActions";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import {
  Download as DownloadIcon,
  Image as ImageIcon,
  Link2 as LinkIcon,
  Bell as BellIcon,
  BellRing as BellRingIcon,
} from "lucide-react";

interface Props {
  hasResult: boolean;
  modelFormat: string;
  outputOpen: boolean;
  onSavePng: () => void;
  onToggleOutput: () => void;
  /** How many notices/warnings are pending — shown as a count badge when > 0. */
  noticeCount?: number;
  /** Compact = the mobile footer: shorter labels, outline secondaries, full size. */
  compact?: boolean;
}

export function ActionButtons({
  hasResult,
  modelFormat,
  outputOpen,
  onSavePng,
  onToggleOutput,
  noticeCount = 0,
  compact = false,
}: Props) {
  const { exportModel, copyLink } = useAppActions();
  const prefix = compact ? "mobile-footer" : "action-cluster";
  const secondary = compact ? "outline" : "ghost";
  const size = compact ? undefined : "sm";
  const fmt = modelFormat.toUpperCase();
  const hasNotices = noticeCount > 0;
  // A bell (ringing when notices are pending) reads far more clearly to a maker
  // than the old `>_` terminal glyph — and a real count badge beats a bare dot.
  const BellGlyph = hasNotices ? BellRingIcon : BellIcon;

  // Mobile footer buttons grow to share the row (the console toggle stays
  // icon-sized). The outline secondaries carry a real border there; the
  // desktop cluster's ghosts have none.
  const grow = compact ? "min-w-0 flex-1" : undefined;

  return (
    <>
      <Button
        size={size}
        variant="default"
        className={cn(grow, "hover:bg-primary hover:brightness-[1.08]", compact && "flex-[1.6]")}
        onClick={exportModel}
        disabled={!hasResult}
        aria-label={`Export ${fmt}`}
      >
        <DownloadIcon size={16} /> {compact ? fmt : `Export ${fmt}`}
      </Button>
      <Button size={size} variant={secondary} className={grow} onClick={onSavePng} disabled={!hasResult} aria-label="Save PNG">
        <ImageIcon size={16} /> PNG
      </Button>
      <Button size={size} variant={secondary} className={grow} onClick={copyLink} aria-label="Copy share link">
        <LinkIcon size={16} /> Share
      </Button>
      {/* Divider fences the console toggle off from the produce-a-file actions. */}
      <span
        className={cn("w-px self-stretch bg-border", compact ? "mx-[0.15rem] my-2 flex-none" : "m-[0.2rem]")}
        aria-hidden="true"
      />
      <Button
        size={compact ? "icon" : size}
        variant={secondary}
        className={cn(
          `${prefix}__output relative`,
          compact && "flex-none",
          outputOpen &&
            (compact ? "border-brand text-brand" : "bg-card text-brand hover:bg-card"),
          hasNotices && "text-warn"
        )}
        onClick={onToggleOutput}
        aria-label={`${outputOpen ? "Close" : "Open"} output console${
          hasNotices ? ` (${noticeCount} notice${noticeCount === 1 ? "" : "s"})` : ""
        }`}
        aria-pressed={outputOpen}
        title="Output console — notices & log"
      >
        <BellGlyph size={16} />
        {!compact && "Output"}
        {hasNotices && (
          <span
            className={cn(
              "inline-flex h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded-full bg-warn px-[0.3rem] text-[0.7rem] font-bold leading-none text-[#1c1f24] tabular-nums [[data-theme=light]_&]:text-white",
              compact && "pointer-events-none absolute top-[2px] right-[2px] shadow-[0_0_0_2px_var(--panel)]"
            )}
            aria-hidden="true"
          >
            {noticeCount}
          </span>
        )}
      </Button>
    </>
  );
}
