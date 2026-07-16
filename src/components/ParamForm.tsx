// ParamForm.tsx — renders the design's Customizer parameters grouped by
// section, driven entirely by the generated schema. This is now a thin
// arrangement: it derives the section list from the design (section name ->
// that section's own, unfiltered params — exactly `design.sections` paired
// with each section's params, as before) and mounts ParamRows
// (src/components/ParamRows.tsx) once to render it. Every per-row behavior
// (controls by type, help popovers, showIf/view filtering, preset-diff
// markers + revert, font hints, SVG controls, `data-param`, focusParam
// handling, collapsed/<details> semantics, search force-open) lives there —
// see that file's own header comment.
import { memo, useMemo } from "react";
import type { Design, ParamValue } from "../openscad/types";
import type { Values } from "../lib/presets";
import type { SettingsView } from "../lib/useExperience";
import type { InstalledFont } from "../lib/fonts";
import { ParamRows, type FocusParamRequest, type ParamSectionGroup } from "./ParamRows";

export type { FocusParamRequest } from "./ParamRows";

interface Props {
  design: Design;
  values: Values;
  onChange: (name: string, value: ParamValue) => void;
  /** Optional search query to filter visible parameters by name/description. */
  search?: string;
  /** Show the underlying OpenSCAD variable name beside each label (default false). */
  showVarName?: boolean;
  /**
   * Normalised set of font families the renderer can use (bundled ∪ imported).
   * When provided and non-empty, a `font` parameter whose family isn't in it
   * shows an inline "not loaded" hint with import / fallback actions. Omitted or
   * empty → no font checking (we can't be authoritative, so we don't warn).
   */
  availableFontFamilies?: Set<string>;
  /** A bundled family offered as a one-click fallback for a missing font. */
  fontSuggestion?: string | null;
  /**
   * Every face the renderer can use right now (bundled ∪ imported), display-
   * ordered. When non-empty, a `font` parameter renders as the FontSelect
   * dropdown listing these under friendly names instead of a raw string/enum
   * control. Omitted or empty → the plain control (we can't be authoritative).
   */
  installedFonts?: InstalledFont[];
  /**
   * Tier-2 preset-diff markers: the values a drifted param is compared against
   * (the selected preset, or design defaults — see App.tsx/PresetDiffBar) and
   * the set of param names currently drifted from it. Both optional so the
   * form still works for a caller that doesn't wire up the diff (e.g. a future
   * standalone use); omitting either suppresses the markers entirely.
   */
  baseline?: Values;
  changedParams?: Set<string>;
  /** The selected preset's display name, used to name the revert target in the
   *  per-field revert button ("to <preset>" vs "to default" when none). */
  presetName?: string | null;
  /** Essentials/all settings-view: composed with `@showIf` visibility (see
   *  isShown) to decide which params render. Defaults to "all" (no
   *  filtering) so a caller that doesn't care about the view still compiles. */
  view?: SettingsView;
  /** Set (with a fresh `nonce` per request, so a repeat click on the same
   *  param retriggers) to open that param's section, scroll it into view and
   *  focus its control — the "hidden settings differ from defaults — Review"
   *  chip's target action. */
  focusParam?: FocusParamRequest | null;
}

export const ParamForm = memo(function ParamForm({ design, values, onChange, search = "", showVarName = false, availableFontFamilies, fontSuggestion, installedFonts, baseline, changedParams, presetName, view = "all", focusParam }: Props) {
  // One entry per design section, carrying that section's own (unfiltered)
  // params — ParamRows applies @showIf/settings-view/search filtering itself.
  // Recomputed only when `design` changes.
  const sections = useMemo<ParamSectionGroup[]>(
    () => design.sections.map((section) => ({ section, params: design.params.filter((p) => p.section === section) })),
    [design]
  );

  return (
    <ParamRows
      design={design}
      sections={sections}
      values={values}
      onChange={onChange}
      search={search}
      showVarName={showVarName}
      availableFontFamilies={availableFontFamilies}
      fontSuggestion={fontSuggestion}
      installedFonts={installedFonts}
      baseline={baseline}
      changedParams={changedParams}
      presetName={presetName}
      view={view}
      focusParam={focusParam}
    />
  );
});
