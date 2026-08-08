// ViewPicker.tsx: the viewer's "choose a view" control: a glass HUD icon button
// that opens a small popover menu of the standard camera views (Isometric, Top,
// Front, …). It's an action menu, not a form select: clicking any view re-snaps
// the camera even if it's already the current one (so it doubles as "snap back"
// after you've orbited away). The active view is checkmarked.
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Box as ViewIcon, Check as CheckIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { VIEW_OPTIONS, type ViewName } from "./views";
import { t } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";

/** The HUD's glass icon-button decoration, shared by every button in the
 *  viewer HUD (IconButtons get it via className; the picker trigger below
 *  carries it directly). */
export const HUD_GLASS_BTN =
  "p-[0.45rem] bg-(--glass-bg) border-(color:--glass-border) shadow-(--elevation)";

interface Props {
  /** The currently-applied view (checkmarked in the menu). */
  view: ViewName;
  /** Snap to a view (called on every click, including the current one). */
  onSelect: (view: ViewName) => void;
}

export function ViewPicker({ view, onSelect }: Props) {
  useLocale(); // subscription only: re-render this component's t() calls on a locale switch
  const [open, setOpen] = useState(false);
  const currentOption = VIEW_OPTIONS.find((o) => o.id === view);
  const current = currentOption ? t(currentOption.labelKey) : t("hud.viewHeading");
  const viewLabel = t("hud.viewLabel", { view: current });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Same hover/focus Tooltip treatment as the rest of the HUD
          (ViewerHUD.tsx's IconButton-based buttons): nested around the
          Popover trigger rather than composing IconButton itself here, since
          this trigger already needs to stay a plain-ref-forwarding native
          <button> serving BOTH the Tooltip's and the Popover's `asChild`;
          `title` stays too, as the no-JS/assistive fallback. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "icon-btn size-8 inline-flex items-center justify-center cursor-pointer outline-none transition-[background-color,border-color,color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50",
                "border rounded-(--radius-sm) hover:border-brand data-[state=open]:border-brand data-[state=open]:text-brand",
                HUD_GLASS_BTN
              )}
              aria-label={viewLabel}
              title={viewLabel}
            >
              <ViewIcon size={18} />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="left">{viewLabel}</TooltipContent>
      </Tooltip>
      <PopoverContent side="left" align="start" className="w-auto min-w-[9rem] p-1">
        <ViewOptionList
          view={view}
          onSelect={(v) => {
            onSelect(v);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The list of standard views, checkmarked at the active one. Extracted so the
 * desktop popover above and the mobile HUD's collapsed menu (ViewerHUD's
 * `collapse` branch) render the SAME list: what the views are, how the active
 * one is marked, and the fact that picking the current one re-snaps the camera
 * are all properties of the control, not of either layout.
 *
 * `listClassName` is the one genuine difference: the mobile menu lays the
 * seven options out two-up to stay one tap deep, where the desktop popover has
 * the height for a single column.
 */
export function ViewOptionList({
  view,
  onSelect,
  listClassName = "flex flex-col gap-[0.1rem]",
}: {
  view: ViewName;
  onSelect: (view: ViewName) => void;
  listClassName?: string;
}) {
  return (
    <ul className={listClassName}>
      {VIEW_OPTIONS.map((o) => {
        const active = o.id === view;
        return (
          <li key={o.id}>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-(--radius-sm) px-2 py-[0.4rem] text-left text-[0.85rem] text-foreground cursor-pointer hover:bg-muted focus-visible:bg-muted",
                active && "text-brand font-semibold"
              )}
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(o.id)}
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
  );
}
