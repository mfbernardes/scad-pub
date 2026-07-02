// fonts.ts — decide font availability in the app from the known font set
// (bundled ∪ user-imported), matched by a font's *embedded* family name rather
// than its filename. OpenSCAD-WASM can't reliably report whether a requested
// family resolved or was silently substituted (an absent family resolves to a
// real bundled face, and once a user imports a font it can even become
// Fontconfig's default fallback), so availability is decided here instead of
// guessed from render output.
//
// `fontFamilyNames` (the `name`-table parser) lives in the shared
// ./fontNameTable.mjs so the browser and the build (scripts/lib/fonts.mjs, for
// the bundled fonts) run byte-identical parsing — the app compares against that
// build-time family data, so the two must never disagree.
export { fontFamilyNames } from "./fontNameTable.mjs";

/**
 * The family portion of an OpenSCAD `font` value — everything before the first
 * Fontconfig property (`:style=…`, `:weight=…`), trimmed. `"Brand Display:style=Bold"`
 * → `"Brand Display"`.
 */
export function familyOf(fontValue: string): string {
  const colon = fontValue.indexOf(":");
  return (colon === -1 ? fontValue : fontValue.slice(0, colon)).trim();
}

/** Swap the family in a `font` value, preserving any `:style=…` properties. */
export function withFamily(fontValue: string, family: string): string {
  const colon = fontValue.indexOf(":");
  return colon === -1 ? family : family + fontValue.slice(colon);
}

/** Case/space-insensitive key for comparing family names. */
export function normalizeFamily(family: string): string {
  return family.trim().toLowerCase();
}
