// SheetTabs.tsx — segmented tabs (shadcn/ui Tabs) inside the mobile bottom sheet.
// Parameters / Presets. Prevents the stacked-sheet anti-pattern. Files used to
// be a third tab here; it's now FilesModal, opened from the mobile top bar's
// "⋮" overflow (BarActions.tsx) — see ParamPanel.tsx's own doc for its desktop twin.
//
// Vertical budget is the constraint here that the docked desktop panel doesn't
// have: the sheet's Half detent is ~52vh (BottomSheet's HALF_VH_RATIO), so on a
// phone every fixed row above the form costs a visible parameter. Three
// deliberate differences from ParamPanel keep that budget for the form:
//   • the toolbar is the search field ALONE. ParamPanel stacks three rows
//     (search, essentials, jump); here essentials moved into the form's own
//     closing row (EssentialsToggle) and the section navigator is desktop-only,
//     its orientation job taken over by sticky `.param-group` headers;
//   • that toolbar SCROLLS with the form instead of pinning above it, so it
//     costs nothing once the visitor has scrolled;
//   • no PanelFooter — Live preview (auto-render) rides the top bar's "⋮"
//     overflow (BarActions) instead.
// Readiness also left: it's a pill in the export dock now, above the Download
// button it warns about (see AppShell's ActionDock) — and on this layout only
// for an outright failure, since Download itself carries the attention dot.
//
// `data-sheet-peek-end` on the tab row marks where the sheet's peek header ends
// — BottomSheet measures the Peek height down to that element's bottom edge.
import type { Design } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import type { InstalledFont } from "../lib/fonts";
import { useAppActions } from "../lib/appActions";
import { useDebounce } from "../lib/useDebounce";
import type { PanelTab } from "../lib/usePanelState";
import { ParamForm } from "./ParamForm";
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
          {/* No padding-top on the scroll port: a sticky group header pins to
              the port's padding box, so any padding here would strand it that
              far down and let rows scroll through the gap above it. The top gap
              is `.param-form`'s own `pt-3` (and the toolbar's `mt-2`), both of
              which scroll away as content should. Same reason ParamPanel's
              scroller drops its `p-3` top. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
            {/* The form toolbar is now just the search field, full width, and
                still INSIDE the scroll container so it hands its ~44px back to
                the form as soon as the visitor scrolls. Its two former
                neighbours both left for somewhere they read better:
                  • essentials ("+N more") is a MODE, not a find-the-setting
                    control — it's the closing row of the form itself now (see
                    EssentialsToggle);
                  • the section navigator is desktop-only. Sticky group headers
                    (`.param-group > summary` in index.css) keep the visitor
                    oriented while scrolling and let them fold the group they're
                    in from wherever they are, which is most of what the jump
                    menu was for — and unlike the menu it costs no standing row. */}
            <div className="sheet-toolbar mt-2">
              <ParamSearch
                value={search}
                onChange={onSearchChange}
                onClear={() => onSearchChange("")}
                onFocus={onSearchFocus}
                onBlur={onSearchBlur}
                compact
              />
            </div>
            <ParamForm design={design} values={values} onChange={change} search={debouncedSearch} showVarName={showVarName} availableFontFamilies={availableFontFamilies} fontSuggestion={fontSuggestion} installedFonts={installedFonts} availableSvgFiles={availableSvgFiles} baseline={baseline} changedParams={changedParams} presetName={presetName} showAdvanced={showAdvanced} onShowAdvancedChange={onShowAdvancedChange} />
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
