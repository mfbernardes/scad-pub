// ViewerHUD.tsx — floating bottom-right viewer controls: zoom, fit, reset, fullscreen.
import type { ViewerHandle } from "./Viewer";
import { IconButton } from "./IconButton";
import { ZoomInIcon, ZoomOutIcon, ResetIcon, MaximizeIcon } from "./Icons";

interface Props {
  viewerRef: React.RefObject<ViewerHandle | null>;
  visible: boolean;
}

export function ViewerHUD({ viewerRef, visible }: Props) {
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
      <IconButton label="Toggle fullscreen" onClick={toggleFullscreen}>
        <MaximizeIcon size={18} />
      </IconButton>
    </div>
  );
}
