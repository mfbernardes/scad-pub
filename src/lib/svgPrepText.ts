// svgPrepText.ts: the SVG-prep engine's display layer. src/lib/svgPrep/ stays
// i18n-free (its check.ts/fixes.ts/groupByColor.ts run under the plain Node
// test suite, with no i18n.ts import), so a Finding/Change/SvgPrepError is
// only ever a stable `code` plus `vars` — this module is the one place that
// turns one into the text the wizard shows, resolving through the active
// locale (t/tn) the same way every other piece of UI copy does.
//
// Each table below is the indirection-table pattern CLAUDE.md's i18n rules
// require (D4): every entry is a literal catalogue-key STRING, resolved at
// render — never a template-built key — both so a locale switch can't miss a
// key and so tests/i18nCoverage.test.mjs's plain-text scan for `"key"`
// literals can see every one of them. A code missing from its table is a bug
// tests/svgPrepText.test.mjs catches (every code round-trips to a
// non-key string).
import { t, tn, formatList, type Vars as I18nVars } from "./i18n";
import type { Change, Finding, SvgPrepError, Vars } from "./svgPrep";

/** check.ts's finding codes with a plural (CLDR #one/#other) `find` value —
 *  every code whose old literal string carried a mechanical "(s)" — mapped to
 *  the catalogue's BASE key (tn() appends #one/#other itself). */
const FIND_KEY: Record<string, string> = {
  "text": "svgPrep.find.text",
  "stroke-only": "svgPrep.find.stroke-only",
  "open-paths": "svgPrep.find.open-paths",
  "covers-canvas": "svgPrep.find.covers-canvas",
  "active-content": "svgPrep.find.active-content",
  "ignored": "svgPrep.find.ignored",
  "styled-fill": "svgPrep.find.styled-fill",
  "inkscape-trap": "svgPrep.find.inkscape-trap",
  "shapes-outside-regions": "svgPrep.find.shapes-outside-regions",
};
/** The rest of check.ts's codes: a plain (non-pluralised) `find` value. */
const FIND_KEY_PLAIN: Record<string, string> = {
  "no-viewbox": "svgPrep.find.no-viewbox",
  "viewbox-origin": "svgPrep.find.viewbox-origin",
  "no-geometry": "svgPrep.find.no-geometry",
  "regions-available": "svgPrep.find.regions-available",
  "too-many-regions": "svgPrep.find.too-many-regions",
  "region-is-label": "svgPrep.find.region-is-label",
  "region-missing": "svgPrep.find.region-missing",
  "content-outside-viewbox": "svgPrep.find.content-outside-viewbox",
  "undersized": "svgPrep.find.undersized",
};

/** Every finding code that pairs its `find` value with a `hint` one — every
 *  code except "regions-available", which has none. */
const HINT_KEY: Record<string, string> = {
  "no-viewbox": "svgPrep.hint.no-viewbox",
  "viewbox-origin": "svgPrep.hint.viewbox-origin",
  "no-geometry": "svgPrep.hint.no-geometry",
  "text": "svgPrep.hint.text",
  "stroke-only": "svgPrep.hint.stroke-only",
  "open-paths": "svgPrep.hint.open-paths",
  "covers-canvas": "svgPrep.hint.covers-canvas",
  "active-content": "svgPrep.hint.active-content",
  "ignored": "svgPrep.hint.ignored",
  "styled-fill": "svgPrep.hint.styled-fill",
  "inkscape-trap": "svgPrep.hint.inkscape-trap",
  "too-many-regions": "svgPrep.hint.too-many-regions",
  "shapes-outside-regions": "svgPrep.hint.shapes-outside-regions",
  "region-is-label": "svgPrep.hint.region-is-label",
  "region-missing": "svgPrep.hint.region-missing",
  "content-outside-viewbox": "svgPrep.hint.content-outside-viewbox",
  "undersized": "svgPrep.hint.undersized",
};

/** fixes.ts/groupByColor.ts's pluralised Change codes, mapped to their
 *  catalogue base key. */
