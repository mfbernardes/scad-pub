// CustomizeTab.tsx — the Customize (Parameters) tab's shared content: the
// essentials/all settings-view toggle, the hidden-but-different chip, the
// preset-diff strip, search (plus its "hidden matches" note), and the
// parameter form itself. Used verbatim by the desktop ParamPanel and the
// mobile SheetTabs so this whole stack of behavior/markup lands once instead
// of being duplicated per layout — PanelFooter (the Live-preview switch) is
// the one piece that stays outside, since the two layouts dock it
// differently (see ParamPanel.tsx / SheetTabs.tsx).
import { useEffect, useMemo, useRef, useState } from "react";
import type { Design } from "../openscad/types";
import type { Values } from "../lib/presets";
import type { InstalledFont } from "../lib/fonts";
import type { ExperienceMode, SettingsView } from "../lib/useExperience";
import { defaultsFor } from "../lib/presets";
import { hiddenAdvancedCount, hiddenAdvancedDiff, hiddenSearchMatches } from "../lib/paramFilter";
import { quickStartAvailable } from "../lib/quickStart";
import { useAppActions } from "../lib/appActions";
import { useDebounce } from "../lib/useDebounce";
import { t, tn } from "../lib/i18n";
import { ParamForm, type FocusParamRequest } from "./ParamForm";
import { ParamSearch } from "./ParamSearch";
import { PresetDiffBar } from "./PresetDiffBar";
import { SettingsViewToggle } from "./SettingsViewToggle";
import { QuickStart } from "./QuickStart";

interface Props {
  design: Design;
  values: Values;
  /** The selected preset's values, or null when no preset is selected (baseline is defaults). */
  presetBaseline: Values | null;
  /** The selected preset's display name, or null when no preset is selected. */
  presetName: string | null;
  /** Values the current params are diffed against — presetBaseline, or design defaults. */
  baseline: Values;
  /** Names of params whose value differs from `baseline`. */
  changedParams: Set<string>;
  showVarName: boolean;
  availableFontFamilies?: Set<string>;
  fontSuggestion?: string | null;
  installedFonts?: InstalledFont[];
  settingsView: SettingsView;
  /** Guided/standard experience mode (src/lib/useExperience.ts) — gates
   *  whether QuickStart may show at all (see quickStartAvailable). */
  experienceMode: ExperienceMode;
  /** Build-time `ui.quickStart` opt-out (default true — declaring `@step`
   *  sections at all is the opt-in). See docs/config.md's `ui.quickStart`. */
  quickStartEnabled: boolean;
  search: string;
  onSearchChange: (search: string) => void;
  onSearchFocus?: () => void;
  onSearchBlur?: () => void;
  /** Bumped externally (e.g. by the friendly-error card's "Review hidden
   *  settings" action — see AppShell) to trigger the exact same reveal+focus
   *  as the "Review" chip below, without this component owning that trigger
   *  itself. Mirrors DesignPicker's `openSignal` prop. Undefined/unchanged is
   *  a no-op. */
  focusHiddenDiffSignal?: number;
}

const noteClass =
  "flex shrink-0 flex-wrap items-center gap-x-[0.4rem] gap-y-1 border-b bg-muted px-3 py-[0.4rem] text-[0.8rem] text-muted-foreground";
const noteActionClass =
  "inline-flex shrink-0 cursor-pointer items-center rounded-(--radius-sm) border-none bg-transparent p-0 font-medium text-brand hover:underline focus-visible:outline-offset-2";

