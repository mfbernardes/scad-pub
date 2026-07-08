// paramDiff.ts — pure param-value diffing shared by the render metrics telemetry
// and the Parameters tab's "drifted from baseline" UI (PresetDiffBar + ParamForm
// per-field markers). A param's "baseline" is whichever snapshot the caller is
// comparing against — the selected preset's values, or the design's defaults.
import type { Param, ParamValue } from "../openscad/types";
import type { Values } from "./presets";

/** A param's display label: its Customizer description, falling back to the
 *  underlying OpenSCAD variable name. */
export const paramLabel = (p: Param): string => p.description || p.name;

/**
 * The params whose value differs between two snapshots, in declaration order.
 * JSON.stringify gives a cheap, stable equality across the value's
 * number/string/boolean shapes without needing a per-type comparator; a
 * missing key falls back to the param's own default (matches how `Values`
 * behaves when read directly).
 */
export function changedParams(params: Param[], prev: Values, next: Values): Param[] {
  return params.filter((p) => {
    const before = JSON.stringify(prev[p.name] ?? p.default);
    const after = JSON.stringify(next[p.name] ?? p.default);
    return before !== after;
  });
}

/** A friendly one-liner for a param's value, for "was <value>" text. */
export function displayValue(p: Param, v: ParamValue): string {
  if (p.type === "boolean") return v ? "on" : "off";
  if (p.type === "enum") return p.choices.find((c) => c.value === String(v))?.label ?? String(v);
  return String(v);
}
