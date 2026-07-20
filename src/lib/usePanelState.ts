// usePanelState.ts — the parameter panel's "which tab / what search" state,
// hoisted above the desktop/mobile layout split (AppShell) instead of living
// inside ParamPanel (desktop) or SheetTabs (mobile). AppShell mounts only the
// active layout (see docs/architecture-review.md M7): if this state stayed
// local to those two components, switching layouts would unmount whichever
// one owned it and reset the tab and clear the search box. AppShell owns one
// instance and passes it as controlled props to whichever layout is mounted,
// so a breakpoint change (or a real device rotation) preserves both.
//
// Search-input FOCUS across that same switch is restored separately, by
// AppShell itself (not tracked here) — it reads `document.activeElement`
// synchronously during render, the one point guaranteed race-free against
// the old input's removal; see AppShell.tsx's own doc on its
// restoreSearchFocusRef.
import { useState } from "react";

export type PanelTab = "presets" | "params" | "files";

export interface PanelState {
  /** Active tab. Presets only when the design ships ready-made presets — a
   *  starting point is the simplest first step; otherwise land on the
   *  controls. Bundled presets load asynchronously, so this stays DERIVED
   *  until the user picks a tab: a mount-time snapshot would be decided
   *  before the presets arrive. */
  tab: PanelTab;
  setTab: (tab: PanelTab) => void;
  search: string;
  setSearch: (search: string) => void;
}

export function usePanelState(hasPresets: boolean): PanelState {
  const [picked, setPicked] = useState<PanelTab | null>(null);
  const tab = (picked ?? (hasPresets ? "presets" : "params")) as PanelTab;
  const [search, setSearch] = useState("");
  return { tab, setTab: setPicked, search, setSearch };
}
