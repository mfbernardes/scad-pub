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
// can never disagree), a "Front view" button, and — unchanged — the pointer
// at the Export action itself. Renders identically in both variants (see
// ReviewContent below), mounted at the END of the scroll flow in scroll mode
// and as the terminal step's content in steps mode, exactly where the old
// Export section sat.
import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck as ReviewIcon, Upload as UploadIcon } from "lucide-react";
import type { Design, ParamValue } from "../openscad/types";
import type { Values } from "../lib/presets";
import type { SettingsView } from "../lib/useExperience";
import type { InstalledFont } from "../lib/fonts";
import { familyOf } from "../lib/fonts";
import type { AttentionItem, FontFallbackItem, ReadinessState } from "../lib/readiness";
import type { Dimensions } from "./Viewer";
import type { ComputedInfo } from "../lib/computedInfo";
import type { ViewName } from "./views";
import {
  REVIEW_STEP_ID,
  currentStepFromIntersections,
  hasVisibleUnstepped,
  resolveCurrentStep,
  unsteppedSectionNames,
  visibleSteps,
} from "../lib/quickStart";
import { buildReviewRows, readinessDotClass, readinessLabel, readinessPulse } from "../lib/reviewSummary";
import { useAppActions } from "../lib/appActions";
import { useSignal } from "../lib/useSignal";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { ParamRows, type FocusParamRequest, type ParamSectionGroup } from "./ParamRows";
import { AttentionItems } from "./AttentionItems";
import { FileInput } from "./FileInput";
import { Button } from "./ui/button";

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
  /** Whether the summary's figures are stale (src/lib/renderState.ts's
   *  isMeasurementStale) — the same dim+italic treatment DimensionInfo gives
   *  an out-of-date preview. */
  reviewStale?: boolean;
  /** Snap the active viewer to a standard camera view — the Review stage's
   *  "Front view" button. `setView` is an instant camera jump (Viewer.tsx's
   *  frameView), not an animation, so there's no prefers-reduced-motion
   *  concern here (unlike the scroll-mode chip navigation above). */
  onSelectView?: (view: ViewName) => void;
}

// F7: stable identities for QuickStart/ReviewContent's non-primitive default
// props — mirrors AppShell's own EMPTY_LOG precedent. An inline `= []` /
// `= () => {}` default literal is re-created fresh on every render a caller
// omits the prop, which (a) is wasted allocation and (b) would defeat a
// memo'd child's shallow-prop-equality check the moment one of these values
// flows into its props (as `attention` does into AttentionItems below).
const EMPTY_ATTENTION_ITEMS: AttentionItem[] = [];
const EMPTY_COMPUTED_INFO: ComputedInfo[] = [];
const NOOP = () => {};

// The Review-stage badge/action row family — a compact, muted card matching
// the attention chip strip's own visual language (bg-muted, small text) but
// scoped to this card rather than CustomizeTab's stable `.attention-chip`
// hooks, so the two can coexist on screen at once in scroll mode (every
// step's group — including this trailing one — mounts simultaneously) without
// colliding on the same class the smoke suite counts elsewhere.
const reviewAttentionItemClass = "flex items-start gap-[0.4rem] text-[0.8rem] text-foreground";
const reviewAttentionActionClass =
  "inline-flex shrink-0 cursor-pointer items-center rounded-(--radius-sm) border-none bg-transparent p-0 font-medium text-brand hover:underline focus-visible:outline-offset-2";

