// EssentialsToggle.tsx — the "Show all settings"/"Show essential settings"
// link that reveals or hides a design's `// @advanced` params, shared by the
// docked desktop panel (ParamPanel.tsx) and the mobile bottom sheet
// (SheetTabs.tsx). Renders nothing when the design has no advanced params.
// The reveal-side label carries the count of currently hidden params —
// "Show all settings (N more)" — which only reflects params that are visible
// under their own `@showIf` right now (see lib/essentials.ts).
//
// Two presentations: a text link on its own line (desktop) and a `compact`
// chip ("+N more" / "Fewer") that shares the mobile sheet's single form
// toolbar with the search field and the section navigator. The chip keeps the
// full sentence as its accessible name, so only the visible text is shortened.
import type { Param } from "../openscad/types";
import type { Values } from "../lib/presets";
import { essentialsToggleLabel } from "../lib/essentials";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";

export function EssentialsToggle({
  params,
  values,
  showAdvanced,
  onShowAdvancedChange,
  compact = false,
  className,
}: {
  params: Param[];
  values: Values;
  showAdvanced: boolean;
  onShowAdvancedChange: (v: boolean) => void;
  /** Compact chip form (mobile toolbar) instead of a full-width text link. */
  compact?: boolean;
  /** Extra classes on the button (parent-supplied spacing). */
  className?: string;
}) {
  if (!params.some((p) => p.advanced)) return null;
  const full = showAdvanced ? t("settings.showEssential") : essentialsToggleLabel(params, values);
  const text = compact
    ? showAdvanced
      ? t("settings.showEssentialShort")
      : essentialsToggleLabel(params, values, true)
    : full;
  return (
    <button
      type="button"
      className={cn(
        "essentials-toggle cursor-pointer",
        compact
          ? // A chip, sized to the toolbar's 44px band like its neighbours.
            "inline-flex h-11 shrink-0 items-center rounded-(--radius-sm) border bg-muted px-[0.6rem] text-[0.85rem] font-semibold whitespace-nowrap text-brand hover:border-brand"
          : "mx-3 mt-2 self-start text-sm font-semibold text-brand hover:underline",
        className
      )}
      onClick={() => onShowAdvancedChange(!showAdvanced)}
      aria-label={compact ? full : undefined}
      title={compact ? full : undefined}
    >
      {compact ? <span aria-hidden="true">{text}</span> : text}
    </button>
  );
}
