// QuickStart.tsx — the guided step navigation shown INSTEAD of the classic
// scrolling form inside CustomizeTab, when ALL of: guided experience, the
// essentials settings view, the active design declares `@step`s, and config
// `ui.quickStart !== false` (see docs/annotations.md#guided-steps--step and
// docs/config.md's `ui.quickStart`). CustomizeTab owns that gate and the
// search-bypass (see its own comment); this component only renders the
// step strip + step content once mounted.
//
// NAVIGATION, NEVER A WIZARD: every param's value lives in the same App
// state regardless of which step is showing (ParamRows just renders a
// SUBSET of sections) — nothing here unmounts destructively, every step
// stays one click away via its chip, and the full form is always one click
// away via the settings-view toggle CustomizeTab renders above this.
//
// TWO VARIANTS, ONE DERIVATION (PR15): desktop's docked panel has room to
// spare and its own scroll container, so `variant="scroll"` renders every
// visible step's group in one scrollable flow — chips become anchors (click
// one, it scrolls its group into view) rather than a one-at-a-time swap, and
// there's no Back/Next; a step's current/visited state instead tracks scroll
// position via IntersectionObserver. Mobile's bottom sheet is short on
// vertical room, so `variant="steps"` (the default) keeps today's
// one-step-at-a-time Back/Next navigation exactly as before — still
// non-destructive per the paragraph above, just narrower per screen. Both
// variants derive from the exact same visibleSteps()/resolveCurrentStep()
// logic (src/lib/quickStart.ts), so step-skip reactivity (a step's params
// all hidden -> its chip disappears) behaves identically in either mode. Set
// by the layout-specific mount point — ParamPanel (desktop) passes "scroll",
// SheetTabs (mobile) passes "steps" — via CustomizeTab's own `variant` prop.
//
// Visited/current state is SESSION-ONLY (component state, not a persisted
// pref) and resets to the first visible step on a design switch (compared
// by object identity, mirroring ParamRows' own design-identity reset).
//
// THE TERMINAL "REVIEW" STAGE (PR18): the last chip used to be a bare
// "Export" pointer — a heading plus one line of text nudging the visitor at
// the floating Export button. It's now a real Review stage: a readiness line
// (src/lib/readiness.ts's readinessState — ready/attention/failed/building),
// the same "what will actually be produced" summary rows DimensionInfo shows
// over the viewer (bounding box + `@info` params + runtime computed-info
// rows — src/lib/reviewSummary.ts, a shared extraction so the two surfaces
// can never disagree), and — unchanged — the pointer at the Export action
// itself. Renders identically in both variants (see
// ReviewContent below), mounted at the END of the scroll flow in scroll mode
// and as the terminal step's content in steps mode, exactly where the old
// Export section sat.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2 as SuccessIcon } from "lucide-react";
import type { Design, ParamValue } from "../openscad/types";
import type { Values } from "../lib/presets";
import type { SettingsView } from "../lib/useExperience";
import type { InstalledFont } from "../lib/fonts";
import type { AttentionItem, FontFallbackItem, ReadinessState } from "../lib/readiness";
import type { Dimensions } from "./Viewer";
import type { ComputedInfo } from "../lib/computedInfo";
import type { DisplayRow } from "../lib/displayRows";
import { displayRowsForStep } from "../lib/displayRows";
import { PanelFooter } from "./PanelFooter";
import {
  REVIEW_STEP_ID,
  currentStepFromIntersections,
  hasVisibleUnstepped,
  resolveCurrentStep,
  stepAdvancedInfo,
  unsteppedSectionNames,
  visibleSteps,
  type QuickStartStep,
} from "../lib/quickStart";
import {
  buildGuidedReviewRows,
  buildReviewSummaryRows,
  readinessDotClass,
  readinessLabel,
  readinessPulse,
} from "../lib/reviewSummary";
import { useAppActions } from "../lib/appActions";
import { useSignal } from "../lib/useSignal";
import { t, tn } from "../lib/i18n";
import { cn } from "../lib/utils";
import { ParamRows, type FocusParamRequest, type ParamSectionGroup } from "./ParamRows";
import { AttentionItems } from "./AttentionItems";
import { DisplayRowsPanel } from "./DisplayRowsPanel";
import { Button } from "./ui/button";

// Shared plain-link style for the Review stage's "Edit <stage>" buttons.
const REVIEW_LINK_CLASS =
  "cursor-pointer border-none bg-transparent p-0 text-[0.85rem] font-medium text-brand hover:underline focus-visible:outline-offset-2";

