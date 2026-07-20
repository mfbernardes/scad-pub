// popup.ts — decides whether the configurable notice dialog (schema.popup)
// should be shown, and remembers a dismissal. Persistence is namespaced by the
// app id so two configs on one origin don't share a flag, and is keyed by a
// content hash of the popup so changing its text re-shows it to returning users.
import { contentHash, readPref, writePref } from "./prefs";
import type { PopupNotice } from "../openscad/types";

const KEY = "popup.seen.v1";

// A small, stable hash of the popup's content + mode. Lets "once"/"dismissible"
// re-appear when a deploy changes the message, instead of staying hidden forever.
function popupHash(popup: PopupNotice): string {
  return contentHash(
    `${popup.mode}\n${popup.header}\n${popup.body}\n${popup.button ?? ""}\n${popup.footnote ?? ""}`
  );
}

/**
 * Whether the popup should be shown now. "always" shows every visit; "once" and
 * "dismissible" show unless this exact content was already remembered (see
 * rememberPopup). Returns false when no popup is configured.
 */
export function shouldShowPopup(popup: PopupNotice | null): boolean {
  if (!popup) return false;
  if (popup.mode === "always") return true;
  // Storage blocked (private mode, etc.) reads as null ≠ hash — fail open and
  // show the notice.
  return readPref(KEY) !== popupHash(popup);
}

/** Persist that the user has dismissed this popup, so it won't show again.
 *  Storage unavailable — the popup simply shows again next visit. */
export function rememberPopup(popup: PopupNotice): void {
  writePref(KEY, popupHash(popup));
}

/**
 * Which surface — if any — the configurable popup should render as THIS load.
 * Pulled out of App.tsx as a pure function so the "picker" mode's fallback/
 * dead-end rules are directly unit-testable without mounting React:
 *
 *  - no popup configured, or this exact content already remembered -> "none"
 *  - any mode other than "picker" -> "classic" (the plain text modal)
 *  - "picker", but fewer than two designs or the card-grid picker isn't
 *    available (`ui.gallery`) -> "classic", downgraded to "dismissible"
 *    behaviour by the caller (see PopupModal's mode-driven remember logic) —
 *    a picker with nothing to pick, or no picker dialog to show, would
 *    otherwise dead-end the visit
 *  - "picker", eligible, but this load carries a design deep/share link
 *    (`#d=…`) -> "none": that visitor already chose, so neither the picker
 *    nor a fallback modal is shown this visit (not remembered either — an
 *    organic later visit without the link should still get it)
 *  - "picker", eligible, no deep link -> "welcome": the design-picker dialog
 *    itself, pre-armed with the popup's header/body/footnote as its heading/
 *    subtitle/footer note
 */
export type PopupSurface = "none" | "classic" | "welcome";

export function resolvePopupSurface({
  popup,
  galleryEnabled,
  isDeepLink,
}: {
  popup: PopupNotice | null;
  /** `ui.gallery` on AND more than one design — i.e. the card-grid
   *  DesignPickerDialog actually exists in this build. */
  galleryEnabled: boolean;
  /** This load's URL hash already names a `d=<id>` design. */
  isDeepLink: boolean;
}): PopupSurface {
  if (!popup || !shouldShowPopup(popup)) return "none";
  if (popup.mode !== "picker") return "classic";
  if (!galleryEnabled) return "classic";
  if (isDeepLink) return "none";
  return "welcome";
}
