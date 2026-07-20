// reviewSummary.ts — derive a compact, automatic review from the same schema
// that renders the parameter form. Guided flow deliberately needs no separate
// review configuration: visible essential parameters become the summary.
import type { Design } from "../openscad/types";
import type { Values } from "./presets";
import { displayValue, paramLabel } from "./paramDiff";
import { isVisible } from "./visibility";

export interface ReviewRow {
  name: string;
  label: string;
  value: string;
}

/** Visible, non-advanced parameter values in declaration order. */
export function reviewRows(design: Design, values: Values): ReviewRow[] {
  return design.params
    .filter((param) => !param.advanced && isVisible(param, values))
    .map((param) => ({
      name: param.name,
      label: paramLabel(param),
      value: displayValue(param, values[param.name] ?? param.default),
    }));
}

/** A model bounding box in millimetres, rounded to one decimal place. */
export function reviewDimensions(size: { x: number; y: number; z: number } | null): string | null {
  if (!size) return null;
  const mm = (value: number) => (Math.round(value * 10) / 10).toFixed(1);
  return `${mm(size.x)} × ${mm(size.y)} × ${mm(size.z)} mm`;
}
