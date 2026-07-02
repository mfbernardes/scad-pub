// BarActions.tsx — the top-bar action cluster: render status, theme toggle,
// Help and licenses buttons. Shared by the desktop CommandBar and the mobile
// top bar; the licenses wording differs per layout (and the capture scripts
// select on it), so it stays a prop. Extra layout-specific actions append via
// children.
import type { ReactNode } from "react";
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
  /** Show the render-status pill (default true). The mobile top bar hides it —
   *  the StaleBanner, the loading spinner and the render-failed toast already
   *  convey state there, and the narrow bar needs the width. */
  showStatus?: boolean;
  /** Extra classes for the StatusPill (the desktop bar pads it a touch more
   *  and gives it a hover tint). */
  pillClassName?: string;
  children?: ReactNode;
}

export function BarActions({
  rendering,
  ready,
  result,
  stalePreview,
  themeMode,
  licensesLabel,
  showStatus = true,
  pillClassName,
  children,
}: Props) {
  const { cycleTheme, showHelp, showLicenses } = useAppActions();
  return (
    <>
      {showStatus && (
        <StatusPill
          rendering={rendering}
          ready={ready}
          result={result}
          stale={stalePreview}
          className={pillClassName}
        />
      )}
      <ThemeToggle mode={themeMode} onCycle={cycleTheme} />
      <IconButton label="Help" title="Help & keyboard shortcuts" onClick={showHelp}>
        <HelpIcon size={16} />
      </IconButton>
      <IconButton label={licensesLabel} title={licensesLabel} onClick={showLicenses}>
        <InfoIcon size={16} />
      </IconButton>
      {children}
    </>
  );
}
