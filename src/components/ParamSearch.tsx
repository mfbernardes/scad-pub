// ParamSearch.tsx: the parameter search control (magnifier + input + clear
// button) shared by the desktop ParamPanel and the mobile SheetTabs Parameters
// tab, so both offer the same filter affordance. Controlled: the parent owns
// the value and its debounce (fed to ParamForm's `search`).
//
// Two presentations: a full-width bordered ROW (desktop, docked panel) and a
// `compact` bordered FIELD for the mobile sheet's form toolbar, which it now
// has entirely to itself, the essentials toggle having moved into the form's
// closing row and the section navigator being desktop-only (see SheetTabs).
import { IconButton } from "./IconButton";
import { Search as SearchIcon, X as XIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";

// Stable id for the search input. Only one layout is ever mounted at a time
// (see docs/architecture-review.md M7), so this id is never duplicated in the
// DOM. AppShell uses it to restore keyboard focus to the input after a
// desktop/mobile switch remounts it (see usePanelState's searchFocusedRef).
export const PARAM_SEARCH_INPUT_ID = "param-search-input";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Compact field form (mobile toolbar) instead of a full-width bordered row. */
  compact?: boolean;
  /** Extra classes on the wrapper (parent-supplied sizing/spacing). */
  className?: string;
}

export function ParamSearch({ value, onChange, onClear, onFocus, onBlur, compact = false, className }: Props) {
  useLocale(); // subscription only: re-render this component's t() calls on a locale switch
  return (
    <div
      className={cn(
        "param-search flex items-center gap-[0.4rem] text-muted-foreground",
        compact
          ? // A 44px touch target: the toolbar's whole height budget now that
            // this is the only control on it.
            "h-11 min-w-0 rounded-(--radius-sm) border bg-muted px-[0.6rem]"
          : "shrink-0 border-b px-[0.6rem] py-[0.35rem]",
        className
      )}
    >
      <SearchIcon size={14} className="shrink-0" />
      <input
        id={PARAM_SEARCH_INPUT_ID}
        type="search"
        name="param-search"
        autoComplete="off"
        // text-base (16px) keeps iOS Safari from auto-zooming on focus: it
        // zooms any focused input under 16px and never zooms back.
        className="min-w-0 flex-1 rounded-[4px] border-none bg-transparent p-0 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-offset-2 [&::-webkit-search-cancel-button]:appearance-none"
        placeholder={t("paramSearch.placeholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        aria-label={t("paramSearch.aria")}
      />
      {value && (
        <IconButton label={t("paramSearch.clear")} onClick={onClear}>
          <XIcon size={14} />
        </IconButton>
      )}
    </div>
  );
}
