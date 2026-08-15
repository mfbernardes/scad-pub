// params.mjs: parse OpenSCAD's Customizer syntax (the `// [Section]` headers,
// `name = default; // [hint]` parameter lines, and the doc comments above them,
// plus ScadPub's `@showIf` / `@font` / `@info` / `@review` / `@label` /
// `@collapsed` annotations) into the typed parameter schema the UI is generated from.
// Skips the [Hidden] section, exactly as OpenSCAD's own Customizer does.
import { readFileSync } from "node:fs";
import { showIfTerms, splitOutsideQuotes } from "../../src/lib/showIfSyntax.mjs";

// A section header must be the WHOLE line (leading/trailing whitespace only):
// otherwise a trailing section-shaped comment on a param line (`w = 10; /* [Oops] */`)
// would be mistaken for a section header, since this is tested before PARAM_RE.
const SECTION_RE = /^\s*\/\*\s*\[([^\]]+)\]\s*\*\/\s*$/;
// name = default; // [hint]
// The name uses OpenSCAD's identifier grammar, so camelCase, PascalCase and
// leading-underscore params are all captured. ($-prefixed special variables
// aren't Customizer params.)
//
// The hint branch tolerates trailing text after the `]` (`// [1:20] mm`), the
// way desktop OpenSCAD does: requiring end-of-line there dropped the range and
// silently downgraded a slider to a free number. A trailing comment that isn't
// a hint at all is consumed and discarded rather than failing the match, in
// both comment syntaxes — otherwise `wall = 2; // in mm` matched neither this
// nor a doc line and vanished from the form while staying a real OpenSCAD
// variable. (A whole-line `/* [Section] */` is caught by SECTION_RE, tested
// first.)
//
// The separator after `;` is a single `[ \t]*` OUTSIDE the optional group, and
// every branch inside starts with a literal `/`: no two free-length quantifiers
// are ever adjacent, so a non-match still fails in O(n) rather than backtracking
// one against the other over a long run of whitespace.
//
// `=(?!=)` because an assignment is not a comparison: a statement that merely
// OPENS with `name ==` and ends in `;` — an `echo(…)` or an `assert(…)` whose
// arguments wrap onto their own line, which is how any of them long enough to
// need wrapping is written — matched as an assignment to `name` and produced a
// phantom parameter shadowing the real one. The other comparison operators
// cannot reach here: the identifier group admits no `!`, `<` or `>` before the
// `=`. `>=`-style compound assignment does not exist in OpenSCAD.
const PARAM_RE =
  /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*(.*?);[ \t]*(?:\/\/[ \t]*\[([^\]]*)\].*|\/\/.*|\/\*.*)?$/;
// A leading line comment that documents the next parameter.
const DOC_RE = /^\s*\/\/\s?(.*)$/;
// `@showIf <expr>` directive inside a param's doc block (conditional visibility).
const SHOWIF_RE = /^@show-?if\s+(.+)$/i;
// `@font` directive: marks a string or enum parameter as a font-family selector,
// so the UI can check its value against the available font set. Invisible to OpenSCAD.
const FONT_ANNOT_RE = /^@font\s*$/i;
// `@info [Label [| unit]]` directive: surface this parameter's live value in the
// viewer's dimension info panel. The optional text is a custom label, and an
// optional `| unit` suffix is appended to the value. Invisible to OpenSCAD.
const INFO_RE = /^@info\b\s*(.*)$/i;
// `@review "<label>"`: this parameter's label in the curated pre-download
// review summary, and the sole source of it (see gen-schema.mjs's buildDesigns
// and docs/annotations.md). The quoted label is REQUIRED, unlike `@info`'s:
// a review row has no description-based fallback to degrade to.
const REVIEW_RE = /^@review\s+"([^"]*)"\s*$/i;
// `@label "<short label>"`: the parameter's CONTROL label, replacing the
// first-sentence default (see firstSentence), leaving the doc block as help.
// Quoted and required for the same reason as `@review`: a blank label is a
// mistake, not "unset".
const LABEL_RE = /^@label\s+"([^"]*)"\s*$/i;
// `// @collapsed` on its own line, marking the NEXT section folded by default.
const COLLAPSE_RE = /^\s*\/\/\s*@collapsed?\s*$/i;
// The keyword on its own, so a malformed `@collapsed extra` fails with its own
// message instead of falling through to the generic unknown-annotation error
// (which listed `@collapsed` among the valid annotations while rejecting it).
const COLLAPSE_KEYWORD_RE = /^\s*\/\/\s*@collapsed?\b/i;
// `@advanced` at line level. The dispatch below only sees a doc line once a
// section is open, so an `@advanced` sitting above the FIRST `/* [Section] */`
// header was silently dropped — the one placement its own documentation calls
// out ("or every parameter in the next section when placed directly before its
// header"). Recognised here, like COLLAPSE_RE, so that placement works.
const ADVANCED_LINE_RE = /^\s*\/\/\s*@advanced\s*$/i;
// File-level design metadata, read anywhere in the file (typically a header
// comment, so it works even before the first section). `@description` is the
// design's picker sub-label; `@icon` is a path to its thumbnail; `@image` is
// larger gallery card artwork; `@doc` is a path to the design's own
// user-documentation Markdown file. All four resolve relative to the design's
// own .scad file, are the SOLE source of this metadata (no config-level
// override exists, see docs/annotations.md), and are invisible to OpenSCAD.
const DESCRIPTION_RE = /^\s*\/\/\s*@description\b\s*(.*)$/i;
const ICON_RE = /^\s*\/\/\s*@icon\b\s*(.*)$/i;
const IMAGE_RE = /^\s*\/\/\s*@image\b\s*(.*)$/i;
const FILEDOC_RE = /^\s*\/\/\s*@doc\b\s*(.*)$/i;
// File-level `// @reviewNote "<text>"`: this design's review-summary note. Same
// idiom as the four above, but the quoted string is REQUIRED — hence two
// passes, the bare keyword so a malformed shape fails the build at all, then
// the full form so a well-formed one is read.
const REVIEWNOTE_KEYWORD_RE = /^\s*\/\/\s*@reviewNote\b/i;
const REVIEWNOTE_RE = /^\s*\/\/\s*@reviewNote\s+"([^"]*)"\s*$/i;
// `@svg [layers=<param>] [height=<param>]` directive: marks a string parameter as
// an SVG file the in-app wizard prepares (check / fix / import). The optional
// `layers=<param>` binds the wizard's derived per-region string to a second
// parameter; `height=<param>` names the number parameter that region heights
// default to, so the wizard can show it. Invisible to OpenSCAD.
const SVG_ANNOT_RE = /^@svg\b\s*(.*)$/i;
const SVG_OPTION_RE = /^(layers|height)=([A-Za-z_][A-Za-z0-9_]*)$/i;
// `@filledBy <param>` directive: marks a parameter as populated by the wizard on
// the named `@svg` field, so the UI can render it demoted. Invisible to OpenSCAD.
const FILLEDBY_RE = /^@filledBy\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i;
// `@editOnModel` directive: marks a parameter as the design's on-model editable
// text. The string the app lets the user edit by clicking the rendered mesh
// (see src/lib/editOnModel.ts). Valid ONLY on a plain `string` param (not a
// font, not an enum), and at most one per design; both rules are enforced
// below. Bare annotation, no arguments. Invisible to OpenSCAD.
const EDITONMODEL_RE = /^@editOnModel\s*$/i;

