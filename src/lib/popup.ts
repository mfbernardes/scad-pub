// popup.ts: decides whether the configurable notice dialog (schema.popup)
// should be shown, and remembers a dismissal. Persistence is namespaced by the
// app id so two configs on one origin don't share a flag, and is keyed by a
// content hash of the popup so changing its text re-shows it to returning users.
import { ns } from "./appId";
import { readLocal, writeLocal } from "./safeStorage";
import type { PopupNotice } from "../openscad/types";

const KEY = "popup.seen.v1";

// A small, stable hash of the popup's content + mode. Lets "once"/"dismissible"
// re-appear when a deploy changes the message, instead of staying hidden forever.
// `header`/`body`/`button` are `LocalizableText` (a plain string, or a
// locale-tag map) — JSON.stringify rather than raw interpolation so either
// form hashes deterministically and a plain string vs. an equivalent
// single-entry object can't collide; this stays locale-invariant on purpose:
// a translation added for one locale re-shows the popup to every locale's
// visitors, not just that one, which is a fine, simple rule.
function contentHash(popup: PopupNotice): string {
  const s = `${popup.mode}\n${JSON.stringify(popup.header)}\n${JSON.stringify(popup.body)}\n${JSON.stringify(popup.button ?? "")}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Whether this popup is the design chooser rather than a notice.
 *
 * `picker` mode means exactly one thing: this popup IS the chooser, the app's
 * first screen. `gen-schema`'s `checkPopupMode` refuses to build a `picker`
 * config with fewer than two designs, so there is no second meaning to test
 * for here: the mode alone is the answer.
 *
 * It reads as a one-line predicate because it used to be more, and that is
 * worth remembering: `picker` once fell back to a plain notice below two
 * designs, so every consumer had to ask "chooser or notice?" with the design
 * count in hand. Three did; one tested the mode alone and silently dropped a
 * single-design deployment's notice from any visit whose URL named its only
 * design. Named rather than inlined so the guarantee has somewhere to live.
 */
export function isDesignChooser(popup: PopupNotice | null): boolean {
  return popup?.mode === "picker";
}

/**
 * Whether the popup should be shown now. "always" shows every visit; "once" and
 * "dismissible" show unless this exact content was already remembered (see
 * rememberPopup). Returns false when no popup is configured.
 *
 * `fromLink` (the URL hash named a design: a shared link or an installed app's
 * `./#d=<id>` shortcut) suppresses the design *chooser*, and only that: the
 * visitor arrived with the choice already made, so asking again is noise over
 * someone's link. It is deliberately not remembered: skipping a question is
 * not answering it, and a later visit to the bare URL still gets the chooser.
 *
 * A notice is never suppressed: it asks nothing, so a URL cannot have answered
 * it. Going through `isDesignChooser` rather than testing `mode` here keeps that
 * distinction in one place.
 */
export function shouldShowPopup(popup: PopupNotice | null, fromLink = false): boolean {
  if (!popup) return false;
  if (fromLink && isDesignChooser(popup)) return false;
  if (popup.mode === "always") return true;
  // Storage blocked (private mode, etc.) reads as null ≠ hash: fail open and
  // show the notice.
  return readLocal(ns(KEY)) !== contentHash(popup);
}

/** Persist that the user has dismissed this popup, so it won't show again.
 *  Storage unavailable: the popup shows again next visit. */
export function rememberPopup(popup: PopupNotice): void {
  writeLocal(ns(KEY), contentHash(popup));
}
