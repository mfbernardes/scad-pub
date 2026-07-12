// shareability.ts — decides whether the current design/values/imported-files
// combination is fully described by a plain share URL, or whether it depends
// on bytes that live only in this browser's IndexedDB (an imported font, an
// SVG the wizard prepared, or a generic imported file such as a `surface()`
// data file). See docs/architecture-review.md H2.
//
// Pure and synchronous: no `location`/storage access, so it's directly
// unit-testable and safe to call on every keystroke.
import type { Design } from "../openscad/types";
import type { Values } from "./presets";
import { familyOf, styleOf, faceKeyOf } from "./fonts";
import { fontFaces } from "./fontNameTable.mjs";

const FONT_EXTENSION_RE = /\.(ttf|otf|ttc)$/i;

export type LocalOnlyKind = "font" | "svg" | "file";

export interface LocalOnlyInput {
  kind: LocalOnlyKind;
  /** The parameter that references this local-only input. */
  param: string;
  /** User-facing name: the imported filename, or the font family for a font. */
  name: string;
}

export interface Shareability {
  /** True when the share URL alone reproduces this render on another device. */
  complete: boolean;
  /** Every local-only render input the current values depend on. */
  localOnly: LocalOnlyInput[];
}

/** Face key (family+style) -> the imported filename that provides it (first match wins). */
function importedFontFaces(userFiles: Record<string, Uint8Array>): Map<string, string> {
  const byFace = new Map<string, string>();
  for (const [name, bytes] of Object.entries(userFiles)) {
    if (!FONT_EXTENSION_RE.test(name)) continue;
    let faces: { family: string; style: string }[];
    try {
      faces = fontFaces(bytes);
    } catch {
      continue; // unparseable font bytes — nothing to key by, skip
    }
    for (const { family, style } of faces) {
      const key = faceKeyOf(family, style);
      if (!byFace.has(key)) byFace.set(key, name);
    }
  }
  return byFace;
}

/**
 * Which of the current design's parameter values depend on files that exist
 * only in this browser's local storage, and are therefore invisible to
 * anyone opening a shared URL elsewhere.
 */
export function computeShareability(
  design: Design,
  values: Values,
  userFiles: Record<string, Uint8Array>,
  bundledFontFaces: { family: string; style: string }[]
): Shareability {
  const localOnly: LocalOnlyInput[] = [];
  const bundledFaces = new Set(bundledFontFaces.map((f) => faceKeyOf(f.family, f.style)));
  const importedFaces = importedFontFaces(userFiles);

  for (const p of design.params) {
    if (p.type !== "string" && p.type !== "enum") continue;
    const value = values[p.name];
    if (typeof value !== "string" || !value) continue;

    if (p.isFont) {
      // Portability is a FACE property, not a family one: a design may select
      // `Family:style=Italic` while the app bundles only Family Regular/Bold —
      // a recipient still can't reproduce the Italic face. Compare the exact
      // face (family+style), and when it isn't bundled, name the specific
      // imported file that supplies THAT face (not merely the family's first).
      const face = faceKeyOf(familyOf(value), styleOf(value));
      if (bundledFaces.has(face)) continue; // this exact face ships with the app — portable
      const fileName = importedFaces.get(face);
      // Only an *imported* font is a share-completeness problem; a face that's
      // neither bundled nor imported is already broken independent of sharing
      // (nothing here renders it either), so it's out of scope.
      if (fileName) localOnly.push({ kind: "font", param: p.name, name: fileName });
      continue;
    }

    if (p.type !== "string") continue; // enum params other than @font carry no file reference

    if (Object.prototype.hasOwnProperty.call(userFiles, value)) {
      // Covers both the SVG-wizard case (an `@svg` field pointing at the file
      // it just mounted) and a generic imported file referenced by name (e.g.
      // a `surface()` data file supplied through the generic file-import button).
      localOnly.push({ kind: p.svg ? "svg" : "file", param: p.name, name: value });
    }
  }

  return { complete: localOnly.length === 0, localOnly };
}

/** A short, user-facing summary of what a share link would be missing. */
export function shareabilityWarning(shareability: Shareability): string | null {
  if (shareability.complete) return null;
  const names = [...new Set(shareability.localOnly.map((f) => f.name))].join(", ");
  return `Link copied, but it won't include files only on this device: ${names}. Recipients need those too.`;
}
