// presetCard.ts — presentation-only parsing of a bundled preset's NAME into
// the pieces its picker card renders (PresetPicker.tsx's bundled-preset
// list): an optional small overline, the title, and an optional trailing
// badge. This is purely a display convention (documented in docs/config.md's
// "Bundled presets" note) — the stored preset name and the OpenSCAD
// parameterSets file format are both untouched; only how the existing name is
// SPLIT for display changes.
//
// Rules, applied to the trimmed name:
//   1. A trailing " (...)" becomes the badge, e.g. "Erdgeschoss (Deutsch)"
//      -> title "Erdgeschoss", badge "Deutsch".
//   2. Whatever's left of a leading "Category | " prefix becomes a small
//      overline above the title, e.g. "Basisschrift | a–z (Deutsch)"
//      -> overline "Basisschrift", title "a–z", badge "Deutsch".
//   3. A name with neither yields just a title (the name itself).
//
// A malformed edge case (e.g. "() (Deutsch)", or a "|" with nothing on one
// side) degrades gracefully to a plain title rather than an empty label.
export interface PresetCardName {
  overline?: string;
  title: string;
  badge?: string;
}

// Trailing "(...)" with no nested parens — greedy on the part before it so
// only the LAST parenthetical is captured (a title that itself legitimately
// ends in "(word) (Lang)" still splits on the final one). Hoisted to module
// scope rather than re-literalized inside parsePresetCardName.
const TRAILING_PAREN_RE = /^(.*\S)\s+\(([^()]+)\)$/;

export function parsePresetCardName(name: string): PresetCardName {
  const trimmed = name.trim();
  const parenMatch = trimmed.match(TRAILING_PAREN_RE);
  const body = (parenMatch ? parenMatch[1] : trimmed).trim();
  const badge = parenMatch ? parenMatch[2].trim() : "";

  const pipeIndex = body.indexOf("|");
  if (pipeIndex === -1) {
    return body ? withBadge(body, badge) : withBadge(trimmed, "");
  }
  const overline = body.slice(0, pipeIndex).trim();
  const title = body.slice(pipeIndex + 1).trim();
  if (!overline || !title) return withBadge(body || trimmed, badge);
  return { overline, title, ...(badge ? { badge } : {}) };
}

function withBadge(title: string, badge: string): PresetCardName {
  return badge ? { title, badge } : { title };
}
