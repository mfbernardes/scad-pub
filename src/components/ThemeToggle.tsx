// ThemeToggle.tsx: the three-mode (light / dark / auto) cycle button, shared by
// the desktop CommandBar and the mobile top bar so both layouts offer the same
// control. The cycle ORDER is theme.ts's nextThemeMode, not a constant here.
import type { ReactNode } from "react";
import { Sun as SunIcon, Moon as MoonIcon, SunMoon as AutoThemeIcon } from "lucide-react";
import { IconButton } from "./IconButton";
import { t } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";
import type { ThemeMode } from "../lib/theme";

/**
 * Per-mode icon and copy, shared by ThemeToggle (both top bars' inline
 * button) and BarActions' collapsed "⋮" menu row, so the two presentations
 * can't drift on icon or wording.
 *  - `icon`: the mode's glyph.
 *  - `nameKey` is the catalogue key for the mode's OWN name, used both by the
 *    icon-only button's "Switch to <name> theme" (where "what will happen" is
 *    more useful than "what mode this is") and by the mobile menu's
 *    "Theme: {mode}" row (where a click cycles in place and the label updating
 *    IS the feedback).
 *
 * There is deliberately no per-mode "next label" here any more: which mode a
 * press moves to depends on the OS preference (see theme.ts's nextThemeMode),
 * so a static map would name the wrong destination under half of them.
 */
export const THEME_MODE: Record<ThemeMode, { icon: ReactNode; nameKey: string }> = {
  light: { icon: <SunIcon size={16} />, nameKey: "theme.modeLight" },
  dark: { icon: <MoonIcon size={16} />, nameKey: "theme.modeDark" },
  auto: { icon: <AutoThemeIcon size={16} />, nameKey: "theme.modeAuto" },
};

export function ThemeToggle({
  mode,
  next,
  onCycle,
}: {
  mode: ThemeMode;
  /** The mode a press moves to (theme.ts's nextThemeMode), which the label names. */
  next: ThemeMode;
  onCycle: () => void;
}) {
  useLocale(); // subscription only: re-render this component's t() calls on a locale switch
  const label = t("theme.switchTo", { mode: t(THEME_MODE[next].nameKey).toLowerCase() });
  return (
    <IconButton label={label} title={label} onClick={onCycle}>
      {THEME_MODE[mode].icon}
    </IconButton>
  );
}
