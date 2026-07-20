// CustomizeTab.tsx — the Customize (Parameters) tab's shared content: the
// essentials/all settings-view toggle, the hidden-but-different chip, the
// preset-diff strip, search (plus its "hidden matches" note), and the
// parameter form itself. Used verbatim by the desktop ParamPanel and the
// mobile SheetTabs so this whole stack of behavior/markup lands once instead
// of being duplicated per layout — PanelFooter (the Live-preview switch) is
// the one piece that stays outside, since the two layouts dock it
// differently (see ParamPanel.tsx / SheetTabs.tsx).
//
// Every prop below except search/onSearchChange/onSearchBlur/
// variant used to be threaded through ParamPanel/SheetTabs by hand (a twin
// list kept in sync manually) — those now come from PanelDataContext
// (src/lib/panelData.ts), read here via usePanelData(). Search stays a prop:
// it's the one piece of "layout wiring" ParamPanel/SheetTabs still own
// directly (different DOM ids/hooks per layout — see AppShell's
// onParamSearchHiddenBlur doc), not data the two layouts merely happen to
// pass through identically.
import { useMemo, useRef, useState } from "react";
import { hiddenAdvancedCount, hiddenSearchMatches } from "../lib/paramFilter";
import { REVIEW_STEP_ID } from "../lib/quickStart";
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
import { NoteBar } from "./NoteBar";

interface Props {
  search: string;
  onSearchChange: (search: string) => void;
  onSearchBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  /** Forwarded to QuickStart — see its own `variant` doc. The layout-specific
   *  mount point decides: ParamPanel (desktop) passes "scroll", SheetTabs
   *  (mobile) passes "steps" (PR15). Defaults to "steps" so an omitted value
   *  degrades to today's behavior rather than silently switching modes. */
  variant?: "scroll" | "steps";
  /**
   * Forwarded to QuickStart — see its own `stepNav` doc. Guided workflow
   * shows no Back/Next on desktop (chips are direct selectors instead);
   * mobile keeps Back/Next in both workflows. ParamPanel passes `false` only
   * when `workflowMode === "guided"`; SheetTabs always leaves this at its
   * default (`true`). Irrelevant to tabs mode's desktop "scroll" variant,
   * which never renders Back/Next regardless.
   */
  stepNav?: boolean;
  /**
   * Wave 3 (mobile density/detents): forwarded verbatim to QuickStart's own
   * `onStepActivate` — guided workflow's mobile mount (SheetTabs) passes its
   * `onActivate` prop (the sheet's `expand` — raise Peek to Half) through
   * here; every other caller (desktop ParamPanel, tabs mode) leaves this
   * unset, since only the mobile sheet has a Peek detent to raise from.
   */
  onStepActivate?: () => void;
}

// Full-bleed banner rows (attention/hidden-diff/search notes) stay edge-to-
// edge (border-b spans the whole panel) but their horizontal padding now
// matches the scroll column's own --space-5 inset below, so their text lines
// up with the card content rather than looking mis-indented against it.
const noteClass =
  "flex shrink-0 flex-wrap items-center gap-x-[0.4rem] gap-y-1 border-b bg-muted px-(--space-5) py-[0.4rem] text-[0.8rem] text-muted-foreground";

