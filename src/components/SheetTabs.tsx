// SheetTabs.tsx — segmented tabs (shadcn/ui Tabs) inside the mobile bottom sheet.
// Parameters / Presets / Files. Prevents the stacked-sheet anti-pattern.
import { useState } from "react";
import type { Design, FileImport } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import { ParamForm } from "./ParamForm";
import { FileBar, type LoadedFile } from "./FileBar";
import { PresetPicker } from "./PresetPicker";
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
  onChange: (name: string, value: import("../openscad/types").ParamValue) => void;
  onApply: (v: Values) => void;
  onSelectedChange: (id: string) => void;
  onPresetsChange: () => void;
  onAddFile: (name: string, bytes: Uint8Array) => void;
  onRemoveFile: (name: string) => void;
  onClearFiles: () => void;
  /** Called when a tab is tapped — used to raise a collapsed (peek) sheet. */
  onActivate?: () => void;
}

export function SheetTabs({
  design,
  values,
  bundled,
  userPresets,
  selected,
  fileImport,
  loadedFiles,
  onChange,
  onApply,
  onSelectedChange,
  onPresetsChange,
  onAddFile,
  onRemoveFile,
  onClearFiles,
  onActivate,
}: Props) {
  const hasFiles = fileImport != null;
  // Presets first (and the default tab) on mobile, then Parameters, then Files.
  const tabs: Tab[] = ["presets", "params", ...(hasFiles ? (["files"] as Tab[]) : [])];
  const [tab, setTab] = useState<Tab>("presets");

  const triggerClass = cn(underlineTabTrigger, "flex-1");

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as Tab)}
      className="sheet-tabs gap-0"
    >
      <TabsList className="w-full shrink-0 rounded-none border-b bg-transparent p-0" aria-label="Panel sections">
        {tabs.map((t) => (
          <TabsTrigger key={t} value={t} className={triggerClass} onClick={() => onActivate?.()}>
            {t === "params" ? "Parameters" : t === "presets" ? "Presets" : "Files"}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="sheet-tabs__body">
        <TabsContent value="params" className="mt-0">
          <div className="sheet-tabs__params">
            <ParamForm design={design} values={values} onChange={onChange} />
          </div>
        </TabsContent>
        <TabsContent value="presets" className="mt-0">
          <PresetPicker
            design={design}
            bundled={bundled}
            userPresets={userPresets}
            selected={selected}
            values={values}
            onApply={onApply}
            onSelectedChange={onSelectedChange}
            onPresetsChange={onPresetsChange}
            inline
          />
        </TabsContent>
        {hasFiles && (
          <TabsContent value="files" className="mt-0">
            <FileBar
              fileImport={fileImport}
              loadedFiles={loadedFiles}
              onAddFile={onAddFile}
              onRemoveFile={onRemoveFile}
              onClearFiles={onClearFiles}
            />
          </TabsContent>
        )}
      </div>
    </Tabs>
  );
}
