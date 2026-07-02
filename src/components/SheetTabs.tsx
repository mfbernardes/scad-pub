// SheetTabs.tsx — segmented tabs (shadcn/ui Tabs) inside the mobile bottom sheet.
// Parameters / Presets / Files. Prevents the stacked-sheet anti-pattern.
import { useState } from "react";
import type { Design, FileImport } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import { useAppActions } from "../lib/appActions";
import { ParamForm } from "./ParamForm";
import { FileBar, type LoadedFile } from "./FileBar";
import { PresetPicker } from "./PresetPicker";
import { PanelFooter } from "./PanelFooter";
import { Tabs, TabsContent, TabsList, TabsTrigger, underlineTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";

type Tab = "params" | "presets" | "files";

interface Props {
  design: Design;
  values: Values;
  bundled: ParsedSet[];
  userPresets: string[];
  selected: string;
  fileImport: FileImport | null;
  loadedFiles: LoadedFile[];
  /** Font families the renderer can use (normalised), for the missing-font hint. */
  availableFontFamilies?: Set<string>;
  /** A bundled family to offer as a one-click fallback for a missing font. */
  fontSuggestion?: string | null;
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
  fileImport,
  loadedFiles,
  availableFontFamilies,
  fontSuggestion,
  onActivate,
  showVarName = true,
  autoRender,
  presetsLabel = "Presets",
  parametersLabel = "Parameters",
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
  // Presets first (and the default tab) on mobile, then Parameters, then Files.
  const tabs: Tab[] = ["presets", "params", ...(hasFiles ? (["files"] as Tab[]) : [])];
  const [tab, setTab] = useState<Tab>("presets");

  const triggerClass = cn(underlineTabTrigger, "flex-1");

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
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            <ParamForm design={design} values={values} onChange={change} showVarName={showVarName} availableFontFamilies={availableFontFamilies} fontSuggestion={fontSuggestion} />
          </div>
          {/* Auto-render + Reset are parameter-scoped, so they pin to the bottom
              of this tab only — not on Presets/Files (mirrors the desktop panel). */}
          <PanelFooter design={design} values={values} autoRender={autoRender} className="sheet-footer" />
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
