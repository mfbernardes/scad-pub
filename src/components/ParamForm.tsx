// ParamForm.tsx — renders the design's Customizer parameters grouped by section,
// driven entirely by the generated schema. Controls are shadcn/ui (Radix):
// Slider + Input for numbers, Switch for booleans, Select for enums, Input for
// strings. Each control carries an aria-label (its description) for its name.
// Every row also carries `data-param="<var>"` — the stable hook the smoke test
// (and extraCss) target now that variable names are hidden from users by default.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Info as InfoIcon, RotateCcw as RevertIcon, Upload as UploadIcon } from "lucide-react";
import type { Design, Param, ParamValue } from "../openscad/types";
import type { Values } from "../lib/presets";
import { displayValue } from "../lib/paramDiff";
import { isVisible } from "../lib/visibility";
import { familyOf, normalizeFamily, type InstalledFont } from "../lib/fonts";
import { fontFallback } from "../lib/fontFallback";
import { useAppActions } from "../lib/appActions";
import { FileInput } from "./FileInput";
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
  /** Whether parameters marked `@advanced` are included. */
  showAdvanced?: boolean;
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
  const { addFile } = useAppActions();
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
        “{family}” isn’t loaded — text may render in another font.
      </span>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <FileInput
          accept=".ttf,.otf,.ttc"
          onFile={async (file) => addFile(file.name, new Uint8Array(await file.arrayBuffer()))}
        >
          {(open) => (
            <button type="button" className={actionBtn} onClick={open}>
              <UploadIcon size={13} aria-hidden="true" /> Import font…
            </button>
          )}
        </FileInput>
        {fallback && (
          <button type="button" className={actionBtn} onClick={() => onUse(fallback.value)}>
            Use {fallback.label}
          </button>
        )}
      </div>
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

  const commitRange = (n: number) => {
    const v = clampNumber(param, n);
    setDraft(String(v));
    onChange(v);
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
          onValueChange={([v]) => commitRange(v)}
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
          className="-m-[5px] inline-flex shrink-0 cursor-pointer items-center justify-center self-center rounded-[4px] border-none bg-transparent p-[5px] leading-[0] text-muted-foreground hover:text-brand focus-visible:text-brand focus-visible:outline-offset-1 [&_svg]:h-[15px] [&_svg]:w-[15px]"
          aria-label={`Help for ${label}`}
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

export const ParamForm = memo(function ParamForm({ design, values, onChange, search = "", showVarName = false, availableFontFamilies, fontSuggestion, installedFonts, baseline, changedParams, presetName, showAdvanced = true }: Props) {
  const q = search.toLowerCase();
  // Sections marked `// @collapsed` in the .scad start folded; every group is
  // collapsible (native <details>), so long forms stay manageable. Recompute
  // visible groups only when the design, values or query change — not on every
  // unrelated render (e.g. a sibling re-render).
  const groups = useMemo(() => {
    return design.sections
      .map((section) => ({
        section,
        // Hide parameters whose @showIf condition is currently false, and drop
        // a section that ends up with no visible parameters.
        params: design.params.filter(
          (p) =>
            p.section === section &&
            (showAdvanced || !p.advanced) &&
            isVisible(p, values) &&
            // Match the variable name, the label, and the full help text, so a
            // term that only appears in the detail (surfaced via the info
            // popover) is still findable.
            (!q ||
              p.name.toLowerCase().includes(q) ||
              p.description.toLowerCase().includes(q) ||
              p.help.toLowerCase().includes(q))
        ),
      }))
      .filter((g) => g.params.length > 0);
  }, [design, values, q, showAdvanced]);

  // Per-section open/closed state, controlled in React so a search can force a
  // folded group open without losing the user's manual fold/unfold of an
  // @collapsed (or plain) group — <details>'s `open` attribute is otherwise
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
  // effect (the documented "adjusting state when a prop changes" pattern) —
  // this is a synchronous reset of state fully derived from `design`, not a
  // side effect on an external system.
  const lastOpenSectionsDesign = useRef(design);
  if (lastOpenSectionsDesign.current !== design) {
    lastOpenSectionsDesign.current = design;
    setOpenSections(initOpenSections(design, collapsedDefault));
  }

  return (
    <div className="param-form">
      {groups.length === 0 && (
        <p className="px-1 py-5 text-center text-[0.9rem] text-muted-foreground">
          {q ? `Nothing matches “${search}”.` : "This design has nothing to customize."}
        </p>
      )}
      {groups.map(({ section, params }) => {
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
            {params.map((p) => {
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
                      <span className="line-through">was {displayValue(p, baseline[p.name])}</span>
                      <button
                        type="button"
                        className="param-drift-revert -m-[3px] inline-flex shrink-0 cursor-pointer items-center rounded-[4px] border-none bg-transparent p-[3px] leading-[0] text-muted-foreground hover:text-brand focus-visible:text-brand focus-visible:outline-offset-1"
                        aria-label={`Revert ${label} to ${presetName ?? "default"}`}
                        title={`Revert to ${presetName ?? "default"}`}
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
                <div
                  className="param my-3 flex flex-col gap-[0.35rem]"
                  key={p.name}
                  data-param={p.name}
                >
                  {p.filledBy ? (
                    <details className="param-advanced">
                      <summary className="flex cursor-pointer select-none list-none items-center gap-[0.3rem] text-[0.82rem] text-muted-foreground focus-visible:rounded-[4px]">
                        Advanced: {label}
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
    </div>
  );
});
