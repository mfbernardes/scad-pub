// EssentialsToggle.tsx — the "Show all settings"/"Show essential settings"
// control that reveals or hides a design's `// @advanced` params. Renders
// nothing when the design has no advanced params. The reveal-side label
// carries the count of currently hidden params — "Show all settings (N more)"
// — which only reflects params that are visible under their own `@showIf`
// right now (see lib/essentials.ts).
//
// It lives at the END of the parameter form (ParamForm renders it after the
// last group), in one presentation for both layouts. It used to sit above the
// form — a text link on its own line on desktop, a "+N more" chip sharing the
// mobile sheet's toolbar row with the search field and the section navigator.
// Both were the wrong place for it twice over: it is a MODE, not one of the
// "find the setting I want" controls it was filed beside, and putting it
// before the form asks the visitor to decide how much form they want before
// they have seen any of it. At the end it is plain progressive disclosure —
// you reach the bottom of the essentials, and the way to more is right there.
// Being a full-width row rather than a chip is also what lets the mobile
// toolbar collapse to a single search field.
import type { Param } from "../openscad/types";
import type { Values } from "../lib/presets";
import { essentialsToggleLabel } from "../lib/essentials";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";
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
  if (!params.some((p) => p.advanced)) return null;
  const label = showAdvanced ? t("settings.showEssential") : essentialsToggleLabel(params, values);
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
