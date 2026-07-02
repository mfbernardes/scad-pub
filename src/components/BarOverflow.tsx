// BarOverflow.tsx — the mobile top bar's "⋮" overflow menu, collapsing the
// secondary top-bar actions (theme cycle, Help, licenses) that would otherwise
// crowd the narrow bar. A Popover of menu rows (same primitive as ViewPicker),
// so no new dependency. Desktop keeps these inline in the CommandBar.
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useAppActions } from "../lib/appActions";
import {
  EllipsisVertical as MoreIcon,
  CircleHelp as HelpIcon,
  Info as InfoIcon,
  Sun as SunIcon,
  Moon as MoonIcon,
  SunMoon as AutoThemeIcon,
} from "lucide-react";

type ThemeMode = "light" | "dark" | "auto";
const THEME_ICON: Record<ThemeMode, React.ReactNode> = {
  light: <SunIcon size={16} />,
  dark: <MoonIcon size={16} />,
  auto: <AutoThemeIcon size={16} />,
};
// What the theme row switches to next (matches ThemeToggle's cycle).
const THEME_NEXT: Record<ThemeMode, string> = {
  light: "Switch to dark theme",
  dark: "Switch to auto theme",
  auto: "Switch to light theme",
};
const CURRENT: Record<ThemeMode, string> = { light: "Light", dark: "Dark", auto: "Auto" };

const rowClass =
  "flex w-full items-center gap-2 rounded-(--radius-sm) px-2 py-[0.45rem] text-left text-[0.9rem] text-foreground cursor-pointer hover:bg-muted focus-visible:bg-muted";

interface Props {
  themeMode: ThemeMode;
  /** Licenses row wording (e.g. "About & licenses"). */
  licensesLabel: string;
}

export function BarOverflow({ themeMode, licensesLabel }: Props) {
  const { cycleTheme, showHelp, showLicenses } = useAppActions();
  const [open, setOpen] = useState(false);
  const runAndClose = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Native button so PopoverTrigger's ref reaches the DOM; styled to match
          the top bar's other icon buttons (bg-muted, bordered). */}
      <PopoverTrigger asChild>
        <button
          type="button"
          className="icon-btn inline-flex size-8 cursor-pointer items-center justify-center rounded-(--radius-sm) border bg-muted p-[0.35rem] outline-none transition-all hover:border-brand focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:border-brand"
          aria-label="More actions"
          title="More"
        >
          <MoreIcon size={16} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        <ul className="flex flex-col gap-[0.1rem]">
          <li>
            {/* Theme cycles in place (menu stays open so you can step through). */}
            <button type="button" className={rowClass} onClick={cycleTheme} aria-label={THEME_NEXT[themeMode]}>
              {THEME_ICON[themeMode]} Theme
              <span className="ml-auto text-[0.8rem] text-muted-foreground">{CURRENT[themeMode]}</span>
            </button>
          </li>
          <li>
            <button type="button" className={rowClass} onClick={runAndClose(showHelp)}>
              <HelpIcon size={16} /> Help
            </button>
          </li>
          <li>
            <button type="button" className={rowClass} onClick={runAndClose(showLicenses)}>
              <InfoIcon size={16} /> {licensesLabel}
            </button>
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}
