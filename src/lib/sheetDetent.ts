// sheetDetent.ts — pure policy behind the mobile bottom sheet's INITIAL detent
// (src/components/AppShell.tsx's `sheetDetent` useState seed). Kept dependent
// only on plain inputs (mode, config, viewport height) — no React, no DOM
// beyond the single number the caller reads once at mount — mirroring
// src/lib/useExperience.ts's initialExperienceMode/initialSettingsView split
// between a pure resolver and the stateful hook that seeds from it.
//
// The "guided-half" policy: a config author can opt a design into landing the
// mobile sheet at Half (instead of the long-standing Peek default) for
// visitors currently in the guided experience — see docs/config.md's
// `ui.experience.mobileInitialSheet`. Standard experience, or a config that
// leaves `mobileInitialSheet` unset (or "peek"), keeps today's Peek-on-mount
// behavior exactly.
import type { ExperienceMode } from "./useExperience";

export type InitialSheetDetent = "peek" | "half";

/** The slice of the generated schema this policy reads. Narrower than
 *  `Schema` (mirrors ExperienceConfig in useExperience.ts) so tests can hand
 *  it small synthetic objects; a real `Schema` satisfies this structurally. */
export type SheetDetentConfig = {
  ui?: {
    experience?: {
      mobileInitialSheet?: "peek" | "half";
    };
  };
};

// Below this viewport height, a device is almost certainly a phone in
// landscape (or a very short window) — the Half detent (~52% of viewport
// height, see BottomSheet's HALF_VH_RATIO) would leave too little room above
// it for the viewer to be useful, so Half never applies there regardless of
// mode/config. 500px comfortably covers common landscape phone heights
// (e.g. 375×667 rotated -> 375 tall) while staying well under portrait phone
// heights (typically 650px+).
export const SHORT_VIEWPORT_HEIGHT = 500;

/**
 * Resolves the mobile sheet's initial detent: Half only when ALL of —
 * guided experience, the config opts in (`mobileInitialSheet === "half"`),
 * and the viewport is tall enough (not landscape-with-short-height) — hold.
 * Otherwise Peek, matching the sheet's long-standing default.
 */
export function initialSheetDetent(
  mode: ExperienceMode,
  config: SheetDetentConfig | undefined,
  viewportHeight: number
): InitialSheetDetent {
  if (mode !== "guided") return "peek";
  if (config?.ui?.experience?.mobileInitialSheet !== "half") return "peek";
  if (viewportHeight < SHORT_VIEWPORT_HEIGHT) return "peek";
  return "half";
}
