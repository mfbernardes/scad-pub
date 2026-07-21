// ViewerHUD.tsx — floating viewer controls: zoom, reset, and (in a browser tab)
// fullscreen. The fullscreen toggle is shown only where it actually works: not
// in an installed PWA (already its own window), and not where the Fullscreen
// API is unsupported (e.g. iOS Safari, which only fullscreens <video>).
import type { ReactNode } from "react";
import type { ViewerHandle } from "./Viewer";
import { ICON_BUTTON_CLASS } from "./IconButton";
import { ViewPicker, HUD_GLASS_BTN } from "./ViewPicker";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "../lib/utils";
import type { ViewName } from "./views";
import { ZoomIn as ZoomInIcon, ZoomOut as ZoomOutIcon, RotateCcw as ResetIcon, Maximize as MaximizeIcon, Ruler as RulerIcon } from "lucide-react";
import { useStandalone } from "../lib/useStandalone";
import { fullscreenSupported } from "../lib/fullscreen";

// A bare icon rail gives a sighted first-time user no affordance until they
// guess (or hover long enough for the native `title` delay). This wraps a
// HUD icon button in a shadcn Tooltip — visible on hover AND keyboard focus,
// unlike `title` — while keeping `title` itself as a no-JS/assistive
// fallback. Reimplements IconButton's own rendering (ICON_BUTTON_CLASS/
// aria-label/title) directly on `Button` rather than wrapping `<IconButton>`
// here: `TooltipTrigger asChild` clones its ref and pointer/focus handlers
// onto its single child, which requires that child to forward a ref to a
// real DOM node, and IconButton is a plain function component that does
// neither (no `React.forwardRef`, no prop spread) — so `asChild` would
// silently drop the events and misposition the tooltip.
function HudIconButton({
  label,
  onClick,
  pressed,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(ICON_BUTTON_CLASS, className)}
          aria-label={label}
          aria-pressed={pressed}
          title={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

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
          <HudIconButton label="Zoom in" className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.zoomIn()}>
            <ZoomInIcon size={18} />
          </HudIconButton>
          <HudIconButton label="Zoom out" className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.zoomOut()}>
            <ZoomOutIcon size={18} />
          </HudIconButton>
        </>
      )}
      {reset && (
        <HudIconButton label="Reset view" className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.resetView()}>
          <ResetIcon size={18} />
        </HudIconButton>
      )}
      {measure && (
        <HudIconButton
          label={showDimensions ? "Hide dimensions" : "Show dimensions"}
          onClick={onToggleDimensions}
          pressed={showDimensions}
          className={cn(HUD_GLASS_BTN, showDimensions && "border-brand text-brand")}
        >
          <RulerIcon size={18} />
        </HudIconButton>
      )}
      {/* Fullscreen only where it works: a browser tab (not an installed PWA)
          on a browser that supports the Fullscreen API. */}
      {canFullscreen && (
        <HudIconButton label="Toggle fullscreen" className={HUD_GLASS_BTN} onClick={toggleFullscreen}>
          <MaximizeIcon size={18} />
        </HudIconButton>
      )}
    </div>
  );
}
