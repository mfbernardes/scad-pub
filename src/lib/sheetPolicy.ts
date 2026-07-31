// sheetPolicy.ts: the pure first-visit policy behind the mobile settings
// BottomSheet's opening detent (see AppShell.tsx). On a mobile visitor's
// genuine first visit the sheet opens partway so the settings are obviously
// present, then falls back to "peek" on every later visit. Only the pure
// resolver + the persisted once-flag KEY live here: schema-/DOM-agnostic, so
// tests/sheetPolicy.test.mjs can exercise every branch without a browser;
// AppShell.tsx owns the actual window reads + useState + writeLocal wiring
// (mirroring src/lib/viewerPrefs.ts's split).
import { ns } from "./appId";
import type { SheetDetent } from "../components/BottomSheet";

// Namespaced by appId, like every other browser-storage key (see appId.ts's
// `ns()`), so two configs on one origin resolve first-visit independently. The
// `.v1` suffix leaves room to retire the stored format without colliding with
// it. Presence alone is the signal: the value is an opaque "1".
export const SHEET_INTRODUCED_KEY = ns("sheet.introduced.v1");

// Viewport-height boundary (px) separating a "short" viewport, where a half-open
// sheet would swallow the model, from a "tall" one that can spare the room. It
// sits between two common phone portrait heights: a 667-tall device (older /
// smaller phones) resolves to "peek", a 844-tall one (modern large phones) to
// "half". Chosen so "half" only fires when the ~52vh sheet still leaves a
// meaningful band of model visible above it. Landscape is handled separately
// (always "peek"), since even a tall device is short along that axis.
const TALL_MIN = 720;

/**
 * Resolves the sheet's opening detent for a first-visit mobile visitor from the
 * viewport geometry alone (both DOM reads are done at the AppShell call site and
 * passed in, keeping this pure): "peek" in landscape or on a short viewport,
 * "half" on a tall portrait viewport, so a new visitor immediately sees the
 * settings exist while the model stays meaningfully visible. Later visits skip
 * this entirely and start at "peek" (see AppShell / SHEET_INTRODUCED_KEY).
 */
export function initialSheetDetent(viewportHeight: number, isLandscape: boolean): SheetDetent {
  if (isLandscape) return "peek";
  return viewportHeight >= TALL_MIN ? "half" : "peek";
}
