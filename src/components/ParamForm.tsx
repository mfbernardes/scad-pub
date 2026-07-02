// ParamForm.tsx — renders the design's Customizer parameters grouped by section,
// driven entirely by the generated schema. Controls are shadcn/ui (Radix):
// Slider + Input for numbers, Checkbox for booleans, Select for enums, Input for
// strings. Each control carries an aria-label (its description) for its name.
import { memo, useEffect, useMemo, useState } from "react";
import { Info as InfoIcon, Upload as UploadIcon } from "lucide-react";
import type { Design, Param, ParamValue } from "../openscad/types";
import type { Values } from "../lib/presets";
import { isVisible } from "../lib/visibility";
import { familyOf, normalizeFamily, withFamily } from "../lib/fonts";
import { useAppActions } from "../lib/appActions";
import { FileInput } from "./FileInput";
import { Slider } from "./ui/slider";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
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
  /** Show the underlying OpenSCAD variable name beside each label (default true). */
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

// A one-click replacement whose family is loaded, or null when none fits. For an
// enum the result must be a listed choice (the dropdown can't show an off-list
// value), so pick the first choice whose family is available; for free text,
// graft the suggested bundled family onto the current value.
function fontFallback(
  param: Param,
  value: string,
  available: Set<string> | undefined,
  suggestion: string | null | undefined
): { value: string; label: string } | null {
  if (param.type === "enum") {
    const choice = param.choices.find((c) =>
      available?.has(normalizeFamily(familyOf(c.value)))
    );
    return choice ? { value: choice.value, label: familyOf(choice.value) } : null;
  }
  if (suggestion && normalizeFamily(suggestion) !== normalizeFamily(familyOf(value)))
    return { value: withFamily(value, suggestion), label: suggestion };
  return null;
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

  useEffect(() => {
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
        className="w-20"
        min={param.min}
        max={param.max}
        step={param.step ?? "any"}
        value={draft}
        aria-label={label}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const n = finiteDraft(raw);
          if (n !== null) onChange(n);
        }}
        // Clamp on commit so intermediate keystrokes stay typeable.
        onBlur={() => {
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
}: {
  param: Param;
  value: ParamValue;
  label: string;
  onChange: (v: ParamValue) => void;
}) {
  switch (param.type) {
    case "number":
      return <NumberControl param={param} value={value} label={label} onChange={onChange} />;
    case "boolean":
      return (
        <Checkbox
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

export const ParamForm = memo(function ParamForm({ design, values, onChange, search = "", showVarName = true, availableFontFamilies, fontSuggestion }: Props) {
  const q = search.toLowerCase();
  // Sections marked `// @collapsed` in the .scad start folded; every group is
  // collapsible (native <details>), so long forms stay manageable. Recompute
  // visible groups only when the design, values or query change — not on every
  // unrelated render (e.g. a sibling re-render).
  const groups = useMemo(() => {
    const collapsed = new Set(design.collapsedSections ?? []);
    return design.sections
      .map((section) => ({
        section,
        // Hide parameters whose @showIf condition is currently false, and drop
        // a section that ends up with no visible parameters.
        params: design.params.filter(
          (p) =>
            p.section === section &&
            isVisible(p, values) &&
            // Match the variable name, the label, and the full help text, so a
            // term that only appears in the detail (surfaced via the info
            // popover) is still findable.
            (!q ||
              p.name.toLowerCase().includes(q) ||
              p.description.toLowerCase().includes(q) ||
              p.help.toLowerCase().includes(q))
        ),
        // Force open when search is active (expand all matching groups).
        startOpen: q ? true : !collapsed.has(section),
      }))
      .filter((g) => g.params.length > 0);
  }, [design, values, q]);

  return (
    <div className="param-form">
      {groups.length === 0 && (
        <p className="px-1 py-5 text-center text-[0.9rem] text-muted-foreground">
          {q ? `No parameters match “${search}”.` : "This design has no parameters."}
        </p>
      )}
      {groups.map(({ section, params, startOpen }) => {
        return (
          <details
            className="param-group mb-[0.8rem] rounded-lg border px-[0.7rem] open:pb-2"
            key={section}
            open={startOpen}
          >
            <summary className="flex cursor-pointer select-none list-none items-center px-[0.2rem] py-[0.55rem] text-[0.9rem] font-semibold text-brand focus-visible:rounded-[4px]">
              {section}
            </summary>
            {params.map((p) => {
              const label = p.description || p.name;
              // `help` is the full comment block; its first sentence is the
              // label, so only offer the popover when it carries extra detail.
              const hasHelp = Boolean(p.help) && p.help !== label;
              const value = values[p.name];
              const missingFontValue = missingFont(p, value, availableFontFamilies);
              return (
                <div className="param my-[0.7rem] flex flex-col gap-[0.3rem]" key={p.name}>
                  <span className="flex items-baseline justify-between gap-2">
                    {/* Label + optional info button together on the left so the
                        var-name code pins to the right edge. */}
                    <span className="flex min-w-0 items-baseline gap-[0.3rem]">
                      <span className="text-foreground">{label}</span>
                      {hasHelp && <ParamHelp help={p.help} label={label} />}
                    </span>
                    {showVarName && p.description && (
                      <code className="param-var shrink-0 font-mono text-[11px] leading-[normal] text-muted-foreground">
                        {p.name}
                      </code>
                    )}
                  </span>
                  <Control
                    param={p}
                    value={value}
                    label={label}
                    onChange={(v) => onChange(p.name, v)}
                  />
                  {missingFontValue !== null && (
                    <FontMissingHint
                      family={familyOf(missingFontValue)}
                      fallback={fontFallback(p, missingFontValue, availableFontFamilies, fontSuggestion)}
                      onUse={(next) => onChange(p.name, next)}
                    />
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
