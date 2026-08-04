// ParamForm.tsx: renders the design's Customizer parameters grouped by section,
// driven entirely by the generated schema. Controls are shadcn/ui (Radix):
// Slider + Input for numbers, Switch for booleans, Select for enums, Input for
// strings. Each control carries an aria-label (its description) for its name.
// Every row also carries `data-param="<var>"`: the stable hook the smoke test
// (and extraCss) target now that variable names are hidden from users by default.
import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { Info as InfoIcon, RotateCcw as RevertIcon, Upload as UploadIcon, TriangleAlert as FailureIcon } from "lucide-react";
import type { FriendlyErrorInfo } from "../lib/friendlyErrors";
import type { Design, Param, ParamValue } from "../openscad/types";
import type { Values } from "../lib/presets";
import { displayValue } from "../lib/paramDiff";
import { visibleGroups } from "../lib/paramGroups";
import { prefersReducedMotion } from "../lib/matchMedia";
import { clampNumber, committedNumber, finiteDraft, typedCommitValue } from "../lib/numberDraft";
import { familyOf, normalizeFamily, type InstalledFont } from "../lib/fonts";
import { fontFallback } from "../lib/fontFallback";
import { nearestScrollParent } from "../lib/scrollParent";
import { t } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";
import { EssentialsToggle } from "./EssentialsToggle";
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

interface Props {
  design: Design;
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
   * SVG basenames the renderer can resolve right now (bundled assets ∪ imported
   * `.svg`). When non-empty, an `@svg` control whose filename value isn't in it
   * shows an actionable "not imported" hint: the SVG mirror of the missing-font
   * hint. Omitted or empty → no SVG checking (we can't be authoritative).
   */
  availableSvgFiles?: Set<string>;
  /**
   * Tier-2 preset-diff markers: the values a drifted param is compared against
   * (the selected preset, or design defaults, see App.tsx/PresetDiffBar) and
   * the set of param names currently drifted from it. Both optional so the
   * form still works for a caller that doesn't wire up the diff (e.g. a future
   * standalone use); omitting either suppresses the markers entirely.
   */
  baseline?: Values;
  changedParams?: Set<string>;
  /** The selected preset's display name, used to name the revert target in the
   *  per-field revert button ("to <preset>" vs "to default" when none). */
  presetName?: string | null;
  /** Whether parameters marked `@advanced` are included. */
  showAdvanced?: boolean;
  /**
   * Density. `false` (the default, and what the docked desktop panel uses)
   * stacks every control under its label. `true` (the mobile sheet) puts the
   * control BESIDE its label wherever the control doesn't need the full row,
   * and tightens the vertical rhythm.
   *
   * The sheet's half detent is the only state where a phone visitor can see
   * the model and the controls at once, and it was showing one or two
   * parameters out of sixteen: a stacked row costs the label's height PLUS the
   * control's, and a label can run to two lines. Side-by-side makes a row
   * `max(label, control)` instead of their sum. Numbers with a slider and
   * `@svg` fields still stack (their controls genuinely need the width) so
   * this narrows rows rather than cramping them.
   */
  compact?: boolean;
  /**
   * Flip `showAdvanced`. Present → the form closes with the EssentialsToggle
   * row (see its own doc for why it belongs at the END of the form rather
   * than above it); omitted → no toggle, for a caller that offers no way to
   * reveal advanced params at all.
   */
  onShowAdvancedChange?: (show: boolean) => void;
  /**
   * Imperative handle (React-19 ref-as-prop) exposing `openSection`, so a
   * sibling "Jump to section" navigator can open + scroll + focus a section
   * without lifting the form's private open-state out of this component.
   */
  ref?: Ref<ParamFormHandle>;
  /**
   * The current render failure, when there is one. Rendered as a banner at the
   * top of the form: the viewer overlay and the Messages console both already
   * report it, but neither is in the surface the visitor is actually editing.
   * Clearing a text field is an ordinary edit that fails the render, and with
   * the panel scrolled the only feedback lived over the model or at the far
   * bottom of the window. Omitted → no banner.
   *
   * It names no parameter, deliberately. OpenSCAD reports a failure against
   * the design, not against a control, so marking one field `aria-invalid`
   * would be a guess — and a wrong guess on a form is worse than none.
   */
  failure?: FriendlyErrorInfo | null;
}

/** The imperative surface a parent gets via `ref` (see Props.ref). */
export interface ParamFormHandle {
  /**
   * Force `section` open, scroll its `<details>` to the top of the scroll
   * area, and move focus to its `<summary>`. Re-scrolls even when the section
   * is already open (it's a one-shot navigation action, not a toggle).
   */
  openSection: (section: string) => void;
}

// Inline, non-alarming hint shown under a `font` control when the selected
// family isn't loaded. Offers the two actions that actually fix it: import the
// real font, or switch to an available bundled family, so availability is
// communicated immediately, without needing a render to find out. The
// hidden-FileInput+addFile plumbing behind "Import font…" is FontImportActions
// (shared with AttentionItems' own font-fallback card): this only supplies
// the copy/visuals, which stay identical to before.
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
  // `pointer-coarse:min-h-11`: these two are where the entire missing-font flow
  // ends, and at 23.7px stacked adjacent they were the smallest targets on the
  // path. Height only — they are text links, and widening them would break the
  // line they sit on.
  const actionBtn =
    "inline-flex cursor-pointer items-center gap-[0.3rem] border-none bg-transparent px-0 py-[2px] pointer-coarse:min-h-11 text-[0.82rem] font-semibold text-brand hover:underline focus-visible:rounded-[4px] focus-visible:outline-offset-2";
  return (
    <div
      className="font-missing mt-[0.1rem] flex flex-col gap-[0.4rem] rounded-(--radius-sm) border border-l-[3px] border-l-warn bg-muted px-[0.6rem] py-2"
      role="status"
    >
      <span className="text-[0.82rem] leading-[1.4] text-foreground">
        “{family}” isn’t loaded — text may render in another font.
      </span>
      <FontImportActions
        className="flex flex-wrap gap-x-4 gap-y-1"
        renderImport={(open) => (
          <button type="button" className={actionBtn} onClick={open}>
            <UploadIcon size={13} aria-hidden="true" /> Import font…
          </button>
        )}
        renderFallback={
          fallback
            ? () => (
                <button type="button" className={actionBtn} onClick={() => onUse(fallback.value)}>
                  Use {fallback.label}
                </button>
              )
            : undefined
        }
      />
    </div>
  );
}

