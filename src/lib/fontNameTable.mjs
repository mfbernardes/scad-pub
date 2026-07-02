// fontNameTable.mjs — the OpenType/TrueType `name`-table parser, shared verbatim
// by the browser (src/lib/fonts.ts, for user-imported fonts) and the build
// (scripts/lib/fonts.mjs, for the bundled fonts). The app compares a design's
// font against the build-time family data, so a single source keeps the two
// sides from ever disagreeing. Plain ESM (no TS) so the `.mjs` build script can
// import it too; a hand-written fontNameTable.d.mts types it for the app.
//
// Returns `[]` for anything it can't parse, so a malformed font never throws.

// Family-name IDs in the `name` table, most-specific first: 16 = typographic
// (preferred) family, 1 = legacy family. Both are matched so a value naming
// either form resolves.
const FAMILY_NAME_IDS = [16, 1];

/** @param {DataView} view @param {number} start @param {number} len */
function decodeUtf16BE(view, start, len) {
  let s = "";
  for (let i = 0; i + 1 < len; i += 2) s += String.fromCharCode(view.getUint16(start + i));
  return s;
}

/** @param {DataView} view @param {number} start @param {number} len */
function decodeLatin1(view, start, len) {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(start + i));
  return s;
}

// Collect family names from one sfnt (TrueType/OpenType) font at `sfntOffset`.
/** @param {DataView} view @param {number} sfntOffset @param {Set<string>} out */
function namesFromSfnt(view, sfntOffset, out) {
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
 * `[]` for anything it can't parse, so a malformed font never throws.
 * @param {Uint8Array} bytes
 * @returns {string[]}
 */
export function fontFamilyNames(bytes) {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Set();
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
