// SheetTabs.tsx — segmented tabs (shadcn/ui Tabs) inside the mobile bottom sheet.
// Parameters / Presets / Files. Prevents the stacked-sheet anti-pattern.
import type { Design, FileImport } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import type { InstalledFont } from "../lib/fonts";
import type { ExperienceMode, SettingsView } from "../lib/useExperience";
import type { ChecklistState } from "../lib/checklist";
import type { AttentionItem } from "../lib/readiness";
import { useAppActions } from "../lib/appActions";
import type { PanelTab } from "../lib/usePanelState";
import { CustomizeTab } from "./CustomizeTab";
import { FileBar, type LoadedFile } from "./FileBar";
import { PresetPicker } from "./PresetPicker";
import { PanelFooter } from "./PanelFooter";
import { GettingStarted } from "./GettingStarted";
import { Tabs, TabsContent, TabsList, TabsTrigger, chipTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";

type Tab = PanelTab;

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
  /** Active tab + search query, hoisted to AppShell (usePanelState) so they
   *  survive a desktop/mobile remount — see docs/architecture-review.md M7. */
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onSearchFocus?: () => void;
  onSearchBlur?: () => void;
  /** Essentials/all settings-view (see src/lib/useExperience.ts). */
  settingsView: SettingsView;
  /** Guided/standard experience mode — forwarded to CustomizeTab, which gates
   *  QuickStart on it (see quickStartAvailable). */
  experienceMode: ExperienceMode;
  /** Build-time `ui.quickStart` opt-out — forwarded to CustomizeTab. */
  quickStartEnabled: boolean;
  /** Forwarded to CustomizeTab — see its own doc. */
  focusHiddenDiffSignal?: number;
  /** The getting-started checklist's derived state — see ParamPanel.tsx's
   *  matching prop doc (this mirrors it for the mobile layout). */
  checklist: ChecklistState;
  /** Forwarded to GettingStarted — see its own doc. */
  checklistReplaySignal?: number;
  /** Forwarded to CustomizeTab — see its own doc. */
  attention: AttentionItem[];
  /** Forwarded to CustomizeTab — see its own doc. */
  onOpenMessages?: () => void;
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
  tab,
  onTabChange,
  search,
  onSearchChange,
  onSearchFocus,
  onSearchBlur,
  settingsView,
  experienceMode,
  quickStartEnabled,
  focusHiddenDiffSignal,
  checklist,
  checklistReplaySignal,
  attention,
  onOpenMessages,
}: Props) {
  const {
    applyPreset,
    selectedPresetChange,
    presetsChange,
    addFile,
    removeFile,
    clearFiles,
  } = useAppActions();
  const hasFiles = fileImport != null;
  // Presets first on mobile, then Customize, then Files.
  const tabs: Tab[] = ["presets", "params", ...(hasFiles ? (["files"] as Tab[]) : [])];

  const triggerClass = cn(chipTabTrigger, "flex-1");

  return (
    <>
      {/* Above the tab strip — mirrors ParamPanel's desktop mount point, so
          the card is visible regardless of which tab is active. */}
      <GettingStarted state={checklist} replaySignal={checklistReplaySignal} />
      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v as Tab)}
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
            <CustomizeTab
              design={design}
              values={values}
              presetBaseline={presetBaseline}
              presetName={presetName}
              baseline={baseline}
              changedParams={changedParams}
              showVarName={showVarName}
              availableFontFamilies={availableFontFamilies}
              fontSuggestion={fontSuggestion}
              installedFonts={installedFonts}
              settingsView={settingsView}
              experienceMode={experienceMode}
              quickStartEnabled={quickStartEnabled}
              search={search}
              onSearchChange={onSearchChange}
              onSearchFocus={onSearchFocus}
              onSearchBlur={onSearchBlur}
              focusHiddenDiffSignal={focusHiddenDiffSignal}
              attention={attention}
              onOpenMessages={onOpenMessages}
            />
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
              showPowerTools={settingsView === "all"}
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
    </>
  );
}
