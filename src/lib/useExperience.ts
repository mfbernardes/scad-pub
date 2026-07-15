// useExperience.ts — the two independent, persisted client-side states behind
// the guided/standard "experience mode" and the essentials/all "settings
// view" (see docs/config.md's `ui.experience`). Nothing consumes this hook
// yet; it exists so the next milestone's UI can read/write these states
// without also owning their resolution rules.
//
// Each state resolves once, at first use: a persisted user preference
// (src/lib/prefs.ts) wins, then the config's `ui.experience` default, then a
// hardcoded fallback. Every later change persists independently via
// writePref — setting one state never writes the other's stored key.
//
// The resolution logic lives in pure, schema-agnostic functions
// (initialExperienceMode / initialSettingsView) so tests/useExperience.test.mjs
// can exercise every precedence branch without React or a real generated
// schema — mirroring src/lib/i18n.ts's `makeT` (pure factory) vs. bound `t`/`tn`
// split.
import { useState } from "react";
import schemaJson from "../generated/designs.json" with { type: "json" };
import { readPref, writePref } from "./prefs";
import type { Schema } from "../openscad/types";

export type ExperienceMode = "guided" | "standard";
export type SettingsView = "essentials" | "all";

/** The slice of the generated schema this hook reads: just `ui.experience`.
 *  Narrower than `Schema` so tests can pass small synthetic objects; a real
 *  `Schema` satisfies this structurally. */
export type ExperienceConfig = {
  ui?: {
    experience?: {
      default?: ExperienceMode;
      settingsView?: SettingsView;
    };
  };
};

const MODE_KEY = "experience.v1";
const SETTINGS_VIEW_KEY = "settingsView.v1";

/**
 * Resolves the initial experience mode: a persisted preference (`pref`, as
 * returned by `readPref(MODE_KEY)` — null when unset or storage is
 * unavailable) wins; otherwise the config's `ui.experience.default`;
 * otherwise "standard". An unrecognised persisted value is treated as unset
 * rather than thrown, so retiring a mode in a future build degrades
 * gracefully instead of breaking returning visitors.
 */
export function initialExperienceMode(
  pref: string | null,
  config: ExperienceConfig | undefined
): ExperienceMode {
  if (pref === "guided" || pref === "standard") return pref;
  const configured = config?.ui?.experience?.default;
  if (configured === "guided" || configured === "standard") return configured;
  return "standard";
}

/**
 * Resolves the initial settings view: a persisted preference wins; otherwise
 * the config's `ui.experience.settingsView`; otherwise a value derived from
 * the already-resolved initial `mode` — "guided" starts on "essentials",
 * "standard" starts on "all". `mode` is the *initial* mode (this function's
 * own resolution is independent of the mode setter afterwards).
 */
export function initialSettingsView(
  pref: string | null,
  config: ExperienceConfig | undefined,
  mode: ExperienceMode
): SettingsView {
  if (pref === "essentials" || pref === "all") return pref;
  const configured = config?.ui?.experience?.settingsView;
  if (configured === "essentials" || configured === "all") return configured;
  return mode === "guided" ? "essentials" : "all";
}

const schema = schemaJson as Schema;

/**
 * Two independent, persisted UI states: `experienceMode` (guided/standard)
 * and `settingsView` (essentials/all). Each is seeded once — see
 * initialExperienceMode / initialSettingsView — and every setter persists its
 * own state via writePref without touching the other's stored key.
 */
export function useExperience(): {
  experienceMode: ExperienceMode;
  setExperienceMode: (mode: ExperienceMode) => void;
  settingsView: SettingsView;
  setSettingsView: (view: SettingsView) => void;
} {
  const [experienceMode, setExperienceModeState] = useState<ExperienceMode>(() =>
    initialExperienceMode(readPref(MODE_KEY), schema)
  );
  const [settingsView, setSettingsViewState] = useState<SettingsView>(() =>
    initialSettingsView(readPref(SETTINGS_VIEW_KEY), schema, experienceMode)
  );

  function setExperienceMode(mode: ExperienceMode): void {
    setExperienceModeState(mode);
    writePref(MODE_KEY, mode);
  }

  function setSettingsView(view: SettingsView): void {
    setSettingsViewState(view);
    writePref(SETTINGS_VIEW_KEY, view);
  }

  return { experienceMode, setExperienceMode, settingsView, setSettingsView };
}
