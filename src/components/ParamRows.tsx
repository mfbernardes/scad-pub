// ParamRows.tsx — renders a given list of sections (name + that section's own,
// unfiltered params), one row per visible parameter. Extracted from
// ParamForm.tsx (which now just derives the full section list from a design
// and mounts this once) so a future caller — the guided-step milestone this
// sits under — can mount it directly against a SUBSET of a design's sections
// (e.g. just the active step's) and still get identical per-row behavior:
// controls by type, help popovers, @showIf/settings-view filtering (isShown),
// search matching, preset-diff markers + per-field revert, font
// availability hints, the SVG wizard affordance, the `data-param` hook,
// focusParam scroll/focus, and collapsed/<details> section chrome. Controls
// are shadcn/ui (Radix): Slider + Input for numbers, Switch for booleans,
// Select for enums, Input for strings. Every row also carries
// `data-param="<var>"` — the stable hook the smoke test (and extraCss)
// target now that variable names are hidden from users by default.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Info as InfoIcon, RotateCcw as RevertIcon, Upload as UploadIcon } from "lucide-react";
import type { Design, Param, ParamValue } from "../openscad/types";
import type { Values } from "../lib/presets";
import type { SettingsView } from "../lib/useExperience";
import { displayValue } from "../lib/paramDiff";
import { isShown, paramMatchesQuery } from "../lib/paramFilter";
import { familyOf, type InstalledFont } from "../lib/fonts";
import { fontFallback, isFontMissing } from "../lib/fontChoices";
import { makeRafThrottle, type RafThrottle } from "../lib/rafThrottle";
import { t } from "../lib/i18n";
import { FontImportActions } from "./FontImportActions";
import { FontSelect } from "./FontSelect";
import { SvgPrepareControl } from "./SvgPrepareControl";
import { Slider } from "./ui/slider";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

/** One section to render: its name and its OWN params, unfiltered — ParamRows
 *  applies `@showIf`/settings-view/search filtering itself (see `isShown` /
 *  `paramMatchesQuery` below), so a caller passing a narrower section subset
 *  gets identical filtering without re-implementing it. A section that ends
 *  up with no visible params after filtering renders nothing. */
export interface ParamSectionGroup {
  section: string;
  params: Param[];
}

interface Props {
  /** The full design, still needed for `collapsedSections` (the section-open
   *  default) and to resolve `focusParam`'s target across every param, even
   *  one outside the currently rendered `sections` subset. */
  design: Design;
  /** The sections to render, in order — see `ParamSectionGroup`. */
  sections: ParamSectionGroup[];
  values: Values;
  onChange: (name: string, value: ParamValue) => void;
  /** Optional search query to filter visible parameters by name/description. */
  search?: string;
  /** Show the underlying OpenSCAD variable name beside each label (default false). */
  showVarName?: boolean;
  /**
   * Normalised set of font families the renderer can use (bundled ∪ imported).
   * When provided and non-empty, a `font` parameter whose family isn't in it
   * shows an inline "not loaded" hint with import / fallback actions. Omitted or
   * empty → no font checking (we can't be authoritative, so we don't warn).
   */
  availableFontFamilies?: Set<string>;
  /** A bundled family offered as a one-click fallback for a missing font. */
  fontSuggestion?: string | null;
  /**
   * Every face the renderer can use right now (bundled ∪ imported), display-
   * ordered. When non-empty, a `font` parameter renders as the FontSelect
   * dropdown listing these under friendly names instead of a raw string/enum
   * control. Omitted or empty → the plain control (we can't be authoritative).
   */
  installedFonts?: InstalledFont[];
  /**
   * Tier-2 preset-diff markers: the values a drifted param is compared against
   * (the selected preset, or design defaults — see App.tsx/PresetDiffBar) and
   * the set of param names currently drifted from it. Both optional so the
   * form still works for a caller that doesn't wire up the diff (e.g. a future
   * standalone use); omitting either suppresses the markers entirely.
   */
  baseline?: Values;
  changedParams?: Set<string>;
  /** The selected preset's display name, used to name the revert target in the
   *  per-field revert button ("to <preset>" vs "to default" when none). */
  presetName?: string | null;
  /** Essentials/all settings-view: composed with `@showIf` visibility (see
   *  isShown) to decide which params render. Defaults to "all" (no
   *  filtering) so a caller that doesn't care about the view still compiles. */
  view?: SettingsView;
  /** Set (with a fresh `nonce` per request, so a repeat click on the same
   *  param retriggers) to open that param's section, scroll it into view and
   *  focus its control — the "hidden settings differ from defaults — Review"
   *  chip's target action. */
  focusParam?: FocusParamRequest | null;
  /**
   * Section chrome: "details" (default) is today's collapsible native
   * <details>/<summary> group, matching ParamForm's existing DOM exactly.
   * "flat" drops the collapse affordance entirely — a plain heading, params
   * always visible — for a future caller (a guided step's own section list)
   * that doesn't want another layer of foldable chrome on top of the step
   * navigation. Unused by ParamForm today.
   */
  sectionChrome?: "details" | "flat";
  /**
   * "flat" chrome only: whether each section's own name renders as a small
   * heading above its params (default true). QuickStart passes false for a
   * step with exactly one section — the step's own heading already names it,
   * so repeating the (often differently-worded) underlying section name
   * directly below reads as a confusing double heading rather than useful
   * structure. A step spanning several sections (see docs/annotations.md's
   * "Sharing a step across sections") still wants them, to tell the
   * sub-groups apart — so this stays true there. Ignored for "details"
   * chrome, whose <summary> IS the section name and can't be a duplicate.
   */
  showSectionHeadings?: boolean;
}

