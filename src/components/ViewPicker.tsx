// ViewPicker.tsx — the viewer's "choose a view" control: a glass HUD icon button
// that opens a small popover menu of the standard camera views (Isometric, Top,
// Front, …). It's an action menu, not a form select: clicking any view re-snaps
// the camera even if it's already the current one (so it doubles as "snap back"
// after you've orbited away). The active view is checkmarked.
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Box as ViewIcon, Check as CheckIcon } from "lucide-react";
import { VIEW_OPTIONS, type ViewName } from "./views";

interface Props {
  /** The currently-applied view (checkmarked in the menu). */
  view: ViewName;
  /** Snap to a view (called on every click, including the current one). */
  onSelect: (view: ViewName) => void;
}

export function ViewPicker({ view, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const current = VIEW_OPTIONS.find((o) => o.id === view)?.label ?? "View";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Native button so PopoverTrigger's ref reaches the DOM (Radix anchors to
          it); styled to match the HUD's glass icon buttons (.viewer-hud .icon-btn). */}
      <PopoverTrigger asChild>
        <button
          type="button"
          className="icon-btn size-8 inline-flex items-center justify-center cursor-pointer outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label={`View: ${current}`}
          title={`View: ${current}`}
        >
          <ViewIcon size={18} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-auto min-w-[9rem] p-1">
        <ul className="view-picker__list">
          {VIEW_OPTIONS.map((o) => {
            const active = o.id === view;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  className={`view-picker__item${active ? " view-picker__item--active" : ""}`}
                  aria-current={active ? "true" : undefined}
                  onClick={() => {
                    onSelect(o.id);
                    setOpen(false);
                  }}
                >
                  <span className="view-picker__check" aria-hidden="true">
                    {active && <CheckIcon size={15} />}
                  </span>
                  {o.label}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
