// fonts.mjs (build side) — the bundled fonts' family extraction and the
// fontconfig config the renderer mounts. The `name`-table parser itself lives
// in the shared src/lib/fontNameTable.mjs so this build code and the browser's
// src/lib/fonts.ts run byte-identical parsing (the app matches a design's font
// against this build-time data — the two must never disagree).
import { fontFaces, fontFamilyNames } from "../../src/lib/fontNameTable.mjs";
import { xmlEscape } from "./config-parsers.mjs";

export { fontFaces, fontFamilyNames };

// Validate the optional `fontFallback` config key: a family name pinned as the
// deterministic last-resort match in fonts.conf so an imported font can never
// become Fontconfig's global default fallback. Must be a bundled family that
// isn't offered as a selectable lettering font. Absent -> null -> no rule.
export function parseFontFallback(raw) {
  if (raw == null) return null;
  if (typeof raw !== "string" || !raw.trim())
    throw new Error(
      `gen-schema: 'fontFallback' must be a non-empty string (got ${JSON.stringify(raw)})`
    );
  return raw.trim();
}

// The fontconfig config the renderer mounts at /fonts/fonts.conf. Optionally
// pins a weak last-resort family so an unmatched/absent family resolves to a
// deterministic bundled face instead of whatever Fontconfig last scanned (which
// can be a user-imported font) — keeping OpenSCAD's own substitution stable.
export function renderFontsConf(fallback) {
  const rule = fallback
    ? `  <match target="pattern">\n` +
      `    <edit name="family" mode="append_last" binding="weak">\n` +
      `      <string>${xmlEscape(fallback)}</string>\n` +
      `    </edit>\n` +
      `  </match>\n`
    : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">\n` +
    `<fontconfig>\n` +
    `  <dir>/fonts</dir>\n` +
    `  <cachedir>/fontconfig-cache</cachedir>\n` +
    rule +
    `</fontconfig>\n`
  );
}
