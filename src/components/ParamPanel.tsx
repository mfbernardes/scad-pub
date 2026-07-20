// ParamPanel.tsx — docked desktop parameter panel: a slim header (collapse), a
// Presets / Parameters / Files tab split (Files only when the design imports
// files), parameter search + ParamForm, and a Reset footer. Collapsible and
// resizable; state persisted to localStorage. Presets live here (a tab,
// mirroring the mobile sheet) rather than in the top bar.
//
// Only genuinely layout-specific props remain here (tab/search wiring, panel
// sizing/side, and the presets/file-import props PresetPicker/FileBar consume
// directly) — the ~25 props CustomizeTab reads identically in
// both this and SheetTabs.tsx now flow through PanelDataContext
// (src/lib/panelData.ts), mounted once by AppShell above both layouts. See
// that module's own doc for why it's a plain (non-stable-ref) context, unlike
// AppActions.
import { useState, useEffect, useRef, useCallback } from "react";
import type { FileImport } from "../openscad/types";
import type { ParsedSet } from "../lib/presets";
import { ns } from "../lib/appId";
import { useAppActions } from "../lib/appActions";
import { usePanelData } from "../lib/panelData";
import type { PanelTab } from "../lib/usePanelState";
import { readLocal, writeLocal } from "../lib/safeStorage";
import { useRafBatchedWrite } from "../lib/useRafBatchedWrite";
import { t } from "../lib/i18n";
import { CustomizeTab } from "./CustomizeTab";
import { FileBar, type LoadedFile } from "./FileBar";
import { PresetPicker } from "./PresetPicker";
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

// v2: the desktop shell pass raised MIN_WIDTH (280 -> 360) and switched the
// default from a flat 360px to a viewport-relative clamp (see
// defaultPanelWidth below) so the panel reads as a generously proportioned
// surface (mockup target), not a cramped utility sidebar — a fresh key so
// existing users' persisted (now-narrower-than-min) width doesn't linger as
// a stale value below the new floor.
const PANEL_WIDTH_KEY = ns("panel.width.v2");
const PANEL_OPEN_KEY = ns("panel.open");

const MIN_WIDTH = 360;
const MAX_WIDTH = 600;

// First-run default (no persisted width yet): clamp(400px, 34vw, 500px) of
// the current viewport, evaluated once at mount — a wide desktop gets a
// roomier panel, a narrow one (just above the 860px mobile breakpoint)
// still gets at least 400px. Guarded for non-browser test environments
// (jsdom-style `window` with no real viewport) with a sane fallback.
const defaultPanelWidth = (): number => {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  return Math.round(Math.min(500, Math.max(400, vw * 0.34)));
};

interface Props {
  bundled: ParsedSet[];
  userPresets: string[];
  selectedPreset: string;
  fileImport: FileImport | null;
  loadedFiles: LoadedFile[];
  panelSide: "left" | "right";
  panelDefaultOpen: boolean;
  autoRender: boolean;
  /** Configurable tab labels (default "Presets" / "Parameters"). */
  presetsLabel?: string;
  parametersLabel?: string;
  /** Active tab + search query, hoisted to AppShell (usePanelState) so they
   *  survive a desktop/mobile remount — see docs/architecture-review.md M7. */
  panelTab: PanelTab;
  onPanelTabChange: (tab: PanelTab) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onSearchBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
}

