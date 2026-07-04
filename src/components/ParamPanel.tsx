// ParamPanel.tsx — docked desktop parameter panel: a slim header (collapse), a
// Presets / Parameters / Files tab split (Files only when the design imports
// files), parameter search + ParamForm, and a Reset footer. Collapsible and
// resizable; state persisted to localStorage. Presets live here (a tab,
// mirroring the mobile sheet) rather than in the top bar.
import { useState, useEffect, useRef, useCallback } from "react";
import type { Design, FileImport } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import type { InstalledFont } from "../lib/fonts";
import { ns } from "../lib/appId";
import { useAppActions } from "../lib/appActions";
import { useDebounce } from "../lib/useDebounce";
import { useInitialTab } from "../lib/useInitialTab";
import { readLocal, writeLocal } from "../lib/safeStorage";
import { ParamForm } from "./ParamForm";
import { FileBar, type LoadedFile } from "./FileBar";
import { PresetPicker } from "./PresetPicker";
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

type PanelTab = "presets" | "params" | "files";

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
  fileImport: FileImport | null;
  loadedFiles: LoadedFile[];
  /** Font families the renderer can use (normalised), for the missing-font hint. */
  availableFontFamilies?: Set<string>;
  /** A bundled family to offer as a one-click fallback for a missing font. */
  fontSuggestion?: string | null;
  /** Faces the renderer can use (bundled ∪ imported), for the font selector. */
  installedFonts?: InstalledFont[];
  panelSide: "left" | "right";
  panelDefaultOpen: boolean;
  /** Show the underlying OpenSCAD variable name beside each label. */
  showVarName: boolean;
  autoRender: boolean;
  /** Configurable tab labels (default "Presets" / "Parameters"). */
  presetsLabel?: string;
  parametersLabel?: string;
}

export function ParamPanel({
  design,
  values,
  bundled,
  userPresets,
  selectedPreset,
  fileImport,
  loadedFiles,
  availableFontFamilies,
  fontSuggestion,
  installedFonts,
  panelSide,
  panelDefaultOpen,
  showVarName,
  autoRender,
  presetsLabel = "Presets",
  parametersLabel = "Customize",
}: Props) {
  const {
    change,
    applyPreset,
    selectedPresetChange,
    presetsChange,
    addFile,
    removeFile,
    clearFiles,
  } = useAppActions();
  const [open, setOpen] = useState(() => {
    const v = readLocal(PANEL_OPEN_KEY);
    return v !== null ? v === "true" : panelDefaultOpen;
  });
  const [width, setWidth] = useState(() => {
    const w = parseInt(readLocal(PANEL_WIDTH_KEY) || "0");
    return w >= MIN_WIDTH && w <= MAX_WIDTH ? w : DEFAULT_WIDTH;
  });
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 150);
  // Landing tab (Presets when the design ships ready-made presets, else the
  // controls) — shared with the mobile sheet via useInitialTab.
  const [panelTab, setPanelTab] = useInitialTab<PanelTab>(bundled.length > 0);

  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);
  const panelSideRef = useRef(panelSide);
  panelSideRef.current = panelSide;
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    writeLocal(PANEL_OPEN_KEY, String(open));
  }, [open]);

  useEffect(() => {
    writeLocal(PANEL_WIDTH_KEY, String(width));
  }, [width]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = widthRef.current;
    (e.target as Element).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = panelSideRef.current === "left"
      ? e.clientX - startX.current
      : startX.current - e.clientX;
    setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW.current + delta)));
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const side = panelSide === "right" ? "param-panel--right" : "param-panel--left";
  // Collapse chevron points toward the screen edge the panel docks against.
  const CollapseChevron = panelSide === "right" ? ChevronRightIcon : ChevronLeftIcon;

  if (!open) {
    return (
      <div className={`param-panel-rail ${side}`}>
        <button
          className="param-panel-open-btn font-display"
          onClick={() => setOpen(true)}
          aria-label={`Open the ${parametersLabel} panel`}
          title={`Open the ${parametersLabel} panel`}
        >
          <MenuIcon size={14} /> {parametersLabel}
        </button>
      </div>
    );
  }

  return (
    <aside
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
        aria-label="Resize parameter panel"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setWidth((w) => Math.max(MIN_WIDTH, w - 20));
          if (e.key === "ArrowRight") setWidth((w) => Math.min(MAX_WIDTH, w + 20));
        }}
      />

      <Tabs
        value={panelTab}
        onValueChange={(v) => setPanelTab(v as PanelTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        {/* Tab row (Presets / Parameters / Files) with the collapse control on
            the end. Files appears only when the design imports files. */}
        <div className="flex shrink-0 items-stretch border-b">
          <TabsList className="flex-1 rounded-none border-0 bg-transparent p-0">
            <TabsTrigger value="presets" className={panelTabClass}>{presetsLabel}</TabsTrigger>
            <TabsTrigger value="params" className={panelTabClass}>{parametersLabel}</TabsTrigger>
            {fileImport && <TabsTrigger value="files" className={panelTabClass}>Files</TabsTrigger>}
          </TabsList>
          <IconButton
            className="mr-1 self-center"
            label="Collapse panel"
            title="Collapse to full-screen canvas"
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
            inline
          />
        </TabsContent>

        <TabsContent value="params" className="mt-0 flex min-h-0 flex-1 flex-col">
          <ParamSearch value={search} onChange={setSearch} onClear={() => setSearch("")} />
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <ParamForm design={design} values={values} onChange={change} search={debouncedSearch} showVarName={showVarName} availableFontFamilies={availableFontFamilies} fontSuggestion={fontSuggestion} installedFonts={installedFonts} />
          </div>
        </TabsContent>

        {fileImport && (
          <TabsContent value="files" className="mt-0 min-h-0 flex-1 overflow-y-auto p-3">
            <FileBar
              fileImport={fileImport}
              loadedFiles={loadedFiles}
              onAddFile={addFile}
              onRemoveFile={removeFile}
              onClearFiles={clearFiles}
            />
          </TabsContent>
        )}
      </Tabs>

      <PanelFooter
        design={design}
        values={values}
        autoRender={autoRender}
        className="flex shrink-0 items-center gap-2 border-t px-3 py-[0.4rem]"
      />
    </aside>
  );
}
