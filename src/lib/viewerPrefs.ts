// viewerPrefs.ts — the persisted client-side state behind the viewer's grid
// toggle (see docs/config.md's `viewer.grid`) and the measurements panel's
// collapsed state. Resolution shape: a persisted preference wins, then the
// config (or the layout), then a hardcoded fallback. Only the pure resolvers
// live here — schema-agnostic, so tests/viewerPrefs.test.mjs can exercise
// every precedence branch without a real generated schema; AppShell.tsx owns
// the actual useState + writeLocal wiring, alongside the sibling viewer
// view-state it already holds.
import { ns } from "./appId";

// Namespaced by appId, like every other browser-storage key (see theme.ts),
// so two configs on one origin keep independent grid preferences. The `.v1`
// suffix leaves room to retire the stored format without colliding with it.
export const GRID_PREF_KEY = ns("viewer.grid.v1");

/** The slice of the generated schema this resolver reads: just `viewer.grid`. */
export type GridConfig = {
  viewer?: {
    grid?: "off" | "on";
  };
};

/**
 * Resolves the viewer's initial grid visibility: a persisted preference
 * (`pref`, as returned by `readLocal(GRID_PREF_KEY)` — null when unset or
 * storage is unavailable) wins as `"on"`/`"off"`; otherwise the config's
 * `viewer.grid`; otherwise off (no visible grid). An unrecognised persisted
 * value is treated as unset, so retiring the format in a future build
 * degrades gracefully instead of throwing.
 */
export function initialGridVisible(pref: string | null, config: GridConfig | undefined): boolean {
  if (pref === "on") return true;
  if (pref === "off") return false;
  return config?.viewer?.grid === "on";
}

// Namespaced and versioned like GRID_PREF_KEY above.
export const MEASURE_COLLAPSED_KEY = ns("viewer.measureCollapsed.v1");

/**
 * Resolves whether the measurements panel starts folded to its bounding-box
 * headline: a persisted preference (`"on"`/`"off"`, as returned by
 * `readLocal(MEASURE_COLLAPSED_KEY)`) wins; otherwise it starts collapsed on
 * mobile and expanded on desktop.
 *
 * Mobile defaults to collapsed because the expanded panel is a corner box
 * roughly a third of the viewer at the sheet's half detent — big enough to
 * hide the model outright — and it is `pointer-events: auto`, so it also eats
 * the orbit drag. Collapsed it is a ~36px header strip, which the camera fit
 * can honestly treat as a top inset (see framing.ts's edgeInset) and which
 * leaves the canvas draggable. Desktop has the room, so nothing changes there.
 *
 * An unrecognised persisted value is treated as unset, so retiring the format
 * in a future build degrades gracefully instead of throwing.
 */
export function initialMeasureCollapsed(pref: string | null, isMobile: boolean): boolean {
  if (pref === "on") return true;
  if (pref === "off") return false;
  return isMobile;
}
