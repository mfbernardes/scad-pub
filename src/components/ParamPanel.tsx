// ParamPanel.tsx: docked desktop parameter panel: a slim header (collapse), a
// Presets / Parameters tab split, parameter search + ParamForm, and a Reset
// footer. Collapsible and resizable; state persisted to localStorage. Presets
// live here (a tab, mirroring the mobile sheet) rather than in the top bar.
// Files is not a tab here: it's FilesModal, opened from BarActions (see
// CommandBar.tsx), so a design that imports files is not special-cased in this
// component at all. Readiness is likewise the dock pill both layouts share (see
// StatusStrip.tsx) rather than a row above the tabs, which also means it
// survives this panel being collapsed to its rail.
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Design } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import type { InstalledFont } from "../lib/fonts";
import { ns } from "../lib/appId";
import { t } from "../lib/i18n";
import { useAppActions } from "../lib/appActions";
import { visibleGroups } from "../lib/paramGroups";
import type { PanelTab } from "../lib/usePanelState";
import { readLocal, writeLocal } from "../lib/safeStorage";
import { useRafBatchedWrite } from "../lib/useRafBatchedWrite";
import type { FriendlyErrorInfo } from "../lib/friendlyErrors";
import { ParamForm, type ParamFormHandle } from "./ParamForm";
import { SectionNavigator } from "./SectionNavigator";
import { PresetPicker } from "./PresetPicker";
import { PresetDiffBar } from "./PresetDiffBar";
import { ParamSearch } from "./ParamSearch";
import { IconButton } from "./IconButton";
import { PanelFooter } from "./PanelFooter";
import { Tabs, TabsContent, TabsList, TabsTrigger, chipTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";
import {
  Menu as MenuIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
} from "lucide-react";

const panelTabClass = cn(chipTabTrigger, "flex-1");

const PANEL_WIDTH_KEY = ns("panel.width");
const PANEL_OPEN_KEY = ns("panel.open");

const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 360;

interface Props {
  design: Design;
  values: Values;
  bundled: ParsedSet[];
  userPresets: string[];
  selectedPreset: string;
  /** The selected preset's values, or null when no preset is selected (baseline is defaults). */
  presetBaseline: Values | null;
  /** The selected preset's display name, or null when no preset is selected. */
  presetName: string | null;
  /** Values the current params are diffed against: presetBaseline, or design defaults. */
  baseline: Values;
  /** Names of params whose value differs from `baseline`. */
  changedParams: Set<string>;
  /** Font families the renderer can use (normalised), for the missing-font hint. */
  availableFontFamilies?: Set<string>;
  /** A bundled family to offer as a one-click fallback for a missing font. */
  fontSuggestion?: string | null;
  /** Faces the renderer can use (bundled ∪ imported), for the font selector. */
  installedFonts?: InstalledFont[];
  /** SVG basenames the renderer can resolve (bundled assets ∪ imports), for the
   *  `@svg` control's missing-file hint. */
  availableSvgFiles?: Set<string>;
  panelSide: "left" | "right";
  panelDefaultOpen: boolean;
  /** Show the underlying OpenSCAD variable name beside each label. */
  showVarName: boolean;
  autoRender: boolean;
  showAdvanced: boolean;
  /** Flip `showAdvanced`. Omitted when the config leaves `ui.essentials` off,
   *  which is what withholds the essentials toggle entirely (see AppShell). */
  onShowAdvancedChange?: (show: boolean) => void;
  /** Active tab + search query, hoisted to AppShell (usePanelState) so they
   *  survive a desktop/mobile remount, see docs/architecture-review.md M7. */
  panelTab: PanelTab;
  onPanelTabChange: (tab: PanelTab) => void;
  search: string;
  /** `search` debounced, from usePanelState: one timer above the layout split,
   *  so a breakpoint flip mid-typing doesn't restart the debounce. */
  debouncedSearch: string;
  onSearchChange: (search: string) => void;
  onSearchFocus?: () => void;
  onSearchBlur?: () => void;
  /** Current render failure, forwarded to ParamForm's banner. */
  failure?: FriendlyErrorInfo | null;
}

export function ParamPanel({
  design,
  values,
  bundled,
  userPresets,
  selectedPreset,
  presetBaseline,
  presetName,
  baseline,
  changedParams,
  availableFontFamilies,
  fontSuggestion,
  installedFonts,
  availableSvgFiles,
  panelSide,
  panelDefaultOpen,
  showVarName,
  autoRender,
  showAdvanced,
  onShowAdvancedChange,
  panelTab,
  onPanelTabChange,
  search,
  debouncedSearch,
  onSearchChange,
  onSearchFocus,
  failure,
  onSearchBlur,
}: Props) {
  const { change, applyPreset, selectedPresetChange, presetsChange } = useAppActions();
  const [open, setOpen] = useState(() => {
    const v = readLocal(PANEL_OPEN_KEY);
    return v !== null ? v === "true" : panelDefaultOpen;
  });
  const [width, setWidth] = useState(() => {
    const w = parseInt(readLocal(PANEL_WIDTH_KEY) || "0");
    return w >= MIN_WIDTH && w <= MAX_WIDTH ? w : DEFAULT_WIDTH;
  });
  // Ref onto the form's imperative handle so the section navigator can jump.
  const formRef = useRef<ParamFormHandle>(null);
  // The navigator's section list: derived from the SAME visible-groups filter
  // the form renders (same debounced search + showAdvanced + values), so it
  // narrows in lockstep and a section that filters out drops from the menu too.
  const navSections = useMemo(
    () => visibleGroups(design, values, { search: debouncedSearch, showAdvanced }).map((g) => g.section),
    [design, values, debouncedSearch, showAdvanced]
  );
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);
  const panelSideRef = useRef(panelSide);
  panelSideRef.current = panelSide;
  const widthRef = useRef(width);
  widthRef.current = width;
  const panelRef = useRef<HTMLElement | null>(null);
  const liveWidthRef = useRef(width);

  useEffect(() => {
    writeLocal(PANEL_OPEN_KEY, String(open));
  }, [open]);

  useEffect(() => {
    writeLocal(PANEL_WIDTH_KEY, String(width));
  }, [width]);

  const handleRef = useRef<HTMLDivElement | null>(null);
  // The panel's width and the separator's announced value are one fact, so they
  // are written in one place. A drag never re-renders (that is the point of
  // batching the write imperatively), so the announced value would otherwise
  // stay frozen at whatever React last committed — and settling them
  // separately at pointer-up left the attribute stranded at an intermediate
  // value whenever the pointer returned to its starting width, because setWidth
  // then matches state and React skips the render that would have fixed it.
  const applyWidth = useCallback((w: number) => {
    if (panelRef.current) panelRef.current.style.width = `${w}px`;
    handleRef.current?.setAttribute("aria-valuenow", String(Math.round(w)));
  }, []);
  const { schedule: scheduleWidth, cancel: cancelWidthFrame } =
    useRafBatchedWrite<number>(applyWidth);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = widthRef.current;
    liveWidthRef.current = widthRef.current;
    (e.target as Element).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = panelSideRef.current === "left"
      ? e.clientX - startX.current
      : startX.current - e.clientX;
    const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW.current + delta));
    liveWidthRef.current = next;
    scheduleWidth(next);
  }, [scheduleWidth]);

  const onPointerUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    // Drop any pending rAF write so a frame queued immediately before pointer-up
    // can't fire after React commits the settled width below.
    cancelWidthFrame();
    // Write the final width imperatively first: when liveWidthRef equals the
    // pre-drag width, setWidth below is a no-op and React skips the render,
    // leaving the DOM at whatever the last rAF frame applied (a few px short
    // of the actual pointer position). Mirrors the BottomSheet drag-settle fix.
    applyWidth(liveWidthRef.current);
    setWidth(liveWidthRef.current);
  }, [cancelWidthFrame, applyWidth]);

  const side = panelSide === "right" ? "param-panel--right" : "param-panel--left";
  // Collapse chevron points toward the screen edge the panel docks against.
  const CollapseChevron = panelSide === "right" ? ChevronRightIcon : ChevronLeftIcon;
  // Overridable via the config's `strings` block (src/locales/en.json's
  // presets.title/settings.title), see docs/config.md's "Text overrides".
  const presetsLabel = t("presets.title");
  const parametersLabel = t("settings.title");

  if (!open) {
    return (
      // Keep the #params id on the rail even collapsed, so the "Skip to
      // parameters" link (AppShell) never dangles: landing on the "Open
      // panel" button is the correct target when there's no panel to skip to.
      // tabIndex -1 for the same reason #main-content has one (AppShell): a
      // skip link that targets a non-focusable element only shifts the
      // sequential-focus starting point, so a screen reader's focus stays where
      // it was and the "skip" appears to do nothing.
      <div className={`param-panel-rail ${side}`} id="params" tabIndex={-1}>
        <button
          className="param-panel-open-btn font-display"
          onClick={() => setOpen(true)}
          aria-label={t("settings.openPanel", { label: parametersLabel })}
          title={t("settings.openPanel", { label: parametersLabel })}
        >
          <MenuIcon size={14} /> {parametersLabel}
        </button>
      </div>
    );
  }

  return (
    <aside
      ref={panelRef}
      className={`param-panel ${side}`}
      style={{ width }}
      id="params"
      tabIndex={-1}
      aria-label={parametersLabel}
    >
      {/* Drag handle for resize */}
      <div
        ref={handleRef}
        className={`param-panel__resize-handle ${panelSide === "right" ? "handle--left" : "handle--right"}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize parameter panel"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        onKeyDown={(e) => {
          // Pointer-drag direction flips with panelSide (the handle sits on
          // the panel's outer edge: left edge when docked right), so mirror
          // that here: for a right-docked panel ArrowLeft (handle moves left,
          // away from the panel) grows it and ArrowRight shrinks it.
          const grow = panelSide === "right" ? "ArrowLeft" : "ArrowRight";
          const shrink = panelSide === "right" ? "ArrowRight" : "ArrowLeft";
          if (e.key === shrink) setWidth((w) => Math.max(MIN_WIDTH, w - 20));
          if (e.key === grow) setWidth((w) => Math.min(MAX_WIDTH, w + 20));
        }}
      />

      <Tabs
        value={panelTab}
        onValueChange={(v) => onPanelTabChange(v as PanelTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        {/* Tab row (Presets / Parameters) with the collapse control on the end. */}
        <div className="flex shrink-0 items-stretch border-b">
          <TabsList className="flex-1 rounded-none border-0 bg-transparent p-0">
            <TabsTrigger value="presets" className={panelTabClass}>{presetsLabel}</TabsTrigger>
            <TabsTrigger value="params" className={panelTabClass}>{parametersLabel}</TabsTrigger>
          </TabsList>
          <IconButton
            className="mr-1 self-center"
            label={t("panel.collapse")}
            title={t("panel.collapseTitle")}
            onClick={() => setOpen(false)}
          >
            <CollapseChevron size={16} />
          </IconButton>
        </div>

        <TabsContent value="presets" className="mt-0 flex min-h-0 flex-1 flex-col">
          <PresetPicker
            design={design}
            bundled={bundled}
            userPresets={userPresets}
            selected={selectedPreset}
            values={values}
            onApply={applyPreset}
            onSelectedChange={selectedPresetChange}
            onPresetsChange={presetsChange}
          />
        </TabsContent>

        <TabsContent value="params" className="mt-0 flex min-h-0 flex-1 flex-col">
          <PresetDiffBar
            design={design}
            values={values}
            presetBaseline={presetBaseline}
            presetName={presetName}
            changedParams={changedParams}
          />
          <ParamSearch
            value={search}
            onChange={onSearchChange}
            onClear={() => onSearchChange("")}
            onFocus={onSearchFocus}
            onBlur={onSearchBlur}
          />
          {/* Essentials is no longer a row of its own here: it's the closing
              row of the form itself now, in both layouts (see
              EssentialsToggle). The section navigator stays: this panel is
              tall and resizable, so a standing jump control costs it nothing
              the way it cost the mobile sheet. */}
          <SectionNavigator
            sections={navSections}
            onSelect={(s) => formRef.current?.openSection(s)}
            className="mx-3 mt-2 self-start"
          />
          {/* No padding-top, see SheetTabs' scroller: it would strand the
              sticky group headers below the port edge. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <ParamForm ref={formRef} design={design} values={values} onChange={change} search={debouncedSearch} showVarName={showVarName} availableFontFamilies={availableFontFamilies} fontSuggestion={fontSuggestion} installedFonts={installedFonts} availableSvgFiles={availableSvgFiles} baseline={baseline} changedParams={changedParams} presetName={presetName} showAdvanced={showAdvanced} onShowAdvancedChange={onShowAdvancedChange} failure={failure} />
          </div>
        </TabsContent>
      </Tabs>

      <PanelFooter
        autoRender={autoRender}
        className="flex shrink-0 items-center gap-2 border-t px-3 py-[0.4rem]"
      />
    </aside>
  );
}
