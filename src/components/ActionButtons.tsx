// ActionButtons.tsx — the shared Render / Export / PNG / Share / Output row,
// rendered in both the desktop ActionCluster (roomy, ghost) and the mobile
// footer (compact, outline). Render/Export/Share come from the AppActions
// context; the PNG snapshot and output toggle are AppShell-local glue (they
// need the viewer ref / console state) and stay props.
import { useAppActions } from "../lib/appActions";
import { Button } from "./ui/button";
import {
  Play as PlayIcon,
  Download as DownloadIcon,
  Image as ImageIcon,
  Link2 as LinkIcon,
  Terminal as TerminalIcon,
} from "lucide-react";

interface Props {
  rendering: boolean;
  autoRender: boolean;
  stalePreview: boolean;
  hasResult: boolean;
  modelFormat: string;
  outputOpen: boolean;
  onSavePng: () => void;
  onToggleOutput: () => void;
  /** Compact = the mobile footer: shorter labels, outline variant, full size. */
  compact?: boolean;
}

export function ActionButtons({
  rendering,
  autoRender,
  stalePreview,
  hasResult,
  modelFormat,
  outputOpen,
  onSavePng,
  onToggleOutput,
  compact = false,
}: Props) {
  const { render, exportModel, copyLink } = useAppActions();
  const prefix = compact ? "mobile-footer" : "action-cluster";
  const variant = compact ? "outline" : "ghost";
  const size = compact ? undefined : "sm";
  const fmt = modelFormat.toUpperCase();

  return (
    <>
      {!autoRender && stalePreview && (
        <Button
          size={size}
          className={`${prefix}__render`}
          onClick={render}
          disabled={rendering}
          aria-label="Render now"
        >
          <PlayIcon size={16} fill="currentColor" /> {compact ? "Render" : "Render now"}
        </Button>
      )}
      <Button
        size={size}
        variant={variant}
        onClick={exportModel}
        disabled={!hasResult}
        aria-label={`Export ${fmt}`}
      >
        <DownloadIcon size={16} /> {compact ? fmt : `Export ${fmt}`}
      </Button>
      <Button size={size} variant={variant} onClick={onSavePng} disabled={!hasResult} aria-label="Save PNG">
        <ImageIcon size={16} /> PNG
      </Button>
      <Button size={size} variant={variant} onClick={copyLink} aria-label="Copy share link">
        <LinkIcon size={16} /> Share
      </Button>
      <Button
        size={size}
        variant={variant}
        className={`${prefix}__output${outputOpen ? " active" : ""}`}
        onClick={onToggleOutput}
        aria-label={`${outputOpen ? "Close" : "Open"} output console`}
        aria-pressed={outputOpen}
      >
        <TerminalIcon size={16} />
        {compact && " Output"}
      </Button>
    </>
  );
}
