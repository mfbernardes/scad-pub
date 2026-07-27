// SheetTabs.tsx — segmented tabs (shadcn/ui Tabs) inside the mobile bottom sheet.
// Parameters / Presets. Prevents the stacked-sheet anti-pattern. Files used to
// be a third tab here; it's now FilesModal, opened from the mobile top bar's
// "⋮" overflow (BarActions.tsx) — see ParamPanel.tsx's own doc for its desktop twin.
//
// Vertical budget is the constraint here that the docked desktop panel doesn't
// have: the sheet's Half detent is ~52vh (BottomSheet's HALF_VH_RATIO), so on a
// phone every fixed row above the form costs a visible parameter. Two
// deliberate differences from ParamPanel keep that budget for the form:
//   • search + essentials toggle + section navigator share ONE toolbar row
//     rather than stacking three;
//   • that toolbar SCROLLS with the form instead of pinning above it, so it
//     costs nothing once the visitor has scrolled.
// Two rows that used to live here moved out of the sheet entirely: readiness
// (StatusStrip) is a pill in the export dock now, above the Download button it
// warns about (see AppShell's ActionDock), and Live preview (auto-render) is in
// the top bar's "⋮" overflow (BarActions), where the app's other rarely-toggled
// chrome already is.
//
// `data-sheet-peek-end` on the tab row marks where the sheet's peek header ends
// — BottomSheet measures the Peek height down to that element's bottom edge.
import { useMemo, useRef } from "react";
import type { Design } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import type { InstalledFont } from "../lib/fonts";
import { useAppActions } from "../lib/appActions";
import { useDebounce } from "../lib/useDebounce";
import { visibleGroups } from "../lib/paramGroups";
import type { PanelTab } from "../lib/usePanelState";
import { EssentialsToggle } from "./EssentialsToggle";
import { ParamForm, type ParamFormHandle } from "./ParamForm";
import { SectionNavigator } from "./SectionNavigator";
import { PresetPicker } from "./PresetPicker";
import { PresetDiffBar } from "./PresetDiffBar";
import { ParamSearch } from "./ParamSearch";
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
  /** SVG basenames the renderer can resolve (bundled assets ∪ imports), for the
   *  `@svg` control's missing-file hint. */
  availableSvgFiles?: Set<string>;
  /** Called when a tab is tapped — used to raise a collapsed (peek) sheet. */
  onActivate?: () => void;
  /** Show the underlying OpenSCAD variable name beside each label (default true). */
  showVarName?: boolean;
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
  availableSvgFiles,
  onActivate,
  showVarName = false,
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
}: Props) {
  const { change, applyPreset, selectedPresetChange, presetsChange } = useAppActions();
  // Presets first on mobile, then Customize.
  const tabs: Tab[] = ["presets", "params"];
  const debouncedSearch = useDebounce(search, 150);
  const triggerClass = cn(chipTabTrigger, "flex-1");
  // See ParamPanel for the desktop twin: same visible-groups source so the
  // navigator tracks the form's sections exactly.
  const formRef = useRef<ParamFormHandle>(null);
  const navSections = useMemo(
    () => visibleGroups(design, values, { search: debouncedSearch, showAdvanced }).map((g) => g.section),
    [design, values, debouncedSearch, showAdvanced]
  );

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => onTabChange(v as Tab)}
      className="sheet-tabs min-h-0 flex-1 gap-0"
    >
      <TabsList
        className="w-full shrink-0 rounded-none border-b bg-transparent p-0"
        aria-label="Panel sections"
        data-sheet-peek-end
      >
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
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
            {/* One form toolbar — search, essentials, jump — INSIDE the scroll
                container, so it hands its ~44px back to the form as soon as
                the visitor scrolls. All three are "find the setting I want"
                controls; stacked as separate pinned rows they used to eat most
                of a Half-detent sheet. */}
            <div className="sheet-toolbar mb-2 flex items-center gap-2">
              <ParamSearch
                value={search}
                onChange={onSearchChange}
                onClear={() => onSearchChange("")}
                onFocus={onSearchFocus}
                onBlur={onSearchBlur}
                compact
                className="flex-1"
              />
              <EssentialsToggle
                params={design.params}
                values={values}
                showAdvanced={showAdvanced}
                onShowAdvancedChange={onShowAdvancedChange}
                compact
              />
              <SectionNavigator
                sections={navSections}
                onSelect={(s) => formRef.current?.openSection(s)}
                compact
              />
            </div>
            <ParamForm ref={formRef} design={design} values={values} onChange={change} search={debouncedSearch} showVarName={showVarName} availableFontFamilies={availableFontFamilies} fontSuggestion={fontSuggestion} installedFonts={installedFonts} availableSvgFiles={availableSvgFiles} baseline={baseline} changedParams={changedParams} presetName={presetName} showAdvanced={showAdvanced} />
          </div>
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
