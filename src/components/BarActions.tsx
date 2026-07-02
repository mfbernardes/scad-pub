// BarActions.tsx — the top-bar action cluster: render status, theme toggle,
// Help and licenses buttons. Shared by the desktop CommandBar and the mobile
// top bar; the licenses wording differs per layout (and the capture scripts
// select on it), so it stays a prop. Extra layout-specific actions (the
// desktop Install button) append via children.
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
  children?: ReactNode;
}

export function BarActions({
  rendering,
  ready,
  result,
  stalePreview,
  themeMode,
  licensesLabel,
  children,
}: Props) {
  const { cycleTheme, showHelp, showLicenses } = useAppActions();
  return (
    <>
      <StatusPill rendering={rendering} ready={ready} result={result} stale={stalePreview} />
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
