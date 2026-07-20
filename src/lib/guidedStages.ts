// guidedStages.ts — turn optional section-level @stage metadata into the
// ordered tabs used by guided mode. Designs without annotations retain one
// generic Customize stage; partially annotated designs retain an Other settings
// fallback so annotations can never make controls unreachable.
import type { Design } from "../openscad/types";
import type { PanelTab } from "./usePanelState";

export interface GuidedStage {
  value: PanelTab;
  label: string;
  /** Undefined shows every param; null shows only params without @stage. */
  filter: string | null | undefined;
}

export function guidedStages(design: Design): GuidedStage[] {
  const declared = design.stages ?? [];
  if (declared.length === 0)
    return [{ value: "params", label: "Customize", filter: undefined }];

  const result: GuidedStage[] = declared.map((stage) => ({
    value: `stage:${stage.id}` as PanelTab,
    label: stage.label,
    filter: stage.id,
  }));
  if (design.params.some((param) => param.stage === undefined))
    result.push({ value: "params", label: "Other settings", filter: null });
  return result;
}
