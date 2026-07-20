// presetCard.ts — presentation-only parsing of a bundled preset's NAME into
// the pieces its picker card renders (PresetPicker.tsx's bundled-preset
// list): an optional small overline, the title, and an optional trailing
// badge — plus `groupPresetsByBadge`, which buckets a design's bundled
// presets by that same parsed badge so the picker can render one section per
// language/category. This is purely a display convention (documented in
// docs/config.md's "Bundled presets" note) — the stored preset name and the
// OpenSCAD parameterSets file format are both untouched; only how the
// existing name is SPLIT (and grouped) for display changes.
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
// scope since parsePresetCardName runs once per preset name, per preset list
// (groupPresetsByBadge loops it).
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

/** One run of bundled presets sharing a parsed badge (`null` for the
 *  badge-less run — PresetPicker.tsx renders that one under its existing
 *  "Ready-made" label; every other run's header is the badge text itself,
 *  e.g. "Deutsch"). */
export interface PresetBadgeGroup<T> {
  badge: string | null;
  items: T[];
}

/**
 * Groups bundled presets by their parsed badge (see `parsePresetCardName`)
 * — a TRUE group-by, not merely an adjacent-run merge like DesignPicker.tsx's
 * `groupDesigns`: every preset sharing a badge lands in the same section
 * regardless of where it falls in the input order, since a config's preset
 * list isn't guaranteed to already cluster same-language presets together.
 * Section order follows each badge's (or the badge-less run's) FIRST
 * appearance in `presets`; item order within a section is preserved from the
 * input. Accepts anything carrying a preset `name` (bundled `ParsedSet`s in
 * practice) so it stays independent of presets.ts's types.
 *
 * Each returned item also carries its own already-computed `parsed` result,
 * so a caller that both groups presets AND renders a per-card title/overline/
 * badge (UnifiedSelectorDialog's Examples group) doesn't have to call
 * `parsePresetCardName` a second time per card — this function already parsed
 * every name once to bucket it.
 */
export function groupPresetsByBadge<T extends { name: string }>(
  presets: T[]
): PresetBadgeGroup<T & { parsed: PresetCardName }>[] {
  const order: (string | null)[] = [];
  const buckets = new Map<string | null, (T & { parsed: PresetCardName })[]>();
  for (const p of presets) {
    const parsed = parsePresetCardName(p.name);
    const badge = parsed.badge ?? null;
    let bucket = buckets.get(badge);
    if (!bucket) {
      bucket = [];
      buckets.set(badge, bucket);
      order.push(badge);
    }
    bucket.push({ ...p, parsed });
  }
  return order.map((badge) => ({ badge, items: buckets.get(badge)! }));
}
