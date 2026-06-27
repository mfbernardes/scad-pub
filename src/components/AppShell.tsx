// AppShell.tsx — responsive layout shell. Owns the full-bleed viewer canvas with:
//   Desktop (≥ 860px): CommandBar + docked ParamPanel + ActionCluster + ViewerHUD
//   Mobile (< 860px):  full-bleed viewer + top bar + BottomSheet + fixed footer
// All state/logic stays in App.tsx; this is a pure view extraction.
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Design, Schema } from "../openscad/types";
import type { Values, ParsedSet } from "../lib/presets";
import type { RenderResult } from "../openscad/types";
import type { ViewerHandle } from "./Viewer";

// Peek shows just the drag handle + the tab bar (Presets/Parameters/Files),
// ending at the tab underline — no sliver of the tab's content.
const PEEK_HEIGHT = 60;
const MOBILE_FOOTER_HEIGHT = 56;
// Stable empty-log identity so idle re-renders don't break memo'd children.
const EMPTY_LOG: string[] = [];

import { ErrorBoundary } from "./ErrorBoundary";
import { CommandBar } from "./CommandBar";
import { ParamPanel } from "./ParamPanel";
import { ActionCluster } from "./ActionCluster";
import { ViewerHUD } from "./ViewerHUD";
import { OutputConsole } from "./OutputConsole";
import { BottomSheet, detentHeight, type SheetDetent } from "./BottomSheet";
import { SheetTabs } from "./SheetTabs";
import { DesignPicker } from "./DesignPicker";
import { IconButton } from "./IconButton";
import { ResetButton } from "./ResetButton";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { Spinner } from "./ui/spinner";
import { HelpIcon, InfoIcon, PlayIcon, TerminalIcon, LinkIcon, DownloadIcon, ImageIcon } from "./Icons";
import { parseDiagnostics, countBadges } from "../lib/diagnostics";
import { assetUrl } from "../lib/assetUrl";
import { useIsMobile } from "../lib/useIsMobile";
import { useViewportHeight } from "../lib/useViewportHeight";

const Viewer = lazy(() =>
  import("./Viewer").then((m) => ({ default: m.Viewer }))
);

interface Props {
  schema: Schema;
  design: Design;
  designs: Design[];
  values: Values;
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
  onInstall: () => void;
  onDesignChange: (id: string) => void;
  onChange: (name: string, value: import("../openscad/types").ParamValue) => void;
  onApplyPreset: (v: Values) => void;
  onSelectedPresetChange: (id: string) => void;
  onPresetsChange: () => void;
  onRender: () => void;
  onExport: () => void;
  onSavePng: (url: string) => void;
  onCopyLink: () => void;
  onReset: () => void;
  onAddFile: (name: string, bytes: Uint8Array) => void;
  onRemoveFile: (name: string) => void;
  onClearFiles: () => void;
  onAutoRenderChange: (v: boolean) => void;
  onCycleTheme: () => void;
  onShowHelp: () => void;
  onShowLicenses: () => void;
}

