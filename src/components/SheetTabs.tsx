// SheetTabs.tsx — segmented tabs (shadcn/ui Tabs) inside the mobile bottom sheet.
// Parameters / Presets / Files. Prevents the stacked-sheet anti-pattern.
import type { Design, FileImport } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import type { InstalledFont } from "../lib/fonts";
import type { ExperienceMode, SettingsView } from "../lib/useExperience";
import type { ChecklistState } from "../lib/checklist";
import type { AttentionItem } from "../lib/readiness";
import type { SheetDetent } from "./BottomSheet";
import { useAppActions } from "../lib/appActions";
import type { PanelTab } from "../lib/usePanelState";
import { CustomizeTab } from "./CustomizeTab";
import { FileBar, type LoadedFile } from "./FileBar";
import { PresetPicker } from "./PresetPicker";
import { PanelFooter } from "./PanelFooter";
import { GettingStarted } from "./GettingStarted";
import { Tabs, TabsContent, TabsList, TabsTrigger, chipTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";

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
  onSearchBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
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
  /** Forwarded to GettingStarted — see ParamPanel's matching prop doc (this
   *  mirrors it for the mobile layout). */
  quickStartActive?: boolean;
  /** The bottom sheet's current detent (BottomSheet.tsx), forwarded to
   *  GettingStarted so it can render nothing but a slim progress line at
   *  Peek instead of the compact/full card — see GettingStarted.tsx's own
   *  doc for why Peek can't afford either. Desktop (ParamPanel) has no
   *  sheet, so it never passes this. */
  sheetDetent?: SheetDetent;
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
  quickStartActive = false,
  sheetDetent,
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
          the card is visible regardless of which tab is active. Peek (rule
          3) is threaded through so this renders a slim progress line instead
          of the compact/full card at that detent — see GettingStarted.tsx. */}
      <GettingStarted
        state={checklist}
        replaySignal={checklistReplaySignal}
        quickStartActive={quickStartActive}
        peek={sheetDetent === "peek"}
      />
      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v as Tab)}
        className="sheet-tabs min-h-0 flex-1 gap-0"
      >
        <TabsList className="w-full shrink-0 rounded-none border-b bg-transparent p-0" aria-label={t("panel.sectionsAria")}>
          {tabs.map((tabKey) => (
            <TabsTrigger key={tabKey} value={tabKey} className={triggerClass} onClick={() => onActivate?.()}>
              {tabKey === "params" ? parametersLabel : tabKey === "presets" ? presetsLabel : t("tabs.files")}
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
              // Mobile's bottom sheet is short on vertical room — QuickStart
              // keeps its one-step-at-a-time Back/Next navigation (PR15's
              // desktop-only scroll mode doesn't apply here). See
              // CustomizeTab's own `variant` doc.
              variant="steps"
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
