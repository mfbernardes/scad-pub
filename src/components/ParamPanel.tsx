// ParamPanel.tsx — docked desktop parameter panel: a slim header (collapse), a
// Parameters/Files tab split (Files tab only when the design imports files),
// parameter search + ParamForm, and a Reset footer. Collapsible and resizable;
// state persisted to localStorage. Presets are reached from the top CommandBar
// on desktop, so the panel itself carries no preset control.
import { useState, useEffect, useRef, useCallback } from "react";
import type { Design, FileImport } from "../openscad/types";
import type { Values } from "../lib/presets";
import { ns } from "../lib/appId";
import { useAppActions } from "../lib/appActions";
import { useDebounce } from "../lib/useDebounce";
import { ParamForm } from "./ParamForm";
import { FileBar, type LoadedFile } from "./FileBar";
import { IconButton } from "./IconButton";
import { ResetButton } from "./ResetButton";
import { Tabs, TabsContent, TabsList, TabsTrigger, underlineTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";
import {
  RotateCcw as ResetIcon,
  Search as SearchIcon,
  X as XIcon,
  Menu as MenuIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
} from "lucide-react";

const panelTabClass = cn(underlineTabTrigger, "flex-1");

const PANEL_WIDTH_KEY = ns("panel.width");
const PANEL_OPEN_KEY = ns("panel.open");

const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 360;

interface Props {
  design: Design;
  values: Values;
  fileImport: FileImport | null;
  loadedFiles: LoadedFile[];
  panelSide: "left" | "right";
  panelDefaultOpen: boolean;
}

export function ParamPanel({
  design,
  values,
  fileImport,
  loadedFiles,
  panelSide,
  panelDefaultOpen,
}: Props) {
  const { change, reset, addFile, removeFile, clearFiles } = useAppActions();
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(PANEL_OPEN_KEY);
      return v !== null ? v === "true" : panelDefaultOpen;
    } catch {
      return panelDefaultOpen;
    }
  });
  const [width, setWidth] = useState(() => {
    try {
      const w = parseInt(localStorage.getItem(PANEL_WIDTH_KEY) || "0");
      return w >= MIN_WIDTH && w <= MAX_WIDTH ? w : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  });
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 150);
  const [panelTab, setPanelTab] = useState<"params" | "files">("params");

  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);
  const panelSideRef = useRef(panelSide);
  panelSideRef.current = panelSide;
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    try { localStorage.setItem(PANEL_OPEN_KEY, String(open)); } catch { /* noop */ }
  }, [open]);

  useEffect(() => {
    try { localStorage.setItem(PANEL_WIDTH_KEY, String(width)); } catch { /* noop */ }
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
          className="param-panel-open-btn"
          onClick={() => setOpen(true)}
          aria-label="Open parameter panel"
          title="Open parameter panel"
        >
          <MenuIcon size={14} /> Edit parameters
        </button>
      </div>
    );
  }

  return (
    <aside
      className={`param-panel ${side}`}
      style={{ width }}
      id="params"
      aria-label="Parameters"
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
        value={fileImport ? panelTab : "params"}
        onValueChange={(v) => setPanelTab(v as "params" | "files")}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        {/* Tab row (Parameters / Files) with the collapse control on the end.
            Without file imports there are no tabs — just the collapse control. */}
        <div className="flex shrink-0 items-stretch border-b">
          {fileImport ? (
            <TabsList className="flex-1 rounded-none border-0 bg-transparent p-0">
              <TabsTrigger value="params" className={panelTabClass}>Parameters</TabsTrigger>
              <TabsTrigger value="files" className={panelTabClass}>Files</TabsTrigger>
            </TabsList>
          ) : (
            <div className="flex-1" />
          )}
          <IconButton
            className="mr-1 self-center"
            label="Collapse panel"
            title="Collapse to full-screen canvas"
            onClick={() => setOpen(false)}
          >
            <CollapseChevron size={16} />
          </IconButton>
        </div>

        <TabsContent value="params" className="mt-0 flex min-h-0 flex-1 flex-col">
          <div className="param-panel__search">
            <SearchIcon size={14} />
            <input
              type="text"
              placeholder="Search parameters…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search parameters"
            />
            {search && (
              <button className="icon-btn" onClick={() => setSearch("")} aria-label="Clear search">
                <XIcon size={14} />
              </button>
            )}
          </div>
          <div className="param-panel__body">
            <ParamForm design={design} values={values} onChange={change} search={debouncedSearch} />
          </div>
        </TabsContent>

        {fileImport && (
          <TabsContent value="files" className="param-panel__body mt-0 min-h-0 flex-1">
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

      <div className="param-panel__footer">
        <ResetButton design={design} values={values} onReset={reset} className="reset-link">
          <ResetIcon size={14} /> Reset to defaults
        </ResetButton>
      </div>
    </aside>
  );
}
