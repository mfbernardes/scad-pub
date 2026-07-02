// BarActions.tsx — the desktop CommandBar's secondary right cluster: theme
// toggle, Help and licenses buttons. Render status now rides on the Output bell
// (see OutputToggle) alongside these. (On mobile theme/help/licenses collapse
// into a ⋮ overflow instead, so the mobile top bar builds its own cluster.)
import { useAppActions } from "../lib/appActions";
import { ThemeToggle } from "./ThemeToggle";
import { IconButton } from "./IconButton";
import { CircleHelp as HelpIcon, Info as InfoIcon } from "lucide-react";

interface Props {
  themeMode: "light" | "dark" | "auto";
  /** Licenses-button wording (label doubles as the tooltip). */
  licensesLabel: string;
}

export function BarActions({ themeMode, licensesLabel }: Props) {
  const { cycleTheme, showHelp, showLicenses } = useAppActions();
  return (
    <>
      <ThemeToggle mode={themeMode} onCycle={cycleTheme} />
      <IconButton label="Help" title="Help & keyboard shortcuts" onClick={showHelp}>
        <HelpIcon size={16} />
      </IconButton>
      <IconButton label={licensesLabel} title={licensesLabel} onClick={showLicenses}>
        <InfoIcon size={16} />
      </IconButton>
    </>
  );
}
