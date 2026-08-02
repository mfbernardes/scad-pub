// useAssetAvailability.ts: what the renderer can actually resolve right now —
// the font families and faces it can use, and the SVG drawings it can find.
//
// Each is the union of what the build bundled with what the visitor has
// imported this session, which is why it can't be a build-time constant: the
// answer changes the moment a font or drawing is imported or removed. The
// controls compare their value against these to surface a missing-font or
// missing-file hint at the control itself rather than at render time.
import { useMemo } from "react";
import type { Schema } from "../openscad/types";
import {
  fontFaces,
  fontFamilyNames,
  mergeInstalledFonts,
  normalizeFamily,
  type FontFaceInfo,
  type InstalledFont,
} from "./fonts";
import { isFontFile } from "../openscad/renderArgs";
import { svgPresent } from "./svgFiles";

export interface AssetAvailability {
  availableFontFamilies: Set<string>;
  /** A bundled family to offer as a one-click fallback when the selected font
   *  isn't loaded. Always available, so it can never itself be missing. */
  fontSuggestion: string | null;
  installedFonts: InstalledFont[];
  availableSvgFiles: Set<string>;
}

export function useAssetAvailability(
  schema: Schema,
  userFiles: Record<string, Uint8Array>
): AssetAvailability {
  // The set of font families the renderer can actually use: bundled families
  // (parsed at build time) plus the embedded families of any imported font.
  // Normalised for case/space-insensitive matching. The font controls compare a
  // design's `font` value against this to flag a missing family (see ParamForm).
  const availableFontFamilies = useMemo(() => {
    const set = new Set((schema.fontFamilies ?? []).map(normalizeFamily));
    for (const [name, bytes] of Object.entries(userFiles)) {
      if (isFontFile(name))
        for (const fam of fontFamilyNames(bytes)) set.add(normalizeFamily(fam));
    }
    return set;
  }, [schema.fontFamilies, userFiles]);
  // A bundled family to offer as a one-click fallback when the selected font
  // isn't loaded. Always available, so it can never itself be missing.
  const fontSuggestion = (schema.fontFamilies ?? [])[0] ?? null;
  // Every face the renderer can actually use, display-ordered: the bundled
  // faces (parsed at build time into schema.fontFaces) merged with the faces of
  // any imported font, so the font selector's list updates the moment a font
  // is imported. Feeds ParamForm's FontSelect.
  const installedFonts = useMemo(() => {
    const imported: FontFaceInfo[] = [];
    for (const [name, bytes] of Object.entries(userFiles)) {
      if (isFontFile(name)) imported.push(...fontFaces(bytes));
    }
    return mergeInstalledFonts(schema.fontFaces ?? [], imported);
  }, [schema.fontFaces, userFiles]);

  // The SVG drawings the renderer can resolve right now: the bundled assets
  // (schema.assets) plus any imported `.svg`. An `@svg` control compares its
  // filename value against this so removing an in-use drawing surfaces a
  // missing-file hint at the control: the SVG mirror of the missing-font hint.
  const availableSvgFiles = useMemo(
    () => svgPresent([...(schema.assets ?? []), ...Object.keys(userFiles)]),
    [schema.assets, userFiles]
  );
  return { availableFontFamilies, fontSuggestion, installedFonts, availableSvgFiles };
}
