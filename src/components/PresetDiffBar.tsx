// PresetDiffBar.tsx — Tier 1 of the unified preset diff/restore UX: a thin
// status strip at the top of the Parameters tab, shown only while the current
// values have drifted from the baseline (the selected preset, or the design's
// defaults when none is selected). Neutral/slate styling throughout — drifting
// from a preset is informational, not a warning (warn/amber stays reserved for
// stale previews and asserts). See ParamForm for the matching per-field (Tier
// 2) markers, which share the same baseline.
//
// The strip is ONE line at every width, which is what the markup below is
// arranged to guarantee. Spelling the baseline's name twice — in the summary
// and again inside the action ("Revert to <name>") — wraps to two lines, because
// neither side can shrink: the summary is a flex item at its default
// `min-width: auto`, so it cannot go below its longest word, and the action is
// `shrink-0`. A preset whose name ran to ~50 characters — routine once a
// name carries a qualifier and a language tag — therefore collapsed the
// summary into a tall one-word column on a phone while the action still
// overflowed off-screen. So: the name is said
// once, in the summary, which is `min-w-0` + `truncate` and carries the full
// text in `title`; the action is the bare verb, with the full "Revert to
// <name>" kept on its aria-label/title for assistive tech and hover. One
// presentation for both layouts — the docked desktop panel is resizable and
// narrows to the same problem.
import type { Design } from "../openscad/types";
import type { Values } from "../lib/presets";
import { useAppActions } from "../lib/appActions";
import { ResetButton } from "./ResetButton";
import { RotateCcw as ResetIcon } from "lucide-react";
import { t, tn } from "../lib/i18n";

interface Props {
  design: Design;
  values: Values;
  /** The selected preset's values, or null when no preset is selected (baseline is defaults). */
  presetBaseline: Values | null;
  /** The selected preset's display name, or null when no preset is selected. */
  presetName: string | null;
  /** Names of params whose value differs from the baseline. */
  changedParams: Set<string>;
}

export function PresetDiffBar({ design, values, presetBaseline, presetName, changedParams }: Props) {
  const { applyPreset, reset } = useAppActions();
  const changedCount = changedParams.size;
  if (changedCount === 0) return null;

  const lead = tn("presetDiff.changesFrom", changedCount);
  const baselineName = presetBaseline && presetName ? presetName : t("presetDiff.defaults");
  const barClass =
    "preset-diff flex items-center gap-2 border-b bg-muted px-3 py-[0.4rem] text-[0.8rem] text-muted-foreground";
  // `shrink-0` so the verb survives at any width; the summary beside it is the
  // part that gives, and it truncates rather than wrapping.
  const actionBtnClass =
    "inline-flex shrink-0 items-center gap-[0.3rem] rounded-(--radius-sm) border-none bg-transparent px-[0.4rem] py-[0.2rem] font-medium text-muted-foreground enabled:hover:text-foreground disabled:cursor-default disabled:opacity-40";
  const summary = (
    // min-w-0 lets this flex item shrink past its longest word so `truncate`
    // can actually take effect (see the component doc above).
    <span className="min-w-0 flex-1 truncate" title={`${lead} ${baselineName}`}>
      {lead} <b className="font-semibold text-foreground">{baselineName}</b>
    </span>
  );

  if (presetBaseline) {
    const revertTo = t("presetDiff.revertTo", { name: baselineName });
    return (
      <div className={barClass} role="region" aria-label={t("presetDiff.region", { name: baselineName })}>
        {summary}
        <button
          type="button"
          className={actionBtnClass}
          onClick={() => applyPreset(presetBaseline)}
          aria-label={revertTo}
          title={revertTo}
        >
          <ResetIcon size={13} className="shrink-0" /> {t("presetDiff.revert")}
        </button>
      </div>
    );
  }

  return (
    <div className={barClass} role="region" aria-label={t("presetDiff.region", { name: baselineName })}>
      {summary}
      {/* ResetButton supplies its own "Reset to defaults" aria-label + title
          and the confirm dialog; this only names the visible verb. */}
      <ResetButton design={design} values={values} onReset={reset} className={actionBtnClass}>
        <ResetIcon size={13} className="shrink-0" /> {t("presetDiff.reset")}
      </ResetButton>
    </div>
  );
}