export function CustomizeTab({
  search,
  onSearchChange,
  onSearchBlur,
  variant = "steps",
  stepNav = true,
  onStepActivate,
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
    focusHiddenDiffSignal,
    focusAttentionParamSignal,
    focusReviewSignal,
    attention,
    onOpenMessages,
    readiness,
    measured,
    renderedValues,
    computedInfo,
    displayRows,
    reviewOverrides,
    reviewStale,
    nonBlockingNoticeCount,
    hiddenDiff,
    quickStartActive,
    canExport,
    workflowMode,
    workflowGuided,
    activeStepId,
    onActiveStepChange,
    downloadConfirmPending,
    onDownloadAnyway,
    autoRender,
  } = usePanelData();
  const { change, settingsViewChange } = useAppActions();
  const debouncedSearch = useDebounce(search, 150);
  const hasAdvanced = useMemo(() => design.params.some((p) => p.advanced), [design]);
  const hiddenCount = useMemo(
    () => hiddenAdvancedCount(design.params, values, settingsView),
    [design, values, settingsView]
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
  // no extra state to reset). `quickStartActive` comes from PanelDataContext
  // (usePanelDerivedState's own quickStartAvailable call) rather than being
  // re-derived here.
  const showQuickStart = quickStartActive && !q;

  // Round-2 review fix: "the workflow stage should be established before the
  // user chooses the settings complexity" — BOTH layouts now hoist
  // QuickStart's step-chip strip ahead of the Essential/All toggle, not just
  // mobile's "steps" variant. Required order (both layouts): guide summary
  // (rendered above this component, unchanged), STAGE CHIPS, toggle, search,
  // step content. QuickStart's own step-chip strip normally renders inline as
  // the first thing inside its own content (scroll mode) / the scroll
  // container (steps mode). Whenever QuickStart is actually showing, this
  // component instead renders an empty slot div ABOVE the toggle, and
  // QuickStart portals its `<nav>` strip into that node instead of rendering
  // it in its normal spot — see QuickStart's own `stripSlot` doc for why a
  // portal, not lifting the navigation state itself, does the hoisting (and
  // for how desktop's scroll-mode sticky strip degrades once it's hoisted
  // outside the scroll container it used to stick inside). `stripSlot` state
  // starts null and is set by the slot div's own ref callback once mounted
  // (and reset to null automatically when it unmounts — React always calls a
  // ref callback with `null` on unmount). Non-QuickStart designs (no steps)
  // keep today's toggle -> search order, unaffected.
  const hoistStrip = showQuickStart;
  const [stripSlot, setStripSlot] = useState<HTMLDivElement | null>(null);

  // Wave 1 (guided workflow): whether QuickStart is showing under
  // `ui.workflow: "guided"` (vs. `showQuickStart` alone, which is also true
  // in tabs mode) — gates purely STRUCTURAL guided-only behavior below (the
  // Review screen, stage-only selection, `stepNav`, the guided mobile
  // header, …). Its own Review stage is a further-scoped subset:
  // `isReviewStage`. The per-stage ADVANCED machinery below (`stageAdvanced`/
  // `showSearch`/the standing toggle/the hidden-diff banners) is gated on
  // `showQuickStart` instead — round-N harmonization: tabs workflow reaches
  // advanced settings identically to guided, so anything that used to say
  // "guided only" there now says "whenever QuickStart is showing, in either
  // workflow" (see docs/config.md's `ui.workflow`).
  const guidedActive = workflowGuided && showQuickStart;
  const isReviewStage = guidedActive && activeStepId === REVIEW_STEP_ID;

  // "Advanced settings as a secondary action" (docs/config.md's
  // `ui.workflow`) — replaces the standing Essential/All `SettingsViewToggle`
  // with a quiet per-STAGE toggle QuickStart itself renders at the bottom of
  // each stage's essential content (see QuickStart's own
  // `stageAdvancedSet`/`onToggleStageAdvanced` props). Deliberately NOT the
  // app-wide `settingsView` state: turning advanced on for one stage must
  // never reveal another stage's advanced params, and must never itself exit
  // QuickStart (which `settingsViewChange("all")` would, since QuickStart
  // only ever shows in the essentials view — see quickStartAvailable). A
  // plain Set of step ids that have been toggled on, so each stage
  // remembers its own choice independently for the rest of this design view.
  // Active whenever QuickStart is showing (`showQuickStart`) — tabs and
  // guided workflow share this exact model now, not just guided.
  const [stageAdvanced, setStageAdvanced] = useState<Set<string>>(() => new Set());
  const toggleStageAdvanced = (stepId: string) =>
    setStageAdvanced((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  // The search box only appears once advanced has been revealed somewhere
  // relevant (docs/config.md: "search only ever appears once advanced is
  // on") — never on Review, which has no advanced controls at all. Steps
  // mode (mobile, either workflow, and guided desktop) has one CURRENT stage
  // — mirroring guided's original behavior exactly, only the current stage's
  // own toggle counts, so moving on to a later stage hides search again
  // until THAT stage's toggle is on too. Scroll mode (tabs desktop) has no
  // such single "current" stage — every step's group is mounted and
  // independently toggleable at once — so there "any stage's advanced is
  // on" is the meaningful equivalent of "the user has revealed advanced".
  const currentStageAdvancedOn =
    showQuickStart &&
    (variant === "scroll" ? stageAdvanced.size > 0 : !!activeStepId && stageAdvanced.has(activeStepId));
  const showSearch = !showQuickStart || currentStageAdvancedOn;

  // The attention chip's "Go to setting" action (see the chip below):
  // reveal + focus the owning param's control. Switches to All settings
  // FIRST when the view is what's hiding it (mirrors reviewHiddenDiff below)
  // — that switch also exits QuickStart (it only shows in essentials view),
  // so the classic form's own focusParam handling takes it from there.
  // Staying in essentials, QuickStart gets the same `focusParam` request
  // (passed below) and composes its own step-jump on top of it — see its
  // own doc for why that composition is buffered through local state there
  // rather than built again here.
  //
  // Whenever QuickStart is showing (either workflow), an advanced target
  // reveals via the STAGE-scoped toggle above instead of the global
  // settingsView switch — flipping settingsView here would exit QuickStart
  // entirely, defeating "advanced stays stage-scoped". Finds the target's
  // owning step the same way QuickStart's own focusParam effect does; that
  // step's own visibility (quickStart.ts's `visibleSteps`) already honours
  // this same `stageAdvanced` set, so a step made visible ONLY by this
  // reveal (every one of its params `@advanced`) still gets a group/chip to
  // land the focus on.
  const focusOnParam = (name: string) => {
    const target = design.params.find((p) => p.name === name);
    if (!target) return;
    if (target.advanced) {
      if (showQuickStart) {
        const step = design.steps?.find((s) => s.sections.includes(target.section));
        if (step) setStageAdvanced((prev) => (prev.has(step.id) ? prev : new Set(prev).add(step.id)));
      } else if (settingsView === "essentials") {
        settingsViewChange("all");
      }
    }
    setFocusParam({ name, nonce: Date.now() });
  };

  // Reveal + focus the first hidden-but-differs-from-default param — the
  // "settings-hidden-diff" banner's own action (below, no-QuickStart path
  // only now — see that banner's gate) AND the friendly-error card's "Review
  // hidden settings" action (via focusHiddenDiffSignal below), which CAN
  // fire while QuickStart is showing. Reveals via the stage-scoped toggle in
  // that case (delegating to focusOnParam, which already knows how) instead
  // of `settingsViewChange("all")`, which would exit QuickStart entirely —
  // see focusOnParam's own doc for why. The "all" fallback is kept only for
  // the no-QuickStart path, where there's no stage to scope a reveal to.
  const reviewHiddenDiff = () => {
    const first = hiddenDiff[0];
    if (showQuickStart) {
      if (first) focusOnParam(first.name);
      return;
    }
    settingsViewChange("all");
    if (first) setFocusParam({ name: first.name, nonce: Date.now() });
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
      {/* Visual-alignment pass: the top-of-panel attention chip that used to
          live here is gone — production-readiness gaps now surface exactly
          three places (the contextual warning card right under a font
          control, the Review stage's own warning card, and Messages' Notices
          tab), plus the export dock's glance-only "N issues to review" line
          and the Review chip's amber dot. See AttentionItems.tsx's own doc.
          `attention`/`onOpenMessages`/`focusOnParam` below still flow to
          QuickStart's Review stage and to OutputConsole's "go to setting"
          signal — only the standing summary banner at the top is gone. */}
      {/* Portal target for QuickStart's step-chip strip (see hoistStrip's own
          doc above) — rendered whenever QuickStart is actively showing, in
          EITHER layout, ahead of the toggle. Insets match SettingsViewToggle's
          own (mx-(--space-5)) so the hoisted chips line up with the rest of
          the panel's content, not the edge-to-edge banners above/below it. */}
      {/* Round-2 review fix (vertical rhythm): mt-(--space-5), not
          --space-4 — "panel sections spaced ~24px block" applies to the
          gap between each of this component's own top-level blocks (chip
          strip, toggle, search), not just the horizontal insets. */}
      {hoistStrip && <div className="quick-start-strip-slot mx-(--space-5) mt-(--space-5) shrink-0" ref={setStripSlot} />}
      {/* Whenever QuickStart is showing (either workflow now — see
          `showQuickStart`'s own doc): NONE of the standing Essential/All
          toggle, the hidden-advanced-diff banner, or (on Review specifically)
          the preset-diff bar render — see docs/config.md's `ui.workflow`. The
          toggle is replaced by QuickStart's own quiet per-stage "Show
          advanced settings" button; the hidden-diff banner has no equivalent
          (it exists purely to point at the now-absent global toggle); the
          preset-diff bar stays available on non-Review guided stages,
          unchanged, matching the mockup's "Review is verification only" (the
          no-QuickStart path — no steps, or an active search query — is
          UNCHANGED: every one of these still renders there exactly as
          before). */}
      {hasAdvanced && !showQuickStart && <SettingsViewToggle view={settingsView} />}
      {!showQuickStart && settingsView === "essentials" && hiddenDiff.length > 0 && (
        <NoteBar
          as="button"
          className="settings-hidden-diff flex shrink-0 items-center gap-[0.4rem] border-b bg-muted px-(--space-5) py-[0.4rem] text-left text-[0.8rem] font-medium text-foreground hover:bg-secondary"
          onAction={reviewHiddenDiff}
          actionLabel={t("settings.review")}
        >
          {tn("settings.hiddenDiffer", hiddenDiff.length)}
        </NoteBar>
      )}
      {!isReviewStage && (
        <PresetDiffBar
          design={design}
          values={values}
          presetBaseline={presetBaseline}
          presetName={presetName}
          changedParams={changedParams}
          settingsView={settingsView}
        />
      )}
      {/* Search only ever appears once advanced has been revealed somewhere
          relevant (never on Review, which has no advanced controls at all)
          — see `showSearch`'s own doc above. Now applies in tabs mode too,
          not just guided. */}
      {showSearch && (
        <ParamSearch
          value={search}
          onChange={onSearchChange}
          onClear={() => onSearchChange("")}
          onBlur={onSearchBlur}
        />
      )}
      {showSearch && settingsView === "essentials" && searchHidden.length > 0 && (
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
      {/* Generously padded (--space-5 ~24px horizontal, mockup target: a
          panel that never reads as a cramped utility sidebar) while staying
          its own independent scroll region — the tab strip/footer above and
          below this stay full-bleed (see ParamPanel.tsx), only this content
          column insets. */}
      <div className="customize-tab__scroll min-h-0 flex-1 overflow-y-auto px-(--space-5) py-(--space-4)">
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
            displayRows={displayRows}
            reviewStale={reviewStale}
            focusReviewSignal={focusReviewSignal}
            canExport={canExport}
            stripSlot={hoistStrip ? stripSlot : null}
            workflow={workflowMode}
            stepNav={stepNav}
            stageAdvancedSet={stageAdvanced}
            onToggleStageAdvanced={toggleStageAdvanced}
            onActiveStepChange={onActiveStepChange}
            reviewLabels={design.reviewLabels}
            reviewNote={design.reviewNote}
            reviewOverrides={reviewOverrides}
            nonBlockingNoticeCount={nonBlockingNoticeCount}
            pendingDownloadConfirm={downloadConfirmPending}
            onDownloadAnyway={onDownloadAnyway}
            onStepActivate={onStepActivate}
            // Guided-only: QuickStart's own inline stage-scoped live-preview
            // control (see its own doc) must stay unreachable in "tabs"
            // workflow, which already renders the standing PanelFooter
            // outside CustomizeTab — passing `undefined` there (as before
            // this value moved into PanelDataContext) keeps QuickStart's
            // `autoRender !== undefined` gate byte-identical to today's
            // no-QuickStart behavior. Now passed through whenever QuickStart
            // is showing (either workflow) — H6: the standing PanelFooter is
            // gone from the tabs path too while QuickStart shows (see
            // ParamPanel.tsx / SheetTabs.tsx), so QuickStart's own inline
            // stage-scoped Live-preview control is what reaches it there.
            autoRender={showQuickStart ? autoRender : undefined}
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
            guided={workflowGuided}
          />
        )}
      </div>
      {!showQuickStart && settingsView === "essentials" && hiddenCount > 0 && (
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
