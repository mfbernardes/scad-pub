// viewerPrefs.ts — the persisted client-side state behind the viewer's grid
// toggle (see docs/config.md's `ui.grid`). Resolution shape: a persisted
// preference wins, then the config's `ui.grid`, then a hardcoded fallback.
// Only the pure resolver lives here — schema-agnostic, so
// tests/viewerPrefs.test.mjs can exercise every precedence branch without a
// real generated schema; AppShell.tsx owns the actual useState + writeLocal
// wiring, alongside the sibling viewer view-state it already holds.
import { ns } from "./appId";

// Namespaced by appId, like every other browser-storage key (see theme.ts),
// so two configs on one origin keep independent grid preferences. The `.v1`
// suffix leaves room to retire the stored format without colliding with it.
export const GRID_PREF_KEY = ns("viewer.grid.v1");

/** The slice of the generated schema this resolver reads: just `ui.grid`. */
export type GridConfig = {
  ui?: {
    grid?: "off" | "on";
  };
};

/**
 * Resolves the viewer's initial grid visibility: a persisted preference
 * (`pref`, as returned by `readLocal(GRID_PREF_KEY)` — null when unset or
 * storage is unavailable) wins as `"on"`/`"off"`; otherwise the config's
 * `ui.grid`; otherwise off (no visible grid). An unrecognised persisted value
 * is treated as unset, so retiring the format in a future build degrades
 * gracefully instead of throwing.
 */
export function initialGridVisible(pref: string | null, config: GridConfig | undefined): boolean {
  if (pref === "on") return true;
  if (pref === "off") return false;
  return config?.ui?.grid === "on";
}
