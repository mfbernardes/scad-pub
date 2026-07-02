// BarActions.tsx — the desktop CommandBar's right cluster: render status, theme
// toggle, Help and licenses buttons. (On mobile these collapse differently —
// the Output bell rides in the top bar and theme/help/licenses go into a ⋮
// overflow — so the mobile top bar builds its own cluster.)
import type { RenderResult } from "../openscad/types";
import { useAppActions } from "../lib/appActions";
import { StatusPill } from "./StatusPill";
import { ThemeToggle } from "./ThemeToggle";
import { IconButton } from "./IconButton";
import { CircleHelp as HelpIcon, Info as InfoIcon } from "lucide-react";

interface Props {
  rendering: boolean;
  ready: boolean;
  result: RenderResult | null;
  stalePreview: boolean;
  themeMode: "light" | "dark" | "auto";
  /** Licenses-button wording (label doubles as the tooltip). */
  licensesLabel: string;
  /** Extra classes for the StatusPill (the bar pads it a touch and adds a hover tint). */
  pillClassName?: string;
}

export function BarActions({
  rendering,
  ready,
  result,
  stalePreview,
  themeMode,
  licensesLabel,
  pillClassName,
}: Props) {
  const { cycleTheme, showHelp, showLicenses } = useAppActions();
  return (
    <>
      <StatusPill
        rendering={rendering}
        ready={ready}
        result={result}
        stale={stalePreview}
        className={pillClassName}
      />
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
