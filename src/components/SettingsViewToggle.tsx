// SettingsViewToggle.tsx — the compact "Essential settings" / "All settings"
// segmented control at the top of the Customize tab (see CustomizeTab.tsx,
// which mounts it once for both the desktop panel and the mobile sheet). Two
// plain buttons rather than Radix Tabs: each is independently focusable and
// activates on Enter/Space with no extra keyboard wiring, and `role="group"`
// plus per-button `aria-pressed` gives assistive tech the same "which of two
// states is active" semantics a segmented control needs.
import { useAppActions } from "../lib/appActions";
import type { SettingsView } from "../lib/useExperience";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";

interface Props {
  view: SettingsView;
}

const optionClass = (active: boolean) =>
  cn(
    "flex-1 cursor-pointer rounded-(--radius-sm) border border-transparent px-3 py-[0.3rem] text-[0.82rem] font-medium text-muted-foreground transition-[color,box-shadow] focus-visible:outline-offset-2",
    active
      ? "border-(color:--line) bg-secondary text-brand shadow-none"
      : "hover:text-foreground"
  );

export function SettingsViewToggle({ view }: Props) {
  const { settingsViewChange } = useAppActions();
  return (
    <div
      // A standalone pill control (visible border on all sides), not a
      // full-bleed banner — inset from the panel edges like the search box
      // and param-group cards, not flush against them. mt-(--space-5), not
      // --space-4 (round-2 review fix): "panel sections spaced ~24px block"
      // — the gap from whatever renders above (the chip strip slot when
      // QuickStart is active, or the tab strip otherwise).
      className="settings-view-toggle mx-(--space-5) mt-(--space-5) flex shrink-0 items-center gap-1 rounded-(--radius-sm) border bg-background/50 p-[3px]"
      role="group"
      aria-label={t("settings.viewLabel")}
    >
      <button
        type="button"
        className={optionClass(view === "essentials")}
        aria-pressed={view === "essentials"}
        onClick={() => settingsViewChange("essentials")}
      >
        {t("settings.essential")}
      </button>
      <button
        type="button"
        className={optionClass(view === "all")}
        aria-pressed={view === "all"}
        onClick={() => settingsViewChange("all")}
      >
        {t("settings.all")}
      </button>
    </div>
  );
}
