// usePanelState.ts — the parameter panel's "which tab / what search / was the
// search box focused" state, hoisted above the desktop/mobile layout split
// (AppShell) instead of living inside ParamPanel (desktop) or SheetTabs
// (mobile). AppShell mounts only the active layout (see docs/architecture-review.md
// M7): if this state stayed local to those two components, switching layouts
// would unmount whichever one owned it and reset the tab, clear the search
// box, and drop keyboard focus. AppShell owns one instance and passes it as
// controlled props to whichever layout is mounted, so a breakpoint change
// (or a real device rotation) preserves all three.
import { useRef, useState, type MutableRefObject } from "react";

export type PanelTab = "presets" | "params" | "review" | "files";

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
  /** Ref (not state — nothing needs to re-render on focus/blur) tracking
   *  whether the search input currently holds focus, so a layout switch can
   *  restore focus to the newly mounted layout's equivalent input instead of
   *  silently dropping it to <body>. */
  searchFocusedRef: MutableRefObject<boolean>;
}

export function usePanelState(hasPresets: boolean): PanelState {
  const [picked, setPicked] = useState<PanelTab | null>(null);
  const tab = (picked ?? (hasPresets ? "presets" : "params")) as PanelTab;
  const [search, setSearch] = useState("");
  const searchFocusedRef = useRef(false);
  return { tab, setTab: setPicked, search, setSearch, searchFocusedRef };
}
