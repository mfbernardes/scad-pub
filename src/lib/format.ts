// format.ts — small formatting helpers shared by the viewer's measurements
// panel (DimensionInfo.tsx) and the pre-download review summary
// (reviewSummary.ts), so a millimetre figure or a parameter's display value
// reads identically wherever a visitor sees it. Dependency-light (only the
// schema/values types), no React — see dimensions.ts's own `mmLabel` for a
// visually similar but NOT identical helper (it appends the " mm" unit into
// the string itself, for a single-value 3D label; deliberately not folded in
// here — see its own doc).
import type { Param } from "../openscad/types";
import type { Values } from "./presets";

/** One millimetre figure, always with at least one decimal (90 -> "90.0"). */
export function mm(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/**
 * Format a parameter's current value for display, appending its optional
 * `@info` unit. Booleans render as Yes/No, enums by their choice label, and
 * an empty string is nothing worth showing (`null`) — the same rules
 * DimensionInfo.tsx's `@info` rows and reviewSummary.ts's curated review rows
 * both need, so this is the one place they're written.
 */
export function formatParamValue(param: Param, values: Values): string | null {
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
