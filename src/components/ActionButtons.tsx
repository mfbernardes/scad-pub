// ActionButtons.tsx — the shared "produce a file" row, rendered in both the
// desktop ActionCluster (roomy) and the mobile footer (compact). Export/Share
// come from the AppActions context; the PNG snapshot is AppShell-local glue (it
// needs the viewer ref) and stays a prop.
//
// This row is purely about getting a result OUT: Export is the filled primary
// (the app's reason to exist), PNG and Share are quiet secondaries. The Output
// console toggle now rides in the top bar (as a status-bearing bell) in both
// layouts, so it's no longer here. Render-mode (auto-render) and the "needs
// re-render" call-to-action live elsewhere — the params footer and the viewer's
// StaleBanner respectively — so this bar has a single, stable shape.
import { useAppActions } from "../lib/appActions";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { Download as DownloadIcon, Image as ImageIcon, Link2 as LinkIcon } from "lucide-react";

interface Props {
  hasResult: boolean;
  modelFormat: string;
  onSavePng: () => void;
  /** Compact = the mobile footer: shorter labels, outline secondaries, full size. */
  compact?: boolean;
}

export function ActionButtons({
  hasResult,
  modelFormat,
  onSavePng,
  compact = false,
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
    </>
  );
}
