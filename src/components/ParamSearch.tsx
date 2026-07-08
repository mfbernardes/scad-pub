// ParamSearch.tsx — the parameter search row (magnifier + input + clear button)
// shared by the desktop ParamPanel and the mobile SheetTabs Parameters tab, so
// both offer the same filter affordance. Controlled: the parent owns the value
// and its debounce (fed to ParamForm's `search`).
import { IconButton } from "./IconButton";
import { Search as SearchIcon, X as XIcon } from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}

export function ParamSearch({ value, onChange, onClear }: Props) {
  return (
    <div className="flex shrink-0 items-center gap-[0.4rem] border-b px-[0.6rem] py-[0.35rem] text-muted-foreground">
      <SearchIcon size={14} />
      <input
        type="search"
        name="param-search"
        autoComplete="off"
        // text-base (16px) at/below the 860px mobile breakpoint keeps iOS
        // Safari from auto-zooming on focus (it zooms any focused input under
        // 16px and never zooms back); the min-[861px] desktop layout restores
        // the 14px size. Breakpoint tracks useIsMobile / the CSS at 860px.
        className="min-w-0 flex-1 rounded-[4px] border-none bg-transparent p-0 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-offset-2 min-[861px]:text-sm [&::-webkit-search-cancel-button]:appearance-none"
        placeholder="Find a setting…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
