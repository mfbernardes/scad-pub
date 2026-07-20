// ViewPicker.tsx — the viewer's "choose a view" control: a glass HUD icon button
// that opens a small popover menu of the standard camera views (the default
// Product view, Isometric, Top, Front, …). It's an action menu, not a form
// select: clicking any view re-snaps the camera even if it's already the
// current one (so it doubles as "snap back" after you've orbited away). The
// active view is checkmarked.
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Box as ViewIcon, Check as CheckIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";
import { VIEW_OPTIONS, type ViewName } from "./views";

/** The HUD's glass icon-button decoration, shared by every button in the
 *  viewer HUD (IconButtons get it via className; the picker trigger below
 *  carries it directly). Deliberately quieter than the old chrome-forward
 *  style — a lighter shadow (--shadow-1, not --elevation) and a muted icon
 *  colour that only brightens on hover/focus — so the controls read as
 *  secondary to the model itself (the design review's "still looks like a
 *  CAD workspace" complaint). size-10 keeps the tap target at the WCAG
 *  44px-ish minimum even though the visible glass surface reads smaller;
 *  round-2 review item 2 drops that to size-9 below the mobile breakpoint —
 *  still a real touch target, but a hair less dominant on a small screen
 *  where the HUD's own strip already eats into the model's clear space (see
 *  framing.ts's computeViewerInsets, which reserves room for exactly this
 *  strip). Uses --glass-bg/--glass-border directly rather than the
 *  `glass-card` utility (src/index.css) because it deliberately swaps in
 *  --shadow-1 instead of glass-card's baked-in --elevation. */
export const HUD_GLASS_BTN =
  "size-10 max-[860px]:size-9 p-[0.4rem] max-[860px]:p-[0.3rem] bg-(--glass-bg) border-(color:--glass-border) shadow-(--shadow-1) text-muted-foreground hover:text-foreground";

interface Props {
  /** The currently-applied view (checkmarked in the menu). */
  view: ViewName;
  /** Snap to a view (called on every click, including the current one). */
  onSelect: (view: ViewName) => void;
}

export function ViewPicker({ view, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const currentOption = VIEW_OPTIONS.find((o) => o.id === view);
  const current = currentOption ? t(currentOption.labelKey) : t("view.fallback");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Native button so PopoverTrigger's ref reaches the DOM (Radix anchors to
          it); styled to match the HUD's glass icon buttons. Its radius is the
          smaller --radius-sm (the pre-port value), unlike the shadcn Buttons. */}
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "icon-btn size-8 inline-flex items-center justify-center cursor-pointer outline-none transition-[background-color,border-color,color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50",
            "border rounded-(--radius-sm) hover:border-brand data-[state=open]:border-brand data-[state=open]:text-brand",
            HUD_GLASS_BTN
          )}
          aria-label={t("view.currentAria", { view: current })}
          title={t("view.currentAria", { view: current })}
        >
          <ViewIcon size={16} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-auto min-w-[9rem] p-1">
        <ul className="flex flex-col gap-[0.1rem]">
          {VIEW_OPTIONS.map((o) => {
            const active = o.id === view;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-(--radius-sm) px-2 py-[0.35rem] text-left text-[0.85rem] text-foreground cursor-pointer hover:bg-muted focus-visible:bg-muted",
                    active && "text-brand font-semibold"
                  )}
                  aria-current={active ? "true" : undefined}
                  onClick={() => {
                    onSelect(o.id);
                    setOpen(false);
                  }}
                >
                  {/* Fixed-width slot so labels align whether or not checkmarked. */}
                  <span className="inline-flex w-4 shrink-0 text-brand" aria-hidden="true">
                    {active && <CheckIcon size={15} />}
                  </span>
                  {t(o.labelKey)}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
