// popup.ts — decides whether the configurable notice dialog (schema.popup)
// should be shown, and remembers a dismissal. Persistence is namespaced by the
// app id so two configs on one origin don't share a flag, and is keyed by a
// content hash of the popup so changing its text re-shows it to returning users.
import { ns } from "./appId";
import { readLocal, writeLocal } from "./safeStorage";
import type { PopupNotice } from "../openscad/types";

const KEY = "popup.seen.v1";

// A small, stable hash of the popup's content + mode. Lets "once"/"dismissible"
// re-appear when a deploy changes the message, instead of staying hidden forever.
function contentHash(popup: PopupNotice): string {
  const s = `${popup.mode}\n${popup.header}\n${popup.body}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
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
  return readLocal(ns(KEY)) !== contentHash(popup);
}

/** Persist that the user has dismissed this popup, so it won't show again.
 *  Storage unavailable — the popup simply shows again next visit. */
export function rememberPopup(popup: PopupNotice): void {
  writeLocal(ns(KEY), contentHash(popup));
}
