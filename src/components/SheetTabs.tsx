// SheetTabs.tsx — segmented tabs (shadcn/ui Tabs) inside the mobile bottom sheet.
// Parameters / Presets. Prevents the stacked-sheet anti-pattern. Files used to
// be a third tab here; it's now FilesModal, opened from the mobile top bar's
// "⋮" overflow (BarActions.tsx) — see ParamPanel.tsx's own doc for its desktop twin.
import { useMemo } from "react";
import type { Design } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import type { InstalledFont } from "../lib/fonts";
import { useAppActions } from "../lib/appActions";
import { useDebounce } from "../lib/useDebounce";
import { hiddenAdvancedCount } from "../lib/essentials";
import { t, tn } from "../lib/i18n";
import type { PanelTab } from "../lib/usePanelState";
import { ParamForm } from "./ParamForm";
import { PresetPicker } from "./PresetPicker";
import { PresetDiffBar } from "./PresetDiffBar";
import { ParamSearch } from "./ParamSearch";
import { PanelFooter } from "./PanelFooter";
import { StatusStrip, type StatusStripProps } from "./StatusStrip";
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
  showAdvanced: boolean;
  onShowAdvancedChange: (show: boolean) => void;
  /** Active tab + search query, hoisted to AppShell (usePanelState) so they
   *  survive a desktop/mobile remount — see docs/architecture-review.md M7. */
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onSearchFocus?: () => void;
  onSearchBlur?: () => void;
  /** Readiness status strip, mounted above the tab row — see StatusStrip.tsx's
   *  own doc for why that keeps it inside the sheet's always-visible peek
   *  header (BottomSheet measures Peek from the sheet's top down to the tab
   *  row's bottom edge). */
  statusStrip: Omit<StatusStripProps, "className">;
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
  availableFontFamilies,
  fontSuggestion,
  installedFonts,
  onActivate,
  showVarName = false,
  autoRender,
  presetsLabel = "Presets",
  parametersLabel = "Customize",
  showAdvanced,
  onShowAdvancedChange,
  tab,
  onTabChange,
  search,
  onSearchChange,
  onSearchFocus,
  onSearchBlur,
  statusStrip,
}: Props) {
  const { change, applyPreset, selectedPresetChange, presetsChange } = useAppActions();
  // Presets first on mobile, then Customize.
  const tabs: Tab[] = ["presets", "params"];
  const debouncedSearch = useDebounce(search, 150);
  // "Show all settings (N more)" — see ParamPanel.tsx's own doc (its desktop
  // twin) for why the count only reflects currently @showIf-visible params.
  const hiddenCount = useMemo(() => hiddenAdvancedCount(design.params, values), [design.params, values]);
  const essentialsToggleLabel =
    hiddenCount > 0 ? tn("settings.showAllCount", hiddenCount) : t("settings.showAll");

  const triggerClass = cn(chipTabTrigger, "flex-1");

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => onTabChange(v as Tab)}
      className="sheet-tabs min-h-0 flex-1 gap-0"
    >
      <StatusStrip {...statusStrip} className="shrink-0" />
      <TabsList className="w-full shrink-0 rounded-none border-b bg-transparent p-0" aria-label="Panel sections">
        {tabs.map((t) => (
          <TabsTrigger key={t} value={t} className={triggerClass} onClick={() => onActivate?.()}>
            {t === "params" ? parametersLabel : presetsLabel}
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
          <ParamSearch
            value={search}
            onChange={onSearchChange}
            onClear={() => onSearchChange("")}
            onFocus={onSearchFocus}
            onBlur={onSearchBlur}
          />
          {design.params.some((p) => p.advanced) && (
            <button
              type="button"
              className="mx-3 mt-2 self-start text-sm font-semibold text-brand hover:underline"
              onClick={() => onShowAdvancedChange(!showAdvanced)}
            >
              {showAdvanced ? t("settings.showEssential") : essentialsToggleLabel}
            </button>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            <ParamForm design={design} values={values} onChange={change} search={debouncedSearch} showVarName={showVarName} availableFontFamilies={availableFontFamilies} fontSuggestion={fontSuggestion} installedFonts={installedFonts} baseline={baseline} changedParams={changedParams} presetName={presetName} showAdvanced={showAdvanced} />
          </div>
          {/* Auto-render is parameter-scoped, so it pins to the bottom of this
              tab only — not on Presets (mirrors the desktop panel). Reset
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
      </div>
    </Tabs>
  );
}
