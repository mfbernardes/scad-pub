// fonts.ts — decide font availability in the app from the known font set
// (bundled ∪ user-imported), matched by a font's *embedded* family name rather
// than its filename. OpenSCAD-WASM can't reliably report whether a requested
// family resolved or was silently substituted (an absent family resolves to a
// real bundled face, and once a user imports a font it can even become
// Fontconfig's default fallback), so availability is decided here instead of
// guessed from render output.
//
// `fontFamilyNames` reads the OpenType/TrueType `name` table (also handling
// TrueType Collections). It mirrors the small parser in scripts/gen-schema.mjs,
// which extracts the bundled fonts' families at build time.

// Family-name IDs in the `name` table, most-specific first: 16 = typographic
// (preferred) family, 1 = legacy family. Both are matched so a value naming
// either form resolves.
const FAMILY_NAME_IDS = [16, 1];

function decodeUtf16BE(view: DataView, start: number, len: number): string {
  let s = "";
  for (let i = 0; i + 1 < len; i += 2) s += String.fromCharCode(view.getUint16(start + i));
  return s;
}

function decodeLatin1(view: DataView, start: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(start + i));
  return s;
}

// Collect family names from one sfnt (TrueType/OpenType) font at `sfntOffset`.
function namesFromSfnt(view: DataView, sfntOffset: number, out: Set<string>): void {
  const numTables = view.getUint16(sfntOffset + 4);
  let nameOffset = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = sfntOffset + 12 + i * 16;
    if (decodeLatin1(view, rec, 4) === "name") {
      nameOffset = view.getUint32(rec + 8);
      break;
    }
  }
  if (nameOffset < 0) return;
  const count = view.getUint16(nameOffset + 2);
  const stringBase = nameOffset + view.getUint16(nameOffset + 4);
  for (let i = 0; i < count; i++) {
    const rec = nameOffset + 6 + i * 12;
    const platformID = view.getUint16(rec);
    const nameID = view.getUint16(rec + 6);
    if (!FAMILY_NAME_IDS.includes(nameID)) continue;
    const len = view.getUint16(rec + 8);
    const off = stringBase + view.getUint16(rec + 10);
    if (off + len > view.byteLength) continue;
    // Platform 1 = Macintosh (single-byte); 0/3 = Unicode/Windows (UTF-16BE).
    const str = platformID === 1 ? decodeLatin1(view, off, len) : decodeUtf16BE(view, off, len);
    const trimmed = str.trim();
    if (trimmed) out.add(trimmed);
  }
}

/**
 * Every family name embedded in a font file's `name` table (typographic and
 * legacy family records, across all faces of a TrueType Collection). Returns
 * `[]` for anything it can't parse, so a malformed upload never throws.
 */
export function fontFamilyNames(bytes: Uint8Array): string[] {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Set<string>();
    if (decodeLatin1(view, 0, 4) === "ttcf") {
      // TrueType Collection: a header listing each member font's sfnt offset.
      const numFonts = view.getUint32(8);
      for (let i = 0; i < numFonts; i++) namesFromSfnt(view, view.getUint32(12 + i * 4), out);
    } else {
      namesFromSfnt(view, 0, out);
    }
    return [...out];
  } catch {
    return [];
  }
}

/** Filenames OpenSCAD's fontconfig can scan for a usable font face. */
export function isFontFile(name: string): boolean {
  return /\.(ttf|otf|ttc)$/i.test(name);
}

/**
 * The family portion of an OpenSCAD `font` value — everything before the first
 * Fontconfig property (`:style=…`, `:weight=…`), trimmed. `"DIN Pro:style=Bold"`
 * → `"DIN Pro"`.
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
