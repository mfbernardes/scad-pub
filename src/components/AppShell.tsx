// AppShell.tsx — responsive layout shell. Owns the full-bleed viewer canvas with:
//   Desktop (≥ 860px): CommandBar + docked ParamPanel + ActionCluster + ViewerHUD
//   Mobile (< 860px):  full-bleed viewer + top bar + BottomSheet + floating ActionCluster
// Both layouts float the same compact action cluster over the viewer bottom —
// mobile no longer reserves a solid footer band. All state/logic stays in
// App.tsx; this is a pure view extraction.
import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { Design, Schema } from "../openscad/types";
import type { Values, ParsedSet } from "../lib/presets";
import type { RenderResult } from "../openscad/types";
import type { RenderMetrics } from "../lib/renderMetrics";
import type { ViewerHandle, Dimensions } from "./Viewer";

// Peek shows just the drag handle + the tab bar (Presets/Parameters/Files),
// ending at the tab underline — no sliver of the tab's content.
const PEEK_HEIGHT = 60;
// Stable empty-log identity so idle re-renders don't break memo'd children.
const EMPTY_LOG: string[] = [];
// The floating action cluster that wraps the ActionButtons row — a solid raised
// card shared verbatim by the desktop and mobile clusters so a tweak to
// padding/border lands once.
const ACTION_CLUSTER_CLASS =
  "action-cluster flex items-center gap-[0.3rem] whitespace-nowrap rounded-lg border-(color:--glass-border) border bg-(--glass-bg) px-[0.45rem] py-[0.35rem] shadow-(--elevation)";

