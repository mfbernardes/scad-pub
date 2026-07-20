// ViewerHUD.tsx — floating viewer controls: zoom, reset, and (in a browser tab)
// fullscreen. The fullscreen toggle is shown only where it actually works: not
// in an installed PWA (already its own window), and not where the Fullscreen
// API is unsupported (e.g. iOS Safari, which only fullscreens <video>).
//
// `compact` (guided workflow's mobile HUD only — see AppShell's own
// `workflowGuided` gate on the mobile ViewerHUD mount; the desktop mount never
// passes it, and tabs-mode mobile leaves it at its default `false`): shows
// only Reset directly, folding the fullscreen toggle, the view-angle picker,
// the measure/ruler toggle, the reference-grid toggle, and zoom in/out into a
// single "View" overflow menu — TWO controls total (Reset + the View menu
// trigger), the mockup's density target for a guided visitor's viewer chrome
// (round-5 Wave 2, item 6 — was three: Reset + Fullscreen directly, plus the
// View menu). Every underlying control/callback is identical either way;
// only which surface (a floating icon-button row vs. a dropdown menu)
// presents them changes.
import { useState, type ReactNode } from "react";
import type { ViewerHandle } from "./Viewer";
import { ICON_BUTTON_CLASS } from "./IconButton";
import { ViewPicker, HUD_GLASS_BTN } from "./ViewPicker";
import { cn } from "../lib/utils";
import { VIEW_OPTIONS, type ViewName } from "./views";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ZoomIn as ZoomInIcon, ZoomOut as ZoomOutIcon, RotateCcw as ResetIcon, Maximize as MaximizeIcon, Ruler as RulerIcon, Grid3x3 as GridIcon, SlidersHorizontal as ViewMenuIcon, Check as CheckIcon } from "lucide-react";
import { useStandalone } from "../lib/useStandalone";
import { fullscreenSupported } from "../lib/fullscreen";
import { t } from "../lib/i18n";

// Shared "on" state for a toggle button in this HUD (grid / measure): a
// brand-coloured border + icon instead of the default quiet muted-foreground,
// so an active toggle stays legibly distinct without adding back the loud
// chrome the rest of the HUD just shed.
const HUD_TOGGLE_ON = "border-brand text-brand";

