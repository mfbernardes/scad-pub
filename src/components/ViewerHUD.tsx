// ViewerHUD.tsx — floating viewer controls: zoom, reset, and (in a browser tab)
// fullscreen. The fullscreen toggle is shown only where it actually works: not
// in an installed PWA (already its own window), and not where the Fullscreen
// API is unsupported (e.g. iOS Safari, which only fullscreens <video>).
//
// Every HUD button wraps a plain `IconButton` in a shadcn Tooltip (`asChild`,
// so the Tooltip's ref/pointer/focus handlers land on IconButton's own
// underlying `<button>`) — visible on hover AND keyboard focus, unlike
// `title` alone, while `title` stays as a no-JS/assistive fallback.
// IconButton now forwards its `ref` prop straight through to Button (React 19
// "ref as a prop" — see IconButton.tsx's own doc), so `asChild` no longer
// needs a hand-rolled Button call to get a working ref target.
import type { ViewerHandle } from "./Viewer";
import { IconButton } from "./IconButton";
import { ViewPicker, HUD_GLASS_BTN } from "./ViewPicker";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "../lib/utils";
import type { ViewName } from "./views";
import { ZoomIn as ZoomInIcon, ZoomOut as ZoomOutIcon, RotateCcw as ResetIcon, Maximize as MaximizeIcon, Ruler as RulerIcon } from "lucide-react";
import { useStandalone } from "../lib/useStandalone";
import { fullscreenSupported } from "../lib/fullscreen";

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
      {/* ViewPicker (a separate component) renders its own trigger button,
          wrapped in the same hover/focus Tooltip as every other HUD button
          (nested around its Popover trigger — see ViewPicker's own doc). */}
      {viewPicker && <ViewPicker view={view} onSelect={onSelectView} />}
      {zoom && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton label="Zoom in" className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.zoomIn()}>
                <ZoomInIcon size={18} />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent side="left">Zoom in</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton label="Zoom out" className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.zoomOut()}>
                <ZoomOutIcon size={18} />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent side="left">Zoom out</TooltipContent>
          </Tooltip>
        </>
      )}
      {reset && (
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton label="Reset view" className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.resetView()}>
              <ResetIcon size={18} />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent side="left">Reset view</TooltipContent>
        </Tooltip>
      )}
      {measure && (
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              label={showDimensions ? "Hide dimensions" : "Show dimensions"}
              onClick={onToggleDimensions}
              pressed={showDimensions}
              className={cn(HUD_GLASS_BTN, showDimensions && "border-brand text-brand")}
            >
              <RulerIcon size={18} />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent side="left">{showDimensions ? "Hide dimensions" : "Show dimensions"}</TooltipContent>
        </Tooltip>
      )}
      {/* Fullscreen only where it works: a browser tab (not an installed PWA)
          on a browser that supports the Fullscreen API. */}
      {canFullscreen && (
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton label="Toggle fullscreen" className={HUD_GLASS_BTN} onClick={toggleFullscreen}>
              <MaximizeIcon size={18} />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent side="left">Toggle fullscreen</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
