// ParamSearch.tsx — the parameter search row (magnifier + input + clear button)
// shared by the desktop ParamPanel and the mobile SheetTabs Parameters tab, so
// both offer the same filter affordance. Controlled: the parent owns the value
// and its debounce (fed to ParamForm's `search`).
import { IconButton } from "./IconButton";
import { Search as SearchIcon, X as XIcon } from "lucide-react";

// Stable id for the search input. Only one layout is ever mounted at a time
// (see docs/architecture-review.md M7), so this id is never duplicated in the
// DOM — AppShell uses it to restore keyboard focus to the input after a
// desktop/mobile switch remounts it (see AppShell.tsx's own doc on its
// restoreSearchFocusRef — captured via document.activeElement, not via
// this component's onFocus/onBlur).
export const PARAM_SEARCH_INPUT_ID = "param-search-input";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  /** Kept as generic optional hooks for a future caller — no built-in
   *  consumer wires these up today (see PARAM_SEARCH_INPUT_ID's own doc for
   *  why the desktop/mobile focus-restore doesn't need them). */
  onFocus?: () => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
}

export function ParamSearch({ value, onChange, onClear, onFocus, onBlur }: Props) {
  return (
    <div className="flex shrink-0 items-center gap-[0.4rem] border-b px-[0.6rem] py-[0.35rem] text-muted-foreground">
      <SearchIcon size={14} />
      <input
        id={PARAM_SEARCH_INPUT_ID}
        type="search"
        name="param-search"
        autoComplete="off"
        // text-base (16px) keeps iOS Safari from auto-zooming on focus — it
        // zooms any focused input under 16px and never zooms back.
        className="min-w-0 flex-1 rounded-[4px] border-none bg-transparent p-0 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-offset-2 [&::-webkit-search-cancel-button]:appearance-none"
        placeholder="Find a setting…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        aria-label="Find a setting"
      />
      {value && (
        <IconButton label="Clear search" onClick={onClear}>
          <XIcon size={14} />
        </IconButton>
      )}
    </div>
  );
}
