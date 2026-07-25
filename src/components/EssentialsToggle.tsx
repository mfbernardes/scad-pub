// EssentialsToggle.tsx — the "Show all settings"/"Show essential settings"
// link that reveals or hides a design's `// @advanced` params, shared verbatim
// by the docked desktop panel (ParamPanel.tsx) and the mobile bottom sheet
// (SheetTabs.tsx). Renders nothing when the design has no advanced params.
// The reveal-side label carries the count of currently hidden params —
// "Show all settings (N more)" — which only reflects params that are visible
// under their own `@showIf` right now (see lib/essentials.ts).
import type { Param } from "../openscad/types";
import type { Values } from "../lib/presets";
import { essentialsToggleLabel } from "../lib/essentials";
import { t } from "../lib/i18n";

export function EssentialsToggle({
  params,
  values,
  showAdvanced,
  onShowAdvancedChange,
}: {
  params: Param[];
  values: Values;
  showAdvanced: boolean;
  onShowAdvancedChange: (v: boolean) => void;
}) {
  if (!params.some((p) => p.advanced)) return null;
  return (
    <button
      type="button"
      className="mx-3 mt-2 self-start text-sm font-semibold text-brand hover:underline"
      onClick={() => onShowAdvancedChange(!showAdvanced)}
    >
      {showAdvanced ? t("settings.showEssential") : essentialsToggleLabel(params, values)}
    </button>
  );
}