/** A request to reveal + focus one parameter's control — see `focusParam` above. */
export interface FocusParamRequest {
  name: string;
  nonce: number;
}

// Inline, non-alarming hint shown under a `font` control when the selected
// family isn't loaded. Offers the two actions that actually fix it: import the
// real font, or switch to an available bundled family — so availability is
// communicated immediately, without needing a render to find out.
function FontMissingHint({
  family,
  fallback,
  onUse,
}: {
  family: string;
  fallback: { value: string; label: string } | null;
  onUse: (next: string) => void;
}) {
  // The action links that actually fix a missing font (import it, or switch
  // to a loaded family).
  const actionBtn =
    "inline-flex cursor-pointer items-center gap-[0.3rem] border-none bg-transparent px-0 py-[2px] text-[0.82rem] font-semibold text-brand hover:underline focus-visible:rounded-[4px] focus-visible:outline-offset-2";
  return (
    <div
      className="font-missing mt-[0.1rem] flex flex-col gap-[0.4rem] rounded-(--radius-sm) border border-l-[3px] border-l-warn bg-muted px-[0.6rem] py-2"
      role="status"
    >
      <span className="text-[0.82rem] leading-[1.4] text-foreground">
        {t("params.fontMissing", { family })}
      </span>
      <FontImportActions
        renderImport={(open) => (
          <button type="button" className={actionBtn} onClick={open}>
            <UploadIcon size={13} aria-hidden="true" /> {t("params.importFont")}
          </button>
        )}
        renderFallback={
          fallback
            ? () => (
                <button type="button" className={actionBtn} onClick={() => onUse(fallback.value)}>
                  {t("params.useFallback", { label: fallback.label })}
                </button>
              )
            : undefined
        }
      />
    </div>
  );
}

// The value of a font selector whose family isn't loaded, else null. A font
// selector is a string or enum (dropdown) param flagged `isFont`. The actual
// "not loaded" predicate is fontChoices.ts's shared isFontMissing (also used
// by readiness.ts's deriveAttention), which already guards both an
// unauthoritative (empty/undefined) available set and an empty family value
// (a cleared field is not a missing font) — this just adapts it to a
// `Param`/`ParamValue` pair and returns the value for display rather than a
// bare boolean.
function missingFont(
  param: Param,
  value: ParamValue,
  available: Set<string> | undefined
): string | null {
  const isFontParam = (param.type === "string" || param.type === "enum") && param.isFont;
  if (!isFontParam) return null;
  const v = String(value ?? "");
  return isFontMissing(v, available) ? v : null;
}