export function CustomizeTab({
  design,
  values,
  presetBaseline,
  presetName,
  baseline,
  changedParams,
  showVarName,
  availableFontFamilies,
  fontSuggestion,
  installedFonts,
  settingsView,
  experienceMode,
  quickStartEnabled,
  search,
  onSearchChange,
  onSearchFocus,
  onSearchBlur,
  focusHiddenDiffSignal,
}: Props) {
  const { change, settingsViewChange } = useAppActions();
  const debouncedSearch = useDebounce(search, 150);
  const hasAdvanced = useMemo(() => design.params.some((p) => p.advanced), [design]);
  const defaults = useMemo(() => defaultsFor(design), [design]);
  const hiddenCount = useMemo(
    () => hiddenAdvancedCount(design.params, values, settingsView),
    [design, values, settingsView]
  );
  const hiddenDiff = useMemo(
    () => hiddenAdvancedDiff(design.params, values, defaults, settingsView),
    [design, values, defaults, settingsView]
  );
  const q = debouncedSearch.trim().toLowerCase();
  const searchHidden = useMemo(
    () => hiddenSearchMatches(design.params, values, settingsView, q),
    [design, values, settingsView, q]
  );
  const [focusParam, setFocusParam] = useState<FocusParamRequest | null>(null);

  // QuickStart replaces the classic form when the four-way gate is open AND
  // there's no active search query — a search always beats stepping through
  // steps (finding a setting by name shouldn't require knowing which step
  // it lives in), so it falls back to the classic filtered form for the
  // query's duration and restores QuickStart the moment the query is
  // cleared (this is purely a function of `q`, so it "restores" for free —
  // no extra state to reset).
  const showQuickStart = quickStartAvailable(design, experienceMode, settingsView, quickStartEnabled) && !q;

  const reviewHiddenDiff = () => {
    settingsViewChange("all");
    const first = hiddenDiff[0];
    if (first) setFocusParam({ name: first.name, nonce: Date.now() });
  };

  // External trigger for the same action (the friendly-error card's "Review
  // hidden settings" button lives in OutputConsole, a sibling of this
  // component — see AppShell). Fires only on a genuine signal CHANGE (not on
  // mount, where focusHiddenDiffSignal may already be a nonzero initial
  // value from a previous card interaction this design view), same guard
  // shape as ParamForm's own focusParam nonce.
  const lastHiddenSignal = useRef(focusHiddenDiffSignal);
  useEffect(() => {
    if (focusHiddenDiffSignal === undefined || focusHiddenDiffSignal === lastHiddenSignal.current) return;
    lastHiddenSignal.current = focusHiddenDiffSignal;
    reviewHiddenDiff();
    // reviewHiddenDiff is recreated every render (it closes over hiddenDiff);
    // depending on the signal alone is intentional — it always reads the
    // latest closure when it actually fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusHiddenDiffSignal]);

  return (
    <>
      {hasAdvanced && <SettingsViewToggle view={settingsView} />}
      {settingsView === "essentials" && hiddenDiff.length > 0 && (
        <button
          type="button"
          className="settings-hidden-diff flex shrink-0 items-center gap-[0.4rem] border-b bg-muted px-3 py-[0.4rem] text-left text-[0.8rem] font-medium text-foreground hover:bg-secondary"
          onClick={reviewHiddenDiff}
        >
          <span className="flex-1">{tn("settings.hiddenDiffer", hiddenDiff.length)}</span>
          <span aria-hidden="true">—</span>
          <span className={noteActionClass}>{t("settings.review")}</span>
        </button>
      )}
      <PresetDiffBar
        design={design}
        values={values}
        presetBaseline={presetBaseline}
        presetName={presetName}
        changedParams={changedParams}
        settingsView={settingsView}
      />
      <ParamSearch
        value={search}
        onChange={onSearchChange}
        onClear={() => onSearchChange("")}
        onFocus={onSearchFocus}
        onBlur={onSearchBlur}
      />
      {settingsView === "essentials" && searchHidden.length > 0 && (
        <div className={`settings-search-note ${noteClass}`} role="status">
          <span>{tn("settings.hiddenMatches", searchHidden.length)}</span>
          <span aria-hidden="true">—</span>
          <button type="button" className={noteActionClass} onClick={() => settingsViewChange("all")}>
            {t("settings.showThem")}
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {showQuickStart ? (
          <QuickStart
            design={design}
            values={values}
            onChange={change}
            view={settingsView}
            showVarName={showVarName}
            availableFontFamilies={availableFontFamilies}
            fontSuggestion={fontSuggestion}
            installedFonts={installedFonts}
            baseline={baseline}
            changedParams={changedParams}
            presetName={presetName}
          />
        ) : (
          <ParamForm
            design={design}
            values={values}
            onChange={change}
            search={debouncedSearch}
            showVarName={showVarName}
            availableFontFamilies={availableFontFamilies}
            fontSuggestion={fontSuggestion}
            installedFonts={installedFonts}
            baseline={baseline}
            changedParams={changedParams}
            presetName={presetName}
            view={settingsView}
            focusParam={focusParam}
          />
        )}
      </div>
      {settingsView === "essentials" && hiddenCount > 0 && (
        <div className={`settings-hidden-note ${noteClass}`}>
          <span>{tn("settings.hiddenCount", hiddenCount)}</span>
          <span aria-hidden="true">—</span>
          <button type="button" className={noteActionClass} onClick={() => settingsViewChange("all")}>
            {t("settings.showAll")}
          </button>
        </div>
      )}
    </>
  );
}
