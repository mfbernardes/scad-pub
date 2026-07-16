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
import type { AttentionItem, ReadinessState } from "../lib/readiness";
import type { Dimensions } from "./Viewer";
import type { ComputedInfo } from "../lib/computedInfo";
import type { ViewName } from "./views";
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
import { AttentionItems } from "./AttentionItems";

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
  onSearchBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  /** Bumped externally (e.g. by the friendly-error card's "Review hidden
   *  settings" action — see AppShell) to trigger the exact same reveal+focus
   *  as the "Review" chip below, without this component owning that trigger
   *  itself. Mirrors DesignPicker's `openSignal` prop. Undefined/unchanged is
   *  a no-op. */
  focusHiddenDiffSignal?: number;
  /**
   * Unresolved production-readiness gaps for the CURRENT render (src/lib/
   * readiness.ts) — a font param whose selected family isn't loaded, or a
   * flagged notice category with a pending notice. Drives the attention chip
   * at the top of this tab. Empty -> no chip (the common case).
   */
  attention: AttentionItem[];
  /** Opens the Output console ("Messages") — a notice-kind attention item's
   *  action. AppShell owns that console's open state (it's a sibling of this
   *  component, not a descendant), so this is threaded down the same way
   *  focusHiddenDiffSignal's counterpart action is threaded UP. */
  onOpenMessages?: () => void;
  /** Forwarded to QuickStart — see its own `variant` doc. The layout-specific
   *  mount point decides: ParamPanel (desktop) passes "scroll", SheetTabs
   *  (mobile) passes "steps" (PR15). Defaults to "steps" so an omitted value
   *  degrades to today's behavior rather than silently switching modes. */
  variant?: "scroll" | "steps";
  /**
   * PR18's Review stage inputs — forwarded verbatim to QuickStart's terminal
   * "Review" step, unused otherwise. Overall production-readiness for the
   * CURRENT render (src/lib/readiness.ts's readinessState — failed >
   * attention > ready > building), computed once in AppShell from the same
   * `result`/`attention` the rest of the app already reads.
   */
  readiness?: ReadinessState;
  /** The active viewer's measured bounding box (mm), or null before any
   *  render has landed — AppShell's own `measured` state (Viewer's onMeasure). */
  measured?: Dimensions | null;
  /** Values behind the CURRENT render (not the live controls) — what the
   *  Review summary's `@info` rows read, mirroring DimensionInfo's own
   *  `values` prop so both surfaces show the same figures. */
  renderedValues?: Values;
  /** Runtime `echo("@info", …)` rows for the current render — see
   *  lib/computedInfo.ts. */
  computedInfo?: ComputedInfo[];
  /** Whether the Review summary's figures are stale (src/lib/renderState.ts's
   *  isMeasurementStale) — reused by QuickStart for the same dim+italic
   *  treatment DimensionInfo gives an out-of-date preview. */
  reviewStale?: boolean;
  /** Snap the active viewer to a standard camera view — QuickStart's "Front
   *  view" button. AppShell's own `handleSelectView`, threaded down the same
   *  path as every other Review input. */
  onSelectView?: (view: ViewName) => void;
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
  attention,
  onOpenMessages,
  variant = "steps",
  readiness,
  measured,
  renderedValues,
  computedInfo,
  reviewStale,
  onSelectView,
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

  // The attention chip's "Go to setting" action (see the chip below):
  // reveal + focus the owning param's control. Switches to All settings
  // FIRST when the view is what's hiding it (mirrors reviewHiddenDiff above)
  // — that switch also exits QuickStart (it only shows in essentials view),
  // so the classic form's own focusParam handling takes it from there.
  // Staying in essentials, QuickStart gets the same `focusParam` request
  // (passed below) and composes its own step-jump on top of it — see its
  // own doc for why that composition is buffered through local state there
  // rather than built again here.
  const focusOnParam = (name: string) => {
    const target = design.params.find((p) => p.name === name);
    if (!target) return;
    if (settingsView === "essentials" && target.advanced) settingsViewChange("all");
    setFocusParam({ name, nonce: Date.now() });
  };

  // Font-fallback attention items' param names, for QuickStart's per-chip
  // amber dot (attentionParams prop) — notice-kind items aren't tied to one
  // parameter, so they're excluded here.
  const attentionParamNames = useMemo(
    () =>
      new Set(
        attention.filter((a): a is Extract<AttentionItem, { kind: "font-fallback" }> => a.kind === "font-fallback")
          .map((a) => a.param)
      ),
    [attention]
  );

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
      {/* Attention chip: real, verifiable production-readiness gaps for the
          CURRENT render (src/lib/readiness.ts) — a rendered preview isn't
          necessarily what the controls say. Sits above everything else in
          this tab (even the settings-view toggle) so it's the first thing a
          visitor sees, regardless of which view/step they're in — the exact
          "hidden behind a bell badge" problem this milestone fixes. Same
          visual family as the hidden-diff chip below (bg-muted, border-b,
          a noteActionClass action), one row per item. */}
      <AttentionItems
        attention={attention}
        onGoToSetting={focusOnParam}
        onOpenMessages={onOpenMessages}
        className="attention-chips flex shrink-0 flex-col border-b bg-muted"
        itemClassName="attention-chip flex items-center gap-[0.4rem] px-3 py-[0.4rem] text-left text-[0.8rem] font-medium text-foreground"
        actionClassName={noteActionClass}
      />
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
      {/* customize-tab__scroll: the stable hook QuickStart's scroll variant
          locates (via closest()) as the IntersectionObserver root and the
          scrollIntoView target for its chip navigation — see QuickStart.tsx's
          own SCROLL_CONTAINER_SELECTOR doc. Present regardless of variant
          (harmless when unused, e.g. mobile's "steps" variant or the classic
          ParamForm) so the class name doesn't have to track which branch is
          active here. */}
      <div className="customize-tab__scroll min-h-0 flex-1 overflow-y-auto p-3">
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
            focusParam={focusParam}
            attentionParams={attentionParamNames}
            variant={variant}
            attention={attention}
            onGoToSetting={focusOnParam}
            onOpenMessages={onOpenMessages}
            readiness={readiness}
            measured={measured}
            renderedValues={renderedValues}
            computedInfo={computedInfo}
            reviewStale={reviewStale}
            onSelectView={onSelectView}
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
