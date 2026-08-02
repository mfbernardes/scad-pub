// useViewerToggles.ts: the viewer HUD's own state — the dimension overlay, the
// measurements panel's folded/unfolded state, the reference grid, and the active
// camera view.
//
// All four live ABOVE the desktop/mobile layout split (AppShell mounts one tree
// or the other, M7), so a breakpoint change doesn't reset them. Extracted from
// AppShell for the same reason useReadinessModel / useOutputConsole /
// useSheetPolicy were: it is self-contained state with its own persistence
// rules, and AppShell's job is composing layout.
//
// Three of the four persist, and each persists differently on purpose:
// `showDimensions` doesn't persist at all (it is a per-session inspection
// mode); `measureCollapsed` and `showGrid` do, seeded from the config on a
// first-ever visit and owned by the visitor after that.
import { useCallback, useState } from "react";
import type { Schema } from "../openscad/types";
import { readLocal, writeLocal } from "./safeStorage";
import {
  GRID_PREF_KEY,
  MEASURE_COLLAPSED_KEY,
  initialGridVisible,
  initialMeasureCollapsed,
} from "./viewerPrefs";
import { DEFAULT_VIEW, type ViewName } from "../components/views";

export interface ViewerToggles {
  showDimensions: boolean;
  toggleDimensions: () => void;
  measureCollapsed: boolean;
  toggleMeasureCollapsed: () => void;
  showGrid: boolean;
  toggleGrid: () => void;
  view: ViewName;
  setView: (v: ViewName) => void;
}

export function useViewerToggles(schema: Schema, isMobile: boolean): ViewerToggles {
  // Whether the viewer overlays arrowed W×D×H dimension lines on the model, plus
  // the top-left measurements panel (bounding box + per-design @info). Off by
  // default; the HUD ruler toggle turns it on.
  const [showDimensions, setShowDimensions] = useState(false);
  const toggleDimensions = useCallback(() => setShowDimensions((v) => !v), []);

  // Whether that measurements panel is folded to its headline. Held here, not
  // in DimensionInfo, because the panel unmounts on every ruler-off, cleared
  // render and design switch: local state made the visitor re-fold it each
  // time. Starts folded on mobile, where the expanded panel would cover the
  // model outright (see viewerPrefs' initialMeasureCollapsed); after that the
  // visitor's own choice persists, like the grid.
  const [measureCollapsed, setMeasureCollapsed] = useState(() =>
    initialMeasureCollapsed(readLocal(MEASURE_COLLAPSED_KEY), isMobile)
  );
  const toggleMeasureCollapsed = useCallback(() => {
    setMeasureCollapsed((v) => {
      const next = !v;
      writeLocal(MEASURE_COLLAPSED_KEY, next ? "on" : "off");
      return next;
    });
  }, []);

  // Whether the viewer draws its reference grid. Unlike the other HUD controls
  // this isn't config-gated: the button is always offered; `viewer.grid` only
  // seeds the first-ever value, after which the visitor's own choice persists
  // (see src/lib/viewerPrefs.ts).
  const [showGrid, setShowGrid] = useState(() =>
    initialGridVisible(readLocal(GRID_PREF_KEY), schema)
  );
  const toggleGrid = useCallback(() => {
    setShowGrid((v) => {
      const next = !v;
      writeLocal(GRID_PREF_KEY, next ? "on" : "off");
      return next;
    });
  }, []);

  // The active camera view. Driving it as state keeps the picker's highlight and
  // a freshly-mounted Viewer in step; AppShell's imperative snap re-applies it
  // on every pick, including the current one.
  const [view, setView] = useState<ViewName>(DEFAULT_VIEW);

  return {
    showDimensions,
    toggleDimensions,
    measureCollapsed,
    toggleMeasureCollapsed,
    showGrid,
    toggleGrid,
    view,
    setView,
  };
}