// Item 8.2: a bare icon rail gives a sighted first-time user no affordance
// until they guess (or hover long enough for the native `title` delay). This
// wraps the HUD's own icon buttons in a shadcn Tooltip — visible on hover
// AND keyboard focus, unlike `title` — while keeping `title` itself as a
// no-JS/assistive fallback. Reimplements IconButton's own rendering
// (ICON_BUTTON_CLASS/aria-label/title) directly on `Button` rather than
// wrapping `<IconButton>` here: `TooltipTrigger asChild` clones its ref and
// pointer/focus handlers onto its single child, which requires that child to
// forward a ref to a real DOM node, and IconButton is a plain function
// component that does neither (no `React.forwardRef`, no prop spread) — so
// asChild would silently drop the events and misposition the tooltip.
function HudIconButton({
  label,
  onClick,
  disabled,
  pressed,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
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
          disabled={disabled}
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
  /** Whether the reference grid is currently shown (config ui.grid seeds the
   *  first-ever default; a persisted preference wins after that — see
   *  src/lib/viewerPrefs.ts). */
  showGrid: boolean;
  /** Toggle the reference grid on/off. */
  onToggleGrid: () => void;
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
  /** Guided workflow's mobile HUD (see this file's own doc) — Reset +
   *  Fullscreen render directly; the view picker/measure/grid/zoom controls
   *  fold into one "View" menu instead. Default `false` (today's full HUD),
   *  so every non-guided/desktop caller is unaffected. */
  compact?: boolean;
}

export function ViewerHUD({ viewerRef, visible, measure, showDimensions, onToggleDimensions, showGrid, onToggleGrid, viewPicker, reset, zoom, fullscreen, view, onSelectView, compact = false }: Props) {
  const standalone = useStandalone();
  const canFullscreen = fullscreen && !standalone && fullscreenSupported();
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
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

  // Reset was a byte-identical `IconButton` (now `HudIconButton` — see item
  // 8.2 above) in both the compact and full-HUD return paths below —
  // factored out once so it's never at risk of drifting (a hook class or
  // a11y label edit that only lands in one branch). Hook classes/labels are
  // unchanged from before this factoring. Fullscreen has no such twin:
  // compact's own View menu renders its OWN fullscreen item inline (below,
  // from `canFullscreen`/`toggleFullscreen` directly) rather than this
  // button, so — round-5 review, quality item 8 — its button is built
  // further down, only on the non-compact path that actually uses it,
  // instead of unconditionally here where a compact render would construct
  // and then simply discard it.
  const resetButton = reset && (
    <HudIconButton label={t("hud.resetView")} className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.resetView()}>
      <ResetIcon size={16} />
    </HudIconButton>
  );

  if (compact) {
    return (
      <div className="viewer-hud viewer-hud--compact">
        {resetButton}
        {/* Round-5 Wave 2 (item 6): TWO directly-visible controls max — Reset
            above, and this View menu, which now also folds in Fullscreen
            (previously its own third icon button) alongside the view-angle
            picker/measure/grid/zoom. Wave 3 a11y fix: `modal={false}` — see
            GuidedMobileHeader's own identical fix doc. This menu lives
            inside `.app-shell__mobile` alongside the guided persistent
            header, which a modal Radix menu would otherwise mark
            aria-hidden (while it stays genuinely focusable) the instant this
            View menu opens. Always rendered: the grid toggle below has no
            config gate, so this menu is never actually empty — see the
            removed `hasViewMenu` check this replaced. */}
        <DropdownMenu open={viewMenuOpen} onOpenChange={setViewMenuOpen} modal={false}>
          {/* Tooltip wraps the dropdown trigger itself (asChild onto Radix's
              own DropdownMenuTrigger, which — unlike IconButton — already
              forwards a ref) so the "View" menu gets the same hover/focus
              label as every other HUD button (item 8.2). */}
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger
                className={cn(
                  "icon-btn inline-flex items-center justify-center cursor-pointer outline-none transition-[background-color,border-color,color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  "border rounded-(--radius-sm) hover:border-brand data-[state=open]:border-brand data-[state=open]:text-brand",
                  HUD_GLASS_BTN,
                  "viewer-hud__view-menu"
                )}
                aria-label={t("hud.viewOptions")}
                title={t("hud.viewOptions")}
              >
                <ViewMenuIcon size={16} />
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="left">{t("hud.viewOptions")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" side="left" className="w-52">
            {canFullscreen && (
              <>
                <DropdownMenuItem onSelect={toggleFullscreen}>
                  <MaximizeIcon size={14} aria-hidden="true" />
                  {t("hud.toggleFullscreen")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {viewPicker &&
              VIEW_OPTIONS.map((o) => {
                const active = o.id === view;
                return (
                  <DropdownMenuItem
                    key={o.id}
                    aria-current={active ? "true" : undefined}
                    onSelect={() => onSelectView(o.id)}
                  >
                    <span className="inline-flex w-4 shrink-0 text-brand" aria-hidden="true">
                      {active && <CheckIcon size={14} />}
                    </span>
                    {t(o.labelKey)}
                  </DropdownMenuItem>
                );
              })}
            {viewPicker && <DropdownMenuSeparator />}
            {measure && (
              <DropdownMenuCheckboxItem checked={showDimensions} onCheckedChange={onToggleDimensions}>
                <RulerIcon size={14} aria-hidden="true" />
                {showDimensions ? t("hud.hideDimensions") : t("hud.showDimensions")}
              </DropdownMenuCheckboxItem>
            )}
            <DropdownMenuCheckboxItem checked={showGrid} onCheckedChange={onToggleGrid}>
              <GridIcon size={14} aria-hidden="true" />
              {showGrid ? t("hud.hideGrid") : t("hud.showGrid")}
            </DropdownMenuCheckboxItem>
            {zoom && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => viewerRef.current?.zoomIn()}>
                  <ZoomInIcon size={14} aria-hidden="true" />
                  {t("hud.zoomIn")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => viewerRef.current?.zoomOut()}>
                  <ZoomOutIcon size={14} aria-hidden="true" />
                  {t("hud.zoomOut")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  // Built only here (see the doc above resetButton): the non-compact HUD is
  // the sole renderer of this button.
  const fullscreenButton = canFullscreen && (
    <HudIconButton label={t("hud.toggleFullscreen")} className={HUD_GLASS_BTN} onClick={toggleFullscreen}>
      <MaximizeIcon size={16} />
    </HudIconButton>
  );

  return (
    <div className="viewer-hud">
      {/* ViewPicker (a separate component) renders its own trigger button and
          already carries a native `title` — it isn't wrapped in the new
          hover/focus Tooltip here because it doesn't forward a ref either
          (same constraint as IconButton, see HudIconButton's own doc above),
          and it's out of this pass's file scope to change. */}
      {viewPicker && <ViewPicker view={view} onSelect={onSelectView} />}
      {zoom && (
        <>
          <HudIconButton label={t("hud.zoomIn")} className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.zoomIn()}>
            <ZoomInIcon size={16} />
          </HudIconButton>
          <HudIconButton label={t("hud.zoomOut")} className={HUD_GLASS_BTN} onClick={() => viewerRef.current?.zoomOut()}>
            <ZoomOutIcon size={16} />
          </HudIconButton>
        </>
      )}
      {resetButton}
      {measure && (
        <HudIconButton
          label={showDimensions ? t("hud.hideDimensions") : t("hud.showDimensions")}
          onClick={onToggleDimensions}
          pressed={showDimensions}
          className={cn(HUD_GLASS_BTN, showDimensions && HUD_TOGGLE_ON)}
        >
          <RulerIcon size={16} />
        </HudIconButton>
      )}
      {/* Grid toggle — off by default (see docs/config.md's ui.grid); shown
          right next to the measure/ruler tool since both are "reference
          overlay" controls. Toggling doesn't move the camera or touch the
          model, just the ground-plane reference. */}
      <HudIconButton
        label={showGrid ? t("hud.hideGrid") : t("hud.showGrid")}
        onClick={onToggleGrid}
        pressed={showGrid}
        className={cn(HUD_GLASS_BTN, showGrid && HUD_TOGGLE_ON)}
      >
        <GridIcon size={16} />
      </HudIconButton>
      {/* Fullscreen only where it works: a browser tab (not an installed PWA)
          on a browser that supports the Fullscreen API. */}
      {fullscreenButton}
    </div>
  );
}
