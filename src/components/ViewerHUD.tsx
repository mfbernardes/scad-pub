// ViewerHUD.tsx — floating viewer controls: zoom, reset, and (in a browser tab)
// fullscreen. The fullscreen toggle is hidden when running as an installed PWA,
// where the app is already its own window.
import type { ViewerHandle } from "./Viewer";
import { IconButton } from "./IconButton";
import { ZoomInIcon, ZoomOutIcon, ResetIcon, MaximizeIcon } from "./Icons";
import { useStandalone } from "../lib/useStandalone";

interface Props {
  viewerRef: React.RefObject<ViewerHandle | null>;
  visible: boolean;
}

export function ViewerHUD({ viewerRef, visible }: Props) {
  const standalone = useStandalone();
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
      {/* Fullscreen only makes sense in a browser tab — an installed PWA is
          already its own window. */}
      {!standalone && (
        <IconButton label="Toggle fullscreen" onClick={toggleFullscreen}>
          <MaximizeIcon size={18} />
        </IconButton>
      )}
    </div>
  );
}
