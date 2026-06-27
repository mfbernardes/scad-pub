// ParamForm.tsx — renders the design's Customizer parameters grouped by section,
// driven entirely by the generated schema. Controls are shadcn/ui (Radix):
// Slider + Input for numbers, Checkbox for booleans, Select for enums, Input for
// strings. Each control carries an aria-label (its description) for its name.
import { memo, useEffect, useMemo, useState } from "react";
import { Info as InfoIcon } from "lucide-react";
import type { Design, Param, ParamValue } from "../openscad/types";
import type { Values } from "../lib/presets";
import { isVisible } from "../lib/visibility";
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
    <div className="control-row">
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
        <button
          type="button"
          className="param-help-btn"
          aria-label={`Help for ${label}`}
        >
          <InfoIcon aria-hidden="true" focusable="false" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="param-help-popover w-64 max-w-[80vw] p-3 text-sm">
        {help}
      </PopoverContent>
    </Popover>
  );
}

export const ParamForm = memo(function ParamForm({ design, values, onChange, search = "", showVarName = true }: Props) {
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
            (!q ||
              p.name.toLowerCase().includes(q) ||
              p.description.toLowerCase().includes(q))
        ),
        // Force open when search is active (expand all matching groups).
        startOpen: q ? true : !collapsed.has(section),
      }))
      .filter((g) => g.params.length > 0);
  }, [design, values, q]);

  return (
    <div className="param-form">
      {groups.map(({ section, params, startOpen }) => {
        return (
          <details className="param-group" key={section} open={startOpen}>
            <summary>{section}</summary>
            {params.map((p) => {
              const label = p.description || p.name;
              // `help` is the full comment block; its first sentence is the
              // label, so only offer the popover when it carries extra detail.
              const hasHelp = Boolean(p.help) && p.help !== label;
              return (
                <div className="param" key={p.name}>
                  <span className="param-label">
                    <span className="param-label__main">
                      <span className="param-desc">{label}</span>
                      {hasHelp && <ParamHelp help={p.help} label={label} />}
                    </span>
                    {showVarName && p.description && <code className="param-var">{p.name}</code>}
                  </span>
                  <Control
                    param={p}
                    value={values[p.name]}
                    label={label}
                    onChange={(v) => onChange(p.name, v)}
                  />
                </div>
              );
            })}
          </details>
        );
      })}
    </div>
  );
});
