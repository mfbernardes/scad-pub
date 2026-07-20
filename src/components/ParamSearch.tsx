// ParamSearch.tsx — the parameter search row (magnifier + input + clear button)
// shared by the desktop ParamPanel and the mobile SheetTabs Parameters tab, so
// both offer the same filter affordance. Controlled: the parent owns the value
// and its debounce (fed to ParamForm's `search`).
import { IconButton } from "./IconButton";
import { Search as SearchIcon, X as XIcon } from "lucide-react";
import { t } from "../lib/i18n";

// Stable id for the search input. Only one layout is ever mounted at a time
// (see docs/architecture-review.md M7), so this id is never duplicated in the
// DOM — AppShell uses it to restore keyboard focus to the input after a
// desktop/mobile switch remounts it (see AppShell.tsx's own doc on its
// restoreSearchFocusRef — captured via document.activeElement, not via
// this component's onBlur).
export const PARAM_SEARCH_INPUT_ID = "param-search-input";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  /** Kept as a generic optional hook for a future caller — no built-in
   *  consumer wires this up today (see PARAM_SEARCH_INPUT_ID's own doc for
   *  why the desktop/mobile focus-restore doesn't need it). */
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
}

export function ParamSearch({ value, onChange, onClear, onBlur }: Props) {
  return (
    // A proper bordered, rounded search box (mockup target) rather than a
    // full-bleed underlined toolbar row: it sits inset from the panel edges
    // like the param-group cards below it (--space-5 side margin), at the
    // same ~40px control height as the form's inputs/selects (--radius-control,
    // one border treatment — var(--line) via the `border` utility). mt-
    // (--space-5), not --space-4 (round-2 review fix): "panel sections
    // spaced ~24px block" — the gap from whatever renders above (the
    // Essential/All toggle, or the chip strip/tab strip when there's no
    // toggle to show).
    <div className="flex h-10 shrink-0 items-center gap-[0.5rem] mx-(--space-5) mt-(--space-5) mb-(--space-2) rounded-(--radius-control) border px-[0.75rem] text-muted-foreground">
      <SearchIcon size={14} />
      <input
        id={PARAM_SEARCH_INPUT_ID}
        type="search"
        name="param-search"
        autoComplete="off"
        // text-base (16px) keeps iOS Safari from auto-zooming on focus — it
        // zooms any focused input under 16px and never zooms back.
        className="min-w-0 flex-1 rounded-[4px] border-none bg-transparent p-0 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-offset-2 [&::-webkit-search-cancel-button]:appearance-none"
        placeholder={t("params.searchPlaceholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-label={t("params.searchAria")}
      />
      {value && (
        <IconButton label={t("params.clearSearch")} onClick={onClear}>
          <XIcon size={14} />
        </IconButton>
      )}
    </div>
  );
}
