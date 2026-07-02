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
import { OutputToggle } from "./OutputToggle";
import { cn } from "../lib/utils";
import { Download as DownloadIcon, Image as ImageIcon, Link2 as LinkIcon } from "lucide-react";

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
  /** Include the Output console toggle (default true). The mobile top bar hosts
   *  it separately, so the mobile footer passes false. */
  showOutput?: boolean;
}

export function ActionButtons({
  hasResult,
  modelFormat,
  outputOpen,
  onSavePng,
  onToggleOutput,
  noticeCount = 0,
  compact = false,
  showOutput = true,
}: Props) {
  const { exportModel, copyLink } = useAppActions();
  const secondary = compact ? "outline" : "ghost";
  const size = compact ? undefined : "sm";
  const fmt = modelFormat.toUpperCase();

  // Mobile footer buttons grow to share the row. The outline secondaries carry
  // a real border there; the desktop cluster's ghosts have none.
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
      {showOutput && (
        <>
          {/* Divider fences the console toggle off from the produce-a-file actions. */}
          <span className="m-[0.2rem] w-px self-stretch bg-border" aria-hidden="true" />
          <OutputToggle
            outputOpen={outputOpen}
            noticeCount={noticeCount}
            onToggleOutput={onToggleOutput}
            compact={compact}
            className="action-cluster__output"
          />
        </>
      )}
    </>
  );
}
