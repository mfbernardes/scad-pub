// ViewerHUD.tsx — floating viewer controls: zoom, reset, and (in a browser tab)
// fullscreen. The fullscreen toggle is shown only where it actually works: not
// in an installed PWA (already its own window), and not where the Fullscreen
// API is unsupported (e.g. iOS Safari, which only fullscreens <video>).
import type { ViewerHandle } from "./Viewer";
import { IconButton } from "./IconButton";
import { ViewPicker, HUD_GLASS_BTN } from "./ViewPicker";
import { cn } from "../lib/utils";
import type { ViewName } from "./views";
import { ZoomIn as ZoomInIcon, ZoomOut as ZoomOutIcon, RotateCcw as ResetIcon, Maximize as MaximizeIcon, Ruler as RulerIcon } from "lucide-react";
import { useStandalone } from "../lib/useStandalone";
import { fullscreenSupported } from "../lib/fullscreen";
import { t } from "../lib/i18n";

interface Props {
  viewerRef: React.RefObject<ViewerHandle | null>;
  visible: boolean;
  /** Whether the measure (dimensions) toggle button is offered (config ui.measure). */
  measure: boolean;
  /** Whether the bounding-box dimension overlay is currently shown. */
  showDimensions: boolean;
  /** Toggle the dimension overlay on/off. */
  onToggleDimensions: () => void;
  /** Whether the view picker (camera-angle menu) is offered (config ui.viewPicker). */
  viewPicker: boolean;
  /** Whether the "reset view" button is offered (config ui.reset). */
  reset: boolean;
  /** Whether the zoom in/out buttons are offered (config ui.zoom). */
  zoom: boolean;
  /** Whether the fullscreen toggle is offered (config ui.fullscreen). */
  fullscreen: boolean;
  /** The active camera view (checkmarked in the view picker). */
  view: ViewName;
  /** Snap to a standard camera view. */
  onSelectView: (view: ViewName) => void;
}

export function ViewerHUD({ viewerRef, visible, measure, showDimensions, onToggleDimensions, viewPicker, reset, zoom, fullscreen, view, onSelectView }: Props) {
  const standalone = useStandalone();
  const canFullscreen = fullscreen && !standalone && fullscreenSupported();
  if (!visible) return null;

  const toggleFullscreen = () => {
    const el = document.documentElement;
    // Both can reject (permissions policy, a transient-activation edge, …);
    // the button's own state follows the fullscreenchange event regardless,
    // so a rejection is a silent no-op rather than an unhandled rejection.
    if (!document.fullscreenElement) {
      el.requestFullscreen?.()?.catch(() => {});
    } else {
      document.exitFullscreen?.()?.catch(() => {});
    }
  };

  return (
    <div className="viewer-hud">
      {viewPicker && <ViewPicker view={view} onSelect={onSelectView} />}
      {zoom && (
        <>
          <IconButton label={t("hud.zoomIn")} className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.zoomIn()}>
            <ZoomInIcon size={18} />
          </IconButton>
          <IconButton label={t("hud.zoomOut")} className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.zoomOut()}>
            <ZoomOutIcon size={18} />
          </IconButton>
        </>
      )}
      {reset && (
        <IconButton label={t("hud.resetView")} className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.resetView()}>
          <ResetIcon size={18} />
        </IconButton>
      )}
      {measure && (
        <IconButton
          label={showDimensions ? t("hud.hideDimensions") : t("hud.showDimensions")}
          onClick={onToggleDimensions}
          pressed={showDimensions}
          className={cn(HUD_GLASS_BTN, showDimensions && "border-brand text-brand")}
        >
          <RulerIcon size={18} />
        </IconButton>
      )}
      {/* Fullscreen only where it works: a browser tab (not an installed PWA)
          on a browser that supports the Fullscreen API. */}
      {canFullscreen && (
        <IconButton label={t("hud.toggleFullscreen")} className={HUD_GLASS_BTN} onClick={toggleFullscreen}>
          <MaximizeIcon size={18} />
        </IconButton>
      )}
    </div>
  );
}
