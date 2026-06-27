// ActionCluster.tsx — floating bottom-center action cluster.
// Auto-render toggle · Render · Export · PNG · Share + Output toggle (badged).
import { memo } from "react";
import { useAppActions } from "../lib/appActions";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
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
  /** True when auto-render is off and params/preset/design changed since the last render. */
  stalePreview?: boolean;
  hasResult: boolean;
  modelFormat: string;
  outputOpen: boolean;
  /** PNG snapshot needs the active viewer ref, so this glue stays a prop. */
  onSavePng: () => void;
  onToggleOutput: () => void;
  className?: string;
}

export const ActionCluster = memo(function ActionCluster({
  rendering,
  autoRender,
  stalePreview = false,
  hasResult,
  modelFormat,
  outputOpen,
  onSavePng,
  onToggleOutput,
  className = "",
}: Props) {
  const { render, exportModel, copyLink, autoRenderChange } = useAppActions();
  return (
    <div className={`action-cluster ${className}`.trim()}>
      <Label
        className="action-cluster__auto-render cursor-pointer gap-1.5 text-xs font-normal"
        title="Re-render automatically as you change parameters"
      >
        <Switch checked={autoRender} onCheckedChange={autoRenderChange} aria-label="Auto-render" />
        Auto
      </Label>
      {!autoRender && stalePreview && (
        <Button
          size="sm"
          className="action-cluster__render"
          onClick={render}
          disabled={rendering}
          aria-label="Render now"
        >
          <PlayIcon size={16} fill="currentColor" /> Render now
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={exportModel}
        disabled={!hasResult}
        aria-label={`Export ${modelFormat.toUpperCase()}`}
      >
        <DownloadIcon size={16} /> Export {modelFormat.toUpperCase()}
      </Button>
      <Button size="sm" variant="ghost" onClick={onSavePng} disabled={!hasResult} aria-label="Save PNG">
        <ImageIcon size={16} /> PNG
      </Button>
      <Button size="sm" variant="ghost" onClick={copyLink} aria-label="Copy share link">
        <LinkIcon size={16} /> Share
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className={`action-cluster__output${outputOpen ? " active" : ""}`}
        onClick={onToggleOutput}
        aria-label={`${outputOpen ? "Close" : "Open"} output console`}
        aria-pressed={outputOpen}
      >
        <TerminalIcon size={16} />
      </Button>
    </div>
  );
});
