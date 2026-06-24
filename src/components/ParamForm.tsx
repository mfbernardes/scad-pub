// ParamForm.tsx — renders the design's Customizer parameters grouped by section,
// driven entirely by the generated schema.
import { useEffect, useState } from "react";
import type { Design, Param, ParamValue } from "../openscad/types";
import type { Values } from "../lib/presets";
import { isVisible } from "../lib/visibility";

interface Props {
  design: Design;
  values: Values;
  onChange: (name: string, value: ParamValue) => void;
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
  onChange,
}: {
  param: Extract<Param, { type: "number" }>;
  value: ParamValue;
  onChange: (v: ParamValue) => void;
}) {
  const committed = committedNumber(param, value);
  const [draft, setDraft] = useState(String(committed));
  const hasRange = param.min !== undefined && param.max !== undefined;

  useEffect(() => {
    setDraft(String(committed));
  }, [committed]);

  const commitRange = (raw: string) => {
    const n = finiteDraft(raw);
    if (n === null) return;
    const v = clampNumber(param, n);
    setDraft(String(v));
    onChange(v);
  };

  return (
    <div className="control-row">
      {hasRange && (
        <input
          type="range"
          min={param.min}
          max={param.max}
          step={param.step ?? "any"}
          value={committed}
          onChange={(e) => commitRange(e.target.value)}
        />
      )}
      <input
        type="number"
        min={param.min}
        max={param.max}
        step={param.step ?? "any"}
        value={draft}
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
  onChange,
}: {
  param: Param;
  value: ParamValue;
  onChange: (v: ParamValue) => void;
}) {
  switch (param.type) {
    case "number":
      return <NumberControl param={param} value={value} onChange={onChange} />;
    case "boolean":
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "enum":
      return (
        <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {param.choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      );
    case "string":
      return (
        <input
          type="text"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

export function ParamForm({ design, values, onChange }: Props) {
  // Sections marked `// @collapsed` in the .scad start folded; every group is
  // collapsible (native <details>), so long forms stay manageable.
  const collapsed = new Set(design.collapsedSections ?? []);
  return (
    <div className="param-form">
      {design.sections.map((section) => {
        // Hide parameters whose @showIf condition is currently false, and drop
        // a section that ends up with no visible parameters.
        const params = design.params.filter(
          (p) => p.section === section && isVisible(p, values)
        );
        if (params.length === 0) return null;
        return (
          <details className="param-group" key={section} open={!collapsed.has(section)}>
            <summary>{section}</summary>
            {params.map((p) => (
              <label className="param" key={p.name} title={p.help || p.description}>
                <span className="param-label">
                  <span className="param-desc">{p.description || p.name}</span>
                  {p.description && <code className="param-var">{p.name}</code>}
                </span>
                <Control
                  param={p}
                  value={values[p.name]}
                  onChange={(v) => onChange(p.name, v)}
                />
              </label>
            ))}
          </details>
        );
      })}
    </div>
  );
}
