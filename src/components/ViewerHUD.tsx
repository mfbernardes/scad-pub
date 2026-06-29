// ViewerHUD.tsx — floating viewer controls: zoom, reset, and (in a browser tab)
// fullscreen. The fullscreen toggle is shown only where it actually works: not
// in an installed PWA (already its own window), and not where the Fullscreen
// API is unsupported (e.g. iOS Safari, which only fullscreens <video>).
import type { ViewerHandle } from "./Viewer";
import { IconButton } from "./IconButton";
import { ZoomIn as ZoomInIcon, ZoomOut as ZoomOutIcon, RotateCcw as ResetIcon, Maximize as MaximizeIcon, Ruler as RulerIcon } from "lucide-react";
import { useStandalone } from "../lib/useStandalone";
import { fullscreenSupported } from "../lib/fullscreen";

interface Props {
  viewerRef: React.RefObject<ViewerHandle | null>;
  visible: boolean;
  /** Whether the bounding-box dimension overlay is currently shown. */
  showDimensions: boolean;
  /** Toggle the dimension overlay on/off. */
  onToggleDimensions: () => void;
}

export function ViewerHUD({ viewerRef, visible, showDimensions, onToggleDimensions }: Props) {
  const standalone = useStandalone();
  const canFullscreen = !standalone && fullscreenSupported();
  if (!visible) return null;

  const toggleFullscreen = () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  return (
    <div className="viewer-hud">
      <IconButton label="Zoom in" onClick={() => viewerRef.current?.zoomIn()}>
        <ZoomInIcon size={18} />
      </IconButton>
      <IconButton label="Zoom out" onClick={() => viewerRef.current?.zoomOut()}>
        <ZoomOutIcon size={18} />
      </IconButton>
      <IconButton label="Reset view" onClick={() => viewerRef.current?.resetView()}>
        <ResetIcon size={18} />
      </IconButton>
      <IconButton
        label={showDimensions ? "Hide dimensions" : "Show dimensions"}
        onClick={onToggleDimensions}
        className={showDimensions ? "icon-btn--active" : undefined}
      >
        <RulerIcon size={18} />
      </IconButton>
      {/* Fullscreen only where it works: a browser tab (not an installed PWA)
          on a browser that supports the Fullscreen API. */}
      {canFullscreen && (
        <IconButton label="Toggle fullscreen" onClick={toggleFullscreen}>
          <MaximizeIcon size={18} />
        </IconButton>
      )}
    </div>
  );
}
