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
  return contentHash(`${popup.mode}\n${popup.header}\n${popup.body}\n${popup.button ?? ""}`);
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
