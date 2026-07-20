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

/**
 * The mobile bottom sheet's snap points (single source — BottomSheet.tsx
 * imports and re-exports this rather than declaring its own copy). "review"
 * (PR-guided) is the guided-workflow (`ui.workflow: "guided"`) Review
 * stage's own detent: taller than "half" (room for the curated summary/
 * attention list) but short of "full" (the model stays visible above it,
 * and — like "peek"/"half" — it stays non-modal; see BottomSheet.tsx's own
 * `REVIEW_VH_RATIO`/`heightFor`/modal-trap doc). Unlike "peek"/"half"/
 * "full", "review" is reached only programmatically (see
 * `reviewDetentOnEnter` below) — it never appears in BottomSheet's own
 * drag-snap/tap-cycle `DETENT_ORDER`, so a visitor can't drag or tap into it
 * by accident, and tabs-mode (`ui.workflow` unset/"tabs") never sets it at
 * all.
 */
export type SheetDetent = "peek" | "half" | "full" | "review";

// The guided-workflow Review stage's own mobile detent height ratio — see
// `SheetDetent`'s own doc for why "review" is a fourth, programmatic-only
// snap point.
export const REVIEW_VH_RATIO = 0.7;

/**
 * Whether entering the guided-workflow Review stage on mobile should raise
 * the sheet to the taller "review" detent (AppShell's own active-step
 * effect calls this on every activeStepId change). Only ever raises FROM
 * Peek/Half — Peek raises exactly like Half so the summary/attention list is
 * reachable regardless of where the sheet happened to sit when Review became
 * active; a visitor who'd already dragged the sheet to Full keeps that
 * choice untouched (Full already shows everything Review's own taller
 * detent would).
 */
export function reviewDetentOnEnter(current: SheetDetent): SheetDetent {
  return current === "peek" || current === "half" ? "review" : current;
}

/**
 * Whether LEAVING the guided-workflow Review stage on mobile should restore
 * the sheet to Half — only when it's still sitting at the "review" detent
 * Review itself raised it to (a visitor who dragged it further, e.g. to
 * Full, keeps that deliberate choice).
 */
export function reviewDetentOnLeave(current: SheetDetent): SheetDetent {
  return current === "review" ? "half" : current;
}

// The mobile sheet's own Half-detent height ratio (fraction of the viewport
// height, minus safe-area/header insets) — the single source BottomSheet.tsx's
// own halfH() reads (imported from here, not redeclared) and the default cap
// sheetTopCapRatio below falls back to. Slightly above 50% to clear browser
// chrome at the bottom.
export const HALF_VH_RATIO = 0.52;

/**
 * Round-5 Wave 2 (item 4): the ratio AppShell writes into the `--sheet-cap-
 * ratio` CSS custom property on `.app-shell__mobile` (see index.css's own
 * `--sheet-top` derivation) — how much of the viewport height the export
 * dock/viewer's reserved bottom space is capped at, for the GIVEN detent.
 *
 * Before this, that cap was a flat 0.52 (Half's own ratio) regardless of
 * detent: fine for peek/half (at or under it already), and deliberately
 * right for full (the sheet is modal there — see BottomSheet.tsx's own M16
 * doc — and is SUPPOSED to rise over the dock/viewer, covering them). But it
 * also silently applied to the guided-workflow "review" detent, which is
 * taller than Half (REVIEW_VH_RATIO, ~70vh) — the dock/viewer only ever
 * reserved Half's shorter space for it, so the sheet's real (taller) top
 * edge rose ABOVE that reserved line and visually covered the export dock
 * (Download/Share), exactly the bug this pass fixes. "review" now gets its
 * own matching cap; every other detent keeps the long-standing Half cap.
 */
export function sheetTopCapRatio(detent: SheetDetent): number {
  return detent === "review" ? REVIEW_VH_RATIO : HALF_VH_RATIO;
}

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
