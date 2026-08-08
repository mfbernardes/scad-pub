// ViewerHUD.tsx: the viewer's own controls: camera views, reset, zoom, the
// dimension overlay, the reference grid, and (in a browser tab) fullscreen.
// One component, two presentations chosen by the `collapse` prop: the same
// split BarActions.tsx uses, and for the same reason: the caller knows which
// layout it's in, and only one layout tree is ever mounted (AppShell's M7
// split), so a viewport hook here would render a stray hidden trigger.
//
//   • inline (desktop): the familiar right-edge column of glass icon buttons.
//   • collapsed (mobile): ONE "View options" button opening a popover.
//
// Why mobile collapses. The column is fixed-height chrome anchored near the top
// of the viewer, and at five buttons it measured 44x258px: 31% of an 844px
// phone's height, 45% of a 568px one. Standing permanently over the model on
// the layout with the least room to spare. It also could not get out of the
// way: the export dock rides the bottom sheet UPWARD as the sheet opens, so at
// the half detent on a 360- or 320-wide viewport the dock came to rest on top
// of the last one or two buttons, which were then genuinely un-tappable
// (elementFromPoint returned the dock, not the button). Collapsing to a single
// trigger removes the rail outright: `collapse` is keyed on the same 860px
// breakpoint the mobile CSS uses, so below it there is only ever one button
// and no config can grow it. scripts/smoke.mjs hit-tests each HUD button's own
// centre at 360x740 and 320x568 so a layout that reintroduces the overlap
// fails there rather than shipping.
//
// The trade is one extra tap for controls a visitor touches rarely, against
// standing space over the model, which is the thing they came for. Desktop
// keeps the column: it floats in open canvas there and costs nothing.
//
// Every inline HUD button wraps a plain `IconButton` in a shadcn Tooltip
// (`asChild`, so the Tooltip's ref/pointer/focus handlers land on IconButton's
// own underlying `<button>`): visible on hover AND keyboard focus, unlike
// `title` alone, while `title` stays as a no-JS/assistive fallback.
// IconButton forwards its `ref` prop straight through to Button (React 19
// "ref as a prop", see IconButton.tsx's own doc), so `asChild` needs no
// hand-rolled Button call to get a working ref target.
import { useState, type ReactNode } from "react";
import type { ViewerHandle } from "./Viewer";
import { IconButton, ICON_BUTTON_CLASS } from "./IconButton";
import { ViewPicker, ViewOptionList, HUD_GLASS_BTN } from "./ViewPicker";
import { MenuRow } from "./MenuRow";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "../lib/utils";
import { VIEW_OPTIONS, type ViewName } from "./views";
import { ZoomIn as ZoomInIcon, ZoomOut as ZoomOutIcon, RotateCcw as ResetIcon, Maximize as MaximizeIcon, Ruler as RulerIcon, Grid3x3 as GridIcon, SlidersHorizontal as ViewOptionsIcon } from "lucide-react";
import { useStandalone } from "../lib/useStandalone";
import { fullscreenSupported } from "../lib/fullscreen";
import { t } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";

