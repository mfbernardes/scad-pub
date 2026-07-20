// viewerPrefs.ts — the persisted client-side state behind the viewer's grid
// toggle (see docs/config.md's `ui.grid`). Mirrors useExperience.ts's
// resolution shape: a persisted preference (src/lib/prefs.ts) wins, then the
// config's `ui.grid`, then a hardcoded fallback. The pure resolver lives here
// (schema-agnostic, so tests/viewerPrefs.test.mjs can exercise every
// precedence branch without a real generated schema) — AppShell.tsx owns the
// actual useState + writePref wiring, the same split useExperience.ts uses.
export const GRID_PREF_KEY = "viewer.grid.v1";

/** The slice of the generated schema this resolver reads: just `ui.grid`. */
export type GridConfig = {
  ui?: {
    grid?: "off" | "on";
  };
};

/**
 * Resolves the viewer's initial grid visibility: a persisted preference
 * (`pref`, as returned by `readPref(GRID_PREF_KEY)` — null when unset or
 * storage is unavailable) wins as `"on"`/`"off"`; otherwise the config's
 * `ui.grid`; otherwise off (the "product stage" look with no visible grid).
 * An unrecognised persisted value is treated as unset, so retiring the
 * format in a future build degrades gracefully instead of throwing.
 */
export function initialGridVisible(pref: string | null, config: GridConfig | undefined): boolean {
  if (pref === "on") return true;
  if (pref === "off") return false;
  return config?.ui?.grid === "on";
}
