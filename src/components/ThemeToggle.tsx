// ThemeToggle.tsx: the light → dark → auto cycle button, shared by the desktop
// CommandBar and the mobile top bar so both layouts offer the same control.
import type { ReactNode } from "react";
import { Sun as SunIcon, Moon as MoonIcon, SunMoon as AutoThemeIcon } from "lucide-react";
import { IconButton } from "./IconButton";

type ThemeMode = "light" | "dark" | "auto";

/**
 * Per-mode icon and copy, shared by ThemeToggle (both top bars' inline
 * button) and BarActions' collapsed "⋮" menu row, so the two presentations
 * can't drift on icon or wording.
 *  - `icon`: the mode's glyph.
 *  - `nextLabel` names the *next* theme in the cycle (what clicking
 *    switches to) — what the icon-only button needs, where "what will
 *    happen" is more useful than "what mode this is".
 *  - `nameKey` is the catalogue key for the mode's OWN name (e.g. the
 *    mobile menu's "Theme: {mode}" row, where a click cycles in place and
 *    the label updating IS the feedback) — the opposite of `nextLabel`.
 */
export const THEME_MODE: Record<ThemeMode, { icon: ReactNode; nextLabel: string; nameKey: string }> = {
  light: { icon: <SunIcon size={16} />, nextLabel: "Switch to dark theme", nameKey: "theme.modeLight" },
  dark: { icon: <MoonIcon size={16} />, nextLabel: "Switch to auto theme", nameKey: "theme.modeDark" },
  auto: { icon: <AutoThemeIcon size={16} />, nextLabel: "Switch to light theme", nameKey: "theme.modeAuto" },
};

export function ThemeToggle({ mode, onCycle }: { mode: ThemeMode; onCycle: () => void }) {
  const { icon, nextLabel } = THEME_MODE[mode];
  return (
    <IconButton label={nextLabel} title={nextLabel} onClick={onCycle}>
      {icon}
    </IconButton>
  );
}