export const AppShell = memo(function AppShell({
  schema,
  design,
  designs,
  values,
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
  onInstall,
  onDesignChange,
  onChange,
  onApplyPreset,
  onSelectedPresetChange,
  onPresetsChange,
  onRender,
  onExport,
  onSavePng,
  onCopyLink,
  onReset,
  onAddFile,
  onRemoveFile,
  onClearFiles,
  onAutoRenderChange,
  onCycleTheme,
  onShowHelp,
  onShowLicenses,
}: Props) {
  const desktopViewerRef = useRef<ViewerHandle>(null);
  const mobileViewerRef = useRef<ViewerHandle>(null);
  // Only the active layout mounts a Viewer (the other layout is CSS-hidden), so
  // we never run two three.js renderers / RAF loops / STL parses at once.
  const isMobile = useIsMobile();
  const viewportH = useViewportHeight();
  const [outputOpen, setOutputOpen] = useState(
    schema.ui?.outputDefault === "open"
  );
  const outputOpenRef = useRef(outputOpen);
  outputOpenRef.current = outputOpen;
  // Sheet detent lives here so the output console can sit just above the sheet
  // and so opening the console can shrink a full sheet to make room.
  const [sheetDetent, setSheetDetent] = useState<SheetDetent>("peek");

  const ui = schema.ui ?? {};
  const panelSide = ui.panelSide ?? "left";
  const panelDefaultOpen = (ui.panelDefault ?? "open") === "open";

  const log = result?.log ?? EMPTY_LOG;
  const notices = schema.notices ?? [];
  const fileImport = schema.fileImport ?? null;
  const loadedFiles = useMemo(
    () => Object.entries(userFiles).map(([name, bytes]) => ({ name, size: bytes.byteLength })),
    [userFiles]
  );

  // Parse the log once here; the OutputConsole (Notices tab count chips) reads
  // this derived data instead of re-parsing it.
  const diagnostics = useMemo(() => parseDiagnostics(log, notices), [log, notices]);
  const badges = useMemo(() => countBadges(log, notices), [log, notices]);

  const handleSavePng = useCallback(() => {
    const url = (isMobile ? mobileViewerRef : desktopViewerRef).current?.snapshot();
    if (url) onSavePng(url);
  }, [isMobile, onSavePng]);

  // A full sheet would cover the console — drop it to half to make room.
  const reduceSheetIfFull = useCallback(() => {
    setSheetDetent((d) => (d === "full" ? "half" : d));
  }, []);

  const openOutput = useCallback(() => {
    setOutputOpen(true);
    reduceSheetIfFull();
  }, [reduceSheetIfFull]);

  const toggleOutput = useCallback(() => {
    if (outputOpenRef.current) setOutputOpen(false);
    else openOutput();
  }, [openOutput]);

  // Auto-open the console when a render surfaces notices/warnings/asserts
  // (only on the empty→non-empty transition, so a manual close sticks).
  // Same behaviour on desktop and mobile — the console surfaces notices, so
  // neither top bar carries a badge.
  const hadDiagnostics = useRef(false);
  useEffect(() => {
    const has = diagnostics.length > 0;
    if (has && !hadDiagnostics.current) openOutput();
    hadDiagnostics.current = has;
  }, [diagnostics, openOutput]);

  // Place the mobile console just above the sheet's current top.
  const mobileConsoleStyle = {
    top: "auto" as const,
    bottom: MOBILE_FOOTER_HEIGHT + detentHeight(sheetDetent, MOBILE_FOOTER_HEIGHT, PEEK_HEIGHT, viewportH),
  };

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
          canInstall={canInstall}
          onInstall={onInstall}
          onDesignChange={onDesignChange}
          onApplyPreset={onApplyPreset}
          onSelectedPresetChange={onSelectedPresetChange}
          onPresetsChange={onPresetsChange}
          onCycleTheme={onCycleTheme}
          onShowHelp={onShowHelp}
          onShowLicenses={onShowLicenses}
        />

        <div className={`app-shell__canvas-area${panelSide === "right" ? " panel-right" : ""}`}>
          {/* Docked panel (presets live in the CommandBar on desktop) */}
          <ParamPanel
            design={design}
            values={values}
            fileImport={fileImport}
            loadedFiles={loadedFiles}
            panelSide={panelSide}
            panelDefaultOpen={panelDefaultOpen}
            onChange={onChange}
            onReset={onReset}
            onAddFile={onAddFile}
            onRemoveFile={onRemoveFile}
            onClearFiles={onClearFiles}
          />

          {/* Canvas */}
          <div className="app-shell__viewer">
            <div className="viewer-wrap">
              <ErrorBoundary resetKey={result}>
                <Suspense fallback={null}>
                  {!isMobile && (
                    <Viewer
                      ref={desktopViewerRef}
                      stl={result?.ok ? result.stl : null}
                      theme={theme}
                      designId={design.id}
                      presetId={selectedPreset}
                    />
                  )}
                </Suspense>
              </ErrorBoundary>
              {(!ready || (rendering && !result)) && (
                <div className="viewer-overlay">
                  <Spinner className="size-9 text-muted-foreground" />
                  <p>{ready ? "Rendering…" : "Loading renderer… (one-time ~10 MB download)"}</p>
                </div>
              )}

              {/* Floating controls live inside viewer-wrap so they hover over the
                  canvas — which shrinks when the output console docks below it —
                  rather than overlapping the console's notices. */}
              <ActionCluster
                rendering={rendering}
                autoRender={autoRender}
                stalePreview={stalePreview}
                hasResult={!!result?.ok}
                modelFormat={schema.format}
                outputOpen={outputOpen}
                onRender={onRender}
                onExport={onExport}
                onSavePng={handleSavePng}
                onCopyLink={onCopyLink}
                onToggleOutput={toggleOutput}
                onAutoRenderChange={onAutoRenderChange}
                className="action-cluster--desktop"
              />
              <ViewerHUD
                viewerRef={desktopViewerRef}
                visible={!!result?.ok}
              />
            </div>

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
      <div className="app-shell__mobile">
        {/* Full-bleed viewer */}
        <div className="app-shell__mobile-viewer">
          <div className="viewer-wrap">
            <ErrorBoundary resetKey={result}>
              <Suspense fallback={null}>
                {isMobile && (
                  <Viewer
                    ref={mobileViewerRef}
                    stl={result?.ok ? result.stl : null}
                    theme={theme}
                    designId={design.id}
                    presetId={selectedPreset}
                    reframeOnPreset={false}
                  />
                )}
              </Suspense>
            </ErrorBoundary>
            {(!ready || (rendering && !result)) && (
              <div className="viewer-overlay">
                <Spinner className="size-9 text-muted-foreground" />
                <p>{ready ? "Rendering…" : "Loading renderer… (~10 MB)"}</p>
              </div>
            )}
          </div>

          {/* Mobile top bar — logo left, design centered, actions right (mirrors desktop) */}
          <div className="mobile-top-bar">
            <span className="mobile-top-bar__brand">
              {schema.logo ? (
                <img className="brand-logo" src={assetUrl(schema.logo[theme])} alt={schema.title} />
              ) : (
                schema.title
              )}
            </span>
            <div className="mobile-top-bar__center">
              {designs.length > 1 ? (
                <DesignPicker designs={designs} value={design.id} onChange={onDesignChange} />
              ) : (
                <span className="mobile-top-bar__design-name">{design.label}</span>
              )}
            </div>
            <div className="mobile-top-bar__right">
              <IconButton label="Help" title="Help & keyboard shortcuts" onClick={onShowHelp}>
                <HelpIcon size={16} />
              </IconButton>
              <IconButton label="About & licenses" title="About & licenses" onClick={onShowLicenses}>
                <InfoIcon size={16} />
              </IconButton>
            </div>
          </div>
        </div>

        {/* Output console (mobile — sits just above the bottom sheet) */}
        <OutputConsole
          log={log}
          diagnostics={diagnostics}
          badges={badges}
          open={outputOpen}
          onClose={() => setOutputOpen(false)}
          style={mobileConsoleStyle}
        />

        {/* Persistent bottom sheet */}
        <BottomSheet
          detent={sheetDetent}
          onDetentChange={setSheetDetent}
          peekHeight={PEEK_HEIGHT}
          bottomInset={MOBILE_FOOTER_HEIGHT}
        >
          {(detent, expand) => (
            // The tab bar shows at every detent (including peek); tapping a tab
            // raises a collapsed sheet. The footer only shows once expanded.
            <div className="sheet-content" id="params">
              <SheetTabs
                design={design}
                values={values}
                bundled={bundled}
                userPresets={userPresets}
                selected={selectedPreset}
                fileImport={fileImport}
                loadedFiles={loadedFiles}
                onChange={onChange}
                onApply={onApplyPreset}
                onSelectedChange={onSelectedPresetChange}
                onPresetsChange={onPresetsChange}
                onAddFile={onAddFile}
                onRemoveFile={onRemoveFile}
                onClearFiles={onClearFiles}
                onActivate={expand}
              />
              {detent !== "peek" && (
                <div className="sheet-footer">
                  <Label className="auto-render cursor-pointer font-normal" title="Re-render automatically as parameters change">
                    <Switch checked={autoRender} onCheckedChange={onAutoRenderChange} aria-label="Auto-render" />
                    Auto-render
                  </Label>
                  <ResetButton design={design} values={values} onReset={onReset} className="reset-link ml-auto">Reset</ResetButton>
                </div>
              )}
            </div>
          )}
        </BottomSheet>

        {/* Fixed footer: primary actions always accessible outside the sheet */}
        <div className="mobile-footer">
          {!autoRender && stalePreview && (
            <Button
              className="mobile-footer__render"
              onClick={onRender}
              disabled={rendering}
              aria-label="Render now"
            >
              <PlayIcon size={16} /> Render
            </Button>
          )}
          <Button
            variant="outline"
            onClick={onExport}
            disabled={!result?.ok}
            aria-label={`Export ${schema.format.toUpperCase()}`}
          >
            <DownloadIcon size={16} /> {schema.format.toUpperCase()}
          </Button>
          <Button variant="outline" onClick={handleSavePng} disabled={!result?.ok} aria-label="Save PNG">
            <ImageIcon size={16} /> PNG
          </Button>
          <Button variant="outline" onClick={onCopyLink} aria-label="Copy share link">
            <LinkIcon size={16} /> Share
          </Button>
          <Button
            variant="outline"
            className={`mobile-footer__output${outputOpen ? " active" : ""}`}
            onClick={toggleOutput}
            aria-label={`${outputOpen ? "Close" : "Open"} output console`}
            aria-pressed={outputOpen}
          >
            <TerminalIcon size={16} /> Output
          </Button>
        </div>

        <ViewerHUD
          viewerRef={mobileViewerRef}
          visible={!!result?.ok}
        />
      </div>
    </div>
  );
});