export function ParamPanel({
  bundled,
  userPresets,
  selectedPreset,
  fileImport,
  loadedFiles,
  panelSide,
  panelDefaultOpen,
  autoRender,
  presetsLabel = "Presets",
  parametersLabel = "Customize",
  panelTab,
  onPanelTabChange,
  search,
  onSearchChange,
  onSearchBlur,
}: Props) {
  const {
    applyPreset,
    selectedPresetChange,
    presetsChange,
    addFile,
    removeFile,
    clearFiles,
  } = useAppActions();
  // design/values/attention/settingsView: read from context for THIS
  // component's own direct consumers (PresetPicker, FileBar) — CustomizeTab
  // below reads the very same context itself, so none of this needs to be
  // threaded through as a prop.
  const { design, values, attention, settingsView, workflowGuided } = usePanelData();
  const [open, setOpen] = useState(() => {
    const v = readLocal(PANEL_OPEN_KEY);
    return v !== null ? v === "true" : panelDefaultOpen;
  });
  const [width, setWidth] = useState(() => {
    const w = parseInt(readLocal(PANEL_WIDTH_KEY) || "0");
    return w >= MIN_WIDTH && w <= MAX_WIDTH ? w : defaultPanelWidth();
  });

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

  const { schedule: scheduleWidth, cancel: cancelWidthFrame } = useRafBatchedWrite<number>(
    (w) => {
      if (panelRef.current) panelRef.current.style.width = `${w}px`;
    }
  );

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
    // Drop any pending rAF write so a frame queued just before pointer-up
    // can't fire after React commits the settled width below.
    cancelWidthFrame();
    // Write the final width imperatively first: when liveWidthRef equals the
    // pre-drag width, setWidth below is a no-op and React skips the render,
    // leaving the DOM at whatever the last rAF frame applied (a few px short
    // of the actual pointer position) — mirrors the BottomSheet drag-settle fix.
    if (panelRef.current) panelRef.current.style.width = `${liveWidthRef.current}px`;
    setWidth(liveWidthRef.current);
  }, [cancelWidthFrame]);

  const side = panelSide === "right" ? "param-panel--right" : "param-panel--left";
  // Collapse chevron points toward the screen edge the panel docks against.
  const CollapseChevron = panelSide === "right" ? ChevronRightIcon : ChevronLeftIcon;

  if (!open) {
    return (
      // Keep the #params id on the rail even collapsed, so the "Skip to
      // parameters" link (AppShell) never dangles — landing on the "Open
      // panel" button is the correct target when there's no panel to skip to.
      <div className={`param-panel-rail ${side}`} id="params">
        <button
          className="param-panel-open-btn font-display"
          onClick={() => setOpen(true)}
          aria-label={t("panel.openAria", { label: parametersLabel })}
          title={t("panel.openAria", { label: parametersLabel })}
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
      aria-label={parametersLabel}
    >
      {/* Drag handle for resize */}
      <div
        className={`param-panel__resize-handle ${panelSide === "right" ? "handle--left" : "handle--right"}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("panel.resizeAria")}
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        onKeyDown={(e) => {
          // Pointer-drag direction flips with panelSide (the handle sits on
          // the panel's outer edge — left edge when docked right), so mirror
          // that here: for a right-docked panel ArrowLeft (handle moves left,
          // away from the panel) grows it and ArrowRight shrinks it.
          const grow = panelSide === "right" ? "ArrowLeft" : "ArrowRight";
          const shrink = panelSide === "right" ? "ArrowRight" : "ArrowLeft";
          if (e.key === shrink) setWidth((w) => Math.max(MIN_WIDTH, w - 20));
          if (e.key === grow) setWidth((w) => Math.min(MAX_WIDTH, w + 20));
        }}
      />

      {workflowGuided ? (
        // Wave 2 (guided shell): the primary panel surface collapses to the
        // stage nav (QuickStart's own chip strip, hoisted by CustomizeTab)
        // -> the active stage's content -> the "Show advanced settings"
        // secondary action (Wave 1) — no Examples/Customize/Files tab strip.
        // The Presets/Files tabs' own jobs moved
        // out: Examples/Saved live in the unified selector (opened from the
        // header's design-name button — see UnifiedSelectorDialog.tsx), and
        // file import moved inline to each param's own control (FontSelect's
        // in-dropdown import row, SvgPrepareControl's own drop zone) plus the
        // "Imported files" management screen off the command bar.
        //
        // Round-6 Wave 2, item 11: the collapse control used to sit alone in
        // its own otherwise-empty header strip above the stage nav (there's
        // no tab row left to carry it, unlike tabs mode below) — a full-width
        // row whose only content was one small chevron wasted a whole line
        // of vertical room right where the stage nav should start. It now
        // rides directly on the panel's own resize-handle edge instead (see
        // `.param-panel__collapse-btn` below) — CustomizeTab's stage nav
        // (hoisted via `stripSlot`, Wave 1's own territory) begins
        // immediately under the app header, with nothing empty above it.
        <>
          <IconButton
            label={t("panel.collapse")}
            title={t("panel.collapseTitle")}
            onClick={() => setOpen(false)}
            className={cn(
              // Sit fully inside the panel's docked edge — `.param-panel` is
              // `overflow: hidden`, so a negative offset (overhanging the edge)
              // gets its outer half clipped. `top-3` keeps it clear of the app
              // header; the stage nav to its left never reaches this corner.
              "param-panel__collapse-btn absolute top-3 z-10 size-6 rounded-full p-1 shadow-(--shadow-1)",
              panelSide === "right" ? "left-1" : "right-1"
            )}
          >
            <CollapseChevron size={14} />
          </IconButton>
          <div className="flex min-h-0 flex-1 flex-col">
            <CustomizeTab
              search={search}
              onSearchChange={onSearchChange}
              onSearchBlur={onSearchBlur}
              // Stage selection with no leak means desktop no longer stacks
              // every step — "steps" (one stage at a time, same as mobile)
              // with no Back/Next (stepNav={false} — the chips are the only
              // navigation on desktop; see QuickStart's own `stepNav` doc).
              variant="steps"
              stepNav={false}
              // Wave 1 (round-5): guided mode has no standing PanelFooter
              // (see below) — QuickStart hosts its own stage-scoped
              // Live-preview toggle instead, reading `autoRender` from
              // PanelDataContext (round-5 review, quality item 2) rather
              // than a hand-drilled prop.
            />
          </div>
        </>
      ) : (
        <>
          <Tabs
            value={panelTab}
            onValueChange={(v) => onPanelTabChange(v as PanelTab)}
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            {/* Tab row (Presets / Parameters / Files) with the collapse
                control on the end. Files appears only when the design
                imports files. */}
            <div className="flex shrink-0 items-stretch border-b">
              <TabsList className="flex-1 rounded-none border-0 bg-transparent p-0">
                <TabsTrigger value="presets" className={panelTabClass}>{presetsLabel}</TabsTrigger>
                <TabsTrigger value="params" className={panelTabClass}>{parametersLabel}</TabsTrigger>
                {fileImport && <TabsTrigger value="files" className={panelTabClass}>{t("tabs.files")}</TabsTrigger>}
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
                showPowerTools={settingsView === "all"}
                inline
              />
            </TabsContent>

            <TabsContent value="params" className="mt-0 flex min-h-0 flex-1 flex-col">
              <CustomizeTab
                search={search}
                onSearchChange={onSearchChange}
                onSearchBlur={onSearchBlur}
                // Desktop's docked panel has room to spare and its own scroll
                // container — QuickStart renders every step at once instead
                // of a one-at-a-time wizard (PR15). See CustomizeTab's own
                // `variant` doc. Tabs mode always keeps "scroll".
                variant="scroll"
                stepNav
              />
            </TabsContent>

            {fileImport && (
              <TabsContent value="files" className="mt-0 min-h-0 flex-1 overflow-y-auto px-(--space-5) py-(--space-4)">
                <FileBar
                  design={design}
                  fileImport={fileImport}
                  loadedFiles={loadedFiles}
                  attention={attention}
                  onAddFile={addFile}
                  onRemoveFile={removeFile}
                  onClearFiles={clearFiles}
                />
              </TabsContent>
            )}
          </Tabs>
        </>
      )}

      {/* Wave 1 (round-5): the standing Live-preview footer is gone from
          guided workflow ENTIRELY now, not just while Review is active —
          live preview just stays on by default there; QuickStart hosts its
          own stage-scoped toggle instead (see its own `autoRender` doc),
          appearing only once a stage's Advanced settings are shown, never
          in Review. Tabs mode (workflowGuided false) is completely
          unaffected — it always renders this footer, unchanged. */}
      {!workflowGuided && (
        <PanelFooter
          autoRender={autoRender}
          className="flex shrink-0 items-center gap-2 border-t px-3 py-[0.4rem]"
        />
      )}
    </aside>
  );
}