// ── M9: annotation grammar + cross-parameter validation ────────────────────
// A doc-comment line starting with `@word` is treated as an annotation
// attempt. Each recognised keyword below has an explicit grammar (its *_RE
// above); anything that starts with a recognised keyword but doesn't match
// that grammar (or starts with an unrecognised `@word` at all) fails the
// build with the file and line, instead of silently degrading to plain doc
// prose, where a typo'd `@shwoIf` would become part of the help text.
const KNOWN_ANNOTATIONS = new Set([
  "showif",
  "show-if",
  "font",
  "advanced",
  "info",
  "review",
  "label",
  "svg",
  "filledby",
  "editonmodel",
  // Handled above the section loop rather than in the dispatch below, but it
  // still has to be listed here: without it, `@collapsed extra` was rejected
  // as an UNKNOWN annotation by an error that went on to list `@collapsed`
  // among the valid ones.
  "collapsed",
  "collapse",
]);
const ANNOTATION_WORD_RE = /^@([A-Za-z-]+)\b/;

// `@showIf` clause shapes accepted at both generate time (here) and runtime
// (src/lib/visibility.ts mirrors this grammar defensively, in case a legacy
// cached schema.json ever bypasses this validation). A relational operator
// (`>`, `>=`, ...) or any other shape is rejected outright rather than
// silently read as an unknown, always-falsy lookup.
const SHOWIF_BARE_RE = /^!?[A-Za-z_]\w*$/;
const SHOWIF_CMP_RE =
  /^[A-Za-z_]\w*\s*(?:==|!=)\s*(?:"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|true|false|[A-Za-z_]\w*)$/;

// ── quote-aware scanning ───────────────────────────────────────────────────
// OpenSCAD values can contain the very characters this parser splits on, and
// splitting blind on them corrupted both `["a,b", "c"]` (one choice became two)
// and `mode=="a||b"` (one clause became two, the second ungrammatical). The
// scanner itself lives in src/lib/showIfSyntax.mjs, because the runtime
// evaluator has to split @showIf identically or this file's acceptance means
// nothing; the enum-hint splitting below reuses it.

// ── OpenSCAD string literals ───────────────────────────────────────────────
// Deliberately non-greedy about the closing quote: `"a" + "b"` is a
// concatenation expression, not the single string `a" + "b`, and matching it
// greedily turned an opaque expression into a literal the form let the visitor
// edit. The escapes are OpenSCAD's own set, and the inverse of
// src/lib/scad.ts's escapeScadString.
const STRING_LITERAL_RE = /^"((?:[^"\\]|\\.)*)"$/;

function unescapeScadString(body) {
  return body.replace(/\\(.)/g, (_, ch) => {
    switch (ch) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return ch; // \" \\ and anything else: the character itself
    }
  });
}

function fail(absPath, line, msg) {
  throw new Error(`gen-schema: ${absPath}:${line}: ${msg}`);
}

// Validates a full `@showIf` expression's grammar (an OR of ANDs of the
// clause shapes above); throws with file/line on the first offending clause.
// Doesn't check that referenced parameter names exist, that needs the full
// parameter list, so it's checked later by validateAnnotations.
function validateShowIfGrammar(expr, absPath, line) {
  for (const term of showIfTerms(expr)) {
    for (const c of term) {
      // An empty clause is always truthy, so a stray `||` quietly turns the
      // whole condition into "always shown" — never what anyone typed. Both
      // ends agree it is truthy; this is where it is refused.
      if (c === "")
        fail(
          absPath,
          line,
          `empty @showIf clause in '${expr}' (a stray '||' or '&&' makes the whole ` +
            `condition always true)`
        );
      if (!SHOWIF_BARE_RE.test(c) && !SHOWIF_CMP_RE.test(c))
        fail(
          absPath,
          line,
          `unsupported @showIf clause '${c}' in '${expr}' ` +
            `(supported: name, !name, name==value, name!=value)`
        );
    }
  }
}

