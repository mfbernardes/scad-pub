// ViewPicker.tsx — the viewer's "choose a view" control: a glass HUD icon button
// that opens a small popover menu of the standard camera views (Isometric, Top,
// Front, …). It's an action menu, not a form select: clicking any view re-snaps
// the camera even if it's already the current one (so it doubles as "snap back"
// after you've orbited away). The active view is checkmarked.
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Box as ViewIcon, Check as CheckIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";
import { VIEW_OPTIONS, type ViewName } from "./views";

/** The HUD's glass icon-button decoration, shared by every button in the
 *  viewer HUD (IconButtons get it via className; the picker trigger below
 *  carries it directly). */
export const HUD_GLASS_BTN = "p-[0.45rem] glass-card";

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
          <ViewIcon size={18} />
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