// fontFallback (the one-click loaded-family replacement) now lives in
// src/lib/fontChoices.ts — shared with src/lib/readiness.ts's deriveAttention
// so the consolidated attention chip's "Use a bundled font" action can never
// disagree with this inline hint about what counts as a valid fallback.

function committedNumber(param: Extract<Param, { type: "number" }>, value: ParamValue): number {
  return typeof value === "number" && Number.isFinite(value) ? value : param.default;
}

function finiteDraft(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function clampNumber(param: Extract<Param, { type: "number" }>, value: number): number {
  let v = value;
  if (param.min !== undefined) v = Math.max(param.min, v);
  if (param.max !== undefined) v = Math.min(param.max, v);
  return v;
}

function NumberControl({
  param,
  value,
  label,
  onChange,
}: {
  param: Extract<Param, { type: "number" }>;
  value: ParamValue;
  label: string;
  onChange: (v: ParamValue) => void;
}) {
  const committed = committedNumber(param, value);
  const [draft, setDraft] = useState(String(committed));
  const hasRange = param.min !== undefined && param.max !== undefined;
  // While the input is focused, an external `committed` change (our own
  // clamped onChange echoing back through props) must NOT stomp the user's
  // in-progress keystrokes — e.g. typing "2" en route to "25" in a min=10
  // field commits (clamped) 10, and re-syncing the draft from that would
  // force the field back to "10" mid-type. Blur already normalises the draft,
  // and an external value change (e.g. a preset apply) while unfocused should
  // still resync immediately.
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) return;
    setDraft(String(committed));
  }, [committed]);

  // Slider drag throttle: Radix's `onValueChange` fires continuously while
  // dragging — often several times per animation frame — but every one of
  // those forwarding straight to `onChange` (which drives the 400ms render
  // debounce) is needless work for a value the user is still actively
  // adjusting. `draft` (the visible thumb position AND the numeric field)
  // still updates on EVERY tick below, so the drag itself never looks or
  // feels throttled; only the forward to `onChange` is capped at one per
  // frame, trailing-edge (the LAST value each frame always wins). Typing in
  // the numeric input below bypasses this entirely — see its own onChange.
  // A ref-stable throttle instance (not recreated per render) so an
  // in-flight frame survives an unrelated re-render; it always calls the
  // LATEST `onChange` closure via `onChangeRef`, mirroring the
  // latest-callback idiom useRafBatchedWrite/useSignal already use elsewhere.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const throttleRef = useRef<RafThrottle<number> | null>(null);
  if (!throttleRef.current) {
    throttleRef.current = makeRafThrottle<number>((v) => onChangeRef.current(v));
  }
  useEffect(() => () => throttleRef.current?.cancel(), []);

  const clampToDraft = (n: number) => {
    const v = clampNumber(param, n);
    setDraft(String(v));
    return v;
  };

  return (
    <div className="flex items-center gap-2">
      {hasRange && (
        <Slider
          className="flex-1"
          min={param.min}
          max={param.max}
          step={param.step ?? 1}
          value={[committed]}
          onValueChange={([v]) => throttleRef.current!.call(clampToDraft(v))}
          // Guarantees the final dragged/clicked value always lands, even if
          // it was still buffered in an unfired frame the instant the
          // pointer released (flush cancels that pending frame and forwards
          // this value immediately instead).
          onValueCommit={([v]) => throttleRef.current!.flush(clampToDraft(v))}
          aria-label={label}
        />
      )}
      <Input
        type="number"
        name={param.name}
        autoComplete="off"
        className="w-20"
        min={param.min}
        max={param.max}
        step={param.step ?? "any"}
        value={draft}
        aria-label={label}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const n = finiteDraft(raw);
          if (n !== null) onChange(clampNumber(param, n));
        }}
        // Clamp on commit so intermediate keystrokes stay typeable, and
        // normalise the draft text itself (e.g. a raw value beyond the range).
        onBlur={() => {
          focusedRef.current = false;
          const v = clampNumber(param, finiteDraft(draft) ?? param.default);
          setDraft(String(v));
          if (v !== committed) onChange(v);
        }}
      />
    </div>
  );
}