// The set of parameter names referenced by a (grammar-valid) @showIf expression.
function showIfIdentifiers(expr) {
  const names = new Set();
  for (const term of showIfTerms(expr)) {
    for (const c of term) {
      if (!c) continue;
      const bare = c.match(/^!?([A-Za-z_]\w*)$/);
      if (bare) {
        names.add(bare[1]);
        continue;
      }
      const cmp = c.match(/^([A-Za-z_]\w*)\s*(?:==|!=)/);
      if (cmp) names.add(cmp[1]);
    }
  }
  return names;
}

// Cross-parameter validation, run once a design's full parameter list is
// known: @showIf targets must exist; @svg's `layers=` target and @filledBy's
// target must exist, be type-compatible, be reciprocal (a layers target must
// be marked `@filledBy` back at its owner, and vice versa), and must not be
// duplicated or cyclic (self-referential).
function validateAnnotations(params, lineInfo, absPath) {
  const byName = new Map(params.map((p) => [p.name, p]));
  const usedLayerTargets = new Map(); // layers target name -> owning @svg param name
  const usedFilledByTargets = new Map(); // @filledBy target (svg param) name -> owning param name

  for (const p of params) {
    if (p.showIf) {
      const line = lineInfo.showIf.get(p.name);
      for (const name of showIfIdentifiers(p.showIf)) {
        if (!byName.has(name))
          fail(absPath, line, `@showIf on '${p.name}' references unknown parameter '${name}'`);
      }
    }

    if (p.svg && p.svg.layers != null) {
      const line = lineInfo.svg.get(p.name);
      const target = p.svg.layers;
      if (target === p.name)
        fail(absPath, line, `@svg layers=${target} on '${p.name}' is cyclic: it targets itself`);
      const targetParam = byName.get(target);
      if (!targetParam)
        fail(absPath, line, `@svg layers=${target} on '${p.name}' references unknown parameter '${target}'`);
      if (targetParam.type !== "string")
        fail(
          absPath,
          line,
          `@svg layers=${target} on '${p.name}' must reference a string parameter (got '${target}' of type ${targetParam.type})`
        );
      if (usedLayerTargets.has(target))
        fail(
          absPath,
          line,
          `@svg layers=${target} on '${p.name}' duplicates the binding already declared by '${usedLayerTargets.get(target)}'`
        );
      usedLayerTargets.set(target, p.name);
      if (targetParam.filledBy !== p.name)
        fail(
          absPath,
          line,
          `@svg layers=${target} on '${p.name}' has no reciprocal '// @filledBy ${p.name}' on '${target}'`
        );
    }

    // `height=` only tells the wizard which number to offer as each region's
    // default height, so it needs no reciprocal, just a real number parameter.
    if (p.svg && p.svg.height != null) {
      const line = lineInfo.svg.get(p.name);
      const target = p.svg.height;
      const targetParam = byName.get(target);
      if (!targetParam)
        fail(absPath, line, `@svg height=${target} on '${p.name}' references unknown parameter '${target}'`);
      else if (targetParam.type !== "number")
        fail(
          absPath,
          line,
          `@svg height=${target} on '${p.name}' must reference a number parameter (got '${target}' of type ${targetParam.type})`
        );
    }

    if (p.filledBy) {
      const line = lineInfo.filledBy.get(p.name);
      const target = p.filledBy;
      if (target === p.name)
        fail(absPath, line, `@filledBy ${target} on '${p.name}' is cyclic: it targets itself`);
      const targetParam = byName.get(target);
      if (!targetParam)
        fail(absPath, line, `@filledBy ${target} on '${p.name}' references unknown parameter '${target}'`);
      else {
        if (!targetParam.svg)
          fail(
            absPath,
            line,
            `@filledBy ${target} on '${p.name}' references '${target}', which has no '@svg' annotation`
          );
        if (usedFilledByTargets.has(target))
          fail(
            absPath,
            line,
            `@filledBy ${target} on '${p.name}' duplicates the binding already declared by '${usedFilledByTargets.get(target)}'`
          );
        usedFilledByTargets.set(target, p.name);
        if (targetParam.svg.layers !== p.name)
          fail(
            absPath,
            line,
            `@filledBy ${target} on '${p.name}' has no reciprocal '// @svg layers=${p.name}' on '${target}'`
          );
      }
    }
  }
}

// Abbreviations whose trailing dot ends a WORD, not a sentence, matched
// case-insensitively against the last token before the dot (so `(e.g.` hits
// too). DELIBERATELY only abbreviations that essentially never end a sentence:
// the obvious extensions (`etc.`, `vs.`, `no.`, `ca.`, `fig.`) routinely do,
// and one of those here would suppress a real boundary and silently restore the
// paragraph-as-label bug. A missing entry costs one over-long label, which
// `// @label` overrides anyway; a wrong entry costs a truncated one with nothing
// to notice it. Grow it on evidence.
const SENTENCE_ABBREVIATIONS = new Set(["e.g.", "i.e.", "z.b.", "d.h."]);

