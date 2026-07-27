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
import type { ReactNode } from "react";
import type { ViewerHandle } from "./Viewer";
import { IconButton } from "./IconButton";
import { ViewPicker, HUD_GLASS_BTN } from "./ViewPicker";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "../lib/utils";
import type { ViewName } from "./views";
import { ZoomIn as ZoomInIcon, ZoomOut as ZoomOutIcon, RotateCcw as ResetIcon, Maximize as MaximizeIcon, Ruler as RulerIcon, Grid3x3 as GridIcon } from "lucide-react";
import { useStandalone } from "../lib/useStandalone";
import { fullscreenSupported } from "../lib/fullscreen";
import { t } from "../lib/i18n";

interface Props {
  viewerRef: React.RefObject<ViewerHandle | null>;
  visible: boolean;
  /** Whether the measure (dimensions) toggle button is offered (config viewer.controls.measure). */
  measure: boolean;
  /** Whether the bounding-box dimension overlay is currently shown. */
  showDimensions: boolean;
  /** Toggle the dimension overlay on/off. */
  onToggleDimensions: () => void;
  /** Whether the viewer's reference grid is currently drawn. Unlike the
   *  measure/zoom/fullscreen flags above this is a live value, not a
   *  visibility gate: the grid button is always offered, and the config's
   *  `viewer.grid` only seeds this state's first-ever value (see
   *  src/lib/viewerPrefs.ts). */
  showGrid: boolean;
  /** Toggle the reference grid on/off. */
  onToggleGrid: () => void;
  /** Whether the view picker (camera-angle menu) is offered (config viewer.controls.viewPicker). */
  viewPicker: boolean;
  /** Whether the "reset view" button is offered (config viewer.controls.reset). */
  reset: boolean;
  /** Whether the zoom in/out buttons are offered (config viewer.controls.zoom). */
  zoom: boolean;
  /** Whether the fullscreen toggle is offered (config viewer.controls.fullscreen). */
  fullscreen: boolean;
  /** The active camera view (checkmarked in the view picker). */
  view: ViewName;
  /** Snap to a standard camera view. */
  onSelectView: (view: ViewName) => void;
}

// Every HUD button is an IconButton wrapped in the same left-anchored
// hover/focus Tooltip, with the tooltip text mirroring the aria-label — this
// composes that once so the five buttons below stay identical in output.
function HudTooltipButton({
  label,
  onClick,
  className,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <IconButton label={label} className={className} pressed={pressed} onClick={onClick}>
          {children}
        </IconButton>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ViewerHUD({ viewerRef, visible, measure, showDimensions, onToggleDimensions, showGrid, onToggleGrid, viewPicker, reset, zoom, fullscreen, view, onSelectView }: Props) {
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
          <HudTooltipButton label="Zoom in" className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.zoomIn()}>
            <ZoomInIcon size={18} />
          </HudTooltipButton>
          <HudTooltipButton label="Zoom out" className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.zoomOut()}>
            <ZoomOutIcon size={18} />
          </HudTooltipButton>
        </>
      )}
      {reset && (
        <HudTooltipButton label="Reset view" className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.resetView()}>
          <ResetIcon size={18} />
        </HudTooltipButton>
      )}
      {measure && (
        <HudTooltipButton
          label={showDimensions ? "Hide dimensions" : "Show dimensions"}
          onClick={onToggleDimensions}
          pressed={showDimensions}
          className={cn(HUD_GLASS_BTN, showDimensions && "border-brand text-brand")}
        >
          <RulerIcon size={18} />
        </HudTooltipButton>
      )}
      {/* The reference grid sits beside the ruler — both are overlays drawn
          around the model rather than camera controls. Always offered: the
          config's `viewer.grid` seeds this toggle's first-ever value, it
          doesn't gate the button (see src/lib/viewerPrefs.ts). */}
      <HudTooltipButton
        label={showGrid ? t("hud.hideGrid") : t("hud.showGrid")}
        onClick={onToggleGrid}
        pressed={showGrid}
        className={cn(HUD_GLASS_BTN, showGrid && "border-brand text-brand")}
      >
        <GridIcon size={18} />
      </HudTooltipButton>
      {/* Fullscreen only where it works: a browser tab (not an installed PWA)
          on a browser that supports the Fullscreen API. */}
      {canFullscreen && (
        <HudTooltipButton label="Toggle fullscreen" className={HUD_GLASS_BTN} onClick={toggleFullscreen}>
          <MaximizeIcon size={18} />
        </HudTooltipButton>
      )}
    </div>
  );
}
