// CustomizeTab.tsx — the Customize (Parameters) tab's shared content: the
// essentials/all settings-view toggle, the hidden-but-different chip, the
// preset-diff strip, search (plus its "hidden matches" note), and the
// parameter form itself. Used verbatim by the desktop ParamPanel and the
// mobile SheetTabs so this whole stack of behavior/markup lands once instead
// of being duplicated per layout — PanelFooter (the Live-preview switch) is
// the one piece that stays outside, since the two layouts dock it
// differently (see ParamPanel.tsx / SheetTabs.tsx).
//
// Every prop below except search/onSearchChange/onSearchFocus/onSearchBlur/
// variant used to be threaded through ParamPanel/SheetTabs by hand (a twin
// list kept in sync manually) — those now come from PanelDataContext
// (src/lib/panelData.ts), read here via usePanelData(). Search stays a prop:
// it's the one piece of "layout wiring" ParamPanel/SheetTabs still own
// directly (different DOM ids/hooks per layout — see AppShell's
// onParamSearchHiddenBlur doc), not data the two layouts merely happen to
// pass through identically.
import { useMemo, useRef, useState } from "react";
import { defaultsFor } from "../lib/presets";
import { hiddenAdvancedCount, hiddenAdvancedDiff, hiddenSearchMatches } from "../lib/paramFilter";
import { quickStartAvailable } from "../lib/quickStart";
import { useAppActions } from "../lib/appActions";
import { usePanelData } from "../lib/panelData";
import { useDebounce } from "../lib/useDebounce";
import { useSignal } from "../lib/useSignal";
import { t, tn } from "../lib/i18n";
import { ParamForm, type FocusParamRequest } from "./ParamForm";
import { ParamSearch } from "./ParamSearch";
import { PresetDiffBar } from "./PresetDiffBar";
import { SettingsViewToggle } from "./SettingsViewToggle";
import { QuickStart } from "./QuickStart";
import { AttentionItems } from "./AttentionItems";
import { NoteBar, noteActionClass } from "./NoteBar";

interface Props {
  search: string;
  onSearchChange: (search: string) => void;
  onSearchFocus?: () => void;
  onSearchBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  /** Forwarded to QuickStart — see its own `variant` doc. The layout-specific
   *  mount point decides: ParamPanel (desktop) passes "scroll", SheetTabs
   *  (mobile) passes "steps" (PR15). Defaults to "steps" so an omitted value
   *  degrades to today's behavior rather than silently switching modes. */
  variant?: "scroll" | "steps";
}

const noteClass =
  "flex shrink-0 flex-wrap items-center gap-x-[0.4rem] gap-y-1 border-b bg-muted px-3 py-[0.4rem] text-[0.8rem] text-muted-foreground";

export function CustomizeTab({
  search,
  onSearchChange,
  onSearchFocus,
  onSearchBlur,
  variant = "steps",
}: Props) {
  const {
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
    focusHiddenDiffSignal,
    focusAttentionParamSignal,
    focusReviewSignal,
    attention,
    onOpenMessages,
    readiness,
    measured,
    renderedValues,
    computedInfo,
    reviewStale,
    onSelectView,
  } = usePanelData();
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

  // External trigger for the same action (the friendly-error card's "Review
  // hidden settings" button lives in OutputConsole, a sibling of this
  // component — see AppShell). F7/F8: useSignal fires only on a genuine
  // signal CHANGE (not on mount, where focusHiddenDiffSignal may already be a
  // nonzero initial value from a previous card interaction this design
  // view — same guard shape as ParamForm's own focusParam nonce) and always
  // calls the LATEST `reviewHiddenDiff` closure (it closes over `hiddenDiff`,
  // recreated every render) via useSignal's own latest-callback ref — no
  // `eslint-disable-next-line react-hooks/exhaustive-deps` needed here
  // anymore to get that same "depend on the signal alone" behavior.
  useSignal(focusHiddenDiffSignal, reviewHiddenDiff);

  // PR22: OutputConsole's own friendly attention cards (Notices tab) "Go to
  // setting" action — AppShell already closed Messages and switched to this
  // tab; this nonce (carrying the target param name) tells this instance to
  // run the exact same focusOnParam it uses internally. Buffered through a
  // ref (mirroring useSignal's own latest-callback idiom) since the payload
  // — not just the nonce — must be read fresh at fire time.
  const focusAttentionParamRef = useRef(focusAttentionParamSignal);
  focusAttentionParamRef.current = focusAttentionParamSignal;
  useSignal(focusAttentionParamSignal?.nonce, () => {
    if (focusAttentionParamRef.current) focusOnParam(focusAttentionParamRef.current.name);
  });

  return (
    <>
      {/* Consolidated attention chip (PR22): real, verifiable production-
          readiness gaps for the CURRENT render (src/lib/readiness.ts) — a
          rendered preview isn't necessarily what the controls say. Sits above
          everything else in this tab (even the settings-view toggle) so it's
          the first thing a visitor sees, regardless of which view/step
          they're in — the exact "hidden behind a bell badge" problem this
          milestone fixes. Leads with a "N issue(s) to review" summary
          (showSummary), then one row per item with its own action(s) — same
          visual family as the hidden-diff chip below (bg-muted, border-b,
          a noteActionClass action). */}
      <AttentionItems
        attention={attention}
        onGoToSetting={focusOnParam}
        onOpenMessages={onOpenMessages}
        className="attention-chips flex shrink-0 flex-col gap-1 border-b bg-muted px-3 py-[0.4rem]"
        itemClassName="attention-chip flex flex-wrap items-center gap-x-[0.4rem] gap-y-1 text-left text-[0.8rem] font-medium text-foreground"
        actionClassName={noteActionClass}
        showSummary
        summaryClassName="attention-chip__summary text-[0.8rem] font-semibold text-foreground"
      />
      {hasAdvanced && <SettingsViewToggle view={settingsView} />}
      {settingsView === "essentials" && hiddenDiff.length > 0 && (
        <NoteBar
          as="button"
          className="settings-hidden-diff flex shrink-0 items-center gap-[0.4rem] border-b bg-muted px-3 py-[0.4rem] text-left text-[0.8rem] font-medium text-foreground hover:bg-secondary"
          onAction={reviewHiddenDiff}
          actionLabel={t("settings.review")}
        >
          {tn("settings.hiddenDiffer", hiddenDiff.length)}
        </NoteBar>
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
        <NoteBar
          as="div"
          role="status"
          className={`settings-search-note ${noteClass}`}
          onAction={() => settingsViewChange("all")}
          actionLabel={t("settings.showThem")}
        >
          {tn("settings.hiddenMatches", searchHidden.length)}
        </NoteBar>
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
            focusReviewSignal={focusReviewSignal}
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
        <NoteBar
          as="div"
          className={`settings-hidden-note ${noteClass}`}
          onAction={() => settingsViewChange("all")}
          actionLabel={t("settings.showAll")}
        >
          {tn("settings.hiddenCount", hiddenCount)}
        </NoteBar>
      )}
    </>
  );
}
