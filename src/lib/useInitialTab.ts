// useInitialTab.ts — the shared "which tab does the parameter panel open on"
// policy, used by both the desktop ParamPanel and the mobile SheetTabs so the
// rule (and its rationale) lives in one place instead of drifting between two
// mirrored components.
//
// Land on Presets only when the design ships ready-made presets — a starting
// point is the simplest first step; otherwise open straight on the controls.
// Bundled presets load asynchronously, so the tab is DERIVED until the user
// picks one: a mount-time snapshot would be decided before the presets arrive.
import { useState } from "react";

export function useInitialTab<T extends string>(
  hasPresets: boolean
): [T, (tab: T) => void] {
  const [picked, setPicked] = useState<T | null>(null);
  const tab = (picked ?? (hasPresets ? "presets" : "params")) as T;
  return [tab, setPicked];
}
