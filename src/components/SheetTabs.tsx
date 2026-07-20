// SheetTabs.tsx — segmented tabs (shadcn/ui Tabs) inside the mobile bottom sheet.
// Parameters / Presets / Files. Prevents the stacked-sheet anti-pattern.
//
// Only genuinely layout-specific props remain here (tab/search wiring,
// sheetDetent, and the presets/file-import props PresetPicker/FileBar
// consume directly) — see ParamPanel.tsx's matching doc: the ~25 props
// CustomizeTab/GettingStarted read identically in both this and ParamPanel.tsx
// now flow through PanelDataContext (src/lib/panelData.ts).
import type { FileImport } from "../openscad/types";
import type { ParsedSet } from "../lib/presets";
import type { SheetDetent } from "./BottomSheet";
import { useAppActions } from "../lib/appActions";
import { usePanelData } from "../lib/panelData";
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
  bundled: ParsedSet[];
  userPresets: string[];
  selected: string;
  fileImport: FileImport | null;
  loadedFiles: LoadedFile[];
  /** Called when a tab is tapped — used to raise a collapsed (peek) sheet. */
  onActivate?: () => void;
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
  onSearchBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  /** The bottom sheet's current detent (BottomSheet.tsx) — forwarded to
   *  GettingStarted so it can render nothing but a slim progress line at
   *  Peek instead of the compact/full card — see GettingStarted.tsx's own
   *  doc for why Peek can't afford either. Desktop (ParamPanel) has no
   *  sheet, so it never passes this. */
  sheetDetent?: SheetDetent;
}

export function SheetTabs({
  bundled,
  userPresets,
  selected,
  fileImport,
  loadedFiles,
  onActivate,
  autoRender,
  presetsLabel = "Presets",
  parametersLabel = "Customize",
  tab,
  onTabChange,
  search,
  onSearchChange,
  onSearchBlur,
  sheetDetent,
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
  // component's own direct consumers (PresetPicker, FileBar) — CustomizeTab/
  // GettingStarted below read the very same context themselves.
  const { design, values, attention, settingsView, workflowGuided } = usePanelData();
  const hasFiles = fileImport != null;
  // Presets first on mobile, then Customize, then Files.
  const tabs: Tab[] = ["presets", "params", ...(hasFiles ? (["files"] as Tab[]) : [])];

  const triggerClass = cn(chipTabTrigger, "flex-1");

  if (workflowGuided) {
    // Wave 2 (guided shell): the mobile sheet's primary surface collapses to
    // the stage nav (QuickStart's own hoisted chip strip) -> the active
    // stage's content — no Examples/Customize/Files tab strip, no
    // GettingStarted guide row (see ParamPanel.tsx's matching doc for where
    // each of those jobs moved instead). Mobile keeps Back/Next
    // (`stepNav` left at its default `true`) — only desktop drops it.
    //
    // Wave 3 (mobile density): no permanent Live-preview footer either — the
    // mockup's guided Content/Appearance stages show no standing switch below
    // the form (auto-render just stays on; a heavy/paused design still gets
    // its own inline "Update" affordance from the viewer/export dock, not
    // this footer). Tabs mode (below) is unaffected — it always renders
    // PanelFooter, unchanged. `onActivate` (the sheet's own `expand` — raise
    // a collapsed Peek to Half) is forwarded to QuickStart, via
    // CustomizeTab's `onStepActivate`, so a deliberate stage-chip tap (or
    // Back/Next) at Peek always lands on Half — see QuickStart's own
    // `onStepActivate` doc.
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <CustomizeTab
          search={search}
          onSearchChange={onSearchChange}
          onSearchBlur={onSearchBlur}
          variant="steps"
          onStepActivate={onActivate}
          // Wave 1 (round-5): guided mode has no standing PanelFooter here
          // either (see the comment below) — QuickStart hosts its own
          // stage-scoped Live-preview toggle instead, reading `autoRender`
          // from PanelDataContext (round-5 review, quality item 2) rather
          // than a hand-drilled prop.
        />
      </div>
    );
  }

  return (
    <>
      {/* Above the tab strip — mirrors ParamPanel's desktop mount point, so
          the card is visible regardless of which tab is active. Peek (rule
          3) is threaded through so this renders a slim progress line instead
          of the compact/full card at that detent — see GettingStarted.tsx. */}
      <GettingStarted peek={sheetDetent === "peek"} />
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
              search={search}
              onSearchChange={onSearchChange}
              onSearchBlur={onSearchBlur}
              // Mobile's bottom sheet is short on vertical room — QuickStart
              // keeps its one-step-at-a-time Back/Next navigation (PR15's
              // desktop-only scroll mode doesn't apply here). See
              // CustomizeTab's own `variant` doc.
              variant="steps"
            />
            {/* Auto-render is parameter-scoped, so it pins to the bottom of this
                tab only — not on Presets/Files (mirrors the desktop panel).
                Reset lives in PresetDiffBar above now (the unified restore
                control). Always rendered here: "tabs" workflow (the only
                mode that reaches this branch — guided returns above) never
                suppresses it. */}
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
        </div>
      </Tabs>
    </>
  );
}
