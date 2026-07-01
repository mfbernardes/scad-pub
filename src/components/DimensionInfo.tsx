// DimensionInfo.tsx — the viewer's measurements panel, shown while the dimension
// overlay is on. Its first line is always the model's bounding box (W × D × H,
// in mm); beneath it sit any per-design facts the design marked with a `// @info`
// annotation in its .scad source (e.g. the engraved text, a font height), then
// any rows the design surfaced at render time via
// `echo("@info", label, unit, value)` (see lib/computedInfo.ts) — the mechanism
// for values OpenSCAD itself computes internally, which gen-schema's static
// parser could never know. All of it is measured/read downstream of the
// export — purely informative, never part of a print.
import type { Design, Param } from "../openscad/types";
import type { Dimensions } from "./Viewer";
import type { Values } from "../lib/presets";
import type { ComputedInfo } from "../lib/computedInfo";
import { isVisible } from "../lib/visibility";

interface Props {
  design: Design;
  /** Bounding-box size in millimetres (the headline "Dimensions" line). */
  size: Dimensions;
  /** Values behind the current render — not the live controls — so the figures
   *  change in step with the measured geometry, only once a render lands. */
  values: Values;
  /** Render is behind the controls (manual mode) — the figures, like the model,
   *  don't yet reflect the latest edits. */
  stale?: boolean;
  /** Runtime "calculated value" rows from `echo("@info", label, unit, value)`
   *  in the design's .scad source — see lib/computedInfo.ts. Rendered as plain
   *  rows after the bounding box and param-@info rows, in echo order. */
  computed?: ComputedInfo[];
}

// One millimetre figure, always with at least one decimal (90 → "90.0").
function mm(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

// Format a parameter's value for display, appending the optional `@info` unit.
// Returns null when there's nothing worth showing (e.g. an empty string).
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

export function DimensionInfo({ design, size, values, stale = false, computed = [] }: Props) {
  // The headline bounding box, then any params flagged `// @info` that are still
  // visible under their @showIf (if any) and have a non-empty formatted value.
  const infoLines = design.params
    .filter((p) => p.info && isVisible(p, values))
    .map((p) => ({
      name: p.name,
      label: p.info!.label ?? p.description,
      value: formatValue(p, values),
    }))
    .filter((l): l is { name: string; label: string; value: string } => l.value !== null);

  return (
    <dl
      className={`dimension-info${stale ? " dimension-info--stale" : ""}`}
      aria-label="Model measurements"
    >
      <div className="dimension-info__row dimension-info__row--primary">
        <dt>Dimensions</dt>
        <dd>{`${mm(size.x)} × ${mm(size.y)} × ${mm(size.z)} mm`}</dd>
      </div>
      {infoLines.map((l) => (
        <div className="dimension-info__row" key={l.name}>
          <dt>{l.label}</dt>
          <dd>{l.value}</dd>
        </div>
      ))}
      {computed.map((c, i) => (
        <div className="dimension-info__row" key={`computed-${i}-${c.label}`}>
          <dt>{c.label}</dt>
          <dd>{c.value}</dd>
        </div>
      ))}
    </dl>
  );
}
