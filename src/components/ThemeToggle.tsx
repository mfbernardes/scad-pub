// ThemeToggle.tsx — the light → dark → auto cycle button, shared by the desktop
// CommandBar and the mobile top bar so both layouts offer the same control.
import { Sun as SunIcon, Moon as MoonIcon, SunMoon as AutoThemeIcon } from "lucide-react";
import { IconButton } from "./IconButton";
import { t } from "../lib/i18n";

type ThemeMode = "light" | "dark" | "auto";

const ICON: Record<ThemeMode, React.ReactNode> = {
  light: <SunIcon size={16} />,
  dark: <MoonIcon size={16} />,
  auto: <AutoThemeIcon size={16} />,
};
// Label names the *next* theme in the cycle (what clicking switches to).
const LABEL_KEY: Record<ThemeMode, string> = {
  light: "theme.toDark",
  dark: "theme.toAuto",
  auto: "theme.toLight",
};

export function ThemeToggle({ mode, onCycle }: { mode: ThemeMode; onCycle: () => void }) {
  return (
    <IconButton label={t(LABEL_KEY[mode])} title={t(LABEL_KEY[mode])} onClick={onCycle}>
      {ICON[mode]}
    </IconButton>
  );
}