interface Props {
  viewerRef: React.RefObject<ViewerHandle | null>;
  visible: boolean;
  /** Collapse into a single "View options" popover (mobile) instead of the
   *  inline right-edge column (desktop). See the file header for why. */
  collapse?: boolean;
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

// Every inline HUD button is an IconButton wrapped in the same left-anchored
// hover/focus Tooltip, with the tooltip text mirroring the aria-label: this
// composes that once so the buttons below stay identical in output.
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

export function ViewerHUD({ viewerRef, visible, collapse = false, measure, showDimensions, onToggleDimensions, showGrid, onToggleGrid, viewPicker, reset, zoom, fullscreen, view, onSelectView }: Props) {
  useLocale(); // subscription only: re-render this component's t() calls on a locale switch
  const standalone = useStandalone();
  const [menuOpen, setMenuOpen] = useState(false);
  const canFullscreen = fullscreen && !standalone && fullscreenSupported();
  // Hooks are declared above this guard, not below it: `visible` gates the
  // render, never the hook order.
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

  const dimensionsLabel = showDimensions ? t("hud.hideDimensions") : t("hud.showDimensions");
  const gridLabel = showGrid ? t("hud.hideGrid") : t("hud.showGrid");
  // Shared by both the collapsed popover's MenuRows and the inline column's
  // HudTooltipButtons below, so the two presentations can't drift.
  const zoomInLabel = t("hud.zoomIn");
  const zoomOutLabel = t("hud.zoomOut");
  const resetViewLabel = t("hud.resetView");
  const fullscreenLabel = t("hud.toggleFullscreen");

  if (collapse) {
    // The trigger names the active view, the way ViewPicker's desktop trigger
    // does, "which way am I looking" is the one piece of HUD state worth
    // reading without opening the menu, and this says it without spending a
    // second element over the model (which would also widen the top inset the
    // camera fit has to clear).
    const currentViewOption = VIEW_OPTIONS.find((o) => o.id === view);
    const currentView = currentViewOption ? t(currentViewOption.labelKey) : undefined;
    const triggerLabel = currentView
      ? `${t("hud.viewOptions")}: ${currentView}`
      : t("hud.viewOptions");
    // Rows that DO something close the menu; the ruler and grid toggles don't,
    // because a visitor flipping one usually wants to see the result and flip
    // it straight back (the same reasoning as BarActions' theme row), and
    // neither does zoom, which is meant to be tapped repeatedly.
    const act = (fn: () => void) => () => {
      fn();
      setMenuOpen(false);
    };
    return (
      <div className="viewer-hud viewer-hud--collapsed">
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          {/* Native button so PopoverTrigger's ref reaches the DOM (Radix
              anchors to it), styled as a HUD glass button rather than a
              top-bar one: it lives over the canvas. */}
          <PopoverTrigger
            className={cn(
              ICON_BUTTON_CLASS,
              HUD_GLASS_BTN,
              // `outline-none` suppresses index.css's global :focus-visible
              // outline, so the replacement ring is not optional. This is a
              // native <button> (PopoverTrigger needs the ref), which means it
              // gets none of shadcn Button's focus styling either. Same recipe
              // as ViewPicker's trigger, the desktop twin of this control.
              "inline-flex items-center justify-center outline-none transition-[background-color,border-color,color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:border-brand data-[state=open]:text-brand"
            )}
            aria-label={triggerLabel}
            title={triggerLabel}
          >
            <ViewOptionsIcon size={18} />
          </PopoverTrigger>
          {/* `side="bottom"` opens the menu down over the model rather than up
              into the top bar; `collisionPadding` keeps it clear of the
              viewport edges on a narrow phone. */}
          <PopoverContent side="bottom" align="end" collisionPadding={8} className="w-56 p-1">
            {viewPicker && (
              <>
                <p className="px-2 pt-1 pb-[0.2rem] text-[0.7rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  {t("hud.viewHeading")}
                </p>
                {/* Two-up, not a nested submenu: seven short labels fit and
                    stay one tap deep, which is the whole point of collapsing
                    the rail. The list itself is ViewPicker's: same options,
                    same active marking, same re-snap-on-repick behaviour. */}
                <ViewOptionList
                  view={view}
                  onSelect={(v) => {
                    onSelectView(v);
                    setMenuOpen(false);
                  }}
                  listClassName="mb-1 grid grid-cols-2 gap-[0.15rem] px-1"
                />
                <div className="my-1 border-t" role="none" />
              </>
            )}
            {zoom && (
              <>
                <MenuRow
                  label={zoomInLabel}
                  onClick={() => viewerRef.current?.zoomIn()}
                  icon={<ZoomInIcon size={16} />}
                />
                <MenuRow
                  label={zoomOutLabel}
                  onClick={() => viewerRef.current?.zoomOut()}
                  icon={<ZoomOutIcon size={16} />}
                />
              </>
            )}
            {reset && (
              <MenuRow
                label={resetViewLabel}
                onClick={act(() => viewerRef.current?.resetView())}
                icon={<ResetIcon size={16} />}
              />
            )}
            {measure && (
              <MenuRow label={dimensionsLabel} onClick={onToggleDimensions} pressed={showDimensions} icon={<RulerIcon size={16} />} />
            )}
            <MenuRow label={gridLabel} onClick={onToggleGrid} pressed={showGrid} icon={<GridIcon size={16} />} />
            {canFullscreen && (
              <MenuRow label={fullscreenLabel} onClick={act(toggleFullscreen)} icon={<MaximizeIcon size={16} />} />
            )}
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <div className="viewer-hud">
      {/* ViewPicker (a separate component) renders its own trigger button,
          wrapped in the same hover/focus Tooltip as every other HUD button
          (nested around its Popover trigger, see ViewPicker's own doc). */}
      {viewPicker && <ViewPicker view={view} onSelect={onSelectView} />}
      {zoom && (
        <>
          <HudTooltipButton label={zoomInLabel} className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.zoomIn()}>
            <ZoomInIcon size={18} />
          </HudTooltipButton>
          <HudTooltipButton label={zoomOutLabel} className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.zoomOut()}>
            <ZoomOutIcon size={18} />
          </HudTooltipButton>
        </>
      )}
      {reset && (
        <HudTooltipButton label={resetViewLabel} className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.resetView()}>
          <ResetIcon size={18} />
        </HudTooltipButton>
      )}
      {measure && (
        <HudTooltipButton
          label={dimensionsLabel}
          onClick={onToggleDimensions}
          pressed={showDimensions}
          className={cn(HUD_GLASS_BTN, showDimensions && "border-brand text-brand")}
        >
          <RulerIcon size={18} />
        </HudTooltipButton>
      )}
      {/* The reference grid sits beside the ruler: both are overlays drawn
          around the model rather than camera controls. Always offered: the
          config's `viewer.grid` seeds this toggle's first-ever value, it
          doesn't gate the button (see src/lib/viewerPrefs.ts). */}
      <HudTooltipButton
        label={gridLabel}
        onClick={onToggleGrid}
        pressed={showGrid}
        className={cn(HUD_GLASS_BTN, showGrid && "border-brand text-brand")}
      >
        <GridIcon size={18} />
      </HudTooltipButton>
      {/* Fullscreen only where it works: a browser tab (not an installed PWA)
          on a browser that supports the Fullscreen API. */}
      {canFullscreen && (
        <HudTooltipButton label={fullscreenLabel} className={HUD_GLASS_BTN} onClick={toggleFullscreen}>
          <MaximizeIcon size={18} />
        </HudTooltipButton>
      )}
    </div>
  );
}
