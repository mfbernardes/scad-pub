// PresetDiffBar.tsx — Tier 1 of the unified preset diff/restore UX: a thin
// status strip at the top of the Parameters tab, shown only while the current
// values have drifted from the baseline (the selected preset, or the design's
// defaults when none is selected). Neutral/slate styling throughout — drifting
// from a preset is informational, not a warning (warn/amber stays reserved for
// stale previews and asserts). See ParamForm for the matching per-field (Tier
// 2) markers, which share the same baseline.
import type { Design } from "../openscad/types";
import type { Values } from "../lib/presets";
import type { SettingsView } from "../lib/useExperience";
import { useAppActions } from "../lib/appActions";
import { ResetButton } from "./ResetButton";
import { t, tn } from "../lib/i18n";
import { RotateCcw as ResetIcon } from "lucide-react";

interface Props {
  design: Design;
  values: Values;
  /** The selected preset's values, or null when no preset is selected (baseline is defaults). */
  presetBaseline: Values | null;
  /** The selected preset's display name, or null when no preset is selected. */
  presetName: string | null;
  /** Names of params whose value differs from the baseline. */
  changedParams: Set<string>;
  /** Essentials/all settings-view — passed through to ResetButton so its
   *  confirmation copy can mention hidden-by-view params the reset also
   *  affects. Optional so a future caller without the view concept still
   *  compiles (ResetButton treats an omitted view as "all", i.e. nothing hidden). */
  settingsView?: SettingsView;
}

export function PresetDiffBar({
  design,
  values,
  presetBaseline,
  presetName,
  changedParams,
  settingsView,
}: Props) {
  const { applyPreset, reset } = useAppActions();
  const changedCount = changedParams.size;
  if (changedCount === 0) return null;

  const countFrom = tn("diffbar.changeCount", changedCount);
  const barClass =
    "preset-diff flex items-center gap-2 border-b bg-muted px-3 py-[0.4rem] text-[0.8rem] text-muted-foreground";
  const actionBtnClass =
    "ml-auto inline-flex shrink-0 items-center gap-[0.3rem] rounded-(--radius-sm) border-none bg-transparent px-[0.4rem] py-[0.2rem] font-medium text-muted-foreground enabled:hover:text-foreground disabled:cursor-default disabled:opacity-40";

  if (presetBaseline) {
    return (
      <div className={barClass} role="region" aria-label={t("diffbar.changesFromAria", { name: presetName ?? "" })}>
        <span>
          {countFrom} <b className="font-semibold text-foreground">{presetName}</b>
        </span>
        <button
          type="button"
          className={actionBtnClass}
          onClick={() => applyPreset(presetBaseline)}
          aria-label={t("diffbar.revertTo", { name: presetName ?? "" })}
        >
          <ResetIcon size={13} className="shrink-0" /> {t("diffbar.revertTo", { name: presetName ?? "" })}
        </button>
      </div>
    );
  }

  return (
    <div className={barClass} role="region" aria-label={t("diffbar.changesFromDefaultsAria")}>
      <span>
        {countFrom} <b className="font-semibold text-foreground">{t("diffbar.defaultsLabel")}</b>
      </span>
      <ResetButton design={design} values={values} onReset={reset} view={settingsView} className={actionBtnClass}>
        <ResetIcon size={13} className="shrink-0" /> {t("diffbar.resetToDefaults")}
      </ResetButton>
    </div>
  );
}
