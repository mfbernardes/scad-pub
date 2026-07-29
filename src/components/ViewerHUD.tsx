// ViewerHUD.tsx — the viewer's own controls: camera views, reset, zoom, the
// dimension overlay, the reference grid, and (in a browser tab) fullscreen.
// One component, two presentations chosen by the `collapse` prop — the same
// split BarActions.tsx uses, and for the same reason: the caller knows which
// layout it's in, and only one layout tree is ever mounted (AppShell's M7
// split), so a viewport hook here would render a stray hidden trigger.
//
//   • inline (desktop): the familiar right-edge column of glass icon buttons.
//   • collapsed (mobile): ONE "View options" button opening a popover.
//
// Why mobile collapses. The column is fixed-height chrome anchored near the top
// of the viewer, and at five buttons it measured 44x258px — 31% of an 844px
// phone's height, 45% of a 568px one — standing permanently over the model on
// the layout with the least room to spare. It also could not get out of the
// way: the export dock rides the bottom sheet UPWARD as the sheet opens, so at
// the half detent on a 360- or 320-wide viewport the dock came to rest on top
// of the last one or two buttons, which were then genuinely un-tappable
// (elementFromPoint returned the dock, not the button). Collapsing to a single
// trigger removes the rail outright; `.viewer-hud`'s mobile max-height in
// index.css bounds whatever is left, so the collision cannot return.
//
// The trade is one extra tap for controls a visitor touches rarely, against
// standing space over the model — which is the thing they came for. Desktop
// keeps the column: it floats in open canvas there and costs nothing.
//
// Every inline HUD button wraps a plain `IconButton` in a shadcn Tooltip
// (`asChild`, so the Tooltip's ref/pointer/focus handlers land on IconButton's
// own underlying `<button>`) — visible on hover AND keyboard focus, unlike
// `title` alone, while `title` stays as a no-JS/assistive fallback.
// IconButton forwards its `ref` prop straight through to Button (React 19
// "ref as a prop" — see IconButton.tsx's own doc), so `asChild` needs no
// hand-rolled Button call to get a working ref target.
import { useState, type ReactNode } from "react";
import type { ViewerHandle } from "./Viewer";
import { IconButton, ICON_BUTTON_CLASS } from "./IconButton";
import { ViewPicker, HUD_GLASS_BTN } from "./ViewPicker";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "../lib/utils";
import { VIEW_OPTIONS, type ViewName } from "./views";
import { ZoomIn as ZoomInIcon, ZoomOut as ZoomOutIcon, RotateCcw as ResetIcon, Maximize as MaximizeIcon, Ruler as RulerIcon, Grid3x3 as GridIcon, SlidersHorizontal as ViewOptionsIcon, Check as CheckIcon } from "lucide-react";
import { useStandalone } from "../lib/useStandalone";
import { fullscreenSupported } from "../lib/fullscreen";
import { t } from "../lib/i18n";

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
// hover/focus Tooltip, with the tooltip text mirroring the aria-label — this
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

// One row of the collapsed menu. Mirrors BarActions' own `rowClass` so the
// app's two overflow popovers read as the same control, and carries
// `aria-pressed` for the rows that are toggles rather than one-shot actions.
const menuRowClass =
  "flex w-full items-center gap-2 rounded-(--radius-sm) px-2 py-[0.45rem] text-left text-[0.9rem] text-foreground cursor-pointer hover:bg-muted focus-visible:bg-muted";

function MenuRow({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(menuRowClass, pressed && "text-brand font-medium")}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
      {label}
    </button>
  );
}

