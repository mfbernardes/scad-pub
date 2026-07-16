// QuickStart.tsx — the guided step navigation shown INSTEAD of the classic
// scrolling form inside CustomizeTab, when ALL of: guided experience, the
// essentials settings view, the active design declares `@step`s, and config
// `ui.quickStart !== false` (see docs/annotations.md#guided-steps--step and
// docs/config.md's `ui.quickStart`). CustomizeTab owns that gate and the
// search-bypass (see its own comment); this component only renders the
// step strip + current step's content once mounted.
//
// NAVIGATION, NEVER A WIZARD: every param's value lives in the same App
// state regardless of which step is showing (ParamRows just renders a
// SUBSET of sections) — nothing here unmounts destructively, every step
// stays one click away via its chip, and the full form is always one click
// away via the settings-view toggle CustomizeTab renders above this.
//
// Visited/current state is SESSION-ONLY (component state, not a persisted
// pref) and resets to the first visible step on a design switch (compared
// by object identity, mirroring ParamRows' own design-identity reset).
import { useEffect, useRef, useState } from "react";
import { Download as ExportIcon } from "lucide-react";
import type { Design, ParamValue } from "../openscad/types";
import type { Values } from "../lib/presets";
import type { SettingsView } from "../lib/useExperience";
import type { InstalledFont } from "../lib/fonts";
import {
  EXPORT_STEP_ID,
  hasVisibleUnstepped,
  resolveCurrentStep,
  unsteppedSectionNames,
  visibleSteps,
  type QuickStartStep,
} from "../lib/quickStart";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { ParamRows, type FocusParamRequest, type ParamSectionGroup } from "./ParamRows";
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
   * Param names with an unresolved attention item (src/lib/readiness.ts) —
   * currently only font-fallbacks, since a flagged notice isn't tied to one
   * parameter. A step whose sections contain one of these gets a small
   * amber dot on its chip, so the same signal that drives the attention
   * chip also nudges a visitor toward the right step without them having to
   * open it first. Skipped when empty/omitted — no extra cost for a design
   * with nothing to flag.
   */
  attentionParams?: Set<string>;
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
  attentionParams,
}: Props) {
  const steps = visibleSteps(design, values, view);
  const stepOrder = [...steps.map((s) => s.id), EXPORT_STEP_ID];

  const [currentId, setCurrentId] = useState<string>(() => steps[0]?.id ?? EXPORT_STEP_ID);
  // "Visited" (sr-only text on the chip, see below), not "valid" or
  // "complete": there is no per-param validation system in this app (a
  // param's value is whatever the control last committed — there's no
  // notion of an invalid or unfilled OpenSCAD parameter), so "this step has
  // been shown at least once" is the only honest claim a chip can make.
  // Never treat this as "done" or gate anything on it.
  const [visited, setVisited] = useState<Set<string>>(() => new Set([currentId]));
  // Set true only by goBack/goNext, so the focus-move effect below fires for
  // deliberate navigation but never for a chip click (the browser already
  // moves focus to the clicked chip) or a reactive step-list change from a
  // value edit (which shouldn't steal focus from whatever the visitor is
  // still doing).
  const pendingFocusRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  // Reconcile `currentId` against the CURRENT render's steps, synchronously
  // during render (react.dev's "adjust state when a prop changes" pattern —
  // same idiom ParamRows uses for its own design-identity reset): a design
  // switch restarts at the first visible step with a fresh visited set; on
  // the same design, a value change that hid the current step falls back to
  // the nearest remaining one (or Export) via resolveCurrentStep.
  const lastDesignRef = useRef(design);
  const designChanged = lastDesignRef.current !== design;
  if (designChanged) lastDesignRef.current = design;
  const resolved = designChanged ? (steps[0]?.id ?? EXPORT_STEP_ID) : resolveCurrentStep(design, steps, currentId);
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
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    headingRef.current?.focus();
  }, [effectiveCurrentId]);

  const select = (id: string, opts: { focus?: boolean } = {}) => {
    pendingFocusRef.current = opts.focus === true;
    setCurrentId(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

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
  const [rowFocus, setRowFocus] = useState<FocusParamRequest | null>(null);
  const lastFocusNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!focusParam || focusParam.nonce === lastFocusNonce.current) return;
    lastFocusNonce.current = focusParam.nonce;
    const target = design.params.find((p) => p.name === focusParam.name);
    const step = target ? steps.find((s) => s.sections.includes(target.section)) : undefined;
    if (step && step.id !== effectiveCurrentId) select(step.id);
    setRowFocus(focusParam);
    // select/steps/effectiveCurrentId are recreated every render (steps
    // closes over design/values/view); depending on the nonce alone is
    // intentional — the effect always reads the latest closure when it fires,
    // matching CustomizeTab's own focusHiddenDiffSignal effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusParam]);

  const currentIndex = stepOrder.indexOf(effectiveCurrentId);
  const isExportCurrent = effectiveCurrentId === EXPORT_STEP_ID;
  const currentStep = steps.find((s) => s.id === effectiveCurrentId) ?? null;

  const showAlsoAvailable = !isExportCurrent && hasVisibleUnstepped(design, values, view);

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

  // Whether a step contains a param with an unresolved attention item — see
  // `attentionParams`' own doc.
  const stepNeedsAttention = (step: QuickStartStep) =>
    !!attentionParams?.size &&
    design.params.some((p) => step.sections.includes(p.section) && attentionParams.has(p.name));

  return (
    <div className="quick-start flex flex-col gap-3">
      <nav className="quick-start__strip flex flex-wrap gap-[0.4rem]" aria-label={t("quickstart.stepsAriaLabel")}>
        {steps.map((step, i) => {
          const isCurrent = step.id === effectiveCurrentId;
          const needsAttention = stepNeedsAttention(step);
          return (
            <button
              key={step.id}
              type="button"
              className={cn(chipClass, isCurrent ? chipCurrent : chipInactive)}
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => select(step.id)}
            >
              <span
                aria-hidden="true"
                className="quick-start__step-number inline-flex size-[1.1rem] shrink-0 items-center justify-center rounded-full bg-background/60 text-[0.7rem] font-semibold"
              >
                {i + 1}
              </span>
              {step.label}
              {needsAttention && (
                <span
                  aria-hidden="true"
                  className="quick-start__step-attention size-[6px] shrink-0 rounded-full bg-warn"
                />
              )}
              {needsAttention && <span className="sr-only"> — {t("checklist.attention")}</span>}
              {visited.has(step.id) && <span className="sr-only"> — {t("quickstart.visited")}</span>}
            </button>
          );
        })}
        <button
          type="button"
          className={cn(chipClass, "quick-start__step--export", isExportCurrent ? chipCurrent : chipInactive)}
          aria-current={isExportCurrent ? "step" : undefined}
          onClick={() => select(EXPORT_STEP_ID)}
        >
          <ExportIcon size={13} aria-hidden="true" />
          {t("quickstart.export")}
          {visited.has(EXPORT_STEP_ID) && <span className="sr-only"> — {t("quickstart.visited")}</span>}
        </button>
      </nav>

      <div className="quick-start__content min-w-0">
        {isExportCurrent ? (
          <div className="quick-start__export flex flex-col gap-1">
            <h3
              ref={headingRef}
              tabIndex={-1}
              className="font-display text-[0.95rem] font-semibold text-foreground outline-none"
            >
              {t("quickstart.exportHeading")}
            </h3>
            <p className="text-[0.85rem] text-muted-foreground">
              {t("quickstart.exportHint", { export: t("action.export") })}
            </p>
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
              sections={sectionsOf(design, currentStep.sections)}
              sectionChrome="flat"
              // The step heading above already names a single-section step;
              // only a step sharing several sections (see docs/
              // annotations.md's "Sharing a step across sections") needs
              // their own names repeated to tell the sub-groups apart.
              showSectionHeadings={currentStep.sections.length > 1}
            />
          </>
        ) : null}
      </div>

      {showAlsoAvailable && (
        <div className="quick-start__also border-t pt-3">
          <div className="mb-1 text-[0.72rem] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("quickstart.alsoAvailable")}
          </div>
          <ParamRows
            {...rowProps}
            sections={sectionsOf(design, unsteppedSectionNames(design))}
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
        {!isExportCurrent && (
          <Button type="button" variant="default" size="sm" className="quick-start__next" onClick={goNext}>
            {currentIndex === stepOrder.length - 2 ? t("quickstart.nextExport") : t("quickstart.next")}
          </Button>
        )}
      </div>
    </div>
  );
}
