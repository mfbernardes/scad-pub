// AppShell.tsx — responsive layout shell. Owns the full-bleed viewer canvas with:
//   Desktop (≥ 860px): CommandBar + docked ParamPanel + ActionCluster + ViewerHUD
//   Mobile (< 860px):  full-bleed viewer + top bar + BottomSheet + fixed footer
// All state/logic stays in App.tsx; this is a pure view extraction.
import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { Design, Schema } from "../openscad/types";
import type { Values, ParsedSet } from "../lib/presets";
import type { RenderResult } from "../openscad/types";
import type { ViewerHandle, Dimensions } from "./Viewer";

// Peek shows just the drag handle + the tab bar (Presets/Parameters/Files),
// ending at the tab underline — no sliver of the tab's content.
const PEEK_HEIGHT = 60;
const MOBILE_FOOTER_HEIGHT = 56;
// Stable empty-log identity so idle re-renders don't break memo'd children.
const EMPTY_LOG: string[] = [];

import { CommandBar } from "./CommandBar";
import { ParamPanel } from "./ParamPanel";
import { ActionButtons } from "./ActionButtons";
import { ViewerStage } from "./ViewerStage";
import { ViewerHUD } from "./ViewerHUD";
import { DEFAULT_VIEW, type ViewName } from "./views";
import { OutputConsole } from "./OutputConsole";
import { BottomSheet, type SheetDetent } from "./BottomSheet";
import { SheetTabs } from "./SheetTabs";
import { DesignPicker } from "./DesignPicker";
import { BarBrand } from "./BarBrand";
import { BarActions } from "./BarActions";
import { parseDiagnostics, countBadges } from "../lib/diagnostics";
import { parseComputedInfo } from "../lib/computedInfo";
import { fontFamilyNames, normalizeFamily } from "../lib/fonts";
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
  bundled: ParsedSet[];
  userPresets: string[];
  selectedPreset: string;
  userFiles: Record<string, Uint8Array>;
  result: RenderResult | null;
  rendering: boolean;
  ready: boolean;
  autoRender: boolean;
  stalePreview: boolean;
  theme: "dark" | "light";
  themeMode: "light" | "dark" | "auto";
  canInstall: boolean;
}

