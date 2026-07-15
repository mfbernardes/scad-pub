// DesignPickerButton.tsx — the top-bar trigger shown instead of DesignPicker's
// Select when `ui.gallery` is enabled (see docs/config.md). Purely a trigger:
// the dialog itself is owned by App.tsx (App's `showPicker` state), reached
// here through AppActions so this stays a small, stateless view.
import { ChevronDown } from "lucide-react";
import type { Design } from "../openscad/types";
import { useAppActions } from "../lib/appActions";
import { t } from "../lib/i18n";

export function DesignPickerButton({ design }: { design: Design }) {
  const { showPicker } = useAppActions();
  return (
    <button
      type="button"
      className="design-picker-button font-display inline-flex h-7 min-w-0 shrink items-center gap-1 rounded-(--radius-sm) px-1 text-[0.88rem] font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t("picker.button")}
      onClick={showPicker}
    >
      <span className="min-w-0 truncate">{design.label}</span>
      <ChevronDown size={14} className="shrink-0 opacity-60" aria-hidden="true" />
    </button>
  );
}
