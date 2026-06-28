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
import {
  Download as DownloadIcon,
  Image as ImageIcon,
  Link2 as LinkIcon,
  Terminal as TerminalIcon,
} from "lucide-react";

interface Props {
  hasResult: boolean;
  modelFormat: string;
  outputOpen: boolean;
  onSavePng: () => void;
  onToggleOutput: () => void;
  /** Count of pending notices/warnings — shown as a badge on the Output toggle. */
  outputBadge?: number;
  /** Compact = the mobile footer: shorter labels, outline secondaries, full size. */
  compact?: boolean;
}

export function ActionButtons({
  hasResult,
  modelFormat,
  outputOpen,
  onSavePng,
  onToggleOutput,
  outputBadge = 0,
  compact = false,
}: Props) {
  const { exportModel, copyLink } = useAppActions();
  const prefix = compact ? "mobile-footer" : "action-cluster";
  const secondary = compact ? "outline" : "ghost";
  const size = compact ? undefined : "sm";
  const fmt = modelFormat.toUpperCase();

  return (
    <>
      <Button
        size={size}
        variant="default"
        className={`${prefix}__primary`}
        onClick={exportModel}
        disabled={!hasResult}
        aria-label={`Export ${fmt}`}
      >
        <DownloadIcon size={16} /> {compact ? fmt : `Export ${fmt}`}
      </Button>
      <Button size={size} variant={secondary} onClick={onSavePng} disabled={!hasResult} aria-label="Save PNG">
        <ImageIcon size={16} /> PNG
      </Button>
      <Button size={size} variant={secondary} onClick={copyLink} aria-label="Copy share link">
        <LinkIcon size={16} /> Share
      </Button>
      {/* Divider fences the console toggle off from the produce-a-file actions. */}
      <span className={`${prefix}__divider`} aria-hidden="true" />
      <Button
        size={compact ? "icon" : size}
        variant={secondary}
        className={`${prefix}__output${outputOpen ? " active" : ""}`}
        onClick={onToggleOutput}
        aria-label={
          `${outputOpen ? "Close" : "Open"} output console` +
          (outputBadge > 0 ? `, ${outputBadge} notice${outputBadge === 1 ? "" : "s"}` : "")
        }
        aria-pressed={outputOpen}
        title="Output console"
      >
        <TerminalIcon size={16} />
        {outputBadge > 0 && <span className="output-toggle-dot" aria-hidden="true" />}
      </Button>
    </>
  );
}