// The value of a font selector whose family isn't loaded, else null. A font
// selector is a string or enum (dropdown) param flagged `isFont`. Only checked
// when an authoritative available set is provided and non-empty, so an unknown
// set never produces a false "not loaded" warning.
function missingFont(
  param: Param,
  value: ParamValue,
  available: Set<string> | undefined
): string | null {
  const isFontParam = (param.type === "string" || param.type === "enum") && param.isFont;
  if (!isFontParam || !available?.size) return null;
  const v = String(value ?? "");
  return available.has(normalizeFamily(familyOf(v))) ? null : v;
}

/** A parameter value as a finite number, or null when it holds anything else. */
function asFiniteNumber(value: ParamValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Revert one parameter to the baseline, and, for an `@svg` field, its bound
 * `layers=` parameter with it. The two are written together by the SVG wizard
 * (the layers string names regions that exist only in the drawing it prepared),
 * so reverting the drawing alone would leave the regions of a drawing that is no
 * longer selected behind, and the design would fail to build.
 */
function revertToBaseline(
  param: Param,
  baseline: Values,
  onChange: (name: string, value: ParamValue) => void,
): void {
  onChange(param.name, baseline[param.name]);
  const bound = param.type === "string" ? param.svg?.layers : null;
  if (bound && bound in baseline) onChange(bound, baseline[bound]);
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
  // onChange echoing back through props) must NOT stomp the user's
  // in-progress keystrokes: e.g. typing "2" en route to "25" in a min=10
  // field commits nothing yet (typedCommitValue, below), but re-syncing the
  // draft from `committed` on every render would still force the field back
  // to whatever was last committed mid-type. Blur already normalises the
  // draft, and an external value change (e.g. a preset apply) while unfocused
  // should still resync immediately.
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) return;
    setDraft(String(committed));
  }, [committed]);

  // Transient "adjusted to the min/max" feedback for a commit that actually
  // clamped an out-of-range typed value. Mid-type keystrokes never reach
  // here (typedCommitValue, above, only commits an already-in-range draft),
  // so this only fires from commitDraft's blur/Enter path, and only clears
  // itself: a permanent fixture under every ranged field would outlast the
  // one commit it's about.
  const [clampHint, setClampHint] = useState<string | null>(null);
  const clampHintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(clampHintTimer.current), []);

  const commitRange = (n: number) => {
    const v = clampNumber(param, n);
    setDraft(String(v));
    onChange(v);
  };

  // Shared by blur and Enter: clamp whatever's left typed, commit it, and
  // normalise the draft text to match (e.g. a raw value beyond the range).
  const commitDraft = () => {
    const raw = finiteDraft(draft) ?? param.default;
    const v = clampNumber(param, raw);
    setDraft(String(v));
    if (v !== committed) onChange(v);
    clearTimeout(clampHintTimer.current);
    if (v !== raw) {
      setClampHint(
        param.max !== undefined && v === param.max
          ? t("paramForm.clampedToMax", { max: v })
          : t("paramForm.clampedToMin", { min: v })
      );
      clampHintTimer.current = setTimeout(() => setClampHint(null), 4000);
    } else {
      setClampHint(null);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {hasRange && (
          <Slider
            className="flex-1"
            min={param.min}
            max={param.max}
            step={param.step ?? 1}
            value={[committed]}
            onValueChange={([v]) => commitRange(v)}
            aria-label={label}
          />
        )}
        <Input
          type="number"
          inputMode="decimal"
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
            // Only commit a draft already within range (typedCommitValue): a
            // partial or out-of-range keystroke (e.g. "2" en route to "25" in a
            // min=10 field) keeps the draft text but leaves the previous
            // committed value live, instead of flashing the clamped bound into
            // the preview and queuing a render for it.
            const v = typedCommitValue(param, raw);
            if (v !== null) onChange(v);
          }}
          onBlur={() => {
            focusedRef.current = false;
            commitDraft();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitDraft();
          }}
        />
      </div>
      {clampHint && (
        <p className="text-[0.72rem] text-warn" role="status">
          {clampHint}
        </p>
      )}
    </div>
  );
}