interface Props {
  design: Design;
  values: Values;
  onChange: (name: string, value: ParamValue) => void;
  /** Always "essentials" in practice (CustomizeTab's gate), kept explicit so
   *  this component doesn't have to assume its own caller's rules. */
  view: SettingsView;
  showVarName?: boolean;
  availableFontFamilies?: Set<string>;
  fontSuggestion?: string | null;
  installedFonts?: InstalledFont[];
  baseline?: Values;
  changedParams?: Set<string>;
  presetName?: string | null;
  /**
   * Set (fresh `nonce` per request) to reveal + focus one parameter's
   * control — the attention chip's "Go to setting" action (see
   * CustomizeTab's `focusOnParam`), composed here with QuickStart's own step
   * navigation: jumps to the step containing the param's section first (if
   * it isn't already current), THEN hands the same request to ParamRows so
   * its existing scroll/focus effect does the rest — see the effect below
   * for why the hand-off is buffered through local state rather than
   * forwarding the prop straight through. A param outside every step (the
   * "Also available" tail) needs no jump — that section is always rendered
   * regardless of the current step.
   */
  focusParam?: FocusParamRequest | null;
  /**
   * PR22: bumped (any new value) to jump straight to the Review chip/stage —
   * the export dock's attention line's "Review" action (see CustomizeTab ->
   * AppShell's `focusReviewSignal`). Scroll mode scrolls the trailing Review
   * section into view; steps mode selects it (with focus, matching Back/
   * Next's own contract).
   */
  focusReviewSignal?: number;
  /**
   * Desktop ("scroll", PR15): every visible step's group renders at once in
   * one scrollable flow — the panel's existing scroll container — with the
   * chip strip as sticky anchors and no Back/Next; a step's "current"/
   * "visited" state tracks scroll position via IntersectionObserver instead
   * of navigation. Mobile ("steps", the default — matches every behavior
   * documented above and throughout this file): today's one-step-at-a-time
   * navigation with Back/Next, unchanged. Set by the layout-specific mount
   * point — ParamPanel (desktop) passes "scroll", SheetTabs (mobile) passes
   * "steps" — via CustomizeTab's own `variant` prop, never derived here.
   */
  variant?: "scroll" | "steps";
  /**
   * PR18's Review stage inputs — the terminal "Review" chip's own content
   * (ReviewContent below), all forwarded verbatim from CustomizeTab, which in
   * turn gets them from AppShell. Overall production-readiness for the
   * CURRENT render (src/lib/readiness.ts's readinessState).
   */
  readiness?: ReadinessState;
  /** Unresolved production-readiness gaps for the current render — the exact
   *  same list CustomizeTab's own attention chip strip shows, reused here via
   *  AttentionItems so the Review stage's "Needs attention" detail can never
   *  drift from it. */
  attention?: AttentionItem[];
  /** A font-fallback attention item's action (CustomizeTab's `focusOnParam`) —
   *  reveal + focus the owning param's control. */
  onGoToSetting?: (name: string) => void;
  /** A notice attention item's action: open the Output console (Messages). */
  onOpenMessages?: () => void;
  /** The active viewer's measured bounding box (mm), or null before any
   *  render has landed. */
  measured?: Dimensions | null;
  /** Values behind the CURRENT render (not the live controls in `values`) —
   *  what the summary's `@info` rows read, mirroring DimensionInfo's own
   *  `values` prop so both surfaces show the same figures. */
  renderedValues?: Values;
  /** Runtime `echo("@info", …)` rows for the current render (src/lib/
   *  computedInfo.ts). */
  computedInfo?: ComputedInfo[];
  /** Runtime `echo("@display", step, label, value)` rows for the current
   *  render (src/lib/displayRows.ts) — a design's own generated-content
   *  preview. Rendered inline in each step's own group (DisplayRowsPanel,
   *  after that step's ParamRows) AND again in the Review card's summary
   *  (reviewSummary.ts's `displayInfoRows`), so the two surfaces can never
   *  disagree about what a design generated. */
  displayRows?: DisplayRow[];
  /** Whether the summary's figures are stale (src/lib/renderState.ts's
   *  isMeasurementStale) — the same dim+italic treatment DimensionInfo gives
   *  an out-of-date preview. */
  reviewStale?: boolean;
  /**
   * M3-A: the live count of non-blocking notices (src/lib/
   * usePanelDerivedState.ts's own doc) — notices Messages shows that never
   * counted against `readiness`/`attention` above. The guided Review "ready"
   * strip (`GuidedReviewContent`) uses this to add a quiet FYI line
   * ("N notes in Messages") when it's non-zero, so an all-clear Review stage
   * doesn't silently contradict a non-zero Messages badge elsewhere in the
   * shell. Purely informational: never renders when 0/undefined, never
   * changes the strip's success styling, never affects `readiness` itself.
   */
  nonBlockingNoticeCount?: number;
  /** A successful render that still matches the live controls (AppShell's
   *  `exportable`) — the Review stage's own primary Export action is
   *  disabled exactly when the export dock's Export button is. */
  canExport?: boolean;
  /**
   * A DOM node to portal the step-chip strip into, so CustomizeTab can hoist
   * it ABOVE the Essential/All settings toggle — mockup order: guide
   * summary, stage chips, toggle, search, step content — without lifting
   * this component's navigation state (currentId/visited/the
   * IntersectionObserver wiring) out to a shared ancestor. Round-2 review fix
   * (was steps/mobile-only): CustomizeTab now hoists the strip for BOTH
   * variants whenever QuickStart is showing, so this is populated in scroll
   * mode too. That changes what "sticky" means for scroll mode's own strip:
   * once hoisted, the strip lives entirely OUTSIDE `.customize-tab__scroll`
   * (CustomizeTab's own scrolling container), so it's structurally always
   * visible above the scrolled content without needing `position: sticky` at
   * all — the sticky/background classes below apply only to the (now mostly
   * hypothetical) inline fallback. `null`/undefined renders the strip inline
   * in its normal spot instead (a caller that doesn't hoist it, e.g. a future
   * standalone use) — see CustomizeTab.tsx's own `stripSlot`/`hoistStrip` doc
   * for the other half of this.
   */
  stripSlot?: HTMLElement | null;
  /**
   * Wave 1's `ui.workflow` (default `"tabs"`, see docs/config.md). `"tabs"`
   * keeps every behavior documented above exactly as it's always been.
   * `"guided"` activates: stage-scoped rendering with no leak (already true
   * of "steps" variant's one-step-at-a-time swap; scroll mode is never used
   * in guided workflow — the caller switches desktop to "steps" too, see
   * `stepNav`), a per-stage "Show advanced settings" toggle in place of the
   * global essentials/all switch, a dedicated verification-only Review
   * screen (`GuidedReviewContent` below, replacing `ReviewContent`), and the
   * just-in-time "Download anyway" confirmation (`pendingDownloadConfirm`).
   */
  workflow?: "tabs" | "guided";
  /**
   * "steps" variant only: whether the Back/Next row renders at all. Default
   * `true` (today's behavior). Guided workflow's desktop mount (ParamPanel)
   * passes `false` — chips are the only navigation there; guided mobile
   * (SheetTabs) and every tabs-mode "steps" caller leave this at its default.
   */
  stepNav?: boolean;
  /**
   * Wave 1: step ids whose Advanced params are currently revealed (see
   * `workflow`'s own doc) — lifted to CustomizeTab so the search box
   * (CustomizeTab's own sibling control) can gate on the ACTIVE step's
   * membership without duplicating this component's per-step bookkeeping.
   * Defaults to an empty set (nothing revealed) when omitted.
   */
  stageAdvancedSet?: Set<string>;
  /** Toggles one step's membership in `stageAdvancedSet` — the "Show/Hide
   *  advanced settings" button's own action, and `focusOnParam`'s guided-mode
   *  branch (CustomizeTab.tsx) when a jump target is itself `@advanced`. */
  onToggleStageAdvanced?: (stepId: string) => void;
  /**
   * Mirrors this component's own active-step id (a real step id or
   * `REVIEW_STEP_ID`) up to CustomizeTab/AppShell on every change, via
   * `useLayoutEffect` so the mirror lands in the SAME synchronous commit as
   * the step change — no visible flash of a sibling control (the Advanced
   * toggle, PanelFooter, the mobile sheet's Review detent) reacting to the
   * OLD step for a frame. See panelData.ts's own `activeStepId` doc for why
   * this is a notify-up mirror rather than a fully controlled `currentId`
   * prop — QuickStart keeps owning its own navigation state (visited,
   * scroll-spy, focus handling) either way.
   */
  onActiveStepChange?: (id: string) => void;
  /** Guided Review's curated-summary label overrides (`designs[].
   *  reviewLabels`, see docs/config.md) — forwarded verbatim to
   *  `buildGuidedReviewRows`. */
  reviewLabels?: Record<string, string>;
  /** Guided Review's optional explanatory note (`designs[].reviewNote`). */
  reviewNote?: string | null;
  /** Param-name -> rendered-value overrides from `echo("@review", param,
   *  value)` (src/lib/reviewOverrides.ts) — forwarded verbatim to
   *  `buildGuidedReviewRows` so a curated row can show what the design
   *  actually rendered instead of the raw stored value. */
  reviewOverrides?: Map<string, string>;
  /** Wave 1: true while the export dock's Download button is waiting on
   *  Review's own just-in-time "Download anyway" confirmation (AppShell's
   *  `downloadConfirmPending`) — see `GuidedReviewContent`'s own doc. */
  pendingDownloadConfirm?: boolean;
  /** Guided Review's "Download anyway" action (AppShell's
   *  `handleDownloadAnyway`) — exports the current model and clears
   *  `pendingDownloadConfirm`. */
  onDownloadAnyway?: () => void;
  /**
   * Wave 3 (mobile density/detents): called on every DELIBERATE step
   * navigation — a chip click, Back/Next, or a `focusParam` jump — never on
   * the automatic step-list reconciliation (a design switch or a value edit
   * hiding the current step, see the `resolved !== currentId` block below).
   * Mirrors the mobile bottom sheet's existing tabs-mode `onActivate` (raise
   * a collapsed Peek sheet to Half the moment a visitor engages with
   * navigation) — CustomizeTab forwards SheetTabs' own `onActivate` here only
   * in guided mode (see its own `onStepActivate` doc), so a chip tap at Peek
   * always lands the visitor on Half, matching the mockup's "peek → select
   * stage → half" contract. A no-op call in every other context (desktop,
   * tabs mode, sheet already past Peek) — see BottomSheet's own `expand`.
   */
  onStepActivate?: () => void;
  /**
   * Wave 1 (round-5); harmonized (R13) to apply whenever QuickStart itself
   * shows, in either workflow: live-preview (auto-render) state, forwarded
   * from CustomizeTab (which gets it as an explicit prop from
   * ParamPanel/SheetTabs, the same value PanelFooter always used). The
   * standing PanelFooter switch is gone from QuickStart's own Content/
   * Appearance footer wherever it shows (live preview just stays on by
   * default); this prop instead feeds the shared `StageLivePreview` helper,
   * appearing per-stage per `stepAdvancedInfo`'s `showLivePreview` (see
   * `src/lib/quickStart.ts`) — never in Review. `undefined` means the caller
   * hasn't wired autoRender at all (StageLivePreview then renders nothing).
   */
  autoRender?: boolean;
}

// F7: stable identities for QuickStart/ReviewContent's non-primitive default
// props — mirrors AppShell's own EMPTY_LOG precedent. An inline `= []` /
// `= () => {}` default literal is re-created fresh on every render a caller
// omits the prop, which (a) is wasted allocation and (b) would defeat a
// memo'd child's shallow-prop-equality check the moment one of these values
// flows into its props (as `attention` does into AttentionItems below).
const EMPTY_ATTENTION_ITEMS: AttentionItem[] = [];
const EMPTY_COMPUTED_INFO: ComputedInfo[] = [];
const EMPTY_DISPLAY_ROWS: DisplayRow[] = [];
const EMPTY_STAGE_ADVANCED: Set<string> = new Set();

/**
 * The Review stage's own content (rebuilt to match the approved mockup): a
 * readiness line, a one-line subtitle, the structured summary CARD (every
 * essential parameter's current value, then the design's own `@display`
 * rows, then the dimension/`@info`/computed rows — reviewSummary.ts's
 * `buildReviewSummaryRows`, the SAME derivation feeding this card whichever
 * variant renders it), then EITHER the one warning card (AttentionItems.tsx,
 * when there's something to review) OR a
 * success strip (when there isn't), and finally the actions row: the primary
 * Export button (reusing the AppActions `exportModel` callback directly —
 * "Export anyway" when attention items exist, the plain export label
 * otherwise — disabled exactly when the export dock's own Export is), plus a
 * quiet "Open font settings" link for the first attention item with a param
 * target (hidden when none — e.g. every gap is a notice, not a font). No
 * separate "Font status" row anymore: a font param's current family already
 * shows as an ordinary essential-parameter row, and a missing family already
 * gets its own warning-card entry with real fix actions — repeating either
 * as a THIRD element was redundant. Identical markup in both variants — only
 * where it's mounted (scroll mode's trailing section vs. steps mode's
 * terminal step) differs — so it's factored out rather than written twice.
 */
