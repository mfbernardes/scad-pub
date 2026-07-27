// EssentialsToggle.tsx — the "Show all settings"/"Show essential settings"
// control that reveals or hides a design's `// @advanced` params. The
// reveal-side label carries the count — "Show all settings (N more)".
//
// It renders only when that count is non-zero, i.e. when there is at least one
// `@advanced` param that is ALSO visible under its own `@showIf` right now.
// Both halves matter, and the count is what tests them together (see
// lib/essentials.ts). Gating on "the design declares an advanced param
// anywhere" — which is what this used to do — produced a dead control: a
// design whose advanced params are all `@showIf`-hidden at its defaults, a
// perfectly ordinary way to author one, offered "Show all settings", revealed
// nothing at all when pressed, and then renamed itself to "Show essential
// settings". The count is live, so the button appears and disappears as
// `@showIf` conditions turn its params on and off, which is exactly when it
// does and doesn't have work to do.
//
// The same reading applies on the hide side: when `showAdvanced` is on, the
// count is the number of advanced params currently ON SCREEN, so a zero there
// means "Show essential settings" would also do nothing, and the button is
// correctly absent. Nobody gets stranded in either mode, because the state
// outlives the button — flip a `@showIf` back and it returns, reading for
// whichever mode is still in effect.
//
// Whether the feature is offered AT ALL is the caller's call, not this
// component's: AppShell withholds `onShowAdvancedChange` unless the config
// sets `ui.essentials`, and ParamForm renders no toggle without it. That
// matches what docs/config.md and docs/annotations.md have always promised —
// `@advanced` hides params "when `ui.essentials` is enabled" — where before, a
// config that never opted in still got the toggle and could hide params its
// operator meant to be permanent.
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