import { CommandBar } from "./CommandBar";
import { ParamPanel } from "./ParamPanel";
import { ActionButtons } from "./ActionButtons";
import { OutputToggle } from "./OutputToggle";
import { BarActions } from "./BarActions";
import { IconButton, ICON_BUTTON_CLASS } from "./IconButton";
import { BookOpen as GuideIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { ViewerStage } from "./ViewerStage";
import { ViewerHUD } from "./ViewerHUD";
import { DEFAULT_VIEW, type ViewName } from "./views";
import { OutputConsole } from "./OutputConsole";
import { BottomSheet, type SheetDetent } from "./BottomSheet";
import { SheetTabs } from "./SheetTabs";
import { DesignPicker } from "./DesignPicker";
import { BarBrand } from "./BarBrand";
import { parseDiagnostics, countBadges } from "../lib/diagnostics";
import { parseComputedInfo } from "../lib/computedInfo";
import {
  fontFaces,
  fontFamilyNames,
  mergeInstalledFonts,
  normalizeFamily,
  type FontFaceInfo,
} from "../lib/fonts";
import { isFontFile } from "../openscad/renderArgs";
import { useAppActions } from "../lib/appActions";
import { useIsMobile } from "../lib/useIsMobile";
import { useSafeAreaBottom } from "../lib/useSafeAreaBottom";

interface Props {
  schema: Schema;
  design: Design;
  designs: Design[];
  values: Values;
  /** Values behind the current render — what the measurements panel reads. */
  renderedValues: Values;
  /** Local-only render performance telemetry, shown in the Output console's Metrics tab. */
  renderMetrics: RenderMetrics;
  bundled: ParsedSet[];
  userPresets: string[];
  selectedPreset: string;
  /** The selected preset's values, or null when no preset is selected (baseline is defaults). */
  presetBaseline: Values | null;
  /** The selected preset's display name, or null when no preset is selected. */
  presetName: string | null;
  /** Values the current params are diffed against — presetBaseline, or design defaults. */
  baseline: Values;
  /** Names of params whose value differs from `baseline`. */
  changedParams: Set<string>;
  userFiles: Record<string, Uint8Array>;
  result: RenderResult | null;
  rendering: boolean;
  ready: boolean;
  autoRender: boolean;
  stalePreview: boolean;
  theme: "dark" | "light";
  themeMode: "light" | "dark" | "auto";
  /** Incremented by the intro popup's primary CTA to open the design picker. */
  openPickerSignal: number;
}

export const AppShell = memo(function AppShell({
  schema,
  design,
  designs,
  values,
  renderedValues,
  renderMetrics,
  bundled,
  userPresets,
  selectedPreset,
  presetBaseline,
  presetName,
  baseline,
  changedParams,
  userFiles,
  result,
  rendering,
  ready,
  autoRender,
  stalePreview,
  theme,
  themeMode,
  openPickerSignal,
}: Props) {
  const actions = useAppActions();
  const desktopViewerRef = useRef<ViewerHandle>(null);
  const mobileViewerRef = useRef<ViewerHandle>(null);
  // The mobile layout root — its --sheet-follow-h CSS var sizes the viewer so it
  // tracks the sheet live (see handleSheetFollow / .app-shell__mobile-viewer).
  const mobileRootRef = useRef<HTMLDivElement>(null);
  // Only the active layout mounts a Viewer (the other layout is CSS-hidden), so
  // we never run two three.js renderers / RAF loops / STL parses at once.
  const isMobile = useIsMobile();
  // The active Viewer's bounding-box size (mm), reported via onMeasure. Local
  // viewer glue like the PNG-snapshot handler — it needs the viewer, not App.
  const [measured, setMeasured] = useState<Dimensions | null>(null);
  // Whether the viewer overlays arrowed W×D×H dimension lines on the model, plus
  // the top-left measurements panel (bounding box + per-design @info). Off by
  // default; the HUD ruler toggle turns it on. Shared across both layouts so the
  // choice survives a desktop⇄mobile breakpoint switch.
  const [showDimensions, setShowDimensions] = useState(false);
  const toggleDimensions = useCallback(() => setShowDimensions((v) => !v), []);
  // The active camera view. Driving it as state (shared across layouts) keeps the
  // picker's highlight and a freshly-mounted Viewer in step; the imperative snap
  // below re-applies it on every pick, including the current one.
  const [view, setView] = useState<ViewName>(DEFAULT_VIEW);
  // The sheet sits directly on the viewport bottom now (no docked footer band),
  // reserving only the iOS home-indicator inset below itself so its peek row
  // clears the gesture bar. Its JS geometry must match that CSS bottom offset.
  // Off-iOS the inset is 0.
  const safeAreaBottom = useSafeAreaBottom();
  const [outputOpen, setOutputOpen] = useState(
    schema.ui?.outputDefault === "open"
  );
  const outputOpenRef = useRef(outputOpen);
  outputOpenRef.current = outputOpen;
  // Sheet detent state (peek/half/full). On mobile the output overlay now covers
  // the sheet, so it no longer has to be positioned relative to the detent.
  const [sheetDetent, setSheetDetent] = useState<SheetDetent>("peek");

  const ui = schema.ui ?? {};
  const panelSide = ui.panelSide ?? "left";
  const panelDefaultOpen = (ui.panelDefault ?? "open") === "open";
  // Variable names are developer detail — hidden unless a config opts in.
  const showVarName = ui.showVarName === true;
  // Configurable tab/section labels (default to the built-in names).
  const presetsLabel = ui.presetsLabel ?? "Presets";
  const parametersLabel = ui.parametersLabel ?? "Customize";
  // Whether the viewer offers the measure (dimensions) toggle. Off hides the HUD
  // ruler button; the overlay + panel are only reachable through it, so they
  // stay hidden too.
  const showMeasure = ui.measure !== false;
  // Whether the viewer offers the view picker (camera-angle menu).
  const showViewPicker = ui.viewPicker !== false;
  // Whether the viewer offers the "reset view" button.
  const showReset = ui.reset !== false;
  // Whether the viewer offers the zoom in/out buttons (off by default).
  const showZoom = ui.zoom === true;
  // Whether the viewer offers the fullscreen toggle (where it works at all).
  const showFullscreen = ui.fullscreen !== false;

  const log = result?.log ?? EMPTY_LOG;
  const notices = schema.notices ?? [];
  const fileImport = schema.fileImport ?? null;
  const loadedFiles = useMemo(
    () => Object.entries(userFiles).map(([name, bytes]) => ({ name, size: bytes.byteLength })),
    [userFiles]
  );

  // The set of font families the renderer can actually use: bundled families
  // (parsed at build time) plus the embedded families of any imported font.
  // Normalised for case/space-insensitive matching. The font controls compare a
  // design's `font` value against this to flag a missing family (see ParamForm).
  const availableFontFamilies = useMemo(() => {
    const set = new Set((schema.fontFamilies ?? []).map(normalizeFamily));
    for (const [name, bytes] of Object.entries(userFiles)) {
      if (isFontFile(name))
        for (const fam of fontFamilyNames(bytes)) set.add(normalizeFamily(fam));
    }
    return set;
  }, [schema.fontFamilies, userFiles]);
  // A bundled family to offer as a one-click fallback when the selected font
  // isn't loaded. Always available, so it can never itself be missing.
  const fontSuggestion = (schema.fontFamilies ?? [])[0] ?? null;
  // Every face the renderer can actually use, display-ordered: the bundled
  // faces (parsed at build time into schema.fontFaces) merged with the faces of
  // any imported font — so the font selector's list updates the moment a font
  // is imported. Feeds ParamForm's FontSelect.
  const installedFonts = useMemo(() => {
    const imported: FontFaceInfo[] = [];
    for (const [name, bytes] of Object.entries(userFiles)) {
      if (isFontFile(name)) imported.push(...fontFaces(bytes));
    }
    return mergeInstalledFonts(schema.fontFaces ?? [], imported);
  }, [schema.fontFaces, userFiles]);

  // Parse the log once here; the OutputConsole (Notices tab count chips) reads
  // this derived data instead of re-parsing it.
  const diagnostics = useMemo(() => parseDiagnostics(log, notices), [log, notices]);
  const badges = useMemo(() => countBadges(log, notices), [log, notices]);
  // Rows from `echo("@info", label, unit, value)` — internally-calculated
  // values the design surfaced at render time (see lib/computedInfo.ts).
  const computedInfo = useMemo(() => parseComputedInfo(log), [log]);

  const handleSavePng = useCallback(() => {
    const url = (isMobile ? mobileViewerRef : desktopViewerRef).current?.snapshot();
    if (url) actions.savePng(url);
  }, [isMobile, actions]);

  // Snap the active viewer to a view and remember it (the prop keeps a
  // freshly-mounted viewer in step; the imperative call re-applies on every pick).
  const handleSelectView = useCallback((next: ViewName) => {
    setView(next);
    (isMobile ? mobileViewerRef : desktopViewerRef).current?.setView(next);
  }, [isMobile]);

  // Open the overlay and collapse the sheet to peek, so the overlay's fixed
  // anchor (just above the peek tab row) never overlaps an expanded sheet.
  const openOutput = useCallback(() => {
    setOutputOpen(true);
    setSheetDetent("peek");
  }, []);

  const toggleOutput = useCallback(() => {
    if (outputOpenRef.current) setOutputOpen(false);
    else openOutput();
  }, [openOutput]);

  // Raising the sheet off peek (dragging the handle OR tapping a tab) would slide
  // its content up under the overlay — close the overlay on any such change so
  // the two are never shown at once.
  const handleDetentChange = useCallback((d: SheetDetent) => {
    setSheetDetent(d);
    if (d !== "peek") setOutputOpen(false);
  }, []);

  // Size the mobile viewer to follow the sheet's live height: write the sheet
  // height (px) into --sheet-follow-h, which sets the viewer's bottom edge (the
  // Viewer's RAF loop reframes the model into the new box). The CSS caps it at
  // the half height, and data-sheet-dragging toggles the easing — see
  // .app-shell__mobile-viewer.
  const handleSheetFollow = useCallback((heightPx: number, dragging: boolean) => {
    const el = mobileRootRef.current;
    if (!el) return;
    el.style.setProperty("--sheet-follow-h", `${Math.round(heightPx)}px`);
    el.dataset.sheetDragging = dragging ? "true" : "false";
  }, []);

  // Mirror the sheet's measured "Peek" height (drag handle + tab row) into
  // --mobile-peek-height, so the output console overlay + scrim anchor to the
  // real row instead of the static CSS fallback, which font scaling can
  // exceed. See BottomSheet's onPeekHeightChange doc.
  const handleSheetPeekHeight = useCallback((heightPx: number) => {
    const el = mobileRootRef.current;
    if (!el) return;
    el.style.setProperty("--mobile-peek-height", `${Math.round(heightPx)}px`);
  }, []);

  // Info-level notices (config-driven `notices`) are surfaced passively by the
  // dot/count on the Output toggle. A warning or assert is different — the model
  // came out wrong in a way worth seeing — so the console auto-opens the first
  // time a render surfaces one, rather than hiding it behind a badge the user
  // may never click. Both transitions use the react.dev "adjust state during
  // render" pattern (compare against the previous render's value), no effect.
  const hasNotices = diagnostics.length > 0;
  const [prevHasNotices, setPrevHasNotices] = useState(hasNotices);
  if (hasNotices !== prevHasNotices) {
    setPrevHasNotices(hasNotices);
    if (!hasNotices) setOutputOpen(false); // notices cleared → hide the console
  }
  // Auto-open on the false→true edge only, so a persistent warning across edits
  // doesn't re-pop a console the user has dismissed.
  const hasProblem = diagnostics.some((d) => d.level === "warning" || d.level === "assert");
  const [prevHasProblem, setPrevHasProblem] = useState(hasProblem);
  if (hasProblem !== prevHasProblem) {
    setPrevHasProblem(hasProblem);
    if (hasProblem) {
      setOutputOpen(true);
      setSheetDetent("peek"); // mobile: anchor the overlay above the peek sheet
    }
  }

  const closeOutput = useCallback(() => setOutputOpen(false), []);

  // Prop bundles shared verbatim by the two layout trees — each invocation
  // below adds only its layout-specific bits (viewer ref, active flag, …).
  const stageProps = {
    design,
    result,
    ready,
    rendering,
    autoRender,
    stalePreview,
    theme,
    selectedPreset,
    showDimensions,
    view,
    onMeasure: setMeasured,
    measured,
    renderedValues,
    computedInfo,
  };
  const hudProps = {
    visible: !!result?.ok,
    measure: showMeasure,
    showDimensions,
    onToggleDimensions: toggleDimensions,
    viewPicker: showViewPicker,
    reset: showReset,
    zoom: showZoom,
    fullscreen: showFullscreen,
    view,
    onSelectView: handleSelectView,
  };
  const outputProps = { log, diagnostics, badges, metrics: renderMetrics, open: outputOpen, onClose: closeOutput };
  const actionButtonsProps = {
    hasResult: !!result?.ok,
    modelFormat: schema.format,
    onSavePng: handleSavePng,
  };
  return (
    <div className="app-shell">
      {/* Skip link: off-screen until focused. Both layout trees are always
          mounted (one CSS-hidden), each with its own #params(-mobile) target,
          so the href must follow the layout that's actually visible/active. */}
      <a
        className="skip-link absolute left-2 -top-12 z-[200] rounded-(--radius-sm) border border-brand bg-card px-[0.7rem] py-[0.4rem] text-foreground touch-manipulation [transition:top_0.15s_ease] focus:top-2"
        href={isMobile ? "#params-mobile" : "#params"}
      >
        Skip to parameters
      </a>

      {/* ── Desktop layout (hidden on mobile via CSS) ── */}
      <div className="app-shell__desktop">
        <CommandBar
          schema={schema}
          designs={designs}
          designId={design.id}
          theme={theme}
          themeMode={themeMode}
          rendering={rendering}
          ready={ready}
          result={result}
          stalePreview={stalePreview}
          outputOpen={outputOpen}
          noticeCount={diagnostics.length}
          onToggleOutput={toggleOutput}
          openPickerSignal={openPickerSignal}
          pickerActive={!isMobile}
        />

        <div className={`app-shell__canvas-area${panelSide === "right" ? " panel-right" : ""}`}>
          {/* Docked panel: Presets / Parameters / Files tabs (mirrors mobile). */}
          <ParamPanel
            design={design}
            values={values}
            bundled={bundled}
            userPresets={userPresets}
            selectedPreset={selectedPreset}
            presetBaseline={presetBaseline}
            presetName={presetName}
            baseline={baseline}
            changedParams={changedParams}
            fileImport={fileImport}
            loadedFiles={loadedFiles}
            availableFontFamilies={availableFontFamilies}
            fontSuggestion={fontSuggestion}
            installedFonts={installedFonts}
            panelSide={panelSide}
            panelDefaultOpen={panelDefaultOpen}
            showVarName={showVarName}
            autoRender={autoRender}
            presetsLabel={presetsLabel}
            parametersLabel={parametersLabel}
          />

          {/* Canvas */}
          <div className="app-shell__viewer">
            <ViewerStage {...stageProps} viewerRef={desktopViewerRef} active={!isMobile}>
              {/* Floating controls live inside viewer-wrap so they hover over the
                  canvas — which shrinks when the output console docks below it —
                  rather than overlapping the console's notices. */}
              <div className={ACTION_CLUSTER_CLASS}>
                <ActionButtons {...actionButtonsProps} />
              </div>
              <ViewerHUD {...hudProps} viewerRef={desktopViewerRef} />
            </ViewerStage>

            {/* Output console — inline below viewer */}
            <OutputConsole {...outputProps} className="max-h-56" />
          </div>
        </div>
      </div>

      {/* ── Mobile layout (hidden on desktop via CSS) ── */}
      {/* --sheet-follow-h (set live by handleSheetFollow) sizes the viewer so its
          bottom edge tracks the sheet; data-sheet-dragging toggles the easing.
          See .app-shell__mobile-viewer in CSS. */}
      <div className="app-shell__mobile" ref={mobileRootRef}>
        {/* Full-bleed viewer */}
        <div className="app-shell__mobile-viewer">
          <ViewerStage
            {...stageProps}
            viewerRef={mobileViewerRef}
            active={isMobile}
            reframeOnPreset={false}
          />

          {/* Mobile top bar — logo left, design centered, actions right (mirrors
              desktop). Normally z-10 (below the bottom sheet, z-30, so the
              full-detent sheet covers it and its drag handle stays grabbable).
              While the output console is open it lifts to z-[33] — above the
              scrim (z-[31]) and console (z-[32]) — so the design picker/⋮/bell
              stay tappable; the console only opens at the peek detent, so this
              never fights the full-detent sheet. */}
          <div className={cn(
            "mobile-top-bar absolute inset-x-0 top-0 grid min-h-12 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-b-(color:--glass-border) bg-(--glass-bg) pt-[calc(env(safe-area-inset-top,0px)+0.4rem)] pb-[0.4rem] pl-[calc(0.75rem+env(safe-area-inset-left,0px))] pr-[calc(0.75rem+env(safe-area-inset-right,0px))]",
            outputOpen ? "z-[33]" : "z-10"
          )}>
            <span className="inline-flex min-w-0 items-center gap-[0.4rem] justify-self-start overflow-hidden whitespace-nowrap px-[0.2rem] py-[0.3rem] text-[0.92rem] font-bold">
              <BarBrand schema={schema} theme={theme} logoClassName="h-[1.3rem]" />
            </span>
            <div className="mobile-top-bar__center inline-flex min-w-0 items-center justify-self-center">
              {designs.length > 1 ? (
                <DesignPicker
                  designs={designs}
                  value={design.id}
                  onChange={actions.designChange}
                  openSignal={openPickerSignal}
                  active={isMobile}
                />
              ) : (
                <span className="whitespace-nowrap px-[0.2rem] py-[0.3rem] text-[0.85rem] font-semibold">
                  {design.label}
                </span>
              )}
              {design.doc && (
                <IconButton
                  label="Design guide"
                  title="About this design"
                  onClick={actions.showDesignDoc}
                  className="mobile-top-bar__design-doc size-7 shrink-0 p-[0.3rem]"
                >
                  <GuideIcon size={15} />
                </IconButton>
              )}
            </div>
            {/* The Output bell doubles as the render-status indicator (a
                status dot rides its corner), so the narrow bar needs no
                separate pill; theme/help/licenses collapse into a ⋮ overflow. */}
            <div className="inline-flex items-center gap-[0.4rem] justify-self-end">
              <OutputToggle
                outputOpen={outputOpen}
                noticeCount={diagnostics.length}
                onToggleOutput={toggleOutput}
                status={{ rendering, ready, result, stale: stalePreview }}
                className={cn(ICON_BUTTON_CLASS, "mobile-top-bar__output")}
              />
              <BarActions themeMode={themeMode} collapse />
            </div>
          </div>
        </div>

        {/* Output console (mobile — slides up over the sheet as a dismissible
            overlay, with a scrim so it reads as a distinct layer, not another
            band stacked above the sheet). */}
        {/* Output console (mobile): a dismissible overlay that slides up just
            above the COLLAPSED (peek) sheet — the sheet's tab row stays visible
            and tappable beneath it — with a scrim dimming only the viewer. */}
        {outputOpen && (
          <button
            type="button"
            className="output-console__scrim absolute inset-x-0 top-0 bottom-[calc(var(--safe-area-bottom)+var(--mobile-peek-height))] z-[31] bg-black/40"
            onClick={closeOutput}
            aria-label="Close messages"
          />
        )}
        <OutputConsole
          {...outputProps}
          className="absolute inset-x-0 bottom-[calc(var(--safe-area-bottom)+var(--mobile-peek-height))] z-[32] max-h-[55vh] rounded-t-(--radius) border-b-0 shadow-(--elevation)"
        />

        {/* Persistent bottom sheet */}
        <BottomSheet
          detent={sheetDetent}
          onDetentChange={handleDetentChange}
          onFollow={handleSheetFollow}
          onPeekHeightChange={handleSheetPeekHeight}
          peekHeight={PEEK_HEIGHT}
          bottomInset={safeAreaBottom}
        >
          {(_detent, expand) => (
            // The tab bar shows at every detent (including peek); tapping a tab
            // raises a collapsed sheet. Auto-render + Reset are param-scoped, so
            // they live inside the Parameters tab (SheetTabs), not here.
            <div className="sheet-content" id="params-mobile">
              <SheetTabs
                design={design}
                values={values}
                bundled={bundled}
                userPresets={userPresets}
                selected={selectedPreset}
                presetBaseline={presetBaseline}
                presetName={presetName}
                baseline={baseline}
                changedParams={changedParams}
                fileImport={fileImport}
                loadedFiles={loadedFiles}
                availableFontFamilies={availableFontFamilies}
                fontSuggestion={fontSuggestion}
                installedFonts={installedFonts}
                onActivate={expand}
                showVarName={showVarName}
                autoRender={autoRender}
                presetsLabel={presetsLabel}
                parametersLabel={parametersLabel}
              />
            </div>
          )}
        </BottomSheet>

        {/* Floating action cluster — the same compact card the desktop
            floats over its viewer, riding just above the sheet's top edge (it
            follows the sheet up to the half detent via --sheet-follow-h) instead
            of a solid docked footer band that would reserve a strip of the
            viewport. Identical markup + buttons to the desktop cluster. */}
        <div className={ACTION_CLUSTER_CLASS}>
          <ActionButtons {...actionButtonsProps} />
        </div>

        <ViewerHUD {...hudProps} viewerRef={mobileViewerRef} />
      </div>
    </div>
  );
});
