// prefs.ts — a small, namespaced preference/once-flag utility generalizing
// the pattern popup.ts pioneered: fail-open persistence over safeStorage, so
// a caller that must not repeat an action (a one-time hint, a dismissible
// notice) can check whether a write actually stuck. Storage unavailable
// (private mode, quota, blocking policies) degrades to "never seen, can't
// remember" rather than throwing.
import { ns } from "./appId";
import { readLocal, writeLocal } from "./safeStorage";

/** Read a namespaced preference. `key` excludes the app-id prefix (ns() adds
 *  it), e.g. readPref("experience.v1"). Storage unavailable reads as null,
 *  indistinguishable from "not set" — callers' defaults apply. */
export function readPref(key: string): string | null {
  return readLocal(ns(key));
}

/** Write a namespaced preference. Returns whether the write persisted, so
 *  callers that must not repeat an action can bail instead of risking it
 *  firing again next visit. */
export function writePref(key: string, value: string): boolean {
  return writeLocal(ns(key), value);
}

/** A versioned once-flag: `seen()` reports whether `remember()` has already
 *  persisted for this key; `remember()` persists it and reports whether the
 *  write succeeded (storage unavailable -> false, letting the caller decide
 *  not to suppress the UI it's guarding). */
export function makeOnceFlag(key: string): { seen(): boolean; remember(): boolean } {
  return {
    seen: () => readPref(key) !== null,
    remember: () => writePref(key, "1"),
  };
}

/** A small, stable hash of arbitrary content. Lets a stored "seen"/"once"
 *  value be keyed by content so it re-arms when the thing it gates changes
 *  (e.g. a deploy edits a notice's text), instead of staying stuck forever. */
export function contentHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
