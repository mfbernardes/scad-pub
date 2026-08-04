// localeRegistry.ts: the static list of locales ScadPub ships chrome
// translations for, plus RFC 4647 lookup over it. Data-only (no JSON, no
// React) so gen-schema.mjs can import it directly under Node's type
// stripping, the same way it already imports src/lib/schema.ts.
export interface LocaleMeta {
  tag: string;
  label: string;
  dir: "ltr" | "rtl";
}

// All ltr today. When the first rtl locale ships, index.html's pre-paint
// script (which only sets <html lang> today) will also need an rtl-tag list
// to set <html dir> before first paint.
export const LOCALES: readonly LocaleMeta[] = [
  { tag: "en", label: "English", dir: "ltr" },
  { tag: "de", label: "Deutsch", dir: "ltr" },
];

export const LOCALE_TAGS: readonly string[] = LOCALES.map((locale) => locale.tag);

/** Case-insensitive lookup of `tag` in `available`, then a fallback that
 *  strips trailing BCP-47 subtags one at a time (`de-AT` -> `de`) until one
 *  matches. Null when nothing matches at any level. */
export function collapseToAvailable(tag: string, available: readonly string[]): string | null {
  const parts = tag.split("-");
  while (parts.length > 0) {
    const candidate = parts.join("-").toLowerCase();
    const hit = available.find((entry) => entry.toLowerCase() === candidate);
    if (hit !== undefined) return hit;
    parts.pop();
  }
  return null;
}

/** RFC 4647 basic lookup: the first `requested` tag (in preference order)
 *  that `collapseToAvailable` resolves against `available`; null on a full
 *  miss. */
export function bestFitLocale(
  requested: readonly string[],
  available: readonly string[]
): string | null {
  for (const tag of requested) {
    const hit = collapseToAvailable(tag, available);
    if (hit !== null) return hit;
  }
  return null;
}