function Control({
  param,
  value,
  label,
  onChange,
  installedFonts,
}: {
  param: Param;
  value: ParamValue;
  label: string;
  onChange: (v: ParamValue) => void;
  installedFonts?: InstalledFont[];
}) {
  // A font parameter (string or enum flagged `isFont`) becomes the friendly
  // FontSelect dropdown whenever we authoritatively know what's installed —
  // listing real faces by name instead of raw Fontconfig strings.
  if ((param.type === "string" || param.type === "enum") && param.isFont && installedFonts?.length)
    return (
      <FontSelect
        param={param}
        value={String(value ?? "")}
        label={label}
        onChange={onChange}
        fonts={installedFonts}
      />
    );
  // An `@svg` string field becomes a "Prepare SVG…" affordance that opens the
  // in-app wizard (check / fix / colour derivation) instead of a raw path box.
  if (param.type === "string" && param.svg)
    return (
      <SvgPrepareControl
        name={param.name}
        svg={param.svg}
        value={String(value ?? "")}
        label={label}
        onChange={onChange}
      />
    );
  switch (param.type) {
    case "number":
      return <NumberControl param={param} value={value} label={label} onChange={onChange} />;
    case "boolean":
      // A switch, not a checkbox: parameter changes apply immediately (live
      // preview), and a switch reads as "turn this feature on/off" to a
      // non-technical user.
      return (
        <Switch
          checked={Boolean(value)}
          onCheckedChange={(v) => onChange(v === true)}
          aria-label={label}
        />
      );
    case "enum":
      return (
        <Select value={String(value)} onValueChange={(v) => onChange(v)}>
          <SelectTrigger className="w-full" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {param.choices.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "string":
      return (
        <Input
          type="text"
          name={param.name}
          autoComplete="off"
          value={String(value)}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

// Surfaces a parameter's full help text in a tap/click popover next to its
// label. The detail was previously reachable only through the hover-only
// `title` tooltip, which is invisible on touch devices.
function ParamHelp({ help, label }: { help: string; label: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* 15px glyph with a >=24px tap target (WCAG 2.2): the negative margin
            absorbs the padding so the row layout is unchanged. */}
        <button
          type="button"
          // param-help-trigger: excluded from the focusParam effect's control
          // query below — it renders before the actual control in DOM order
          // (the label line comes first), so an unqualified query would focus
          // this info popover instead of the control it's meant to reveal.
          className="param-help-trigger -m-[5px] inline-flex shrink-0 cursor-pointer items-center justify-center self-center rounded-[4px] border-none bg-transparent p-[5px] leading-[0] text-muted-foreground hover:text-brand focus-visible:text-brand focus-visible:outline-offset-1 [&_svg]:h-[15px] [&_svg]:w-[15px]"
          aria-label={t("params.helpForAria", { label })}
        >
          <InfoIcon aria-hidden="true" focusable="false" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 max-w-[80vw] p-3 text-sm leading-[1.45] text-foreground [overflow-wrap:anywhere]"
      >
        {help}
      </PopoverContent>
    </Popover>
  );
}

export const ParamRows = memo(function ParamRows({
  design,
  sections,
  values,
  onChange,
  search = "",
  showVarName = false,
  availableFontFamilies,
  fontSuggestion,
  installedFonts,
  baseline,
  changedParams,
  presetName,
  view = "all",
  focusParam,
  sectionChrome = "details",
  showSectionHeadings = true,
}: Props) {
  const q = search.toLowerCase();
  // Apply @showIf/settings-view visibility and the search query to each
  // section's own params, then drop a section that ends up with none visible.
  // Match the variable name, the label, and the full help text, so a term
  // that only appears in the detail (surfaced via the info popover) is still
  // findable. Recomputed only when the input sections, values, view or query
  // change — not on every unrelated render (e.g. a sibling re-render).
  const groups = useMemo(() => {
    return sections
      .map(({ section, params }) => ({
        section,
        params: params.filter((p) => isShown(p, values, view) && paramMatchesQuery(p, q)),
      }))
      .filter((g) => g.params.length > 0);
  }, [sections, values, view, q]);

  // Per-section open/closed state, controlled in React so a search can force a
  // folded group open without losing the user's manual fold/unfold of an
  // @collapsed (or plain) group — <details>'s `open` attribute is otherwise
  // native DOM state React never observes, so a search-forced re-render used to
  // stomp it back to the design's static @collapsed default. Re-derived whenever
  // the design changes (a different design's section names shouldn't inherit
  // this one's open/closed choices). Only meaningful for "details" chrome.
  const collapsedDefault = useMemo(
    () => new Set(design.collapsedSections ?? []),
    [design]
  );
  const initOpenSections = (secs: ParamSectionGroup[], defaultClosed: Set<string>) => {
    const init: Record<string, boolean> = {};
    for (const { section } of secs) init[section] = !defaultClosed.has(section);
    return init;
  };
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    initOpenSections(sections, collapsedDefault)
  );
  // Re-derive whenever `design` changes, during render rather than in an
  // effect (the documented "adjusting state when a prop changes" pattern) —
  // this is a synchronous reset of state fully derived from `design`, not a
  // side effect on an external system.
  const lastOpenSectionsDesign = useRef(design);
  if (lastOpenSectionsDesign.current !== design) {
    lastOpenSectionsDesign.current = design;
    setOpenSections(initOpenSections(sections, collapsedDefault));
  }

  // The "hidden settings differ from defaults — Review" chip's target action:
  // reveal one param's control. Runs only once per `nonce` (a fresh request
  // even for the same param re-clicked), so it doesn't refire on every
  // unrelated render while `focusParam` is still set. Opens the param's
  // section first (it may be `@collapsed`, independent of the essentials/all
  // switch that made the param itself visible), then waits a frame for that
  // — and any settingsView switch the caller made in the same click — to
  // commit and paint before querying the DOM for the now-real row/control.
  const lastFocusNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!focusParam || focusParam.nonce === lastFocusNonce.current) return;
    lastFocusNonce.current = focusParam.nonce;
    const target = design.params.find((p) => p.name === focusParam.name);
    if (target && sectionChrome === "details")
      setOpenSections((prev) => ({ ...prev, [target.section]: true }));
    const raf = requestAnimationFrame(() => {
      const row = document.querySelector(`[data-param="${CSS.escape(focusParam.name)}"]`);
      // Excludes .param-help-trigger: the info popover button (when the
      // param has extra help text) renders before the actual control in DOM
      // order — an unqualified query would land focus there instead.
      const control = row?.querySelector<HTMLElement>(
        'input, select, textarea, [role="switch"], button:not(.param-help-trigger)'
      );
      const el = (control ?? row) as HTMLElement | null;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [focusParam, design, sectionChrome]);

  // One parameter's row: label + help popover + control, preset-diff marker
  // and revert, and the missing-font hint. Shared verbatim between the
  // "details" and "flat" section chrome below.
  const renderRow = (p: Param) => {
    const label = p.description || p.name;
    // `help` is the full comment block; its first sentence is the
    // label, so only offer the popover when it carries extra detail.
    const hasHelp = Boolean(p.help) && p.help !== label;
    const value = values[p.name];
    const missingFontValue = missingFont(p, value, availableFontFamilies);
    // Toggles ride the label row (label left, switch right) — a
    // control row below would leave a stranded switch.
    const isToggle = p.type === "boolean";
    // Tier-2 preset-diff marker (see PresetDiffBar for Tier 1): this
    // param's value differs from the baseline (selected preset, or
    // design defaults). Neutral/slate — never the warn colour.
    const isDrifted = Boolean(baseline && changedParams?.has(p.name));
    const control = (
      <Control
        param={p}
        value={value}
        label={label}
        onChange={(v) => onChange(p.name, v)}
        installedFonts={installedFonts}
      />
    );
    const body = (
      <>
        <span className={`flex ${isToggle ? "items-center" : "items-baseline"} justify-between gap-2`}>
          {/* Label + optional info button together on the left so the
              right edge is free for the toggle / var-name code. */}
          <span className="flex min-w-0 items-baseline gap-[0.3rem]">
            {isDrifted && (
              <span
                className="param-drift-dot size-[6px] shrink-0 self-center rounded-full bg-muted-foreground"
                aria-hidden="true"
              />
            )}
            <span className="text-foreground">{label}</span>
            {hasHelp && <ParamHelp help={p.help} label={label} />}
            {showVarName && p.description && (
              <code className="param-var shrink-0 font-mono text-[11px] leading-[normal] text-muted-foreground">
                {p.name}
              </code>
            )}
          </span>
          {isToggle && control}
        </span>
        {!isToggle && control}
        {isDrifted && baseline && (
          <span className="param-drift flex items-center gap-[0.4rem] text-[0.78rem] text-muted-foreground">
            <span className="line-through">{t("params.wasValue", { value: displayValue(p, baseline[p.name]) })}</span>
            <button
              type="button"
              className="param-drift-revert -m-[3px] inline-flex shrink-0 cursor-pointer items-center rounded-[4px] border-none bg-transparent p-[3px] leading-[0] text-muted-foreground hover:text-brand focus-visible:text-brand focus-visible:outline-offset-1"
              aria-label={t("params.revertFieldAria", { label, target: presetName ?? t("params.defaultTarget") })}
              title={t("params.revertFieldTitle", { target: presetName ?? t("params.defaultTarget") })}
              onClick={() => onChange(p.name, baseline[p.name])}
            >
              <RevertIcon size={12} aria-hidden="true" />
            </button>
          </span>
        )}
        {missingFontValue !== null && (
          <FontMissingHint
            family={familyOf(missingFontValue)}
            fallback={fontFallback(p, missingFontValue, availableFontFamilies, fontSuggestion)}
            onUse={(next) => onChange(p.name, next)}
          />
        )}
      </>
    );
    // The `.param`/`data-param` row hook stays on the outer element for
    // every param (smoke harness + extraCss target it). A `@filledBy`
    // param is normally written by the SVG wizard, so its content rides
    // an inner "Advanced" disclosure — demoted, but still hand-editable.
    return (
      <div className="param my-3 flex flex-col gap-[0.35rem]" key={p.name} data-param={p.name}>
        {p.filledBy ? (
          <details className="param-advanced">
            <summary className="flex cursor-pointer select-none list-none items-center gap-[0.3rem] text-[0.82rem] text-muted-foreground focus-visible:rounded-[4px]">
              {t("params.advancedPrefix", { label })}
            </summary>
            <div className="mt-2 flex flex-col gap-[0.35rem]">{body}</div>
          </details>
        ) : (
          body
        )}
      </div>
    );
  };

  return (
    <div className="param-form">
      {groups.length === 0 && (
        <p className="px-1 py-5 text-center text-[0.9rem] text-muted-foreground">
          {q ? t("params.noMatch", { search }) : t("params.nothingToCustomize")}
        </p>
      )}
      {groups.map(({ section, params }) => {
        if (sectionChrome === "flat") {
          // Minimal, non-collapsible chrome for a future subset caller (a
          // guided step's own section list) that already has its own
          // navigation — no <details> fold on top of it, params always shown.
          return (
            <div className="param-group param-group--flat mb-3" key={section}>
              {showSectionHeadings && (
                <div className="font-display px-[0.2rem] py-[0.6rem] text-[0.92rem] font-semibold text-brand">
                  {section}
                </div>
              )}
              {params.map(renderRow)}
            </div>
          );
        }
        const isOpen = openSections[section] ?? !collapsedDefault.has(section);
        return (
          <details
            className="param-group mb-3 rounded-lg border bg-background/50 px-[0.8rem] open:pb-2"
            key={section}
            open={q ? true : isOpen}
            onToggle={(e) => {
              // A search forces every matching group open without being a user
              // choice — don't persist it, so clearing the search restores
              // whatever the user had before searching.
              if (q) return;
              const next = (e.target as HTMLDetailsElement).open;
              // Guard against feedback loops: only write when the DOM's actual
              // state differs from what we already have (also fires when React
              // itself flips `open`, e.g. the forced-open-by-search handoff).
              setOpenSections((prev) => (prev[section] === next ? prev : { ...prev, [section]: next }));
            }}
          >
            <summary className="font-display flex cursor-pointer select-none list-none items-center px-[0.2rem] py-[0.6rem] text-[0.92rem] font-semibold text-brand focus-visible:rounded-[4px]">
              {section}
            </summary>
            {params.map(renderRow)}
          </details>
        );
      })}
    </div>
  );
});