function ReviewContent({
  readiness = "building",
  attention = EMPTY_ATTENTION_ITEMS,
  onGoToSetting,
  onOpenMessages,
  rows,
  stale = false,
  canExport = false,
}: {
  readiness?: ReadinessState;
  attention?: AttentionItem[];
  onGoToSetting?: (name: string) => void;
  onOpenMessages?: () => void;
  rows: ReturnType<typeof buildReviewSummaryRows>;
  stale?: boolean;
  canExport?: boolean;
}) {
  const { exportModel } = useAppActions();
  const hasAttention = attention.length > 0;
  // The actions row's "Open font settings" link: the first attention item
  // that actually names a param to jump to — today that's only ever a
  // font-fallback item (a notice has no single control to point at) — so
  // this doubles as "is there a font issue at all". Hidden entirely when
  // there's none, rather than a dead link.
  const fontFallbackItem = useMemo(
    () => attention.find((a): a is FontFallbackItem => a.kind === "font-fallback") ?? null,
    [attention]
  );

  return (
    <div className="quick-start__review flex flex-col gap-4">
      <div className="quick-start__review-readiness flex items-center gap-2 text-[0.85rem] font-medium text-foreground">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            readinessDotClass(readiness),
            readinessPulse(readiness) && "animate-pulse"
          )}
        />
        <span>{readinessLabel(readiness)}</span>
      </div>
      <p className="quick-start__review-subtitle m-0 text-[0.85rem] text-muted-foreground">
        {t("quickstart.reviewSubtitle")}
      </p>
      {rows.length > 0 && (
        <dl
          className={cn(
            "quick-start__review-summary m-0 flex flex-col gap-[0.5rem] rounded-(--radius-card) border bg-background/50 p-(--space-4) text-[0.85rem]",
            stale && "italic opacity-70"
          )}
          aria-label={t("review.summaryAria")}
        >
          {rows.map((r) => (
            <div
              key={r.key}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3",
                r.headline ? "font-semibold text-foreground" : "text-muted-foreground"
              )}
            >
              <dt className="truncate" title={r.label}>{r.label}</dt>
              <dd
                className={cn(
                  "m-0 text-right text-foreground tabular-nums break-words",
                  r.large && "text-[1.9em] leading-[1.6] tracking-[0.05em]"
                )}
              >
                {r.value}
                {r.auto && (
                  <span className="quick-start__review-auto ml-2 inline-block rounded-full bg-success-bg px-2 py-[0.05rem] align-middle text-[0.68rem] font-medium text-success">
                    {t("quickstart.displayAuto")}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {hasAttention ? (
        <AttentionItems
          attention={attention}
          // No onGoToSetting here (unlike OutputConsole's own instance of
          // this card) — see AttentionItems.tsx's own doc: the Review
          // stage's single "Open font settings" link below already covers
          // that once for the whole card, so a per-item button here would
          // just duplicate it.
          onOpenMessages={onOpenMessages}
          className="quick-start__review-attention"
        />
      ) : (
        readiness === "ready" && (
          <div
            className="quick-start__review-ready flex items-center gap-2 rounded-(--radius-card) border border-success/40 bg-success-bg px-(--space-4) py-(--space-3) text-[0.85rem] text-foreground"
            role="status"
          >
            <SuccessIcon aria-hidden="true" size={18} className="shrink-0 text-success" />
            <span className="font-medium">{t("quickstart.reviewReadyTitle")}</span>
          </div>
        )
      )}
      <div className="quick-start__review-actions flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        <Button
          type="button"
          variant="default"
          size="sm"
          className="quick-start__review-export"
          onClick={exportModel}
          disabled={!canExport}
        >
          {hasAttention ? t("quickstart.exportAnyway") : t("action.export")}
        </Button>
        {fontFallbackItem && onGoToSetting && (
          <button
            type="button"
            className="quick-start__review-open-setting cursor-pointer border-none bg-transparent p-0 text-[0.85rem] font-medium text-brand hover:underline focus-visible:outline-offset-2"
            onClick={() => onGoToSetting(fontFallbackItem.param)}
          >
            {t("quickstart.openFontSettings")}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Guided workflow's (ui.workflow: "guided") dedicated Review screen —
 * VERIFICATION ONLY, replacing `ReviewContent` above wherever
 * `workflow === "guided"`. Deliberately excludes everything ReviewContent
 * shows that isn't pure verification: no settings toggle/search/hidden-diff
 * banner/preset-diff bar (CustomizeTab already suppresses those — see its
 * own `isReviewStage`), no standing Export/Share button, no `@display`/
 * Braille rows, no invented colour rows (`rows` comes from
 * `buildGuidedReviewRows`, which never produces either — see its own doc),
 * and no "Export anyway" wording (Review never exports — see
 * `pendingDownloadConfirm` below).
 *
 * Content, top to bottom (round-5 visual-alignment reorder — readiness now
 * sits right under the summary, so it's above the fold on mobile instead of
 * competing for scroll room with the Edit links first): a "Review your
 * design" heading + one-line subtitle, the curated summary `<dl>`
 * (reviewLabels rows, honouring any `@review` rendered-value overrides,
 * plus ONE overall Dimensions row — see `buildGuidedReviewRows`' own doc),
 * the design's own `reviewNote` when configured, EITHER the attention list
 * (led by a distinct-issue COUNT, each item listed explicitly via
 * `AttentionItems`) or a "Ready for download" success strip, and finally
 * "Edit <stage>" links back to every declared step (`allSteps`, not just the
 * currently-visible subset — a stage hidden
 * by the CURRENT values might become relevant again after editing another
 * stage).
 *
 * The "Download anyway" button is NOT standing chrome: it renders only while
 * `pendingDownloadConfirm` is true — the export dock's Download button
 * (AppShell's `handleDownloadClick`) sets that flag and routes here the
 * INSTANT a visitor presses Download with unresolved issues, instead of
 * downloading immediately. There is exactly one Download action location in
 * guided workflow (the viewer's export dock); this is only its just-in-time
 * confirmation, not a second standing Download control.
 *
 * SCROLL CONTRACT: every entry into Review — the first visit, a plain chip
 * click, or returning from "Edit Content"/"Edit Appearance" (all of which
 * remount this component, see below) — always opens scrolled to the very
 * top, regardless of whether the issue list or the ready strip renders.
 * Only a readiness change that happens WHILE already sitting on Review
 * (never during entry itself) scrolls the newly-shown "Ready for download"
 * strip into view in place. See the two effects below for the mechanism.
 */
function GuidedReviewContent({
  readiness = "building",
  attention = EMPTY_ATTENTION_ITEMS,
  onOpenMessages,
  rows,
  reviewNote,
  stale = false,
  nonBlockingNoticeCount = 0,
  allSteps,
  onEditStep,
  pendingDownloadConfirm = false,
  onDownloadAnyway,
}: {
  readiness?: ReadinessState;
  attention?: AttentionItem[];
  onOpenMessages?: () => void;
  rows: ReturnType<typeof buildGuidedReviewRows>;
  reviewNote?: string | null;
  stale?: boolean;
  /** M3-A: see Props.nonBlockingNoticeCount's own doc — the ready strip's
   *  quiet "N notes in Messages" FYI line. */
  nonBlockingNoticeCount?: number;
  allSteps: QuickStartStep[];
  onEditStep: (stepId: string) => void;
  pendingDownloadConfirm?: boolean;
  onDownloadAnyway?: () => void;
}) {
  const hasAttention = attention.length > 0;

  // This component fully unmounts/remounts on every visit to Review (the
  // `isReviewCurrent` ternary below swaps it for step content entirely, see
  // its own comment) — so "first entry into Review" and "this component's
  // mount" are the same event, and there is exactly one such event per
  // visit. `rootRef` sits on this component's own outermost element so the
  // effect below can find the actual scroll container from here, the same
  // `.customize-tab__scroll`/mobile-sheet-body ancestor the top-level
  // QuickStart component's own always-top-on-entry effect already targets
  // via `SCROLL_CONTAINER_SELECTOR` (see that effect's doc, above `select`).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const readyStripRef = useRef<HTMLDivElement | null>(null);
  const prevHasAttentionRef = useRef(hasAttention);
  // Mirrors the latest `hasAttention` on every render (not just inside an
  // effect) so the rAF callback below reads the value readiness actually
  // settled on, not whatever it happened to be the instant this component
  // mounted.
  const hasAttentionRef = useRef(hasAttention);
  hasAttentionRef.current = hasAttention;
  // False until this mount's first-entry reset (below) has finished
  // settling — see that effect's own doc for why it flips inside the rAF
  // callback rather than synchronously.
  const enteredReviewRef = useRef(false);
  const [readyAnnouncement, setReadyAnnouncement] = useState("");

  // FIRST ENTRY INTO REVIEW (this mount): unconditionally land at the top —
  // both the issue state and the (visually shorter) "Ready for download"
  // state must open showing, in order, the stage nav, "Review your sign",
  // the intro sentence, and the start of the summary; neither should ever
  // open scrolled to wherever a stray readiness update happened to land.
  // `useLayoutEffect` + an immediate reset lands before the first paint of
  // this mount; the `requestAnimationFrame`-deferred second reset gives the
  // sheet detent / readiness one more frame to settle (a render already in
  // flight when the visitor navigated here can still resolve a tick later)
  // before this mount is considered "settled" — only once THAT happens does
  // `enteredReviewRef` flip true, baselining `prevHasAttentionRef` against
  // whatever `hasAttention` actually settled on. This is what stops a
  // readiness value still stabilizing during entry from being mistaken by
  // the effect below for a live, already-present transition (the round-6
  // bug: the READY state could open re-scrolled down to the readiness strip
  // instead of at the top).
  useLayoutEffect(() => {
    const scroller = rootRef.current?.closest<HTMLElement>(SCROLL_CONTAINER_SELECTOR);
    scroller?.scrollTo({ top: 0, behavior: "instant" });
    const raf = requestAnimationFrame(() => {
      scroller?.scrollTo({ top: 0, behavior: "instant" });
      prevHasAttentionRef.current = hasAttentionRef.current;
      enteredReviewRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
    // Deliberately mount-only (this component remounts on every Review
    // entry, so an empty dependency array already means "once per entry" —
    // see this component's own doc above). Only refs are read/written
    // inside, so there's nothing exhaustive-deps would ask for anyway.
  }, []);

  // READINESS CHANGES WHILE ALREADY IN REVIEW (round-6, item 4): resolving
  // the LAST unresolved issue while already sitting on Review (e.g.
  // importing a missing font from the attention card's own action, or
  // fixing a design notice elsewhere and returning) swaps the issue list out
  // for the "Ready for download" strip in place — nothing else moves the
  // visitor's scroll position, so on a longer issue list that strip could
  // land off-screen below the fold, and a sighted visitor watching the model
  // (not the panel) could miss the state change entirely. Guarded on
  // `enteredReviewRef` so this NEVER fires until the first-entry reset above
  // has finished settling — i.e. never during this mount's own entry, only
  // for a genuine change afterward. On a genuine hasAttention TRUE -> FALSE
  // transition (never on FALSE -> TRUE — an issue reappearing scrolls
  // nowhere, it just swaps the strip back for the list) this scrolls the
  // newly-shown strip into view and announces it through an always-mounted
  // `aria-live="polite"` region — a live region's TEXT changing is reliably
  // announced by assistive tech; a whole new `role="status"` element being
  // inserted (the strip itself, below) isn't always announced the same way
  // on first appearance. This is the ONLY place left that scrolls an element
  // into view rather than resetting the scroller outright — first entry
  // (above) and returning from Edit Content/Edit Appearance (itself a fresh
  // mount, so it goes through that same first-entry reset) both always reset
  // to the top instead, never to a retained/restored position.
  useEffect(() => {
    if (!enteredReviewRef.current) return;
    const wasAttention = prevHasAttentionRef.current;
    prevHasAttentionRef.current = hasAttention;
    if (wasAttention && !hasAttention) {
      readyStripRef.current?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "nearest",
      });
      setReadyAnnouncement(t("review.readyTitle"));
    }
  }, [hasAttention]);

  return (
    <div ref={rootRef} className="quick-start__review quick-start__review--guided flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-display m-0 text-[0.95rem] font-semibold text-foreground">
          {t("review.heading")}
        </h3>
        <p className="m-0 text-[0.85rem] text-muted-foreground">{t("review.subtitle")}</p>
      </div>
      {/* UX-plan 4.1: attention state only — the issue list (led by its own
          "N issue(s) to review" count) moves ABOVE the summary card here so
          the stage's actual point is visible without scrolling past a tidy
          summary first; the Ready state's layout (summary, then the ready
          strip further down) is untouched — see the second copy of this
          block, further down, gated on `!hasAttention`. This REORDERS the
          existing elements rather than adding new ones: same total content
          either way, so entering Review never measures a taller screen than
          before this fix, only a differently-ordered one. The summary
          card's own field set is untouched (settled) — only the CARD's
          position (rows.length check further down) shifts, not its rows. */}
      {hasAttention && (
        <div className="flex flex-col gap-2">
          <p className="quick-start__review-issue-count m-0 text-[0.85rem] font-medium text-foreground">
            {tn("review.issueCount", attention.length)}
          </p>
          <AttentionItems attention={attention} onOpenMessages={onOpenMessages} className="quick-start__review-attention" />
        </div>
      )}
      {rows.length > 0 && (
        <dl
          className={cn(
            "quick-start__review-summary m-0 flex flex-col gap-[0.6rem] rounded-(--radius-card) border bg-background/50 p-(--space-4) text-[0.85rem]",
            stale && "italic opacity-70"
          )}
          aria-label={t("review.summaryAria")}
        >
          {/* Round-6, item 3: a stable two-column grid (label ~120-42%,
              value the remaining ~58%) rather than the tabs-mode
              ReviewContent's `1fr auto` + `truncate` pairing — that let a
              short label column ellipsize ("Lan…") the moment a value's own
              natural width pushed it narrow. The label column NEVER
              ellipsizes here (`whitespace-normal`/`overflow-visible`, no
              `text-ellipsis` utility) — it wraps instead, and `title` still
              carries the full text for a mouse hover. Below ~360px (a
              genuinely narrow phone, not this app's typical 390px+ target)
              the two columns stack instead of squeezing further. */}
          {rows.map((r) => (
            <div
              key={r.key}
              className={cn(
                "grid grid-cols-[minmax(120px,42%)_minmax(0,58%)] items-baseline gap-x-3 gap-y-[0.15rem] max-[360px]:grid-cols-1 max-[360px]:gap-y-0",
                r.headline ? "font-semibold text-foreground" : "text-muted-foreground"
              )}
            >
              <dt className="m-0 overflow-visible break-words whitespace-normal" title={r.label}>
                {r.label}
              </dt>
              <dd className="m-0 text-right text-foreground tabular-nums break-words max-[360px]:text-left">
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {reviewNote && (
        <p className="quick-start__review-note m-0 text-[0.8rem] text-muted-foreground">{reviewNote}</p>
      )}
      {/* Round-5 reorder: the Ready strip comes right after the summary +
          note (unchanged position — see this component's own doc). In the
          attention state the equivalent content already rendered ABOVE the
          summary instead (UX-plan 4.1, above) — this branch is simply
          `!hasAttention` now rather than the other half of a ternary. */}
      {/* Always mounted (empty text does nothing) so a browser/AT already has
          this region registered before the announcement-worthy change
          happens — see the effect above for why that's more reliable than a
          brand-new role="status" element appearing. */}
      <div aria-live="polite" className="sr-only">{readyAnnouncement}</div>
      {!hasAttention && readiness === "ready" && (
        <div
          ref={readyStripRef}
          className="quick-start__review-ready flex flex-col gap-1 rounded-(--radius-card) border border-success/40 bg-success-bg px-(--space-4) py-(--space-3) text-[0.85rem] text-foreground"
          role="status"
        >
          <div className="flex items-center gap-2">
            <SuccessIcon aria-hidden="true" size={18} className="shrink-0 text-success" />
            <div className="flex flex-col">
              <span className="font-medium">{t("review.readyTitle")}</span>
              <span className="text-muted-foreground">{t("review.readyBody")}</span>
            </div>
          </div>
          {/* M3-A: an FYI, not a warning — the ready strip must not read as
              amber just because Messages still has a non-blocking notice
              (e.g. a `fontnote` category flagged `attention: false`) sitting
              alongside an all-clear render. Quiet, same success-tinted text
              colour as the body line above, styled as a link only for its
              own click affordance (opens Messages) — no icon, no border, no
              change to the strip's success treatment. Never renders when
              `nonBlockingNoticeCount` is 0 — most designs, most renders. */}
          {nonBlockingNoticeCount > 0 && (
            <button
              type="button"
              className="quick-start__review-notes-in-messages w-fit cursor-pointer border-none bg-transparent p-0 pl-[1.65rem] text-left text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-offset-2"
              onClick={() => onOpenMessages?.()}
            >
              {tn("review.notesInMessages", nonBlockingNoticeCount)}
            </button>
          )}
        </div>
      )}
      {/* The "Edit <stage>" navigation row — the only actions on Review;
          each jumps the visitor back to a declared stage. (Neither Review
          variant offers a camera shortcut — the viewer's own controls own
          that.) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {allSteps.map((step) => (
          <button
            key={step.id}
            type="button"
            className={cn("quick-start__review-edit", REVIEW_LINK_CLASS)}
            onClick={() => onEditStep(step.id)}
          >
            {t("review.editStep", { label: step.label })}
          </button>
        ))}
      </div>
      {/* Just-in-time only — see this component's own doc. Not rendered at
          all outside the export dock's "download while unresolved issues
          exist" flow, so Review never carries a standing Download button. */}
      {pendingDownloadConfirm && (
        <div
          className="quick-start__review-download-confirm flex flex-wrap items-center gap-3 rounded-(--radius-card) border border-warn/50 bg-warn-bg px-(--space-4) py-(--space-3)"
          role="status"
        >
          <span className="text-[0.85rem] text-foreground">{t("review.downloadAnywayHint")}</span>
          <Button type="button" variant="default" size="sm" className="quick-start__review-download-anyway" onClick={onDownloadAnyway}>
            {t("review.downloadAnyway")}
          </Button>
        </div>
      )}
    </div>
  );
}

// A thin band across the top of the scroll container: only a group heading
// inside it counts as "intersecting" for currentStepFromIntersections, so
// `current` flips once a step's heading scrolls near the top rather than as
// soon as any sliver of the group appears at the bottom of the panel. The
// large negative bottom margin shrinks the effective observed area to
// (100% - 80%) = the top 20% of the container.
const SCROLL_SPY_ROOT_MARGIN = "0px 0px -80% 0px";

// The scroll-mode container to observe against and to scroll within — see
// CustomizeTab.tsx's own comment on this class. Falls back to the browser
// viewport (root: null) if it's ever mounted outside that wrapper (e.g. a
// future standalone use), which still degrades reasonably.
const SCROLL_CONTAINER_SELECTOR = ".customize-tab__scroll";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

// Round-2 review fix ("three large pills occupy too much height"): a light
// step indicator matching the approved mockup — a small circular number
// badge (accent-filled for the current step, a plain muted outline
// otherwise) plus a text label, joined by a thin connector line between
// chips. No full pill background/border on an inactive chip (fully
// transparent, muted text). min-h-11 (44px) keeps the tap target
// comfortable despite the lighter visual footprint.
//
// Round-5 Wave 2 (item 5, "further toward the mockup's lightness"): the
// current chip used to also get a quiet pill of its own (a subtle border +
// tinted fill around the whole chip) so it read as "selected" beyond just
// the filled number badge — the approved mockup has no such box at all: the
// filled accent number circle plus bold accent-coloured text alone read as
// current, exactly like an inactive chip's plain circle + muted text, just
// recoloured. Dropped entirely rather than lightened further.
const chipClass =
  "quick-start__step inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-[0.4rem] rounded-(--radius-sm) px-[0.35rem] py-1 text-[0.82rem] font-medium transition-colors focus-visible:outline-offset-2";
// Round-2 review re-check: an inactive chip's label + number-circle text both
// resolve to --muted on the docked panel/sheet's --panel background (the only
// surface this strip renders on — see .param-panel/.bottom-sheet in
// index.css). Re-verified against the round-2 dark-elevation lift above:
// 7.09:1, comfortably clear of the 4.5:1 AA floor, so --muted itself needs no
// adjustment for this chip.
const chipInactive = "bg-transparent text-muted-foreground hover:text-foreground";
const chipCurrent = "quick-start__step--current bg-transparent font-semibold text-brand";
// The number badge itself — bg-primary/text-primary-foreground is the same
// accent-filled-circle treatment DesignPickerDialog's own numbered badge
// uses (see PresetPicker.tsx's comment on that pairing), reused here so a
// "current step" badge and an "already selected" badge read the same way
// throughout the app.
const stepNumberClass =
  "quick-start__step-number inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-semibold";
const stepNumberCurrent = "bg-primary text-primary-foreground";
const stepNumberInactive = "border border-(color:--line) text-muted-foreground";
// A short, fixed-width thin line rather than a flex-grown one: the mockup's
// connectors read as a quiet rhythm mark between chips, not a stretched
// timeline bar filling whatever space is left.
const connectorClass = "quick-start__step-connector h-px w-5 shrink-0 bg-(color:--line)";

function sectionsOf(design: Design, names: string[]): ParamSectionGroup[] {
  return names.map((section) => ({ section, params: design.params.filter((p) => p.section === section) }));
}

/**
 * The per-stage "Show/Hide advanced settings" text button — identical markup
 * in both of QuickStart's variants (steps mode below its own current step's
 * ParamRows; scroll mode below each visible step's group), previously
 * duplicated inline. `show` is that step's own `stepAdvancedInfo(...).
 * hasAdvanced` (no button at all when the step has no `@advanced` param to
 * reveal); `on` is `.advancedOn`, deciding the label.
 */
function AdvancedToggleButton({
  show,
  on,
  onClick,
}: {
  show: boolean;
  on: boolean;
  onClick: () => void;
}) {
  if (!show) return null;
  return (
    <button
      type="button"
      className="quick-start__advanced-toggle mt-(--space-3) cursor-pointer border-none bg-transparent p-0 text-[0.82rem] font-medium text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-offset-2"
      onClick={onClick}
    >
      {on ? t("quickstart.hideAdvanced") : t("quickstart.showAdvanced")}
    </button>
  );
}

/**
 * The stage-scoped inline Live-preview footer — identical in both of
 * QuickStart's variants, previously duplicated inline. Only rendered once
 * `autoRender` is actually wired (`!== undefined` — the caller hasn't wired
 * it at all otherwise, distinct from "off") AND `visible` (that step's own
 * `stepAdvancedInfo(...).showLivePreview`, see its own doc).
 */
function StageLivePreview({
  visible,
  autoRender,
}: {
  visible: boolean;
  autoRender: boolean | undefined;
}) {
  if (autoRender === undefined || !visible) return null;
  return (
    <PanelFooter
      autoRender={autoRender}
      className="quick-start__advanced-live-preview mt-(--space-3) flex items-center gap-2"
    />
  );
}

export function QuickStart({
  design,
  values,
  onChange,
  view,
  showVarName = false,
  availableFontFamilies,
  fontSuggestion,
  installedFonts,
  baseline,
  changedParams,
  presetName,
  focusParam,
  focusReviewSignal,
  variant = "steps",
  readiness = "building",
  attention = EMPTY_ATTENTION_ITEMS,
  onGoToSetting,
  onOpenMessages,
  measured = null,
  renderedValues,
  computedInfo = EMPTY_COMPUTED_INFO,
  displayRows = EMPTY_DISPLAY_ROWS,
  reviewStale = false,
  nonBlockingNoticeCount = 0,
  canExport = false,
  stripSlot = null,
  workflow = "tabs",
  stepNav = true,
  stageAdvancedSet = EMPTY_STAGE_ADVANCED,
  onToggleStageAdvanced,
  onActiveStepChange,
  reviewLabels,
  reviewNote,
  reviewOverrides,
  pendingDownloadConfirm = false,
  onDownloadAnyway,
  onStepActivate,
  autoRender,
}: Props) {
  // F6: memoized on their actual inputs — design/values/view — so a render
  // that doesn't change any of them (e.g. a sibling attention/readiness
  // update elsewhere in AppShell) reuses the SAME `steps`/`stepOrder` array
  // references instead of recomputing (and reallocating) them from scratch.
  // That matters beyond the direct cost of visibleSteps() itself: several
  // values derived below (stepSectionGroups, orderKey) depend on `steps`, so
  // keeping its identity stable across an unrelated re-render lets those stay
  // stable too, which is what actually keeps ParamRows' own memo (below)
  // effective — see its own comment.
  const steps = useMemo(
    () => visibleSteps(design, values, view, stageAdvancedSet),
    [design, values, view, stageAdvancedSet]
  );
  const stepOrder = useMemo(() => [...steps.map((s) => s.id), REVIEW_STEP_ID], [steps]);

  const [currentId, setCurrentId] = useState<string>(() => steps[0]?.id ?? REVIEW_STEP_ID);
  // "Visited" (sr-only text on the chip, see below), not "valid" or
  // "complete": there is no per-param validation system in this app (a
  // param's value is whatever the control last committed — there's no
  // notion of an invalid or unfilled OpenSCAD parameter), so "this step has
  // been shown at least once" is the only honest claim a chip can make.
  // Never treat this as "done" or gate anything on it. Steps mode marks a
  // step visited the moment it's selected (click or Back/Next); scroll mode
  // marks it visited once its group has actually scrolled into view (the
  // IntersectionObserver effect below) — see this component's own `variant`
  // doc for why the two modes differ here.
  const [visited, setVisited] = useState<Set<string>>(() => new Set([currentId]));
  // Set true only by goBack/goNext (steps mode only), so the focus-move
  // effect below fires for deliberate navigation but never for a chip click
  // (the browser already moves focus to the clicked chip) or a reactive
  // step-list change from a value edit (which shouldn't steal focus from
  // whatever the visitor is still doing).
  const pendingFocusRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  // Scroll mode only: every step-group heading (+ the trailing Review
  // heading), keyed by step id — the IntersectionObserver's targets and
  // scrollToGroup's jump targets. A plain mutable ref (not state): membership
  // changes on every mount/unmount of a group, and nothing needs to re-render
  // off it directly.
  const groupRefs = useRef<Map<string, HTMLElement>>(new Map());
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const intersectingRef = useRef<Set<string>>(new Set());

  // Reconcile `currentId` against the CURRENT render's steps, synchronously
  // during render (react.dev's "adjust state when a prop changes" pattern —
  // same idiom ParamRows uses for its own design-identity reset): a design
  // switch restarts at the first visible step with a fresh visited set; on
  // the same design, a value change that hid the current step falls back to
  // the nearest remaining one (or Review) via resolveCurrentStep.
  const lastDesignRef = useRef(design);
  const designChanged = lastDesignRef.current !== design;
  if (designChanged) lastDesignRef.current = design;
  const resolved = designChanged ? (steps[0]?.id ?? REVIEW_STEP_ID) : resolveCurrentStep(design, steps, currentId);
  if (resolved !== currentId) {
    setCurrentId(resolved);
    setVisited((prev) => {
      const base = designChanged ? new Set<string>() : prev;
      return base.has(resolved) ? base : new Set(base).add(resolved);
    });
    pendingFocusRef.current = false;
  }
  const effectiveCurrentId = resolved;

  // Mirror the active step id UP to CustomizeTab/AppShell (see this
  // component's own `onActiveStepChange` doc). `useLayoutEffect`, not
  // `useEffect`: it must land in the SAME synchronous commit as the step
  // change, before the browser paints, so a sibling control reacting to it
  // (the Advanced toggle, PanelFooter, the mobile Review detent) never shows
  // a frame reflecting the OLD step.
  useLayoutEffect(() => {
    onActiveStepChange?.(effectiveCurrentId);
    // onActiveStepChange is recreated every render in every real caller
    // (AppShell hands out a plain setState function via panelData, itself
    // stable, but CustomizeTab forwards it through its own render) —
    // depending on the step id alone, mirroring every other signal-style
    // effect in this file (see focusReviewSignal's useSignal usage below),
    // is intentional: it always calls the LATEST callback when the id itself
    // actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCurrentId]);

  useEffect(() => {
    if (variant !== "steps") return;
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    headingRef.current?.focus();
  }, [effectiveCurrentId, variant]);

  // Wave 1 (round-5), hardened round-6 item 4: guided workflow's Review
  // stage always opens scrolled to the TOP — its own "Review your design"
  // heading is the first thing visible, rather than wherever the shared
  // scroll container happened to be scrolled from the previous stage. Steps
  // mode swaps content in place inside the SAME `.customize-tab__scroll`
  // element (see SCROLL_CONTAINER_SELECTOR's own doc), so a plain Review
  // chip click — the most common way in, and one that never sets
  // `pendingFocusRef` (only Back/Next/Edit-step do, see `select`'s own
  // `opts.focus`) — would otherwise leave Review mid-scroll on mobile,
  // pushing the readiness state below the fold. Deliberately unconditional
  // beyond that: "always top on entering Review" is simpler than trying to
  // distinguish "returning from an Edit action" from every other path in,
  // and still correct there (Review has no per-visit scroll state worth
  // restoring). "tabs" workflow is intentionally untouched — see
  // `workflow`'s own byte-identical contract.
  //
  // Round-6 item 4: `useLayoutEffect` (was `useEffect`) so the reset lands
  // in the SAME synchronous commit as the step change, before the browser
  // ever paints a frame at the OLD scroll position against Review's NEW
  // (shorter or taller) content — a plain `useEffect` can be deferred past a
  // paint, which is what let the READY state (whose content is noticeably
  // SHORTER than the issue state's — no multi-item attention card) sometimes
  // render one frame at the previous stage's scroll offset before snapping
  // to 0, reading as "opens mid-summary". A second, `requestAnimationFrame`-
  // deferred reset follows the synchronous one, covering content that only
  // reaches its final height a frame later (e.g. once the mobile sheet's own
  // "review" detent finishes measuring) — belt-and-braces cheap insurance,
  // not a sign the first reset is unreliable on its own.
  useLayoutEffect(() => {
    if (workflow !== "guided" || effectiveCurrentId !== REVIEW_STEP_ID) return;
    const root = wrapperRef.current?.closest<HTMLElement>(SCROLL_CONTAINER_SELECTOR);
    if (!root) return;
    root.scrollTo({ top: 0 });
    const raf = requestAnimationFrame(() => root.scrollTo({ top: 0 }));
    return () => cancelAnimationFrame(raf);
  }, [workflow, effectiveCurrentId]);

  // Steps mode's chip/Back/Next navigation: swaps which step's ParamRows is
  // mounted (see `currentStep` below), immediately marking it current+visited.
  const select = (id: string, opts: { focus?: boolean } = {}) => {
    pendingFocusRef.current = opts.focus === true;
    setCurrentId(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    onStepActivate?.();
  };

  // Scroll mode's own jump: every group is already mounted, so there's
  // nothing to swap — just scroll the target group into view (respecting
  // prefers-reduced-motion) and move focus to its heading, the same
  // heading-focus contract steps mode gives goBack/goNext.
  const scrollToGroup = (id: string, opts: { focusHeading?: boolean } = {}) => {
    const el = groupRefs.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    if (opts.focusHeading !== false) el.focus({ preventScroll: true });
  };

  // Scroll mode's chip click: deliberate navigation, so — mirroring steps
  // mode's `select` — set current+visited immediately rather than waiting
  // for the IntersectionObserver below (built for organic scrolling, see its
  // own doc) to catch up once the scroll settles.
  const selectScroll = (id: string) => {
    setCurrentId(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    scrollToGroup(id);
  };

  // Scroll mode's IntersectionObserver: recreated whenever the visible step
  // set changes (a step appearing/disappearing changes which headings exist
  // to observe) or the variant flips. Recreating rather than patching an
  // existing observer keeps this simple and correct — stale observations
  // from a removed group can't linger — at the cost of one extra observer
  // setup per step-list change, which is cheap (a handful of elements).
  const orderKey = stepOrder.join("|");
  useEffect(() => {
    if (variant !== "scroll") return;
    if (typeof IntersectionObserver === "undefined") return;
    const order = orderKey.split("|");
    const root = wrapperRef.current?.closest<HTMLElement>(SCROLL_CONTAINER_SELECTOR) ?? null;
    intersectingRef.current = new Set();
    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.stepGroup;
          if (!id) continue;
          const was = intersectingRef.current.has(id);
          if (entry.isIntersecting && !was) {
            intersectingRef.current.add(id);
            changed = true;
          } else if (!entry.isIntersecting && was) {
            intersectingRef.current.delete(id);
            changed = true;
          }
        }
        if (!changed) return;
        const next = currentStepFromIntersections(order, intersectingRef.current);
        if (!next) return;
        setCurrentId((prev) => (prev === next ? prev : next));
        setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
      },
      { root, rootMargin: SCROLL_SPY_ROOT_MARGIN, threshold: 0 }
    );
    for (const el of groupRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [variant, orderKey]);

  // The `focusParam` request, handed to ParamRows only once the right step is
  // actually showing (see the prop's own doc). Buffered through local state
  // rather than forwarding the incoming prop straight to ParamRows: children's
  // effects fire before a parent's, so if ParamRows saw the prop directly it
  // would consume the nonce (and query the DOM) on the SAME render the step
  // jump below is still only queued, before `select`'s state update has
  // landed — a guaranteed miss. Setting `rowFocus` here instead means both
  // land in the same commit: `select` updates `currentId` (so `sections`
  // already reflects the target step) and `rowFocus` first receives this
  // nonce together, so by the time ParamRows' own effect runs, the row it's
  // looking for actually exists.
  //
  // Scroll mode needs no such buffering trick — every step's ParamRows is
  // already mounted, so the target row already exists in the DOM the moment
  // `rowFocus` is set; ParamRows' own scroll/focus effect (see ParamRows.tsx)
  // does the rest. `currentId` is still updated (mirroring `select`, not
  // waiting on the IntersectionObserver) purely so `aria-current` and the
  // chip strip agree with what's now on screen.
  const [rowFocus, setRowFocus] = useState<FocusParamRequest | null>(null);
  const lastFocusNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!focusParam || focusParam.nonce === lastFocusNonce.current) return;
    lastFocusNonce.current = focusParam.nonce;
    const target = design.params.find((p) => p.name === focusParam.name);
    const step = target ? steps.find((s) => s.sections.includes(target.section)) : undefined;
    if (step && step.id !== effectiveCurrentId) {
      if (variant === "scroll") {
        setCurrentId(step.id);
        setVisited((prev) => (prev.has(step.id) ? prev : new Set(prev).add(step.id)));
      } else {
        select(step.id);
      }
    }
    setRowFocus(focusParam);
    // select/steps/effectiveCurrentId/variant are recreated every render
    // (steps closes over design/values/view); depending on the nonce alone
    // is intentional — the effect always reads the latest closure when it
    // fires, matching CustomizeTab's own focusHiddenDiffSignal effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusParam]);

  const currentIndex = stepOrder.indexOf(effectiveCurrentId);
  const isReviewCurrent = effectiveCurrentId === REVIEW_STEP_ID;
  const currentStep = steps.find((s) => s.id === effectiveCurrentId) ?? null;

  // F6: hasVisibleUnstepped(design, values, view) used to be called twice —
  // once for each variant's own gate below — recomputing the exact same
  // answer from the exact same inputs. One memoized call, reused by both.
  const hasUnstepped = useMemo(() => hasVisibleUnstepped(design, values, view), [design, values, view]);
  // Steps mode: the tail sits below whichever single step is showing, so it's
  // suppressed while the Review "step" is current (nothing else belongs on
  // that screen). Scroll mode has no such exclusivity — every group renders
  // at once, the tail included — so it's gated on content alone.
  const showAlsoAvailableSteps = !isReviewCurrent && hasUnstepped;
  const showAlsoAvailable = variant === "scroll" ? hasUnstepped : showAlsoAvailableSteps;

  // PR18's Review stage: rows reflect the RENDERED model (renderedValues),
  // falling back to the live controls only when the caller hasn't wired a
  // distinct rendered snapshot (e.g. a test harness) — same fallback shape as
  // `baseline`/`changedParams` elsewhere in this file. Rebuilt Review card
  // (visual-alignment pass): essential-parameter rows + `@display` rows +
  // the dimension/`@info`/computed rows, in that order (reviewSummary.ts's
  // `buildReviewSummaryRows`).
  const reviewRows = buildReviewSummaryRows(design, renderedValues ?? values, measured, computedInfo, displayRows);
  // Guided workflow's own Review rows (curated `reviewLabels` summary,
  // honouring any `@review` rendered-value overrides, plus ONE overall
  // Dimensions row — never the @info/computed metric rows, `@display`, or an
  // invented colour row; see buildGuidedReviewRows' own doc). Only ever
  // computed for rendering when `workflow === "guided"` below, but built
  // unconditionally here (cheap — a handful of param lookups) so the render
  // branch doesn't need its own hook-order-sensitive early return.
  const guidedReviewRows = buildGuidedReviewRows(
    design,
    renderedValues ?? values,
    reviewLabels,
    measured,
    reviewOverrides
  );

  const goBack = () => {
    if (currentIndex > 0) select(stepOrder[currentIndex - 1], { focus: true });
  };
  const goNext = () => {
    if (currentIndex >= 0 && currentIndex < stepOrder.length - 1)
      select(stepOrder[currentIndex + 1], { focus: true });
  };
  // Guided Review's "Edit <stage>" links — steps mode only (guided never
  // uses scroll mode; see `workflow`'s own doc) — jump straight to any
  // declared step, mirroring a deliberate chip click.
  const onEditStep = (id: string) => select(id, { focus: true });

  // The per-STAGE "Show advanced settings" toggle (see `stageAdvancedSet`'s
  // own doc): whether the CURRENT step has any `@advanced` param at all (no
  // button when it doesn't — nothing to reveal), and the view ParamRows
  // should actually use for it — "all" only while this one step's own toggle
  // is on, never touching the app-wide `view` prop (which stays "essentials"
  // throughout). Applies whenever QuickStart itself is mounted — CustomizeTab
  // only ever mounts this component while its own `showQuickStart` is true
  // (see CustomizeTab.tsx), so there's no separate flag to gate on here:
  // tabs and guided workflow reach advanced settings identically. `workflow`
  // itself stays reserved for genuinely STRUCTURAL differences (the Review
  // screen variant, stage-only selection, `stepNav`, …).
  const currentStepInfo = stepAdvancedInfo(design, currentStep, stageAdvancedSet, view, autoRender, true);
  const currentStepHasAdvanced = currentStepInfo.hasAdvanced;
  const currentStepAdvancedOn = currentStepInfo.advancedOn;
  const currentStepView = currentStepInfo.view;

  const rowProps = {
    design,
    values,
    onChange,
    showVarName,
    availableFontFamilies,
    fontSuggestion,
    installedFonts,
    baseline,
    changedParams,
    presetName,
    view,
    focusParam: rowFocus,
    // Wave 2 (guided shell): every ParamRows mount below gets the adjacent
    // "Import font…" affordance (see ParamRows' own `guided` doc) whenever
    // this IS the guided workflow — independent of which step/variant is
    // showing.
    guided: workflow === "guided",
  };

  // F6: sectionsOf(design, names) is a pure function of design + a section
  // NAME list, so its result never actually needs to change unless design or
  // that name list changes — never on a plain value edit. Called inline (as
  // it used to be, right in the JSX below) it hands ParamRows — memo'd,
  // see its own import — a BRAND NEW `sections` array reference every single
  // render, which defeats that memo just as surely as never memoizing
  // ParamRows at all. Precomputed once per step here (keyed by step id, so
  // scroll mode's one-array-per-visible-step map stays a single object) and
  // reused by both variants below, so a render that doesn't change `design`
  // or `steps` hands ParamRows back the exact same array it got last time.
  const stepSectionGroups = useMemo(() => {
    const map = new Map<string, ParamSectionGroup[]>();
    for (const step of steps) map.set(step.id, sectionsOf(design, step.sections));
    return map;
  }, [design, steps]);
  // The "Also available" tail's groups (unstepped sections) — same
  // reasoning, reused by both variants' own tail rendering below. Only
  // depends on `design` (unsteppedSectionNames reads design.steps/sections,
  // not values).
  const unsteppedGroups = useMemo(
    () => sectionsOf(design, unsteppedSectionNames(design)),
    [design]
  );


  // PR22: jump straight to the Review chip/stage — the export dock's
  // attention line's "Review" action (see this component's own
  // `focusReviewSignal` doc). Mirrors the focusParam effect below (a fresh
  // nonce means "act now"), but always targets the Review sentinel rather
  // than resolving a param's owning step.
  // Round-2 review regression guard: this is deliberate navigation, exactly
  // like a chip click — mirror `onChipActivate`'s own choice of `selectScroll`
  // over a bare `scrollToGroup` in scroll mode, so the Review chip's
  // aria-current flips the instant this fires instead of waiting on the
  // IntersectionObserver to notice the (still-animating) smooth scroll has
  // landed. Previously used `scrollToGroup` directly, which scrolls/focuses
  // but never touches `currentId` — the chip stayed on whatever step was
  // current until scroll-spy eventually caught up.
  useSignal(focusReviewSignal, () => {
    if (variant === "scroll") selectScroll(REVIEW_STEP_ID);
    else select(REVIEW_STEP_ID, { focus: true });
  });

  // Scroll mode's chip/Review click and heading ref-callback factory —
  // extracted so the strip (shared markup below) doesn't repeat this per
  // button, and so a group's ref registration/cleanup stays in one place.
  const onChipActivate = (id: string) => (variant === "scroll" ? selectScroll(id) : select(id));
  const groupHeadingRef = (id: string) => (el: HTMLHeadingElement | null) => {
    if (el) groupRefs.current.set(id, el);
    else groupRefs.current.delete(id);
  };
  // scroll-mt used to clear the sticky strip's own height when it rendered
  // inline above the scrolled content; now that the strip is (in practice)
  // always hoisted out of the scroll container entirely (see `stripSlot`'s
  // own doc), a scrolled/focused heading no longer needs to clear anything —
  // kept small purely as breathing room from the panel's own top edge, not
  // strip clearance.
  const groupHeadingClass =
    "font-display mb-(--space-3) scroll-mt-2 text-[0.95rem] font-semibold text-foreground outline-none";

  // Extracted from the JSX below (not inlined) so it can either render in
  // its normal spot or, when `stripSlot` is provided (both variants now —
  // see `stripSlot`'s own doc), portal out to a DOM node CustomizeTab
  // positions above the toggle instead. A portal only changes WHERE in the
  // DOM this renders, never React's props/state reconciliation, so every
  // click handler/aria-current/visited-state binding below is identical
  // either way.
  // Wave 3 (mobile density): guided workflow's stage-nav row targets a
  // 48-56px tap strip (mockup density spec) — a touch taller than tabs
  // mode's existing 44px chip (`chipClass`'s own `min-h-11`), which stays
  // exactly as-is there. Handled purely in CSS now (src/index.css's
  // `.app-shell__mobile--guided .quick-start__step` rule, mobile-scoped),
  // not here — a JS-side `min-h-12` class applied regardless of layout used
  // to also enlarge desktop guided chips, which this component has no way
  // to know it's NOT mounted inside (that's AppShell's own responsive
  // layout choice).
  //
  // Round-6 Wave 2, item 1: `stage-navigation`/`stage-item` are ADDITIONAL
  // hook classes (the original `quick-start__strip`/`quick-start__step`
  // stay, byte-identical, for smoke.mjs's own structural assertions and for
  // every non-mobile-guided render, which never sees the new classes do
  // anything — see index.css's own `.app-shell__mobile--guided
  // .stage-navigation` rule for the actual grid layout, mobile-guided-only).
  // `--stage-count` (steps + the trailing Review chip) is set inline so that
  // CSS `repeat(var(--stage-count), …)` always matches the ACTUAL chip count
  // for whichever design is showing — not hardcoded to the 3-stage case the
  // mockup happens to show (a common case is 2 @step + Review = 3 stages),
  // so a design with more steps (e.g. this repo's own `tag` example, 4 @step
  // + Review) still gets equal, non-overflowing columns instead of a
  // 3-column grid that would silently drop or overlap its extra chips.
  const stripNav = (
    <nav
      className={cn(
        "quick-start__strip stage-navigation flex flex-nowrap items-center gap-0 overflow-x-auto",
        // Sticky only for the (now mostly hypothetical) inline-in-scroll-mode
        // fallback — see `stripSlot`'s own doc: once hoisted, the strip lives
        // outside the scroll container it used to stick above, so this
        // never actually applies in normal use.
        !stripSlot && variant === "scroll" && "sticky top-0 z-10 bg-background py-1"
      )}
      style={{ "--stage-count": steps.length + 1 } as React.CSSProperties}
      aria-label={t("quickstart.stepsAriaLabel")}
    >
      {steps.map((step, i) => {
        const isCurrent = step.id === effectiveCurrentId;
        return (
          <Fragment key={step.id}>
            <button
              type="button"
              className={cn(chipClass, "stage-item", isCurrent ? chipCurrent : chipInactive)}
              aria-current={isCurrent ? "step" : undefined}
              // Every stage label stays fully visible at every width (R9
              // directive — guided mobile's stage-nav no longer collapses or
              // truncates a label, see index.css's `.app-shell__mobile--
              // guided .stage-navigation`); `title` is just a normal hover/
              // long-press tooltip repeating the always-visible text.
              title={step.label}
              onClick={() => onChipActivate(step.id)}
            >
              <span
                aria-hidden="true"
                className={cn(stepNumberClass, isCurrent ? stepNumberCurrent : stepNumberInactive)}
              >
                {i + 1}
              </span>
              <span className="quick-start__step-label whitespace-nowrap">{step.label}</span>
              {visited.has(step.id) && <span className="sr-only"> — {t("quickstart.visited")}</span>}
            </button>
            <span aria-hidden="true" className={connectorClass} />
          </Fragment>
        );
      })}
      <button
        type="button"
        className={cn(chipClass, "stage-item", "quick-start__step--review", isReviewCurrent ? chipCurrent : chipInactive)}
        aria-current={isReviewCurrent ? "step" : undefined}
        // UX-plan 1.3: the attention dot below is colour-only + aria-hidden
        // — its sr-only text a few lines down already carries the meaning
        // for assistive tech; `title` gives sighted mouse/long-press users
        // the same "needs attention" signal on hover. Shown ONLY while a
        // real unresolved issue is pending (readiness === "attention"),
        // exactly like the dot itself.
        title={readiness === "attention" ? `${t("quickstart.review")} — ${t("checklist.attention")}` : t("quickstart.review")}
        onClick={() => onChipActivate(REVIEW_STEP_ID)}
      >
        <span
          aria-hidden="true"
          className={cn(stepNumberClass, isReviewCurrent ? stepNumberCurrent : stepNumberInactive)}
        >
          {steps.length + 1}
        </span>
        <span className="quick-start__step-label whitespace-nowrap">{t("quickstart.review")}</span>
        {readiness === "attention" && (
          <span aria-hidden="true" className="quick-start__step-attention size-[6px] shrink-0 rounded-full bg-warn" />
        )}
        {readiness === "attention" && <span className="sr-only"> — {t("checklist.attention")}</span>}
        {visited.has(REVIEW_STEP_ID) && <span className="sr-only"> — {t("quickstart.visited")}</span>}
      </button>
    </nav>
  );

  return (
    // Round-2 review fix (vertical rhythm): the outer gap between this
    // component's own top-level blocks (content/also/nav — the chip strip
    // is portaled out in normal operation, see `stripSlot`) is now
    // variant-specific. Steps mode (mobile) uses a slightly roomier ~20px —
    // no exact --space-* token lands there, so an arbitrary value is used
    // (matching the codebase's existing convention for values a token
    // doesn't cover, e.g. ParamRows' own gap-[0.35rem]) — while scroll mode
    // (desktop) keeps the tighter --space-3 it always had, since its own
    // step groups already carry their own --space-5 rhythm below.
    <div
      className={cn("quick-start flex flex-col", variant === "steps" ? "gap-[1.25rem]" : "gap-(--space-3)")}
      ref={wrapperRef}
    >
      {stripSlot ? createPortal(stripNav, stripSlot) : stripNav}

      {variant === "scroll" ? (
        // Desktop: every visible step's group renders at once — a scrollable
        // form, not a wizard — followed by the "Also available" tail and a
        // final Review section (readiness + summary + the Export pointer —
        // see ReviewContent above; the Export action itself
        // floats over the viewer, not part of this panel). Round-2 review fix:
        // gap-6 (32px) -> --space-5 (24px), matching the "panel sections
        // spaced ~24px" rhythm target.
        <div className="quick-start__scroll-content flex min-w-0 flex-col gap-(--space-5)">
          {steps.map((step) => {
            // Per-stage advanced model, generalized to scroll mode (every
            // step's group is mounted at once here, unlike steps mode's
            // single current step) — same `stepAdvancedInfo` steps mode calls
            // only for `currentStep` above, called per group instead. The
            // `showLivePreview` fallback for a heavy/paused design with no
            // reachable Advanced toggle anywhere is a GLOBAL condition, not a
            // per-stage one — unlike steps mode (only one step's content is
            // ever mounted), scroll mode mounts every step's group at once,
            // so `step === steps[0]` (this call's `isFirstStep`) keeps it to
            // exactly one control instead of one identical switch repeated
            // under every single step.
            const stepInfo = stepAdvancedInfo(design, step, stageAdvancedSet, view, autoRender, step === steps[0]);
            return (
              <section
                key={step.id}
                className="quick-start__group"
                aria-labelledby={`quick-start-heading-${step.id}`}
              >
                <h3
                  id={`quick-start-heading-${step.id}`}
                  data-step-group={step.id}
                  ref={groupHeadingRef(step.id)}
                  tabIndex={-1}
                  className={groupHeadingClass}
                >
                  {step.label}
                </h3>
                <ParamRows
                  {...rowProps}
                  view={stepInfo.view}
                  sections={stepSectionGroups.get(step.id) ?? []}
                  sectionChrome="flat"
                  // The step heading above already names a single-section step;
                  // only a step sharing several sections (see docs/
                  // annotations.md's "Sharing a step across sections") needs
                  // their own names repeated to tell the sub-groups apart.
                  showSectionHeadings={step.sections.length > 1}
                />
                {/* Same per-stage "Show/Hide advanced settings" toggle and
                    inline Live-preview control steps mode renders below its
                    own ParamRows — shared components, see their own docs. */}
                <AdvancedToggleButton
                  show={stepInfo.hasAdvanced}
                  on={stepInfo.advancedOn}
                  onClick={() => onToggleStageAdvanced?.(step.id)}
                />
                <StageLivePreview visible={stepInfo.showLivePreview} autoRender={autoRender} />
                {/* This step's own `@display` rows (src/lib/displayRows.ts) —
                    a read-only "generated automatically" preview surface,
                    after the step's own parameter controls. Renders nothing
                    before the first successful render, or for a step with no
                    `@display` rows at all. */}
                <DisplayRowsPanel rows={displayRowsForStep(displayRows, step.id)} />
              </section>
            );
          })}

          {showAlsoAvailable && (
            <div className="quick-start__also border-t pt-3">
              <div className="mb-1 text-[0.72rem] font-semibold tracking-wide text-muted-foreground uppercase">
                {t("quickstart.alsoAvailable")}
              </div>
              <ParamRows
                {...rowProps}
                sections={unsteppedGroups}
                sectionChrome="details"
              />
            </div>
          )}

          <div className="flex flex-col gap-1 border-t pt-3">
            <h3
              id={`quick-start-heading-${REVIEW_STEP_ID}`}
              data-step-group={REVIEW_STEP_ID}
              ref={groupHeadingRef(REVIEW_STEP_ID)}
              tabIndex={-1}
              className={groupHeadingClass}
            >
              {t("quickstart.review")}
            </h3>
            <ReviewContent
              readiness={readiness}
              attention={attention}
              onGoToSetting={onGoToSetting}
              onOpenMessages={onOpenMessages}
              rows={reviewRows}
              stale={reviewStale}
              canExport={canExport}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="quick-start__content min-w-0">
            {isReviewCurrent ? (
              workflow === "guided" ? (
                // Guided Review supplies its own heading/subtitle (see
                // GuidedReviewContent's own doc) — no separate "Review" h3
                // wrapper here, unlike tabs mode below. This div only exists
                // to give the step-change focus effect (`pendingFocusRef`) a
                // place to move focus to; headingRef is typed for the <h3>
                // the other two branches use it on, so cast through
                // `unknown` for this structurally different (but
                // behaviourally equivalent — only ever `.focus()`-ed)
                // element type.
                <div ref={headingRef as unknown as React.RefObject<HTMLDivElement>} tabIndex={-1} className="outline-none">
                  <GuidedReviewContent
                    readiness={readiness}
                    attention={attention}
                    onOpenMessages={onOpenMessages}
                    rows={guidedReviewRows}
                    reviewNote={reviewNote}
                    stale={reviewStale}
                    nonBlockingNoticeCount={nonBlockingNoticeCount}
                    allSteps={design.steps ?? []}
                    onEditStep={onEditStep}
                    pendingDownloadConfirm={pendingDownloadConfirm}
                    onDownloadAnyway={onDownloadAnyway}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <h3
                    ref={headingRef}
                    tabIndex={-1}
                    className="font-display text-[0.95rem] font-semibold text-foreground outline-none"
                  >
                    {t("quickstart.review")}
                  </h3>
                  <ReviewContent
                    readiness={readiness}
                    attention={attention}
                    onGoToSetting={onGoToSetting}
                    onOpenMessages={onOpenMessages}
                    rows={reviewRows}
                    stale={reviewStale}
                    canExport={canExport}
                  />
                </div>
              )
            ) : currentStep ? (
              <>
                <h3
                  ref={headingRef}
                  tabIndex={-1}
                  className="font-display mb-(--space-3) text-[0.95rem] font-semibold text-foreground outline-none"
                >
                  {currentStep.label}
                </h3>
                <ParamRows
                  {...rowProps}
                  view={currentStepView}
                  sections={stepSectionGroups.get(currentStep.id) ?? []}
                  sectionChrome="flat"
                  // The step heading above already names a single-section
                  // step; only a step sharing several sections (see docs/
                  // annotations.md's "Sharing a step across sections") needs
                  // their own names repeated to tell the sub-groups apart.
                  showSectionHeadings={currentStep.sections.length > 1}
                />
                <AdvancedToggleButton
                  show={currentStepHasAdvanced}
                  on={currentStepAdvancedOn}
                  onClick={() => onToggleStageAdvanced?.(currentStep.id)}
                />
                {/* Wave 1 (round-5): the standing Live-preview switch is gone
                    from guided mode's Content/Appearance footer (see
                    ParamPanel/SheetTabs — live preview just stays on by
                    default); its toggle now lives HERE instead, appearing
                    once this stage's own Advanced settings are revealed —
                    the "advanced settings area" the mockup scopes it to —
                    and never on Review (this whole branch is only reached
                    for a real step, never REVIEW_STEP_ID).
                    Round-5 review, functional item 9: that "only once
                    Advanced is open" gating left NO way to reach this
                    control at all for a `heavy: true` design (autoRender
                    defaults OFF) with no `@advanced` params anywhere — live
                    preview/manual-render would be permanently unreachable in
                    guided mode. So it ALSO shows whenever autoRender is
                    currently off (heavy/paused), regardless of the Advanced
                    toggle — the common light-design case (autoRender still
                    on, Advanced closed) is unaffected and keeps it hidden
                    from the standing footer as before. See `stepAdvancedInfo`
                    (src/lib/quickStart.ts) for the shared formula. */}
                <StageLivePreview visible={currentStepInfo.showLivePreview} autoRender={autoRender} />
                <DisplayRowsPanel rows={displayRowsForStep(displayRows, currentStep.id)} compact />
              </>
            ) : null}
          </div>

          {showAlsoAvailableSteps && (
            // Round-2 review fix (mobile vertical rhythm): border-t pt-3
            // (12px) -> pt-(--space-2) (8px) — this and the nav row below it
            // were the "excessive gaps" the review flagged; the outer
            // wrapper's own gap (see the `quick-start` div above) already
            // separates this block from its neighbours, so the padding here
            // only needs to clear the border, not add a second helping of
            // whitespace on top of it.
            <div className="quick-start__also border-t pt-(--space-2)">
              <div className="mb-1 text-[0.72rem] font-semibold tracking-wide text-muted-foreground uppercase">
                {t("quickstart.alsoAvailable")}
              </div>
              <ParamRows
                {...rowProps}
                sections={unsteppedGroups}
                sectionChrome="details"
              />
            </div>
          )}

          {/* Round-2 review fix: no `mt-1` (redundant with the outer
              wrapper's own gap, see above — the two together read as
              "excessive space above the Back/Next row") and pt-3 -> pt-2 for
              the same reason as the "Also available" tail's border above.
              First-step behavior (review: no disabled Back on the very first
              step): Back is omitted entirely rather than rendered disabled —
              a disabled control with nothing to explain why is worse than no
              control — and the lone forward action reads "Next: <next step>"
              (quickstart.nextStep) instead of the bare "Next", naming the
              destination up front since there's no "Back" alongside it to
              anchor the direction. justify-end (vs. the usual
              justify-between) keeps that lone button on the trailing edge
              where every other step's Next button already sits, rather than
              collapsing to the leading edge the way a single flex child in a
              space-between row otherwise would. */}
          {/* Guided workflow's desktop mount (ParamPanel) passes
              `stepNav={false}` — "no Back/Next on desktop" (chips are the
              only navigation there); mobile (SheetTabs, both workflows) and
              every tabs-mode caller leave `stepNav` at its default `true`. */}
          {stepNav && (
            <div
              className={cn(
                "quick-start__nav flex items-center gap-2 border-t pt-(--space-2)",
                currentIndex > 0 ? "justify-between" : "justify-end"
              )}
            >
              {currentIndex > 0 && (
                <Button type="button" variant="ghost" size="sm" className="quick-start__back" onClick={goBack}>
                  {t("quickstart.back")}
                </Button>
              )}
              {!isReviewCurrent && (
                <Button type="button" variant="default" size="sm" className="quick-start__next" onClick={goNext}>
                  {currentIndex === stepOrder.length - 2
                    ? t("quickstart.nextReview")
                    : currentIndex === 0 && steps[1]
                      ? t("quickstart.nextStep", { label: steps[1].label })
                      : t("quickstart.next")}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