export const AppShell = memo(function AppShell({
  schema,
  design,
  designs,
  values,
  renderedValues,
  bundled,
  userPresets,
  selectedPreset,
  userFiles,
  result,
  rendering,
  ready,
  autoRender,
  stalePreview,
  theme,
  themeMode,
  canInstall,
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
  // The fixed footer reserves the iOS home-indicator inset below its buttons (see
  // .mobile-footer / --mobile-footer-total in index.css), so the sheet must sit
  // above the footer's *full* height — its 56px button band plus that inset —
  // for its JS geometry to match the CSS layout. Off-iOS the inset is 0.
  const safeAreaBottom = useSafeAreaBottom();
  const footerInset = MOBILE_FOOTER_HEIGHT + safeAreaBottom;
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
  const showVarName = ui.showVarName !== false;
  // Configurable tab/section labels (default to the built-in names).
  const presetsLabel = ui.presetsLabel ?? "Presets";
  const parametersLabel = ui.parametersLabel ?? "Parameters";
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

  // Notices are surfaced by the dot on the Output toggle, not by auto-popping the
  // console. We only auto-hide a console that's open once its notices clear —
  // detected by comparing against the previous render's value (the react.dev
  // "adjust state during render" pattern), no effect pass needed.
  const hasNotices = diagnostics.length > 0;
  const [prevHasNotices, setPrevHasNotices] = useState(hasNotices);
  if (hasNotices !== prevHasNotices) {
    setPrevHasNotices(hasNotices);
    if (!hasNotices) setOutputOpen(false);
  }

  return (
    <div className="app-shell">
      {/* Skip link */}
      <a className="skip-link" href="#params">Skip to parameters</a>

      {/* ── Desktop layout (hidden on mobile via CSS) ── */}
      <div className="app-shell__desktop">
        <CommandBar
          schema={schema}
          designs={designs}
          designId={design.id}
          design={design}
          bundled={bundled}
          userPresets={userPresets}
          selectedPreset={selectedPreset}
          values={values}
          theme={theme}
          themeMode={themeMode}
          rendering={rendering}
          ready={ready}
          result={result}
          stalePreview={stalePreview}
          canInstall={canInstall}
          presetsLabel={presetsLabel}
        />

        <div className={`app-shell__canvas-area${panelSide === "right" ? " panel-right" : ""}`}>
          {/* Docked panel (presets live in the CommandBar on desktop) */}
          <ParamPanel
            design={design}
            values={values}
            fileImport={fileImport}
            loadedFiles={loadedFiles}
            availableFontFamilies={availableFontFamilies}
            fontSuggestion={fontSuggestion}
            panelSide={panelSide}
            panelDefaultOpen={panelDefaultOpen}
            showVarName={showVarName}
            autoRender={autoRender}
            parametersLabel={parametersLabel}
          />

          {/* Canvas */}
          <div className="app-shell__viewer">
            <ViewerStage
              viewerRef={desktopViewerRef}
              active={!isMobile}
              design={design}
              result={result}
              ready={ready}
              rendering={rendering}
              autoRender={autoRender}
              stalePreview={stalePreview}
              theme={theme}
              selectedPreset={selectedPreset}
              showDimensions={showDimensions}
              view={view}
              onMeasure={setMeasured}
              measured={measured}
              renderedValues={renderedValues}
              computedInfo={computedInfo}
            >
              {/* Floating controls live inside viewer-wrap so they hover over the
                  canvas — which shrinks when the output console docks below it —
                  rather than overlapping the console's notices. */}
              <div className="action-cluster">
                <ActionButtons
                  hasResult={!!result?.ok}
                  modelFormat={schema.format}
                  outputOpen={outputOpen}
                  noticeCount={diagnostics.length}
                  onSavePng={handleSavePng}
                  onToggleOutput={toggleOutput}
                />
              </div>
              <ViewerHUD
                viewerRef={desktopViewerRef}
                visible={!!result?.ok}
                measure={showMeasure}
                showDimensions={showDimensions}
                onToggleDimensions={toggleDimensions}
                viewPicker={showViewPicker}
                reset={showReset}
                zoom={showZoom}
                view={view}
                onSelectView={handleSelectView}
              />
            </ViewerStage>

            {/* Output console — inline below viewer */}
            <OutputConsole
              log={log}
              diagnostics={diagnostics}
              badges={badges}
              open={outputOpen}
              onClose={() => setOutputOpen(false)}
            />
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
            viewerRef={mobileViewerRef}
            active={isMobile}
            design={design}
            result={result}
            ready={ready}
            rendering={rendering}
            autoRender={autoRender}
            stalePreview={stalePreview}
            theme={theme}
            selectedPreset={selectedPreset}
            reframeOnPreset={false}
            showDimensions={showDimensions}
            view={view}
            onMeasure={setMeasured}
            measured={measured}
            renderedValues={renderedValues}
            computedInfo={computedInfo}
          />

          {/* Mobile top bar — logo left, design centered, actions right (mirrors desktop) */}
          <div className="mobile-top-bar">
            <span className="mobile-top-bar__brand">
              <BarBrand schema={schema} theme={theme} />
            </span>
            <div className="mobile-top-bar__center">
              {designs.length > 1 ? (
                <DesignPicker designs={designs} value={design.id} onChange={actions.designChange} />
              ) : (
                <span className="mobile-top-bar__design-name">{design.label}</span>
              )}
            </div>
            <div className="mobile-top-bar__right">
              <BarActions
                rendering={rendering}
                ready={ready}
                result={result}
                stalePreview={stalePreview}
                themeMode={themeMode}
                licensesLabel="About & licenses"
              />
            </div>
          </div>
        </div>

        {/* Output console (mobile — slides up over the sheet as a dismissible
            overlay, with a scrim so it reads as a distinct layer, not another
            band stacked above the sheet). */}
        {outputOpen && (
          <div
            className="output-console__scrim"
            onClick={() => setOutputOpen(false)}
            aria-hidden="true"
          />
        )}
        <OutputConsole
          log={log}
          diagnostics={diagnostics}
          badges={badges}
          open={outputOpen}
          onClose={() => setOutputOpen(false)}
        />

        {/* Persistent bottom sheet */}
        <BottomSheet
          detent={sheetDetent}
          onDetentChange={handleDetentChange}
          onFollow={handleSheetFollow}
          peekHeight={PEEK_HEIGHT}
          bottomInset={footerInset}
        >
          {(_detent, expand) => (
            // The tab bar shows at every detent (including peek); tapping a tab
            // raises a collapsed sheet. Auto-render + Reset are param-scoped, so
            // they live inside the Parameters tab (SheetTabs), not here.
            <div className="sheet-content" id="params">
              <SheetTabs
                design={design}
                values={values}
                bundled={bundled}
                userPresets={userPresets}
                selected={selectedPreset}
                fileImport={fileImport}
                loadedFiles={loadedFiles}
                availableFontFamilies={availableFontFamilies}
                fontSuggestion={fontSuggestion}
                onActivate={expand}
                showVarName={showVarName}
                autoRender={autoRender}
                presetsLabel={presetsLabel}
                parametersLabel={parametersLabel}
              />
            </div>
          )}
        </BottomSheet>

        {/* Fixed footer: primary actions always accessible outside the sheet */}
        <div className="mobile-footer">
          <ActionButtons
            compact
            hasResult={!!result?.ok}
            modelFormat={schema.format}
            outputOpen={outputOpen}
            noticeCount={diagnostics.length}
            onSavePng={handleSavePng}
            onToggleOutput={toggleOutput}
          />
        </div>

        <ViewerHUD
          viewerRef={mobileViewerRef}
          visible={!!result?.ok}
          measure={showMeasure}
          showDimensions={showDimensions}
          onToggleDimensions={toggleDimensions}
          viewPicker={showViewPicker}
          reset={showReset}
          zoom={showZoom}
          view={view}
          onSelectView={handleSelectView}
        />
      </div>
    </div>
  );
});
