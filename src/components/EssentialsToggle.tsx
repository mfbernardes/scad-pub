// EssentialsToggle.tsx — the "Show all settings"/"Show essential settings"
// control that reveals or hides a design's `// @advanced` params; the
// reveal-side label carries the count ("Show all settings (N more)").
//
// The count also gates rendering, and counts params that are `@advanced` AND
// currently visible under their own `@showIf` (see lib/essentials.ts) — so the
// control is absent in either mode exactly when pressing it would reveal or
// hide nothing. The state outlives the button, so a `@showIf` flipping back
// restores it in whichever mode is still in effect.
//
// Whether the feature is offered at all is AppShell's call: it withholds
// `onShowAdvancedChange` unless the config sets `ui.essentials`.
import type { Param } from "../openscad/types";
import type { Values } from "../lib/presets";
import { hiddenAdvancedCount } from "../lib/essentials";
import { cn } from "../lib/utils";
import { t, tn } from "../lib/i18n";
import { ChevronDown as MoreIcon, ChevronUp as FewerIcon } from "lucide-react";

export function EssentialsToggle({
  params,
  values,
  showAdvanced,
  onShowAdvancedChange,
  className,
}: {
  params: Param[];
  values: Values;
  showAdvanced: boolean;
  onShowAdvancedChange: (v: boolean) => void;
  /** Extra classes on the button (parent-supplied spacing). */
  className?: string;
}) {
  // The one gate — see the component doc. Zero means the toggle has nothing to
  // reveal (or, with `showAdvanced` on, nothing to hide), so it doesn't render.
  const count = hiddenAdvancedCount(params, values);
  if (count === 0) return null;
  const label = showAdvanced ? t("settings.showEssential") : tn("settings.showAllCount", count);
  const Icon = showAdvanced ? FewerIcon : MoreIcon;
  return (
    <button
      type="button"
      className={cn(
        // Full-width and bordered so it reads as the form's continuation —
        // "there is more past here" — rather than a stray link. Sized to a
        // comfortable touch target, since on mobile this is now the only way
        // to reach an advanced param.
        "essentials-toggle mb-3 flex w-full cursor-pointer items-center justify-center gap-[0.4rem] rounded-lg border bg-muted px-[0.8rem] py-[0.6rem] text-[0.85rem] font-semibold text-brand hover:border-brand",
        className
      )}
      onClick={() => onShowAdvancedChange(!showAdvanced)}
    >
      <Icon size={15} aria-hidden="true" className="shrink-0" />
      {label}
    </button>
  );
}
