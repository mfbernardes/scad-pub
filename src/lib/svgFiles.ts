// svgFiles.ts: decide which SVG drawings the renderer can resolve right now:
// the bundled assets plus any user-imported `.svg`, matched by filename (an
// `@svg` parameter's value references the mounted file by name). Pure
// data-in/data-out so the missing-SVG detection is unit-testable without React,
// mirroring fontChoices/fonts: availability is decided in the app, not guessed
// from render output.

/** True when a filename looks like an SVG the renderer can mount/import. */
export function isSvgFile(name: string): boolean {
  return /\.svg$/i.test(name.trim());
}

/** Strip any directory part from a name: a mounted file lives at the FS root,
 *  so an `@svg` value and a stored file both key on the bare basename. */
export function svgBaseName(name: string): string {
  return name.trim().split(/[\\/]/).pop() || name.trim();
}

/**
 * The set of SVG basenames currently resolvable, from a pool of names (bundled
 * assets ∪ user-imported files). Non-SVG names are dropped; each kept name is
 * stored under its basename so an `@svg` value like `"logo.svg"` matches whether
 * the source named it bare or with a path. Filenames are case-sensitive in the
 * render FS, so no case folding is applied.
 */
export function svgPresent(names: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const name of names) if (isSvgFile(name)) set.add(svgBaseName(name));
  return set;
}

/**
 * Whether an `@svg` control's current value names a file that isn't present.
 * Only authoritative when the present set is non-empty (there are bundled
 * assets or imports to compare against): an empty set means "we can't be
 * sure", so it never reports a value as missing, mirroring the font hint's
 * `available?.size` guard.
 */
export function isSvgMissing(value: string, present: Set<string>): boolean {
  if (!present.size) return false;
  const v = value.trim();
  if (!v || !isSvgFile(v)) return false;
  return !present.has(svgBaseName(v));
}