// PR22 item 3: a dedicated "Font status" row above the Review stage's own
// warning list — always present when the design has at least one `@font`
// param (skipped entirely otherwise, since there's nothing to report either
// way). Two states: a substitute in use (mirrors the export dock/attention
// chip's own two actions — Import font…, reusing the exact FileInput +
// addFile affordance FontMissingHint/FileBar's font card already use, and
// Use a bundled font, via the AppActions `change` these share), or — clean —
// just the currently-selected family, informational only.
function FontStatusRow({
  hasFontParams,
  family,
  fallbackItem,
}: {
  hasFontParams: boolean;
  family: string | null;
  fallbackItem: FontFallbackItem | null;
}) {
  const { addFile, change } = useAppActions();
  if (!hasFontParams) return null;
  if (fallbackItem) {
    return (
      <div
        className="quick-start__review-font flex flex-col gap-[0.4rem] rounded-(--radius-sm) border border-(color:--glass-border) bg-muted/60 p-2 text-[0.8rem] text-foreground"
        role="status"
      >
        <span className="font-medium">{t("quickstart.fontStatusSubstitute")}</span>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <FileInput
            accept=".ttf,.otf,.ttc"
            onFile={async (file) => addFile(file.name, new Uint8Array(await file.arrayBuffer()))}
          >
            {(open) => (
              <button type="button" className={reviewAttentionActionClass} onClick={open}>
                <UploadIcon size={13} aria-hidden="true" /> {t("params.importFont")}
              </button>
            )}
          </FileInput>
          {fallbackItem.fallback && (
            <button
              type="button"
              className={reviewAttentionActionClass}
              onClick={() => change(fallbackItem.param, fallbackItem.fallback!.value)}
            >
              {t("attention.useBundledFont")}
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <p className="quick-start__review-font m-0 text-[0.8rem] text-muted-foreground">
      {t("quickstart.fontStatusOk", { family: family ?? "" })}
    </p>
  );
}

/**
 * The Review stage's own content — a readiness line, the font status row
 * (PR22 item 3), the "what will actually be produced" summary (src/lib/
 * reviewSummary.ts, the same rows DimensionInfo shows), a "Front view"
 * button, and the (unchanged) pointer at the Export action. Identical markup
 * in both variants — only where it's mounted (scroll mode's trailing section
 * vs. steps mode's terminal step) differs — so it's factored out rather than
 * written twice.
 */
function ReviewContent({
  readiness = "building",
  attention = EMPTY_ATTENTION_ITEMS,
  onGoToSetting = NOOP,
  onOpenMessages,
  rows,
  stale = false,
  onSelectView,
  hasFontParams = false,
  fontFamily = null,
  fontFallbackItem = null,
}: {
  readiness?: ReadinessState;
  attention?: AttentionItem[];
  onGoToSetting?: (name: string) => void;
  onOpenMessages?: () => void;
  rows: ReturnType<typeof buildReviewRows>;
  stale?: boolean;
  onSelectView?: (view: ViewName) => void;
  hasFontParams?: boolean;
  fontFamily?: string | null;
  fontFallbackItem?: FontFallbackItem | null;
}) {
  return (
    <div className="quick-start__review flex flex-col gap-3">
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
      <FontStatusRow hasFontParams={hasFontParams} family={fontFamily} fallbackItem={fontFallbackItem} />
      {readiness === "attention" && (
        <AttentionItems
          attention={attention}
          onGoToSetting={onGoToSetting}
          onOpenMessages={onOpenMessages}
          className="quick-start__review-attention flex flex-col gap-[0.35rem] rounded-(--radius-sm) border border-(color:--glass-border) bg-muted/60 p-2"
          itemClassName={reviewAttentionItemClass}
          actionClassName={reviewAttentionActionClass}
        />
      )}
      {rows.length > 0 && (
        <dl
          className={cn(
            "quick-start__review-summary m-0 flex flex-col gap-[0.3rem] text-[0.85rem]",
            stale && "italic opacity-70"
          )}
          aria-label={t("dimensions.aria")}
        >
          {rows.map((r) => (
            <div
              key={r.key}
              className={cn(
                "flex items-baseline justify-between gap-3",
                r.headline ? "font-semibold text-foreground" : "text-muted-foreground"
              )}
            >
              <dt>{r.label}</dt>
              <dd className="m-0 text-right text-foreground tabular-nums break-words">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="quick-start__review-front-view self-start"
        onClick={() => onSelectView?.("front")}
      >
        {t("quickstart.frontView")}
      </Button>
      <p className="quick-start__review-export-hint text-[0.85rem] text-muted-foreground">
        {t("quickstart.exportHint", { export: t("action.export") })}
      </p>
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

const chipClass =
  "quick-start__step inline-flex shrink-0 cursor-pointer items-center gap-[0.35rem] rounded-full border px-3 py-[0.35rem] text-[0.8rem] font-medium transition-[color,background-color,border-color] focus-visible:outline-offset-2";
const chipInactive = "border-transparent bg-muted text-muted-foreground hover:text-foreground";
const chipCurrent = "quick-start__step--current border-(color:--line) bg-secondary text-brand";

function sectionsOf(design: Design, names: string[]): ParamSectionGroup[] {
  return names.map((section) => ({ section, params: design.params.filter((p) => p.section === section) }));
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
  reviewStale = false,
  onSelectView,
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
  const steps = useMemo(() => visibleSteps(design, values, view), [design, values, view]);
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

  useEffect(() => {
    if (variant !== "steps") return;
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    headingRef.current?.focus();
  }, [effectiveCurrentId, variant]);

  // Steps mode's chip/Back/Next navigation: swaps which step's ParamRows is
  // mounted (see `currentStep` below), immediately marking it current+visited.
  const select = (id: string, opts: { focus?: boolean } = {}) => {
    pendingFocusRef.current = opts.focus === true;
    setCurrentId(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
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
  // `baseline`/`changedParams` elsewhere in this file.
  const reviewRows = buildReviewRows(design, renderedValues ?? values, measured, computedInfo);

  const goBack = () => {
    if (currentIndex > 0) select(stepOrder[currentIndex - 1], { focus: true });
  };
  const goNext = () => {
    if (currentIndex >= 0 && currentIndex < stepOrder.length - 1)
      select(stepOrder[currentIndex + 1], { focus: true });
  };

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

  // PR22's Review-stage "Font status" row (item 3): the font-fallback
  // attention item, if any (there's at most one per param, but a design with
  // several font params could in principle have more — the row leads with
  // the first, mirroring the export dock's own summary). `hasFontParams`
  // gates the row's clean-state text entirely: a design with no `@font`
  // params has nothing to report either way. `currentFontFamily` reads the
  // FIRST font param's live value — the family shown when nothing's missing.
  const fontFallbackItem = useMemo(
    () =>
      (attention.find(
        (a): a is FontFallbackItem => a.kind === "font-fallback"
      ) ?? null),
    [attention]
  );
  const firstFontParam = useMemo(
    () => design.params.find((p) => (p.type === "string" || p.type === "enum") && p.isFont) ?? null,
    [design]
  );
  const currentFontFamily = firstFontParam ? familyOf(String(values[firstFontParam.name] ?? "")) : null;

  // PR22: jump straight to the Review chip/stage — the export dock's
  // attention line's "Review" action (see this component's own
  // `focusReviewSignal` doc). Mirrors the focusParam effect below (a fresh
  // nonce means "act now"), but always targets the Review sentinel rather
  // than resolving a param's owning step.
  useSignal(focusReviewSignal, () => {
    if (variant === "scroll") scrollToGroup(REVIEW_STEP_ID);
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
  // scroll-mt matches the sticky strip's own height so a scrolled/focused
  // heading lands fully below it, not partly hidden underneath.
  const groupHeadingClass =
    "font-display mb-1 scroll-mt-14 text-[0.95rem] font-semibold text-foreground outline-none";

  return (
    <div className="quick-start flex flex-col gap-3" ref={wrapperRef}>
      <nav
        className={cn(
          "quick-start__strip flex flex-wrap gap-[0.4rem]",
          // Sticky only in scroll mode — steps mode has no internal scroll of
          // its own to stick above (Back/Next replaces one step's content
          // wholesale, so the strip never scrolls out of view to begin with).
          variant === "scroll" && "sticky top-0 z-10 bg-background py-1"
        )}
        aria-label={t("quickstart.stepsAriaLabel")}
      >
        {steps.map((step, i) => {
          const isCurrent = step.id === effectiveCurrentId;
          return (
            <button
              key={step.id}
              type="button"
              className={cn(chipClass, isCurrent ? chipCurrent : chipInactive)}
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => onChipActivate(step.id)}
            >
              <span
                aria-hidden="true"
                className="quick-start__step-number inline-flex size-[1.1rem] shrink-0 items-center justify-center rounded-full bg-background/60 text-[0.7rem] font-semibold"
              >
                {i + 1}
              </span>
              {step.label}
              {visited.has(step.id) && <span className="sr-only"> — {t("quickstart.visited")}</span>}
            </button>
          );
        })}
        <button
          type="button"
          className={cn(chipClass, "quick-start__step--review", isReviewCurrent ? chipCurrent : chipInactive)}
          aria-current={isReviewCurrent ? "step" : undefined}
          onClick={() => onChipActivate(REVIEW_STEP_ID)}
        >
          <ReviewIcon size={13} aria-hidden="true" />
          {t("quickstart.review")}
          {readiness === "attention" && (
            <span aria-hidden="true" className="quick-start__step-attention size-[6px] shrink-0 rounded-full bg-warn" />
          )}
          {readiness === "attention" && <span className="sr-only"> — {t("checklist.attention")}</span>}
          {visited.has(REVIEW_STEP_ID) && <span className="sr-only"> — {t("quickstart.visited")}</span>}
        </button>
      </nav>

      {variant === "scroll" ? (
        // Desktop: every visible step's group renders at once — a scrollable
        // form, not a wizard — followed by the "Also available" tail and a
        // final Review section (readiness + summary + front view + the
        // Export pointer — see ReviewContent above; the Export action itself
        // floats over the viewer, not part of this panel).
        <div className="quick-start__scroll-content flex min-w-0 flex-col gap-6">
          {steps.map((step) => (
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
                sections={stepSectionGroups.get(step.id) ?? []}
                sectionChrome="flat"
                // The step heading above already names a single-section step;
                // only a step sharing several sections (see docs/
                // annotations.md's "Sharing a step across sections") needs
                // their own names repeated to tell the sub-groups apart.
                showSectionHeadings={step.sections.length > 1}
              />
            </section>
          ))}

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
              onSelectView={onSelectView}
              hasFontParams={!!firstFontParam}
              fontFamily={currentFontFamily}
              fontFallbackItem={fontFallbackItem}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="quick-start__content min-w-0">
            {isReviewCurrent ? (
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
                  onSelectView={onSelectView}
                  hasFontParams={!!firstFontParam}
                  fontFamily={currentFontFamily}
                  fontFallbackItem={fontFallbackItem}
                />
              </div>
            ) : currentStep ? (
              <>
                <h3
                  ref={headingRef}
                  tabIndex={-1}
                  className="font-display mb-1 text-[0.95rem] font-semibold text-foreground outline-none"
                >
                  {currentStep.label}
                </h3>
                <ParamRows
                  {...rowProps}
                  sections={stepSectionGroups.get(currentStep.id) ?? []}
                  sectionChrome="flat"
                  // The step heading above already names a single-section
                  // step; only a step sharing several sections (see docs/
                  // annotations.md's "Sharing a step across sections") needs
                  // their own names repeated to tell the sub-groups apart.
                  showSectionHeadings={currentStep.sections.length > 1}
                />
              </>
            ) : null}
          </div>

          {showAlsoAvailableSteps && (
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

          <div className="quick-start__nav mt-1 flex items-center justify-between gap-2 border-t pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="quick-start__back"
              onClick={goBack}
              disabled={currentIndex <= 0}
            >
              {t("quickstart.back")}
            </Button>
            {!isReviewCurrent && (
              <Button type="button" variant="default" size="sm" className="quick-start__next" onClick={goNext}>
                {currentIndex === stepOrder.length - 2 ? t("quickstart.nextReview") : t("quickstart.next")}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
