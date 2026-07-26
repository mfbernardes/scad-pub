// SectionNavigator.tsx — a lightweight "Jump to section" control shown above the
// parameter form. It orients a visitor in a long form WITHOUT restoring a guided
// stepper: no completion state, no locked steps, no required order, no Review
// stage. The form stays freely editable in any order; picking a section merely
// opens it, scrolls it into view, and focuses its summary (see ParamForm's
// `openSection`). It's an action menu, not a select — re-selecting the current
// section re-scrolls to it (handy after scrolling away).
//
// The section list is derived by the parent from lib/paramGroups.ts — the SAME
// visible-section computation the form renders — so it narrows in lockstep as a
// search filters or the essentials toggle hides advanced params.
import { useState } from "react";
import { List as JumpIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";

// A design earns the navigator only once it has at least this many visible
// sections; a 1–3 section form is short enough to scan without it. Counted from
// the same visible-section list the form shows, so search/essentials filtering
// can drop the control back below the threshold live.
export const MIN_SECTIONS_FOR_NAV = 4;

interface Props {
  /** Visible section names, in form order (from lib/paramGroups.ts). */
  sections: string[];
  /** Open + scroll + focus the chosen section (ParamForm's `openSection`). */
  onSelect: (section: string) => void;
  /** Mobile compact icon-only trigger; desktop (default) shows a labeled row. */
  compact?: boolean;
  /** Extra classes on the trigger (parent-supplied spacing). */
  className?: string;
}

export function SectionNavigator({ sections, onSelect, compact = false, className }: Props) {
  const [open, setOpen] = useState(false);
  // Below the threshold the form is short enough that a jump control is noise.
  if (sections.length < MIN_SECTIONS_FOR_NAV) return null;
  const label = t("settings.jumpToSection");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            "section-nav-trigger inline-flex cursor-pointer items-center gap-[0.4rem] rounded-(--radius-sm) border bg-muted text-foreground transition-[background-color,border-color,color,box-shadow] hover:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:border-brand data-[state=open]:text-brand",
            compact
              ? "size-8 justify-center p-[0.35rem]"
              : "px-[0.6rem] py-[0.35rem] text-[0.85rem] font-semibold",
            className
          )}
        >
          <JumpIcon size={15} aria-hidden="true" />
          {!compact && <span>{label}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        // Wrap long labels and scroll a long list; never clip (also holds up
        // under browser zoom). Not width-locked to the trigger — the compact
        // icon trigger is far narrower than a readable menu.
        className="section-nav-list max-h-[min(60vh,20rem)] w-auto min-w-[12rem] max-w-[min(20rem,80vw)] overflow-y-auto p-1"
      >
        <ul className="flex flex-col gap-[0.1rem]">
          {sections.map((section) => (
            <li key={section}>
              <button
                type="button"
                className="section-nav-item flex w-full cursor-pointer items-start rounded-(--radius-sm) px-2 py-[0.4rem] text-left text-[0.85rem] text-foreground [overflow-wrap:anywhere] hover:bg-muted focus-visible:bg-muted"
                onClick={() => {
                  onSelect(section);
                  setOpen(false);
                }}
              >
                {section}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