const CHANGE_KEY: Record<string, string> = {
  "removed-background": "svgPrep.change.removed-background",
  "removed-active": "svgPrep.change.removed-active",
  "removed-external": "svgPrep.change.removed-external",
  "style-fills": "svgPrep.change.style-fills",
  "grouped-colour": "svgPrep.change.grouped-colour",
};
/** Their non-pluralised Change codes. */
const CHANGE_KEY_PLAIN: Record<string, string> = {
  "layer-kept": "svgPrep.change.layer-kept",
  "layer-usable": "svgPrep.change.layer-usable",
  "layer-renamed": "svgPrep.change.layer-renamed",
  "recentred": "svgPrep.change.recentred",
};

/** groupByColor outcomes autoGroupByColor surfaces as a Change (see
 *  src/lib/svgPrep/index.ts): "already-grouped"/"one-colour" are swallowed
 *  before a Change is ever minted, so only these two reach display — as
 *  `svgPrep.group.<code>`, not `svgPrep.change.<code>`, since "no shapes to
 *  group" reads differently as an auto-run aside than a Change would
 *  elsewhere (the en value keeps the "Group by colour: " prefix). */
const GROUP_KEY: Record<string, string> = {
  "no-shapes": "svgPrep.group.no-shapes",
  "transformed": "svgPrep.group.transformed",
};

/** SvgPrepError codes with a translatable template. "not-xml" is
 *  DELIBERATELY absent: its `.message` is the DOMParser's own parser-supplied
 *  detail (or a fixed English fallback when that's empty), neither of which
 *  is catalogue text — see `prepErrorText`'s fallback. */
const PREP_ERROR_KEY: Record<string, string> = {
  "not-svg": "svgPrep.prepError.not-svg",
  "spec-separator": "svgPrep.prepError.spec-separator",
};

/** Convert an engine Vars object (whose values may be a string[], e.g. region
 *  ids) into the flat scalar Vars i18n.ts's t/tn accept, joining any list
 *  through the active locale's Intl.ListFormat before interpolation. */
function resolveVars(vars?: Vars): I18nVars | undefined {
  if (!vars) return undefined;
  const out: I18nVars = {};
  for (const [key, value] of Object.entries(vars)) {
    out[key] = Array.isArray(value) ? formatList(value) : value;
  }
  return out;
}

function countOf(vars?: Vars): number {
  const count = vars?.count;
  return typeof count === "number" ? count : 0;
}

/** A finding's display text: its message, and its hint when the code declares
 *  one (see HINT_KEY). `region-missing`'s "available" region list falls back
 *  to "(none)" here — a display concern, not check.ts's (see its own
 *  comment). */
export function findingText(f: Finding): { message: string; hint?: string } {
  const vars: Vars | undefined =
    f.code === "region-missing" && Array.isArray(f.vars?.regions)
      ? { ...f.vars, available: f.vars.regions.length > 0 ? f.vars.regions : "(none)" }
      : f.vars;
  const message = FIND_KEY[f.code]
    ? tn(FIND_KEY[f.code], countOf(f.vars), resolveVars(vars))
    : t(FIND_KEY_PLAIN[f.code], resolveVars(vars));
  const hintKey = HINT_KEY[f.code];
  if (!hintKey) return { message };
  return { message, hint: t(hintKey, resolveVars(f.vars)) };
}

/** A fix/group-by-colour Change's display text. */
export function changeText(c: Change): string {
  if (GROUP_KEY[c.code]) return t(GROUP_KEY[c.code], resolveVars(c.vars));
  if (CHANGE_KEY[c.code]) return tn(CHANGE_KEY[c.code], countOf(c.vars), resolveVars(c.vars));
  return t(CHANGE_KEY_PLAIN[c.code], resolveVars(c.vars));
}

/** A terminal SvgPrepError's display text: the catalogue template for a coded
 *  error, or the error's own `.message` when its code carries none (see
 *  PREP_ERROR_KEY — "not-xml" always falls through here). */
export function prepErrorText(e: SvgPrepError): string {
  const key = PREP_ERROR_KEY[e.code];
  return key ? t(key, resolveVars(e.vars)) : e.message;
}
