// BarActions.tsx — the secondary actions shared by both top bars: Save image
// (PNG), theme toggle, Help, and open-source licenses. One component, two
// presentations chosen by the `collapse` prop (the caller knows which layout
// it's in — both layout trees mount at once, so a viewport hook would render
// a stray hidden ⋮ button):
//   • inline (desktop CommandBar): four icon buttons in a row.
//   • collapsed (mobile top bar): a single "⋮" Popover of rows, so the narrow
//     bar stays uncluttered.
// Render status rides separately on the Output bell (see OutputToggle).
//
// Save-image moved here from the export dock (ActionButtons.tsx) in Phase 2's
// unified two-button dock (Download + Share only) — it's a lower-frequency
// secondary action, and this is where the app's other secondary chrome
// (theme/help/licenses) already lives in both layouts, so it needs no new
// overflow surface of its own.
import { useState } from "react";
import { useAppActions } from "../lib/appActions";
import { ThemeToggle } from "./ThemeToggle";
import { IconButton, ICON_BUTTON_CLASS } from "./IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { cn } from "../lib/utils";
import {
  CircleHelp as HelpIcon,
  Image as ImageIcon,
  Info as InfoIcon,
  EllipsisVertical as MoreIcon,
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

// One wording for the licenses control in both presentations.
const LICENSES_LABEL = "Open-source licenses";

const rowClass =
  "flex w-full items-center gap-2 rounded-(--radius-sm) px-2 py-[0.45rem] text-left text-[0.9rem] text-foreground cursor-pointer hover:bg-muted focus-visible:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

interface Props {
  themeMode: ThemeMode;
  /** Collapse into a "⋮" overflow menu (mobile) instead of inline buttons (desktop). */
  collapse?: boolean;
  /** Present -> render the Save-image action (both presentations). Omitted
   *  entirely by a caller that has nowhere for it to act (there is none
   *  currently, but this keeps the action optional rather than assumed). */
  onSavePng?: () => void;
  /** Gates Save-image the same way the dock's Download button is gated for
   *  its direct-export path — a successful render matching the live controls. */
  canSavePng?: boolean;
}

export function BarActions({ themeMode, collapse = false, onSavePng, canSavePng = true }: Props) {
  const { cycleTheme, showHelp, showLicenses } = useAppActions();
  const [open, setOpen] = useState(false);
  // Help/licenses/Save-image close the menu; theme cycles in place.
  const openModal = (fn: () => void) => () => { fn(); setOpen(false); };

  if (collapse) {
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
          {onSavePng && (
            <button
              type="button"
              className={rowClass}
              onClick={openModal(onSavePng)}
              disabled={!canSavePng}
              aria-label="Save image"
            >
              <ImageIcon size={16} /> Save image
            </button>
          )}
          <button type="button" className={rowClass} onClick={cycleTheme} aria-label="Toggle theme">
            {THEME_ICON[themeMode]} Theme
          </button>
          <button type="button" className={rowClass} onClick={openModal(() => showHelp())}>
            <HelpIcon size={16} /> Help
          </button>
          <button type="button" className={rowClass} onClick={openModal(showLicenses)}>
            <InfoIcon size={16} /> {LICENSES_LABEL}
          </button>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <>
      {onSavePng && (
        <IconButton
          label="Save image"
          title="Save image (PNG)"
          onClick={onSavePng}
          disabled={!canSavePng}
        >
          <ImageIcon size={16} />
        </IconButton>
      )}
      <ThemeToggle mode={themeMode} onCycle={cycleTheme} />
      <IconButton label="Help" title="Help & keyboard shortcuts" onClick={() => showHelp()}>
        <HelpIcon size={16} />
      </IconButton>
      <IconButton label={LICENSES_LABEL} title={LICENSES_LABEL} onClick={showLicenses}>
        <InfoIcon size={16} />
      </IconButton>
    </>
  );
}
