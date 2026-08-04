// format.ts: small formatting helpers shared by the viewer's measurements
// panel (DimensionInfo.tsx) and the pre-download review summary
// (reviewSummary.ts), so a millimetre figure or a parameter's display value
// reads identically wherever a visitor sees it. Dependency-light (only the
// schema/values types), no React.
import type { Param } from "../openscad/types";
import type { Values } from "./presets";
import { fontValueLabel } from "./fontChoices";
import { t, formatNumber } from "./i18n";

/** One millimetre figure, always with at least one decimal (90 -> "90.0").
 *  Display only (DimensionInfo, reviewSummary, the viewer's dimension
 *  overlay) — never feeds a render arg, URL state or an `<input>` value. */
export function mm(n: number): string {
  return formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * Format a parameter's current value for display, appending its optional
 * `@info` unit. Booleans render as Yes/No, enums by their choice label, and
 * an empty string is nothing worth showing (`null`): the same rules
 * DimensionInfo.tsx's `@info` rows and reviewSummary.ts's curated review rows
 * both need, so this is the one place they're written.
 *
 * A font parameter (`isFont`, whether typed as a raw string or a quoted-string
 * enum) is shown by the same friendly name the font dropdown uses
 * (`fontValueLabel`: `"Foo:style=Bold"` → `"Foo Bold"`), so a review row can
 * never disagree with the selector about what a font is called. Font values
 * carry no `@info` unit, so none is appended.
 */
export function formatParamValue(param: Param, values: Values): string | null {
  const raw = values[param.name] ?? param.default;
  const unit = param.info?.unit ? ` ${param.info.unit}` : "";
  if ((param.type === "string" || param.type === "enum") && param.isFont) {
    const s = String(raw).trim();
    return s ? fontValueLabel(s) : null;
  }
  switch (param.type) {
    case "boolean":
      return raw ? t("common.yes") : t("common.no");
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
