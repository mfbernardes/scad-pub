// BarOverflow.tsx — the mobile top bar's "⋮" overflow menu, collapsing the
// secondary actions (theme cycle, Help, licenses) that would otherwise crowd
// the narrow bar. A Popover of rows (same primitive as ViewPicker), so no new
// dependency. Desktop keeps these inline in the CommandBar.
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ICON_BUTTON_CLASS } from "./IconButton";
import { useAppActions } from "../lib/appActions";
import { cn } from "../lib/utils";
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
  // Help/licenses open a modal, so close the menu; theme cycles in place.
  const openModal = (fn: () => void) => () => { fn(); setOpen(false); };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Native button so PopoverTrigger's ref reaches the DOM (Radix anchors to
          it); styled to match the top bar's other icon buttons. */}
      <PopoverTrigger
        className={cn(ICON_BUTTON_CLASS, "inline-flex items-center justify-center rounded-md outline-none data-[state=open]:border-brand")}
        aria-label="More actions"
        title="More"
      >
        <MoreIcon size={16} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        <button type="button" className={rowClass} onClick={cycleTheme} aria-label="Toggle theme">
          {THEME_ICON[themeMode]} Theme
        </button>
        <button type="button" className={rowClass} onClick={openModal(showHelp)}>
          <HelpIcon size={16} /> Help
        </button>
        <button type="button" className={rowClass} onClick={openModal(showLicenses)}>
          <InfoIcon size={16} /> {licensesLabel}
        </button>
      </PopoverContent>
    </Popover>
  );
}