// Sentence boundary: `.!?` + whitespace + a capital, an opening paren or an
// opening quote (straight or typographic) — the quote branch is what stops an
// enum documented by naming its values (`Text alignment. "center" (default) …`)
// from becoming one paragraph-long label. Zero-width on both sides, so the
// captured sentence keeps its terminator. Source-only rather than a shared /g
// literal, whose `lastIndex` would carry between calls.
const SENTENCE_SPLIT_SOURCE = String.raw`(?<=[.!?])\s+(?=["'“‘(A-Z])`;

/**
 * The concise label: the first sentence of the doc block (the rest is help).
 * Splits on sentence-ending punctuation followed by a capital, an opening
 * paren or an opening quote, but never inside a decimal (`1.5 mm`, no
 * whitespace after the dot) nor after a known abbreviation (`… (e.g. "1 OG")`,
 * which the quote lookahead alone would cut in half). A block with no
 * interior boundary is returned unchanged.
 */
export function firstSentence(text) {
  if (!text) return "";
  // Walk candidate boundaries in order and take the first real one, rather
  // than String.split: an abbreviation must be SKIPPED, not accepted as the
  // end of the label, and split() gives no way to resume past one.
  const re = new RegExp(SENTENCE_SPLIT_SOURCE, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // The lookbehind is zero-width, so the match starts at the whitespace:
    // i.e. m.index is already "just past the .!?", and slicing to it keeps
    // the terminator without the following space.
    const end = m.index;
    const lastToken = /\S+$/.exec(text.slice(0, end))?.[0] ?? "";
    // Strip any opening bracket/quote so `(e.g.` matches the bare `e.g.`.
    const bare = lastToken.replace(/^[([{"'“‘]+/, "").toLowerCase();
    if (SENTENCE_ABBREVIATIONS.has(bare)) continue;
    return text.slice(0, end);
  }
  return text;
}

// Turn a file stem into a human label ("learning_tile" -> "Learning tile").
export function humanize(stem) {
  const s = stem.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseNumberHint(hint) {
  // "min:step:max", "min:max", or OpenSCAD's single-value shorthand "max"
  // (a 0..max slider, no step). An empty segment ("1::10", ":10") is NOT the
  // same as an explicit 0. Number("") is 0, so reject it up front rather
  // than silently treating a typo'd/omitted bound as zero.
  const segs = hint.split(":").map((p) => p.trim());
  if (segs.some((s) => s === "")) return null;
  const parts = segs.map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return { min: parts[0], step: parts[1], max: parts[2] };
  if (parts.length === 2) return { min: parts[0], max: parts[1] };
  if (parts.length === 1) return { min: 0, max: parts[0] };
  return null;
}

export function parseEnumHint(hint) {
  // "val:Label, val2:Label2"  OR  list of quoted strings: "a", "b"
  // OR a bare comma-separated value list: "left, right, up, down".
  const items = splitOutsideQuotes(hint, ",").map((s) => s.trim()).filter(Boolean);
  if (items.length < 2) return null;
  if (items.every((i) => /^".*"$/.test(i))) {
    // quoted-string enum (e.g. font choices)
    return items.map((i) => {
      const v = i.replace(/^"|"$/g, "");
      return { value: v, label: v };
    });
  }
  if (items.some((i) => splitOutsideQuotes(i, ":").length > 1)) {
    return items.map((i) => {
      const [value, ...rest] = splitOutsideQuotes(i, ":");
      const label = rest.join(":").trim() || value.trim();
      return { value: value.trim(), label };
    });
  }
  // Bare value list: OpenSCAD's Customizer renders these as a dropdown whose
  // label is the value itself (e.g. signage's `arrow` directions).
  return items.map((v) => ({ value: v, label: v }));
}

function inferParam(name, rawDefault, hint, doc, help, section) {
  const base = { name, section, description: doc || "", help: help || "" };
  const def = rawDefault.trim();

  // boolean
  if (def === "true" || def === "false") {
    return { ...base, type: "boolean", default: def === "true" };
  }

  // string default
  const stringMatch = def.match(STRING_LITERAL_RE);
  const isString = stringMatch != null;
  const stringValue = isString ? unescapeScadString(stringMatch[1]) : null;

  if (hint) {
    const num = !isString ? parseNumberHint(hint) : null;
    if (num) {
      return { ...base, type: "number", default: Number(def), ...num };
    }
    const choices = parseEnumHint(hint);
    if (choices) {
      return {
        ...base,
        type: "enum",
        default: isString ? stringValue : def,
        choices,
      };
    }
  }

  if (isString) return { ...base, type: "string", default: stringValue };
  if (!Number.isNaN(Number(def)))
    return { ...base, type: "number", default: Number(def) };
  // Fallback: opaque expression. Expose as raw text.
  return { ...base, type: "string", default: def, raw: true };
}

// The ordered annotation dispatch for one doc-comment line, writing into the
// loop's `pending` state. The `@word` catch-all MUST stay last: it is what turns
// an unrecognised or malformed annotation into a build failure rather than doc
// prose. Ordinary prose is appended to `pending.doc`.
function parseAnnotation(content, raw, lineNo, pending, absPath) {
  // Pull `@showIf <expr>` out of the doc block so it doesn't pollute the
  // label/help; it drives conditional visibility in the UI instead.
  const showIf = content.match(SHOWIF_RE);
  const info = content.match(INFO_RE);
  const review = content.match(REVIEW_RE);
  const shortLabel = content.match(LABEL_RE);
  const svg = content.match(SVG_ANNOT_RE);
  const filledBy = content.match(FILLEDBY_RE);
  const word = content.match(ANNOTATION_WORD_RE);
  if (showIf) {
    const expr = showIf[1].trim();
    validateShowIfGrammar(expr, absPath, lineNo);
    pending.showIf = expr;
    pending.showIfLine = lineNo;
  } else if (FONT_ANNOT_RE.test(content)) {
    pending.font = true;
    pending.fontLine = lineNo;
  } else if (EDITONMODEL_RE.test(content)) {
    pending.editOnModel = true;
    pending.editOnModelLine = lineNo;
  } else if (info) {
    // `@info`, `@info Label`, or `@info Label | unit`: split on a single
    // pipe; empty parts become null (label falls back to the param's own
    // description in the UI).
    const [label, unit] = info[1].split("|").map((s) => s.trim());
    pending.info = { label: label || null, unit: unit || null };
  } else if (review) {
    // The quoted label is required (see REVIEW_RE's own comment): a
    // blank one (`@review ""`) is always a mistake, unlike a file-level
    // `@reviewNote`/`@description`, which silently ignore blank text as
    // "not set".
    const label = review[1].trim();
    if (!label) fail(absPath, lineNo, `@review annotation must have a non-empty quoted label`);
    pending.review = label;
  } else if (shortLabel) {
    const label = shortLabel[1].trim();
    if (!label) fail(absPath, lineNo, `@label annotation must have a non-empty quoted label`);
    pending.label = label;
  } else if (filledBy) {
    pending.filledBy = filledBy[1];
    pending.filledByLine = lineNo;
  } else if (svg) {
    // `@svg`, optionally followed by `layers=<param>` and/or `height=<param>`
    // in either order. M9: any other trailing text is an unknown @svg option,
    // not a bare annotation. Reject it instead of silently ignoring it.
    const rest = svg[1].trim();
    const options = { layers: null, height: null };
    for (const token of rest.split(/\s+/).filter(Boolean)) {
      const match = token.match(SVG_OPTION_RE);
      if (!match)
        fail(
          absPath,
          lineNo,
          `unknown @svg option '${token}' (expected bare '@svg', '@svg layers=<param>' or '@svg height=<param>')`
        );
      const key = match[1].toLowerCase();
      if (options[key] !== null)
        fail(absPath, lineNo, `@svg option '${key}=' is given twice`);
      options[key] = match[2];
    }
    pending.svg = options;
    pending.svgLine = lineNo;
  } else if (word) {
    // A `@word` that isn't one of the annotations above: either a
    // recognised keyword used with the wrong shape (e.g. bare `@filledBy`
    // with no target), or a typo'd/unknown directive (`@shwoIf`). Both
    // fail the build rather than silently becoming doc prose.
    const keyword = word[1].toLowerCase();
    if (KNOWN_ANNOTATIONS.has(keyword))
      fail(
        absPath,
        lineNo,
        `malformed @${word[1]} annotation: '${content}'`
      );
    fail(
      absPath,
      lineNo,
      `unknown annotation '@${word[1]}' (expected one of: @showIf, @font, @advanced, @info, @review, @label, @svg, @filledBy, @editOnModel, @collapsed, @description, @icon, @image, @doc, @reviewNote)`
    );
  } else pending.doc.push(raw);
}

// The five section-independent, file-level metadata annotations. Returns true
// when `line` was one of them (and the caller should move on). Split out of the
// main loop because none of it interacts with the pending-annotation state the
// loop otherwise exists to carry.
function matchFileMeta(line, lineNo, meta, absPath) {
  for (const [key, re] of [
    ["description", DESCRIPTION_RE],
    ["icon", ICON_RE],
    ["image", IMAGE_RE],
    ["doc", FILEDOC_RE],
  ]) {
    const m = line.match(re);
    if (!m) continue;
    if (meta[key] === null && m[1].trim()) meta[key] = m[1].trim();
    return true;
  }
  // `@reviewNote` is checked in two passes (see its regexes' comment): the
  // bare keyword first, so a shape that isn't a well-formed quoted string fails
  // the build instead of silently falling through to be read as ordinary doc
  // prose or an unrelated section/param line.
  if (REVIEWNOTE_KEYWORD_RE.test(line)) {
    const m = line.match(REVIEWNOTE_RE);
    if (!m)
      fail(absPath, lineNo, `malformed @reviewNote annotation: expected // @reviewNote "<text>"`);
    if (meta.reviewNote === null && m[1].trim()) meta.reviewNote = m[1].trim();
    return true;
  }
  return false;
}

// Split one line's top-level code into `;`-terminated statements, keeping any
// trailing comment attached to the LAST of them.
//
// PARAM_RE's value group is lazy, so it stops at the first `;` — unless what
// follows is neither whitespace nor a comment, in which case it backtracks and
// swallows the `;` too. `d = 1; e = 2;` therefore produced ONE parameter `d`
// whose default was the string `1; e = 2`, and `e` vanished: a control seeded
// with garbage next to a control that does not exist.
//
// The comment has to travel with the last statement rather than being split
// off, because that is where a Customizer hint lives: `mode = "a"; // [a, b]`
// is one statement plus its hint, not two things.
// Blank out CLOSED `/* … */` runs in a line's code, quote-aware, stopping at a
// `//` (which carries the doc/hint text and must survive verbatim).
//
// OpenSCAD treats a block comment as whitespace ANYWHERE in an assignment, and
// PARAM_RE has no notion of one — so `a = /* mm */ 1;` produced a raw-string
// default of `/* mm */ 1`, and `b /* mm */ = 2;` matched nothing and vanished.
// Verified against the pinned build (scripts/check-scad-semantics.mjs): all of
// these are ordinary assignments to it.
//
// Returns { code, opened }: `opened` is the index at which an UNCLOSED comment
// began, or -1. The caller carries that prefix to the line where it closes, so
// an assignment interrupted by a multi-line comment is still one statement.
// ── source-order statement scanner ────────────────────────────────────────
// One pass over the whole file, emitting the TOP-LEVEL, `;`-terminated
// statements in source order, with the lines each one spans.
//
// This replaces three line-wise heuristics (a per-line brace/comment scanner, a
// "carried" continuation string, and a per-line statement splitter) that
// between them got the same class of input wrong in four consecutive rounds:
// a parameter after a module, a parameter before one, a continued assignment on
// either side of one, and — worst — a module's own LOCAL leaking out as a
// control (`a = 1; module m() { p = 1; q = 2; } b = 2;` offered `a` and `q`).
//
// The cause was structural rather than a missing case: brace depth and comment
// state are properties of a POSITION in the source, and every fix that
// expressed them as a property of a LINE ("did this line contain a brace?")
// was wrong for some arrangement of the same constructs on one line. Depth is
// tracked here as the scanner moves, so "top-level" means what it says and
// nothing at depth > 0 is ever collected.
//
// Comments are whitespace, in both syntaxes and across lines, which is what
// OpenSCAD does (asserted against the pinned build by
// scripts/check-scad-semantics.mjs). A `{` at depth 0 discards whatever has
// been collected: that text was a module or function header, not the start of
// an assignment.
function scanTopLevelStatements(text) {
  /** end line -> statements finishing on it, in order. */
  const byEndLine = new Map();
  /** every line any top-level statement occupies. */
  const statementLines = new Set();
  /** lines that BEGIN inside a block comment or inside a body: not Customizer
   *  surface, so the caller skips doc/section handling for them. */
  const startedInside = new Set();

  let buf = "";
  // Whether `buf` still holds nothing but whitespace. Maintained alongside the
  // buffer rather than recomputed, because `buf.trim()` on every character is
  // quadratic in the statement's length: a top-level point table of a few
  // thousand entries — ordinary OpenSCAD — took 25s to parse through it.
  let bufBlank = true;
  // The buffer's FIRST token, and whether the buffer is still that token plus
  // whitespace. Together they answer "is this a `use`/`include` awaiting its
  // `<`" in constant time and for any amount of intervening whitespace or
  // comment — which a bound on the buffer's length could not: `include` is
  // already seven characters, so two spaces hid the directive and the rest of
  // the file was swallowed into one unterminated statement.
  let head = "";
  let headSealed = false; // whitespace has followed the token: it cannot grow
  let headOnly = true;
  let startLine = 0;
  let depth = 0;
  let quote = null;
  let inBlock = false;
  let inLine = false;
  let line = 1;

  // Every reset of the buffer resets what is derived from it. One helper
  // rather than five copies, because a missed field is a silently wrong scan.
  const clearBuf = () => {
    buf = "";
    bufBlank = true;
    head = "";
    headSealed = false;
    headOnly = true;
    startLine = 0;
  };
  // A newline, or a comment, is whitespace between tokens: it separates the
  // head from whatever follows without ending the statement.
  const sealHead = () => {
    if (buf) {
      buf += " ";
      headSealed = true;
    }
  };

  const emit = (endLine, trailing) => {
    if (!bufBlank) {
      const from = startLine || endLine;
      if (!byEndLine.has(endLine)) byEndLine.set(endLine, []);
      byEndLine.get(endLine).push({ code: `${buf};${trailing}`, startLine: from });
      for (let l = from; l <= endLine; l++) statementLines.add(l);
    }
    clearBuf();
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      line += 1;
      inLine = false;
      if (inBlock || depth > 0) startedInside.add(line);
      sealHead();
      continue;
    }
    if (inLine) continue;
    if (inBlock) {
      if (ch === "*" && text[i + 1] === "/") {
        inBlock = false;
        i += 1;
        if (depth === 0) sealHead();
      }
      continue;
    }
    if (quote) {
      if (depth === 0) {
        buf += ch;
        bufBlank = false;
        headOnly = false;
      }
      if (ch === "\\" && i + 1 < text.length) {
        if (depth === 0) buf += text[i + 1];
        i += 1;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      inLine = true;
      i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      inBlock = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      if (depth === 0) {
        if (bufBlank) startLine = line;
        buf += ch;
        bufBlank = false;
        headOnly = false;
      }
      continue;
    }
    // `use <lib/core.scad>` and `include <x.scad>` are statements OpenSCAD
    // terminates with `>`, not `;`. Without this the scanner accumulated one
    // unterminated statement from the first `use` to the next semicolon
    // anywhere in the file — which swallowed every `/* [Section] */` header in
    // between, because a line a statement occupies is that statement's alone.
    // The test is exact and reads two variables, so a `<` used as less-than in
    // an expression is untouched and a file full of them costs nothing.
    if (ch === "<" && depth === 0 && headOnly && (head === "use" || head === "include")) {
      const close = text.indexOf(">", i + 1);
      i = close === -1 ? text.length : close;
      clearBuf();
      continue;
    }
    if (ch === "{") {
      // Whatever was collected is a header, not an assignment.
      if (depth === 0) clearBuf();
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) clearBuf();
      continue;
    }
    if (depth > 0) continue;
    if (ch === ";") {
      // A `// …` immediately after the `;` is that statement's Customizer hint,
      // so it travels with it.
      let j = i + 1;
      while (text[j] === " " || text[j] === "\t") j += 1;
      let trailing = "";
      if (text[j] === "/" && text[j + 1] === "/") {
        const nl = text.indexOf("\n", j);
        trailing = ` ${text.slice(j, nl === -1 ? text.length : nl)}`;
        i = (nl === -1 ? text.length : nl) - 1;
      }
      emit(line, trailing);
      continue;
    }
    if (bufBlank && /\s/.test(ch)) continue; // don't start on whitespace
    if (bufBlank) startLine = line;
    if (/\s/.test(ch)) headSealed = true;
    else if (headSealed) headOnly = false;
    // Nothing longer than `include` can be one, so the token stops growing.
    else if (head.length < 8) head += ch;
    else headOnly = false;
    buf += ch;
    bufBlank = false;
  }
  return { byEndLine, statementLines, startedInside };
}

export function parseParams(absPath) {
  const text = readFileSync(absPath, "utf-8");
  const lines = text.split(/\r?\n/);
  let section = null;
  let sectionAdvanced = false;
  // Every annotation waiting to be applied to the next parameter (or, for
  // `sectionCollapsed`, the next section header), in one object so
  // parseAnnotation can write into it. `reset()` clears the lot.
  const pending = {
    doc: [],
    showIf: null,
    showIfLine: 0,
    font: false,
    fontLine: 0,
    advanced: false,
    info: null,
    review: null,
    label: null,
    svg: null,
    svgLine: 0,
    filledBy: null,
    filledByLine: 0,
    editOnModel: false,
    editOnModelLine: 0,
    sectionCollapsed: false,
  };
  // Name of the param already marked `@editOnModel` in this design (at most one
  // is allowed): persists across the whole loop so a second one fails the build.
  let editOnModelName = null;
  const params = [];
  const sections = [];
  const collapsedSections = [];
  // File-level design metadata (`// @description` / `// @icon`); first non-empty
  // wins. Populated regardless of section, so a header comment above the first
  // `/* [Section] */` is honoured.
  const meta = { description: null, icon: null, image: null, doc: null, reviewNote: null };
  // The line each param's @showIf/@svg/@filledBy annotation was declared on,
  // keyed by param name: fed into validateAnnotations below for diagnostics.
  const lineInfo = { showIf: new Map(), svg: new Map(), filledBy: new Map() };
  // Every parameter name already declared -> the line it was declared on.
  const declaredAt = new Map();
  const reset = () => {
    pending.doc = [];
    pending.showIf = null;
    pending.font = false;
    pending.advanced = false;
    pending.info = null;
    pending.review = null;
    pending.label = null;
    pending.svg = null;
    pending.filledBy = null;
    pending.editOnModel = false;
    pending.sectionCollapsed = false;
  };
  // Build one parameter from a PARAM_RE match and the pending annotation
  // state, then clear that state. `lineNo` is the declaration line.
  const pushParam = (pm, lineNo) => {
    const [, name, def, hint] = pm;
    // OpenSCAD's Customizer documents a parameter with the comment block
    // directly above it: its first sentence is the label and the full block
    // is help. Unless `// @label "…"` supplied one outright (see LABEL_RE).
    const trimmed = pending.doc.map((d) => d.trim()).filter(Boolean);
    const help = trimmed.join(" ");
    const p = inferParam(name, def, hint, pending.label ?? firstSentence(help), help, section);
    if (pending.showIf) p.showIf = pending.showIf;
    // Flag font-family selectors: a free-text string OR an enum (dropdown)
    // param with an explicit `@font` annotation. The availability check then
    // runs against the known font set. Enums are included so a design can keep
    // the native OpenSCAD `// [...]` dropdown (which the desktop Customizer
    // renders) and still get the in-app import / fallback affordance. M9: a
    // type mismatch (the annotation on a number/boolean param, which FontSelect
    // never renders — see ParamForm's isFontParam) fails the build instead of
    // silently no-oping.
    if (pending.font) {
      if (p.type !== "string" && p.type !== "enum")
        fail(
          absPath,
          pending.fontLine,
          `@font on '${name}' must be a string or enum parameter (got type ${p.type})`
        );
      p.isFont = true;
    }
    if (pending.advanced || sectionAdvanced) p.advanced = true;
    // Surface this param's value in the viewer info panel (see `// @info`).
    if (pending.info) p.info = pending.info;
    // Transient: gen-schema.mjs's buildDesigns folds this into the design's
    // `reviewLabels` map and strips it before the param reaches designs.json,
    // so ParamBase deliberately carries no such field — matching protocol.ts
    // (worker.ts's hashed message-shape module), where adding one would
    // change renderHash and evict every deployment's persisted render cache
    // for a field that can't affect a triangle.
    if (pending.review) p.reviewLabel = pending.review;
    // Mark a string SVG field for the in-app wizard (see `// @svg`), and a
    // wizard-populated target for demoted rendering (see `// @filledBy`).
    // M9: a type mismatch (the annotation on a non-string param) fails the
    // build instead of silently dropping the annotation.
    if (pending.svg) {
      if (p.type !== "string")
        fail(absPath, pending.svgLine, `@svg on '${name}' must be a string parameter (got type ${p.type})`);
      p.svg = pending.svg;
      lineInfo.svg.set(name, pending.svgLine);
    }
    if (pending.filledBy) {
      if (p.type !== "string")
        fail(
          absPath,
          pending.filledByLine,
          `@filledBy on '${name}' must be a string parameter (got type ${p.type})`
        );
      p.filledBy = pending.filledBy;
      lineInfo.filledBy.set(name, pending.filledByLine);
    }
    // `@editOnModel`: only a plain string param (not a font, not an enum) may
    // be the on-model editable text, and a design may declare it on at most
    // one param. `isFont` is already resolved above, so the font check reads
    // the final flag; an enum (or any non-string type) is caught by the type
    // check. A second occurrence fails the build, naming the first owner.
    if (pending.editOnModel) {
      if (p.type !== "string")
        fail(
          absPath,
          pending.editOnModelLine,
          `@editOnModel on '${name}' must be a string parameter (got type ${p.type})`
        );
      if (p.isFont)
        fail(
          absPath,
          pending.editOnModelLine,
          `@editOnModel on '${name}' cannot be a font parameter (a '@font' string is not editable on the model)`
        );
      if (editOnModelName)
        fail(
          absPath,
          pending.editOnModelLine,
          `@editOnModel is already declared on '${editOnModelName}'; only one parameter per design may be @editOnModel`
        );
      p.editOnModel = true;
      editOnModelName = name;
    }
    if (pending.showIf) lineInfo.showIf.set(name, pending.showIfLine);
    // Two CONTROLS writing one OpenSCAD variable is never intended: the second
    // silently shadowed the first in the form while `-D` defined the name once.
    // Scoped to declared controls: a `[Hidden]` or preamble assignment sharing
    // the name is not a conflict, because `-D` overrides it.
    if (declaredAt.has(name))
      fail(
        absPath,
        lineNo,
        `duplicate parameter '${name}' (already declared at line ${declaredAt.get(name)})`
      );
    declaredAt.set(name, lineNo);
    params.push(p);
    reset();
  };
  // Every top-level statement in the file, in source order, with the lines it
  // spans (see scanTopLevelStatements). Computed once, up front: brace and
  // comment depth are properties of a POSITION, and every attempt to derive
  // them per line got some arrangement of the same constructs wrong.
  const { byEndLine, statementLines, startedInside } = scanTopLevelStatements(text);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;

    // A line a top-level statement occupies is that statement's, and nothing
    // else's: it is never doc prose, a section header or an annotation. The
    // statement is pushed on the line it ENDS, so its doc block — accumulated
    // before it began — is still pending.
    if (statementLines.has(lineNo)) {
      // Per ENTRY, not per line: `byEndLine` has entries only where a statement
      // ends, so resetting once per line would clear a multi-line statement's
      // pending doc block before its end line ever arrives.
      for (const st of byEndLine.get(lineNo) ?? []) {
        if (section === null || section === "Hidden") continue;
        const pm = st.code.match(PARAM_RE);
        // pushParam() reset()s when it fires; a statement that is not a
        // Customizer parameter must clear the block above it too, or that block
        // becomes the next parameter's label and help.
        if (pm) pushParam(pm, st.startLine);
        else reset();
      }
      continue;
    }
    // Inside a block comment or a module/function body: not Customizer surface
    // at all. Not its assignments (`-D` cannot reach them, so a control for one
    // does nothing) and not its comments (a commented-out annotation is
    // commented out).
    if (startedInside.has(lineNo)) {
      reset();
      continue;
    }
    const line = raw;
    // A section-collapse marker can precede the header even before the first
    // section, so handle it before the null-section guard below.
    if (COLLAPSE_KEYWORD_RE.test(line)) {
      if (!COLLAPSE_RE.test(line))
        fail(absPath, lineNo, `malformed @collapsed annotation: expected a bare // @collapsed`);
      pending.sectionCollapsed = true;
      continue;
    }
    if (ADVANCED_LINE_RE.test(line)) {
      pending.advanced = true;
      continue;
    }
    // File-level metadata is section-independent (a header comment sits above
    // the first section), so it is captured before the null-section guard.
    if (matchFileMeta(line, lineNo, meta, absPath)) continue;
    const sm = line.match(SECTION_RE);
    if (sm) {
      section = sm[1];
      sectionAdvanced = pending.advanced;
      if (section !== "Hidden" && !sections.includes(section))
        sections.push(section);
      if (pending.sectionCollapsed && section !== "Hidden" && !collapsedSections.includes(section))
        collapsedSections.push(section);
      reset();
      continue;
    }
    if (section === null || section === "Hidden") {
      // A blank line keeps the pending state, exactly as it does inside a
      // section. `@advanced` and `@collapsed` both apply to the NEXT section
      // header, and a blank line between the marker and the header is how
      // anyone would write it; resetting here silently dropped the annotation
      // for the one placement its own documentation names.
      if (line.trim() !== "") reset();
      // Deliberately NOT recorded for the duplicate check below. A `[Hidden]`
      // assignment does not defeat a control of the same name: OpenSCAD's `-D`
      // (which is how ScadPub sets every parameter, see
      // src/openscad/renderArgs.ts) overrides in-file assignment wherever it
      // appears, so the control still wins and the engine merely warns about
      // the shadowed assignment. Verified against the pinned build — see
      // scripts/check-scad-semantics.mjs, which is that claim as an executable
      // check rather than as a belief.
      //
      // Repeated assignment is also ordinary OpenSCAD (a value re-derived under
      // a condition, generated source), so rejecting it here would fail
      // programs that are correct.
      continue;
    }
    const dm = line.match(DOC_RE);
    if (dm && line.trim().startsWith("//")) {
      parseAnnotation(dm[1].trim(), dm[1], lineNo, pending, absPath);
    } else if (line.trim() === "") {
      // keep doc across blank lines
    } else {
      reset();
    }
  }
  validateAnnotations(params, lineInfo, absPath);
  return { params, sections, collapsedSections, meta };
}
