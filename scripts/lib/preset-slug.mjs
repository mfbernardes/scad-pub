// preset-slug.mjs — the preset-thumbnail slug rule for `designs[].presets.images`'
// directory form (see docs/config.md). Reverse-engineered from, and must match
// byte-for-byte, a real consumer's own thumbnail-rendering script (taktildots'
// tools/render-preset-images.sh, a Python one-liner): replace "×" with "x",
// lowercase, collapse every run of characters outside [a-z0-9] to a single
// "-", strip leading/trailing "-". Matching this exactly means a maintainer's
// own rendering script and gen-schema's directory lookup agree on every
// filename without either side hand-listing the mapping.

/** Slug a single preset name, matching render-preset-images.sh's `slug()`. */
export function presetSlug(name) {
  const s = String(name).replace(/×/g, "x").toLowerCase();
  return s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Slug every name in `names` (an iterable, walked in order), disambiguating a
 * repeated slug with a numeric suffix ("-2", "-3", …) in the order its name
 * was first seen — matching render-preset-images.sh's `seen` dict exactly.
 * Iteration ORDER matters: it must be the same order the preset names appear
 * in the design's `parameterSets` JSON (insertion/object-key order), since
 * that's the order the disambiguation counts against.
 * @param {Iterable<string>} names
 * @returns {Map<string, string>} name -> slug
 */
export function slugifyPresetNames(names) {
  const seen = new Map();
  const out = new Map();
  for (const name of names) {
    const base = presetSlug(name);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.set(name, n === 1 ? base : `${base}-${n}`);
  }
  return out;
}