export function ViewerHUD({ viewerRef, visible, collapse = false, measure, showDimensions, onToggleDimensions, showGrid, onToggleGrid, viewPicker, reset, zoom, fullscreen, view, onSelectView }: Props) {
  const standalone = useStandalone();
  const [menuOpen, setMenuOpen] = useState(false);
  const canFullscreen = fullscreen && !standalone && fullscreenSupported();
  // Hooks are declared above this guard, not below it — `visible` gates the
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

  const dimensionsLabel = showDimensions ? "Hide dimensions" : "Show dimensions";
  const gridLabel = showGrid ? t("hud.hideGrid") : t("hud.showGrid");

  if (collapse) {
    const currentView = VIEW_OPTIONS.find((o) => o.id === view)?.label ?? "";
    // One-shot actions close the menu; the two toggles leave it open, because
    // a visitor flipping the grid or the ruler usually wants to see the result
    // and flip it straight back — the same reasoning as BarActions' theme row.
    const act = (fn: () => void) => () => {
      fn();
      setMenuOpen(false);
    };
    return (
      <div className="viewer-hud viewer-hud--collapsed">
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          {/* Native button so PopoverTrigger's ref reaches the DOM (Radix
              anchors to it), styled as a HUD glass button rather than a
              top-bar one — it lives over the canvas. */}
          <PopoverTrigger
            className={cn(
              ICON_BUTTON_CLASS,
              HUD_GLASS_BTN,
              "inline-flex items-center justify-center outline-none data-[state=open]:border-brand data-[state=open]:text-brand"
            )}
            aria-label={t("hud.viewOptions")}
            title={t("hud.viewOptions")}
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
                {/* A chip grid, not a nested submenu: seven short labels fit
                    two-up and stay one tap deep, which is the whole point of
                    collapsing the rail in the first place. */}
                <ul className="mb-1 grid grid-cols-2 gap-[0.15rem] px-1">
                  {VIEW_OPTIONS.map((o) => {
                    const active = o.id === view;
                    return (
                      <li key={o.id}>
                        <button
                          type="button"
                          className={cn(
                            "flex w-full items-center gap-1 rounded-(--radius-sm) px-2 py-[0.4rem] text-left text-[0.82rem] text-foreground cursor-pointer hover:bg-muted focus-visible:bg-muted",
                            active && "text-brand font-semibold"
                          )}
                          aria-current={active ? "true" : undefined}
                          onClick={act(() => onSelectView(o.id))}
                        >
                          {/* Fixed-width slot so labels align whether or not
                              checkmarked. */}
                          <span className="inline-flex w-3.5 shrink-0" aria-hidden="true">
                            {active && <CheckIcon size={13} />}
                          </span>
                          {o.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="my-1 border-t" role="none" />
              </>
            )}
            {zoom && (
              <>
                <MenuRow label="Zoom in" onClick={() => viewerRef.current?.zoomIn()}>
                  <ZoomInIcon size={16} />
                </MenuRow>
                <MenuRow label="Zoom out" onClick={() => viewerRef.current?.zoomOut()}>
                  <ZoomOutIcon size={16} />
                </MenuRow>
              </>
            )}
            {reset && (
              <MenuRow label="Reset view" onClick={act(() => viewerRef.current?.resetView())}>
                <ResetIcon size={16} />
              </MenuRow>
            )}
            {measure && (
              <MenuRow label={dimensionsLabel} onClick={onToggleDimensions} pressed={showDimensions}>
                <RulerIcon size={16} />
              </MenuRow>
            )}
            <MenuRow label={gridLabel} onClick={onToggleGrid} pressed={showGrid}>
              <GridIcon size={16} />
            </MenuRow>
            {canFullscreen && (
              <MenuRow label="Toggle fullscreen" onClick={act(toggleFullscreen)}>
                <MaximizeIcon size={16} />
              </MenuRow>
            )}
          </PopoverContent>
        </Popover>
        {/* Which way the camera is pointing is the one piece of HUD state
            worth reading without opening the menu, and the trigger is an icon.
            Decorative (`aria-hidden`): the trigger's own accessible name
            already covers the control, and the chip would otherwise announce a
            bare word with no context. */}
        {viewPicker && currentView && (
          <span
            aria-hidden="true"
            className="viewer-hud__view-label pointer-events-none mt-1 max-w-16 truncate rounded-(--radius-sm) border border-(color:--glass-border) bg-(--glass-bg) px-[0.35rem] py-[0.1rem] text-center text-[0.62rem] font-medium text-muted-foreground"
          >
            {currentView}
          </span>
        )}
      </div>
    );
  }

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
          label={dimensionsLabel}
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
        <HudTooltipButton label="Toggle fullscreen" className={HUD_GLASS_BTN} onClick={toggleFullscreen}>
          <MaximizeIcon size={18} />
        </HudTooltipButton>
      )}
    </div>
  );
}
