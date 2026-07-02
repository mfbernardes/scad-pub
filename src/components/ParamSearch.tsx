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
        type="text"
        className="min-w-0 flex-1 border-none bg-transparent p-0 text-foreground placeholder:text-muted-foreground focus:outline-none"
        placeholder="Search parameters…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Search parameters"
      />
      {value && (
        <IconButton label="Clear search" onClick={onClear}>
          <XIcon size={14} />
        </IconButton>
      )}
    </div>
  );
}
