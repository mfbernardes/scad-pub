// SheetTabs.tsx — segmented tabs (shadcn/ui Tabs) inside the mobile bottom sheet.
// Parameters / Presets / Files. Prevents the stacked-sheet anti-pattern.
import { useState } from "react";
import type { Design, FileImport } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import type { InstalledFont } from "../lib/fonts";
import { useAppActions } from "../lib/appActions";
import { useDebounce } from "../lib/useDebounce";
import { useInitialTab } from "../lib/useInitialTab";
import { ParamForm } from "./ParamForm";
import { FileBar, type LoadedFile } from "./FileBar";
import { PresetPicker } from "./PresetPicker";
import { PresetDiffBar } from "./PresetDiffBar";
import { ParamSearch } from "./ParamSearch";
import { PanelFooter } from "./PanelFooter";
import { Tabs, TabsContent, TabsList, TabsTrigger, chipTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";

type Tab = "params" | "presets" | "files";

interface Props {
  design: Design;
  values: Values;
  bundled: ParsedSet[];
  userPresets: string[];
  selected: string;
  /** The selected preset's values, or null when no preset is selected (baseline is defaults). */
  presetBaseline: Values | null;
  /** The selected preset's display name, or null when no preset is selected. */
  presetName: string | null;
  /** Values the current params are diffed against — presetBaseline, or design defaults. */
  baseline: Values;
  /** Names of params whose value differs from `baseline`. */
  changedParams: Set<string>;
  fileImport: FileImport | null;
  loadedFiles: LoadedFile[];
  /** Font families the renderer can use (normalised), for the missing-font hint. */
  availableFontFamilies?: Set<string>;
  /** A bundled family to offer as a one-click fallback for a missing font. */
  fontSuggestion?: string | null;
  /** Faces the renderer can use (bundled ∪ imported), for the font selector. */
  installedFonts?: InstalledFont[];
  /** Called when a tab is tapped — used to raise a collapsed (peek) sheet. */
  onActivate?: () => void;
  /** Show the underlying OpenSCAD variable name beside each label (default true). */
  showVarName?: boolean;
  autoRender: boolean;
  /** Configurable tab labels (default "Presets" / "Parameters"). */
  presetsLabel?: string;
  parametersLabel?: string;
}

export function SheetTabs({
  design,
  values,
  bundled,
  userPresets,
  selected,
  presetBaseline,
  presetName,
  baseline,
  changedParams,
  fileImport,
  loadedFiles,
  availableFontFamilies,
  fontSuggestion,
  installedFonts,
  onActivate,
  showVarName = false,
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
  const hasFiles = fileImport != null;
  // Presets first on mobile, then Customize, then Files. Landing tab (Presets
  // when the design ships ready-made presets, else the controls) — shared with
  // the desktop panel via useInitialTab.
  const tabs: Tab[] = ["presets", "params", ...(hasFiles ? (["files"] as Tab[]) : [])];
  const [tab, setTab] = useInitialTab<Tab>(bundled.length > 0);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 150);

  const triggerClass = cn(chipTabTrigger, "flex-1");

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as Tab)}
      className="sheet-tabs min-h-0 flex-1 gap-0"
    >
      <TabsList className="w-full shrink-0 rounded-none border-b bg-transparent p-0" aria-label="Panel sections">
        {tabs.map((t) => (
          <TabsTrigger key={t} value={t} className={triggerClass} onClick={() => onActivate?.()}>
            {t === "params" ? parametersLabel : t === "presets" ? presetsLabel : "Files"}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="flex min-h-0 flex-1 flex-col">
        <TabsContent value="params" className="mt-0 flex min-h-0 flex-1 flex-col">
          <PresetDiffBar
            design={design}
            values={values}
            presetBaseline={presetBaseline}
            presetName={presetName}
            changedParams={changedParams}
          />
          <ParamSearch value={search} onChange={setSearch} onClear={() => setSearch("")} />
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            <ParamForm design={design} values={values} onChange={change} search={debouncedSearch} showVarName={showVarName} availableFontFamilies={availableFontFamilies} fontSuggestion={fontSuggestion} installedFonts={installedFonts} baseline={baseline} changedParams={changedParams} presetName={presetName} />
          </div>
          {/* Auto-render is parameter-scoped, so it pins to the bottom of this
              tab only — not on Presets/Files (mirrors the desktop panel). Reset
              lives in PresetDiffBar above now (the unified restore control). */}
          <PanelFooter autoRender={autoRender} className="sheet-footer" />
        </TabsContent>
        <TabsContent value="presets" className="mt-0 flex min-h-0 flex-1 flex-col">
          <PresetPicker
            design={design}
            bundled={bundled}
            userPresets={userPresets}
            selected={selected}
            values={values}
            onApply={applyPreset}
            onSelectedChange={selectedPresetChange}
            onPresetsChange={presetsChange}
            inline
          />
        </TabsContent>
        {hasFiles && (
          <TabsContent value="files" className="mt-0 min-h-0 flex-1 overflow-y-auto">
            <FileBar
              fileImport={fileImport}
              loadedFiles={loadedFiles}
              onAddFile={addFile}
              onRemoveFile={removeFile}
              onClearFiles={clearFiles}
            />
          </TabsContent>
        )}
      </div>
    </Tabs>
  );
}
