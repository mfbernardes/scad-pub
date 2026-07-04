// ActionButtons.tsx — the shared "produce a file" row, rendered identically in
// the desktop ActionCluster and the mobile floating cluster (same compact glass
// pill in both). Export/Share come from the AppActions context; the PNG snapshot
// is AppShell-local glue (it needs the viewer ref) and stays a prop.
//
// This row is purely about getting a result OUT: Export is the filled primary
// (the app's reason to exist), PNG and Share are quiet ghost secondaries. The
// Output console toggle now rides in the top bar (as a status-bearing bell) in
// both layouts, so it's no longer here. Render-mode (auto-render) and the "needs
// re-render" call-to-action live elsewhere — the params footer and the viewer's
// StaleBanner respectively — so this bar has a single, stable shape.
import { useAppActions } from "../lib/appActions";
import { Button } from "./ui/button";
import { Download as DownloadIcon, Image as ImageIcon, Link2 as LinkIcon } from "lucide-react";

interface Props {
  hasResult: boolean;
  modelFormat: string;
  onSavePng: () => void;
}

export function ActionButtons({ hasResult, modelFormat, onSavePng }: Props) {
  const { exportModel, copyLink } = useAppActions();
  const fmt = modelFormat.toUpperCase();

  return (
    <>
      {/* "Download", not "Export": the universal word for "get the file". The
          format rides along because the slicer needs it. */}
      <Button
        size="sm"
        variant="default"
        className="hover:bg-primary hover:brightness-[1.08]"
        onClick={exportModel}
        disabled={!hasResult}
        aria-label={`Download ${fmt}`}
      >
        <DownloadIcon size={16} /> Download {fmt}
      </Button>
      <Button size="sm" variant="ghost" onClick={onSavePng} disabled={!hasResult} aria-label="Save image">
        <ImageIcon size={16} /> Image
      </Button>
      <Button size="sm" variant="ghost" onClick={copyLink} aria-label="Copy share link">
        <LinkIcon size={16} /> Share
      </Button>
    </>
  );
}
