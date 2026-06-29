// DimensionInfo.tsx — companion to SizeReadout shown only while the dimension
// overlay is on. Surfaces a per-design set of parameter values (those the design
// marked with a `// @info` annotation in its .scad source) as a small glass
// panel, so the viewer can show model-specific facts (e.g. the engraved text, a
// font height) alongside the W×D×H callouts. Values are read live from the
// controls; like SizeReadout it's purely informative and never part of a print.
import type { Design, Param } from "../openscad/types";
import type { Values } from "../lib/presets";
import { isVisible } from "../lib/visibility";

interface Props {
  design: Design;
  /** Current parameter values from the controls. */
  values: Values;
  /** Params changed since the last render — the figures may not match the model. */
  stale?: boolean;
}

// Format a parameter's live value for display, appending the optional `@info`
// unit. Returns null when there's nothing worth showing (e.g. an empty string).
function formatValue(param: Param, values: Values): string | null {
  const raw = values[param.name] ?? param.default;
  const unit = param.info?.unit ? ` ${param.info.unit}` : "";
  switch (param.type) {
    case "boolean":
      return raw ? "Yes" : "No";
    case "string": {
      const s = String(raw).trim();
      return s ? s + unit : null;
    }
    case "enum": {
      const choice = param.choices.find((c) => c.value === String(raw));
      return (choice?.label ?? String(raw)) + unit;
    }
    default:
      return String(raw) + unit; // number
  }
}

export function DimensionInfo({ design, values, stale = false }: Props) {
  // Only params flagged `// @info`, still visible under their @showIf (if any),
  // and with a non-empty formatted value.
  const lines = design.params
    .filter((p) => p.info && isVisible(p, values))
    .map((p) => ({
      name: p.name,
      label: p.info!.label ?? p.description,
      value: formatValue(p, values),
    }))
    .filter((l): l is { name: string; label: string; value: string } => l.value !== null);

  if (lines.length === 0) return null;

  return (
    <dl
      className={`dimension-info${stale ? " dimension-info--stale" : ""}`}
      aria-label="Model details"
    >
      {lines.map((l) => (
        <div className="dimension-info__row" key={l.name}>
          <dt>{l.label}</dt>
          <dd>{l.value}</dd>
        </div>
      ))}
    </dl>
  );
}