/**
 * Whether `param`'s control needs the full width of a form row, so a compact
 * (mobile) layout must keep it stacked under its label rather than beside it.
 *
 * Lives beside `Control` because it is a statement about which WIDGET the
 * param resolves to: a ranged number renders a Slider plus a numeric input
 * (NumberControl's `hasRange`), which in a 48% column leaves the slider too
 * short to aim at, and an `@svg` field's control is a whole wizard launcher. A
 * `@filledBy` param rides its own inner disclosure and keeps the stacked
 * layout too. Deriving it at the call site instead would let the layout and
 * the widget disagree the next time either changes.
 */
function controlNeedsFullRow(param: Param): boolean {
  return (
    (param.type === "number" && param.min !== undefined && param.max !== undefined) ||
    (param.type === "string" && param.svg != null) ||
    param.filledBy != null
  );
}

function Control({
  param,
  value,
  label,
  onChange,
  installedFonts,
  availableSvgFiles,
  svgDefaultHeight,
}: {
  param: Param;
  value: ParamValue;
  label: string;
  onChange: (v: ParamValue) => void;
  installedFonts?: InstalledFont[];
  availableSvgFiles?: Set<string>;
  svgDefaultHeight?: number | null;
}) {
  // A font parameter (string or enum flagged `isFont`) becomes the friendly
  // FontSelect dropdown whenever we authoritatively know what's installed:
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
        availableSvgFiles={availableSvgFiles}
        defaultHeight={svgDefaultHeight}
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
    case "enum": {
      // The full label of the selected choice as a `title`: the trigger
      // wraps to 2 lines (ui/select.tsx's `wrap`) but a choice long enough to
      // still clip is readable on hover.
      const selectedLabel = param.choices.find((c) => c.value === String(value))?.label;
      return (
        <Select value={String(value)} onValueChange={(v) => onChange(v)}>
          <SelectTrigger className="w-full" aria-label={label} title={selectedLabel} wrap>
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
    }
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

// Surfaces a parameter's full help text in a tap/click popover, rendered
// INLINE right after the last word of the label/help text it belongs to (a
// plain sibling in the same text flow, not a flex row item), so when that
// text wraps to multiple lines, the button flows with it instead of sitting
// detached to the row's right edge at the first line's height. A hover-only
// `title` tooltip would leave the detail unreachable on touch devices.
function ParamHelp({ help, label }: { help: string; label: string }) {
  // Radix positions against the VIEWPORT by default, so an open popover whose
  // row is scrolled away keeps shifting to stay on screen and comes to rest
  // over the 3D viewer, pointing at nothing. Anchoring collision handling to
  // the scroller the row lives in (the docked panel or the mobile sheet) keeps
  // it over the form, and `hideWhenDetached` retires it once its trigger has
  // scrolled out of that scroller entirely. Resolved on open rather than on
  // mount: the same form is portalled between the two layouts.
  const trigger = useRef<HTMLButtonElement>(null);
  const [boundary, setBoundary] = useState<HTMLElement | null>(null);
  return (
    <Popover onOpenChange={(open) => open && setBoundary(nearestScrollParent(trigger.current))}>
      <PopoverTrigger asChild>
        {/* 15px glyph with a >=44x44px tap target (WCAG 2.2 AAA "Target Size
            (Enhanced)"): the negative margin absorbs the padding so it
            doesn't push the surrounding text apart. */}
        <button
          ref={trigger}
          type="button"
          className="param-help__trigger -m-[14.5px] inline-flex shrink-0 cursor-pointer items-center justify-center rounded-[4px] border-none bg-transparent p-[14.5px] align-middle leading-[0] text-muted-foreground hover:text-brand focus-visible:text-brand focus-visible:outline-offset-1 [&_svg]:h-[15px] [&_svg]:w-[15px]"
          aria-label={t("paramForm.helpFor", { label })}
        >
          <InfoIcon aria-hidden="true" focusable="false" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        // Radix renders this as role="dialog", which axe requires to have an
        // accessible name (aria-dialog-name). It shares the trigger's, so the
        // popover announces which parameter it is explaining.
        aria-label={t("paramForm.helpFor", { label })}
        // `?? []` is Radix's own "no explicit boundary" value; passing null
        // would register as explicit and pin it to the viewport instead.
        collisionBoundary={boundary ?? []}
        collisionPadding={8}
        hideWhenDetached
        className="param-help w-64 max-w-[80vw] p-3 text-sm leading-[1.45] text-foreground [overflow-wrap:anywhere]"
      >
        {help}
      </PopoverContent>
    </Popover>
  );
}

// The two densities' spacing, side by side so a change to one is made against
// the other rather than three conditionals apart. See Props.compact.
const DENSITY = {
  regular: { group: "mb-3", summary: "py-[0.6rem]", row: "my-3 gap-[0.35rem]" },
  compact: { group: "mb-2", summary: "py-[0.45rem]", row: "my-2 gap-[0.25rem]" },
} as const;

export const ParamForm = memo(function ParamForm({ design, values, onChange, search = "", showVarName = false, availableFontFamilies, fontSuggestion, installedFonts, availableSvgFiles, baseline, changedParams, presetName, showAdvanced = true, onShowAdvancedChange, compact = false, failure, ref }: Props) {
  // Subscription only: re-render this component's t() calls on a locale
  // switch. A useSyncExternalStore-backed hook works fine inside memo().
  useLocale();
  const density = compact ? DENSITY.compact : DENSITY.regular;
  const q = search.toLowerCase();
  // Sections marked `// @collapsed` in the .scad start folded; every group is
  // collapsible (native <details>), so long forms stay manageable. Recompute
  // visible groups only when the design, values or query change, not on every
  // unrelated render (e.g. a sibling re-render). The filter itself lives in
  // lib/paramGroups.ts so the section navigator (ParamPanel/SheetTabs) shares
  // exactly this computation and can never list a section the form doesn't show.
  const groups = useMemo(
    // `q` is `search` already lowercased; visibleGroups lowercases again
    // (idempotent), so passing it keeps the memo deps honest without a
    // case-only-change recompute.
    () => visibleGroups(design, values, { search: q, showAdvanced }),
    [design, values, q, showAdvanced]
  );

  // Per-section open/closed state, controlled in React so a search can force a
  // folded group open without losing the user's manual fold/unfold of an
  // @collapsed (or plain) group: <details>'s `open` attribute is otherwise
  // native DOM state React never observes, so a search-forced re-render used to
  // stomp it back to the design's static @collapsed default. Re-derived whenever
  // the design changes (a different design's section names shouldn't inherit
  // this one's open/closed choices).
  const collapsedDefault = useMemo(
    () => new Set(design.collapsedSections ?? []),
    [design]
  );
  const initOpenSections = (d: Design, defaultClosed: Set<string>) => {
    const init: Record<string, boolean> = {};
    for (const section of d.sections) init[section] = !defaultClosed.has(section);
    return init;
  };
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    initOpenSections(design, collapsedDefault)
  );
  // Re-derive whenever `design` changes, during render rather than in an
  // effect (the documented "adjusting state when a prop changes" pattern):
  // this is a synchronous reset of state fully derived from `design`, not a
  // side effect on an external system.
  const lastOpenSectionsDesign = useRef(design);
  if (lastOpenSectionsDesign.current !== design) {
    lastOpenSectionsDesign.current = design;
    setOpenSections(initOpenSections(design, collapsedDefault));
  }

  // Imperative "jump to a section" for the SectionNavigator. `openSection`
  // forces the section open (leaving the search-forces-open logic untouched)
  // and arms a scroll via a monotonically-increasing counter: bumped on every
  // call so the effect fires even when the section was already open (identity
  // of `openSections` wouldn't change then), giving the always-re-scroll a
  // one-shot navigation deserves.
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingSectionRef = useRef<string | null>(null);
  const [scrollTick, setScrollTick] = useState(0);
  const openSection = useCallback((section: string) => {
    pendingSectionRef.current = section;
    setOpenSections((prev) => (prev[section] ? prev : { ...prev, [section]: true }));
    setScrollTick((n) => n + 1);
  }, []);
  useImperativeHandle(ref, () => ({ openSection }), [openSection]);
  useEffect(() => {
    if (scrollTick === 0) return; // never on mount
    const section = pendingSectionRef.current;
    pendingSectionRef.current = null;
    const root = rootRef.current;
    if (!section || !root) return;
    const el = root.querySelector<HTMLDetailsElement>(`[data-section="${CSS.escape(section)}"]`);
    if (!el) return;
    // rAF so the forced-open <details> has committed before we scroll/focus.
    // Cancelled on cleanup: a jump followed immediately by an unmount (a
    // breakpoint flip, a design switch) would otherwise scroll and steal focus
    // into a tree that is on its way out.
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
      el.querySelector("summary")?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollTick]);

  // The banner and the group headers are both `position: sticky` against the
  // same scroll port, so both pinned at top 0 and the header sat entirely
  // behind the banner. Publish the banner's measured height as
  // `--failure-banner-h`; index.css offsets the headers by it, so they pin
  // under the banner instead of beneath it. Measured rather than hardcoded:
  // the message wraps to two or three lines depending on the design.
  const failureRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const el = failureRef.current;
    if (!el) {
      root.style.removeProperty("--failure-banner-h");
      return;
    }
    // Sticky only while the banner is a small part of the port. At 320x568 it
    // measured ~119px of a ~180px form area, and useScrollFocusedIntoView
    // CENTRES a focused field rather than using scrollIntoView — so the field
    // whose value caused the failure parked underneath it, invisible and not
    // hit-testable, because the banner paints above. Past the threshold it
    // scrolls with the content instead; the pill and the Messages console still
    // report, and the banner is still the first thing in the form.
    const publish = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      const port = el.parentElement?.parentElement;
      const portH = port?.getBoundingClientRect().height ?? 0;
      const stick = portH > 0 && h / portH <= 0.35;
      el.style.position = stick ? "sticky" : "static";
      root.style.setProperty("--failure-banner-h", stick ? `${h}px` : "0px");
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    const port = el.parentElement?.parentElement;
    if (port) ro.observe(port);
    return () => ro.disconnect();
  }, [failure]);

  // pt-3 here rather than padding-top on the scroll port above: the port's
  // padding box is what a sticky group header pins to, so padding there would
  // strand every pinned header that far down and let rows scroll through the
  // gap. As the form's own padding it scrolls away, like content should.
  return (
    <div className="param-form pt-3" ref={rootRef}>
      {/* Sticky, and above the sticky group headers (z-index 1): the whole point
          is that a form scrolled 800px down still shows why the preview stopped
          updating, and a banner that scrolls away with the content reproduces
          the problem it was added for.
          Colour follows FriendlyFailureCard: the destructive token tints the
          BORDER and the icon (graphics, held to 1.4.11's 3:1), never the copy —
          `text-destructive` over a `bg-destructive/10` tint measured 3.97:1
          against body text's 4.5:1. */}
      {failure && (
        <div
          className="param-form__failure sticky top-0 z-[2] mb-2 rounded-lg border border-destructive/40 bg-card px-[0.7rem] py-[0.5rem] text-[0.82rem] shadow-(--elevation)"
          ref={failureRef}
          role="alert"
        >
          <p className="flex items-start gap-[0.4rem] font-semibold text-foreground">
            <FailureIcon size={14} aria-hidden="true" className="mt-[0.15rem] shrink-0 text-destructive" />
            <span className="min-w-0">{failure.title}</span>
          </p>
          {failure.body && <p className="mt-[0.2rem] pl-[1.1rem] text-muted-foreground">{failure.body}</p>}
        </div>
      )}
      {groups.length === 0 && (
        <p className="px-1 py-5 text-center text-[0.9rem] text-muted-foreground">
          {q ? t("paramForm.noMatches", { search }) : t("paramForm.nothingToCustomize")}
        </p>
      )}
      {groups.map(({ section, params }) => {
        const isOpen = openSections[section] ?? !collapsedDefault.has(section);
        return (
          <details
            className={`param-group rounded-lg border bg-background/50 px-[0.8rem] open:pb-2 ${density.group}`}
            key={section}
            data-section={section}
            open={q ? true : isOpen}
            onToggle={(e) => {
              // A search forces every matching group open without being a user
              // choice: don't persist it, so clearing the search restores
              // whatever the user had before searching.
              if (q) return;
              const next = (e.target as HTMLDetailsElement).open;
              // Guard against feedback loops: only write when the DOM's actual
              // state differs from what we already have (also fires when React
              // itself flips `open`, e.g. the forced-open-by-search handoff).
              setOpenSections((prev) => (prev[section] === next ? prev : { ...prev, [section]: next }));
            }}
          >
            <summary className={`font-display flex cursor-pointer select-none list-none items-center px-[0.2rem] text-[0.92rem] font-semibold text-brand focus-visible:rounded-[4px] ${density.summary}`}>
              {section}
            </summary>
            {params.map((p) => {
              const label = p.description || p.name;
              // `help` is the full comment block; its first sentence is the
              // label, so only offer the popover when it carries extra detail.
              const hasHelp = Boolean(p.help) && p.help !== label;
              const value = values[p.name];
              const missingFontValue = missingFont(p, value, availableFontFamilies);
              // Toggles ride the label row (label left, switch right): a
              // control row below would leave a stranded switch.
              const isToggle = p.type === "boolean";
              // In compact (mobile) mode most controls join the toggle on the
              // label row; see controlNeedsFullRow for the exceptions.
              const sideBySide = compact && !isToggle && !controlNeedsFullRow(p);
              // Tier-2 preset-diff marker (see PresetDiffBar for Tier 1): this
              // param's value differs from the baseline (selected preset, or
              // design defaults). Neutral/slate, never the warn colour.
              const isDrifted = Boolean(baseline && changedParams?.has(p.name));
              const control = (
                <Control
                  param={p}
                  value={value}
                  label={label}
                  onChange={(v) => onChange(p.name, v)}
                  installedFonts={installedFonts}
                  availableSvgFiles={availableSvgFiles}
                  svgDefaultHeight={
                    p.type === "string" && p.svg?.height
                      ? asFiniteNumber(values[p.svg.height])
                      : null
                  }
                />
              );
              const body = (
                <>
                  <span className={`flex ${isToggle || sideBySide ? "items-center" : "items-baseline"} justify-between gap-2`}>
                    {/* Label + optional info button together on the left so the
                        right edge is free for the toggle / var-name code. */}
                    <ParamLabel
                      label={label}
                      help={hasHelp ? p.help : null}
                      drifted={isDrifted}
                      varName={showVarName && p.description ? p.name : null}
                    />
                    {isToggle && control}
                    {/* Compact: the control shares the label's row. Fixed
                        share of the width rather than `flex-1`, so a one-word
                        label and a long one give the control the same size and
                        the column of controls stays aligned down the form. */}
                    {sideBySide && (
                      <span className="w-[48%] min-w-[8.5rem] shrink-0">{control}</span>
                    )}
                  </span>
                  {!isToggle && !sideBySide && control}
                  {isDrifted && baseline && (
                    <ParamDrift
                      param={p}
                      label={label}
                      baseline={baseline}
                      presetName={presetName}
                      onChange={onChange}
                    />
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
              // an inner "Advanced" disclosure: demoted, but still hand-editable.
              return (
                <div
                  className={`param flex flex-col ${density.row}`}
                  key={p.name}
                  data-param={p.name}
                >
                  {p.filledBy ? (
                    <details className="param-advanced">
                      <summary className="flex cursor-pointer select-none list-none items-center gap-[0.3rem] text-[0.82rem] text-muted-foreground focus-visible:rounded-[4px]">
                        {t("paramForm.advancedLabel", { label })}
                      </summary>
                      <div className="mt-2 flex flex-col gap-[0.35rem]">{body}</div>
                    </details>
                  ) : (
                    body
                  )}
                </div>
              );
            })}
          </details>
        );
      })}
      {/* The form's closing row: the way to the `@advanced` params, at the
          point the visitor has run out of essential ones (see
          EssentialsToggle's own doc). Rendered outside the groups.map so it
          survives an empty `groups`: a search that matches only advanced
          params shows "Nothing matches", and this is exactly the control that
          resolves that. */}
      {onShowAdvancedChange && (
        <EssentialsToggle
          params={design.params}
          values={values}
          showAdvanced={showAdvanced}
          onShowAdvancedChange={onShowAdvancedChange}
        />
      )}
    </div>
  );
});

/** A parameter row's left-hand cluster: the drift dot, the label with its
 *  optional help popover, and the optional OpenSCAD variable name. Named
 *  because the row body it sits in reads as one shape once these two pieces
 *  are out of it, not because either is reused. */
function ParamLabel({
  label,
  help,
  drifted,
  varName,
}: {
  label: string;
  /** The full doc block, or null when there is nothing beyond the label. */
  help: string | null;
  drifted: boolean;
  varName: string | null;
}) {
  return (
    <span className="flex min-w-0 items-baseline gap-[0.3rem]">
      {drifted && (
        <span
          className="param-drift-dot size-[6px] shrink-0 self-center rounded-full bg-muted-foreground"
          aria-hidden="true"
        />
      )}
      <span className="min-w-0 text-foreground">
        {label}
        {help && " "}
        {help && <ParamHelp help={help} label={label} />}
      </span>
      {varName && (
        <code className="param-var shrink-0 font-mono text-[11px] leading-[normal] text-muted-foreground">
          {varName}
        </code>
      )}
    </span>
  );
}

/** "was <old value>" plus the one-click revert, shown under a control whose
 *  value has drifted from the applied preset (or the design's defaults). */
function ParamDrift({
  param,
  label,
  baseline,
  presetName,
  onChange,
}: {
  param: Param;
  label: string;
  baseline: Values;
  presetName: string | null | undefined;
  onChange: (name: string, value: ParamValue) => void;
}) {
  const target = presetName ?? t("paramForm.defaultTarget");
  return (
    <span className="param-drift flex items-center gap-[0.4rem] text-[0.78rem] text-muted-foreground">
      <span className="line-through">
        {t("paramForm.wasValue", { value: displayValue(param, baseline[param.name]) })}
      </span>
      <button
        type="button"
        className="param-drift-revert -m-[6px] inline-flex shrink-0 cursor-pointer items-center rounded-[4px] border-none bg-transparent p-[6px] pointer-coarse:-m-[16px] pointer-coarse:p-[16px] leading-[0] text-muted-foreground hover:text-brand focus-visible:text-brand focus-visible:outline-offset-1"
        aria-label={t("paramForm.revertAria", { label, target })}
        title={t("paramForm.revertTitle", { target })}
        onClick={() => revertToBaseline(param, baseline, onChange)}
      >
        <RevertIcon size={12} aria-hidden="true" />
      </button>
    </span>
  );
}
