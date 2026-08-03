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
// button it warns about (see AppShell's ActionDock). At the sheet's Full
// detent that dock is hidden along with the rest of the mobile chrome (see
// AppShell's `data-sheet-detent` doc), so "attention" or "failed" would
// otherwise go unannounced there — ParamForm's own `failure` banner is no
// substitute, since it only mounts on the Customize tab and Presets has none
// of its own. `sheetPill` (below) reuses the same StatusStrip inside the
// sheet for those two cases.
//
// `data-sheet-peek-end` on the tab row marks where the sheet's peek header
// ends — BottomSheet measures the Peek height down to that element's bottom
// edge. The pill renders AFTER the tab row (not before it) so mounting or
// unmounting it never shifts the measured element's own position.
import type { Design } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import type { InstalledFont } from "../lib/fonts";
import { useAppActions } from "../lib/appActions";
import { t } from "../lib/i18n";
import type { PanelTab } from "../lib/usePanelState";
import type { FriendlyErrorInfo } from "../lib/friendlyErrors";
import type { ReadinessState } from "../lib/readiness";
import { ParamForm } from "./ParamForm";
import { PresetPicker } from "./PresetPicker";
import { PresetDiffBar } from "./PresetDiffBar";
import { ParamSearch } from "./ParamSearch";
import { StatusStrip } from "./StatusStrip";
import { Tabs, TabsContent, TabsList, TabsTrigger, chipTabTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";

type Tab = PanelTab;

interface Props {
  design: Design;
  values: Values;
  bundled: ParsedSet[];
  userPresets: string[];
  selectedPreset: string;
  /** The selected preset's values, or null when none is selected (baseline is defaults). */
  presetBaseline: Values | null;
  /** The selected preset's display name, or null when none is selected. */
  presetName: string | null;
  /** Values the current params are diffed against: presetBaseline, or design defaults. */
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
  /** Called when a tab is tapped: used to raise a collapsed (peek) sheet. */
  onActivate?: () => void;
  /** Show the underlying OpenSCAD variable name beside each label (default true). */
  showVarName?: boolean;
  showAdvanced: boolean;
  /** Flip `showAdvanced`. Omitted when the config leaves `ui.essentials` off,
   *  which is what withholds the essentials toggle entirely (see AppShell). */
  onShowAdvancedChange?: (show: boolean) => void;
  /** Active tab + search query, hoisted to AppShell (usePanelState) so they
   *  survive a desktop/mobile remount, see docs/architecture-review.md M7. */
  panelTab: PanelTab;
  onPanelTabChange: (tab: PanelTab) => void;
  search: string;
  /** `search` debounced, from usePanelState: one timer above the layout split,
   *  so a breakpoint flip mid-typing doesn't restart the debounce. */
  debouncedSearch: string;
  onSearchChange: (search: string) => void;
  onSearchFocus?: () => void;
  onSearchBlur?: () => void;
  /** Current render failure, forwarded to ParamForm's banner. */
  failure?: FriendlyErrorInfo | null;
  /** The readiness pill, reused here for the one case where the export
   *  dock's own copy is hidden: the sheet's Full detent. Undefined
   *  everywhere else (see AppShell's `sheetStatusPill`). */
  sheetPill?: { readiness: ReadinessState; attentionCount: number; onOpen: () => void };
}

export function SheetTabs({
  design,
  values,
  bundled,
  userPresets,
  selectedPreset,
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
  showAdvanced,
  onShowAdvancedChange,
  panelTab,
  onPanelTabChange,
  search,
  debouncedSearch,
  onSearchChange,
  onSearchFocus,
  failure,
  onSearchBlur,
  sheetPill,
}: Props) {
  const { change, applyPreset, selectedPresetChange, presetsChange } = useAppActions();
  // Overridable via the config's `strings` block (src/locales/en.json's
  // presets.title/settings.title), see docs/config.md's "Text overrides".
  const presetsLabel = t("presets.title");
  const parametersLabel = t("settings.title");
  // Presets first on mobile, then Customize.
  const tabs: Tab[] = ["presets", "params"];
  const triggerClass = cn(chipTabTrigger, "flex-1");

  return (
    <Tabs
      value={panelTab}
      onValueChange={(v) => onPanelTabChange(v as Tab)}
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
      {sheetPill && (
        <div className="shrink-0 px-3 pt-2 pb-1">
          <StatusStrip
            readiness={sheetPill.readiness}
            attentionCount={sheetPill.attentionCount}
            onOpen={sheetPill.onOpen}
            className="w-full justify-center"
          />
        </div>
      )}
      {/* Everything below the tab row sits under the peek fold, inside the
          sheet's `overflow: hidden` frame: Tab used to walk straight into it
          while the sheet was collapsed and park focus on controls ~90% clipped.
          Raising the sheet on the way in is what tapping a tab already does
          (`onActivate`), and `expand` is a no-op above peek. */}
      <div className="flex min-h-0 flex-1 flex-col" onFocusCapture={onActivate}>
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
            {/* The form toolbar is now only the search field, full width, and
                still INSIDE the scroll container so it hands its ~44px back to
                the form as soon as the visitor scrolls. Its two former
                neighbours both left for somewhere they read better:
                  • essentials ("+N more") is a MODE, not a find-the-setting
                    control. It's the closing row of the form itself now (see
                    EssentialsToggle);
                  • the section navigator is desktop-only. Sticky group headers
                    (`.param-group > summary` in index.css) keep the visitor
                    oriented while scrolling and let them fold the group they're
                    in from wherever they are, which is most of what the jump
                    menu was for, and unlike the menu it costs no standing row. */}
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
            {/* `compact`: control beside label wherever the control doesn't
                need the full row, plus a tighter vertical rhythm. The sheet's
                half detent is the only state where a phone shows the model and
                the controls together, and its form port is ~380px: a stacked
                row costs the label's height plus the control's, which fitted
                two of sixteen parameters in it. See ParamForm's `compact`
                doc. The docked desktop panel keeps the stacked layout. */}
            <ParamForm design={design} values={values} onChange={change} search={debouncedSearch} showVarName={showVarName} availableFontFamilies={availableFontFamilies} fontSuggestion={fontSuggestion} installedFonts={installedFonts} availableSvgFiles={availableSvgFiles} baseline={baseline} changedParams={changedParams} presetName={presetName} showAdvanced={showAdvanced} onShowAdvancedChange={onShowAdvancedChange} compact failure={failure} />
          </div>
        </TabsContent>
        <TabsContent value="presets" className="mt-0 flex min-h-0 flex-1 flex-col">
          <PresetPicker
            design={design}
            bundled={bundled}
            userPresets={userPresets}
            selected={selectedPreset}
            values={values}
            onApply={applyPreset}
            onSelectedChange={selectedPresetChange}
            onPresetsChange={presetsChange}
            compact
          />
        </TabsContent>
      </div>
    </Tabs>
  );
}
