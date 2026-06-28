// ActionButtons.tsx — the shared Render / Export / PNG / Share / Output row,
// rendered in both the desktop ActionCluster (roomy) and the mobile footer
// (compact). Render/Export/Share come from the AppActions context; the PNG
// snapshot and output toggle are AppShell-local glue (they need the viewer ref
// / console state) and stay props.
//
// Hierarchy is the whole point of this row: there is always exactly ONE filled
// primary — Render when a manual render is pending, otherwise Export (the app's
// reason to exist: get your model out). PNG/Share are quiet secondaries; the
// Output console toggle is a utility, fenced off with a divider so it doesn't
// read as another "produce a file" action.
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
  const secondary = compact ? "outline" : "ghost";
  const size = compact ? undefined : "sm";
  const fmt = modelFormat.toUpperCase();

  // A manual render is pending → Render is what matters most; otherwise the
  // finished model wants exporting. Exactly one of these is the filled primary.
  const renderPending = !autoRender && stalePreview;
  const exportIsPrimary = !renderPending;

  return (
    <>
      {renderPending && (
        <Button
          size={size}
          className={`${prefix}__primary`}
          onClick={render}
          disabled={rendering}
          aria-label="Render now"
        >
          <PlayIcon size={16} fill="currentColor" /> {compact ? "Render" : "Render now"}
        </Button>
      )}
      <Button
        size={size}
        variant={exportIsPrimary ? "default" : secondary}
        className={exportIsPrimary ? `${prefix}__primary` : undefined}
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
        aria-label={`${outputOpen ? "Close" : "Open"} output console`}
        aria-pressed={outputOpen}
        title="Output console"
      >
        <TerminalIcon size={16} />
      </Button>
    </>
  );
}
