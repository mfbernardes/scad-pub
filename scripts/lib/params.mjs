// params.mjs: parse OpenSCAD's Customizer syntax (the `// [Section]` headers,
// `name = default; // [hint]` parameter lines, and the doc comments above them,
// plus ScadPub's `@showIf` / `@font` / `@info` / `@review` / `@label` /
// `@collapsed` annotations) into the typed parameter schema the UI is generated from.
// Skips the [Hidden] section, exactly as OpenSCAD's own Customizer does.
import { readFileSync } from "node:fs";

// A section header must be the WHOLE line (leading/trailing whitespace only):
// otherwise a trailing section-shaped comment on a param line (`w = 10; /* [Oops] */`)
// would be mistaken for a section header, since this is tested before PARAM_RE.
const SECTION_RE = /^\s*\/\*\s*\[([^\]]+)\]\s*\*\/\s*$/;
// name = default; // [hint]
// The name uses OpenSCAD's identifier grammar: a letter or underscore, then
// letters/digits/underscores, so camelCase (wallThickness), PascalCase
// (FontSize) and leading-underscore (_offset) params are all captured, not just
// lowercase ones. ($-prefixed special variables aren't Customizer params.)
// The trailing `\s*` sits INSIDE the optional `(?:// [hint])?` group, not
// after it: outside, a failing match (trailing text that's neither whitespace
// nor a valid hint) lets two adjacent `\s*` quantifiers backtrack against each
// other. O(n²) on a long run of whitespace. Inside, any given path has a
// single free-length `\s*`, so a non-match fails in O(n).
const PARAM_RE =
  /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?);\s*(?:\/\/\s*\[([^\]]*)\]\s*)?$/;
// A leading line comment that documents the next parameter.
const DOC_RE = /^\s*\/\/\s?(.*)$/;
// `@showIf <expr>` directive inside a param's doc block (conditional visibility).
const SHOWIF_RE = /^@show-?if\s+(.+)$/i;
// `@font` directive: marks a string or enum parameter as a font-family selector,
// so the UI can check its value against the available font set. Invisible to OpenSCAD.
const FONT_ANNOT_RE = /^@font\s*$/i;
// `@advanced`: the next parameter, or every parameter in the next section
// when placed directly before its header, is hidden in essentials-first mode.
const ADVANCED_ANNOT_RE = /^@advanced\s*$/i;
// `@info [Label [| unit]]` directive: surface this parameter's live value in the
// viewer's dimension info panel. The optional text is a custom label, and an
// optional `| unit` suffix is appended to the value. Invisible to OpenSCAD.
const INFO_RE = /^@info\b\s*(.*)$/i;
// `@review "<label>"` directive: sets this parameter's label in the curated
// pre-download review summary (designs[].reviewLabels, see docs/config.md
// and docs/annotations.md). Unlike `@info`'s label, which is optional free
// text, `@review`'s quoted label is REQUIRED: a review row always needs
// something to show, with no description-based fallback to fall back to
// (an `@info` row without a custom label falls back to the parameter's own
// description; a review row has nothing equivalent). This annotation is the
// sole source of a row's label, see gen-schema.mjs's buildDesigns.
// Invisible to OpenSCAD.
const REVIEW_RE = /^@review\s+"([^"]*)"\s*$/i;
// `@label "<short label>"` directive: the parameter's CONTROL label, replacing
// the first-sentence-of-the-doc-block default (see firstSentence). The doc
// block then serves purely as help.
//
// It exists because those two jobs genuinely differ. A Customizer docstring is
// written to explain. "Choose the language and Braille standard for this
// sign.", and that is the right *description*; as a label above a dropdown on
// a phone it is a two-line paragraph where "Language & standard" would do.
// firstSentence can only ever shorten prose that is already a sequence of
// sentences; it cannot turn one explanatory sentence into a noun phrase. This
// annotation is how a design says both.
//
// Quoted and required, like `@review` (and for the same reason): a label is
// the one thing a control always needs, so a blank one is a mistake rather
// than "unset". Invisible to OpenSCAD.
const LABEL_RE = /^@label\s+"([^"]*)"\s*$/i;
// `// @collapsed` on its own line, marking the NEXT section folded by default.
const COLLAPSE_RE = /^\s*\/\/\s*@collapsed?\s*$/i;
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
// File-level `// @reviewNote "<text>"`: this design's review-summary note
// (`designs[].reviewNote`, see docs/config.md and docs/annotations.md). Same
// file-level idiom as the four above (first occurrence wins; the sole
// source, no config-level override), but (like `@review` above) takes a
// REQUIRED quoted string rather than bare trailing text: the keyword present
// with anything other than a `"…"` string fails the build, unlike its
// unquoted meta siblings, which merely treat unparsed trailing text as part
// of the path/label they capture.
// Matched in two passes: the bare keyword (so a malformed shape is
// detected at all) and the full quoted form (so a well-formed one is read).
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
// prose, where a typo'd `@shwoIf` would simply become part of the help text.
const KNOWN_ANNOTATIONS = new Set(["showif", "show-if", "font", "advanced", "info", "review", "label", "svg", "filledby", "editonmodel"]);
const ANNOTATION_WORD_RE = /^@([A-Za-z-]+)\b/;

// `@showIf` clause shapes accepted at both generate time (here) and runtime
// (src/lib/visibility.ts mirrors this grammar defensively, in case a legacy
// cached schema.json ever bypasses this validation). A relational operator
// (`>`, `>=`, ...) or any other shape is rejected outright rather than
// silently read as an unknown, always-falsy lookup.
const SHOWIF_BARE_RE = /^!?[A-Za-z_]\w*$/;
const SHOWIF_CMP_RE =
  /^[A-Za-z_]\w*\s*(?:==|!=)\s*(?:"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|true|false|[A-Za-z_]\w*)$/;

function fail(absPath, line, msg) {
  throw new Error(`gen-schema: ${absPath}:${line}: ${msg}`);
}

// Validates a full `@showIf` expression's grammar (an OR of ANDs of the
// clause shapes above); throws with file/line on the first offending clause.
// Doesn't check that referenced parameter names exist, that needs the full
// parameter list, so it's checked later by validateAnnotations.
function validateShowIfGrammar(expr, absPath, line) {
  for (const term of expr.split("||")) {
    for (const raw of term.split("&&")) {
      const c = raw.trim();
      if (c === "") continue; // an empty clause (e.g. a trailing `||`) is tolerated (always truthy)
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
  for (const term of expr.split("||")) {
    for (const raw of term.split("&&")) {
      const c = raw.trim();
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

// Abbreviations whose trailing dot ends a WORD, not a sentence. Without this
// guard the quote-aware split below would cut `… name (e.g. "1 OG")` right
// after the `e.g.`, because the next token opens with a quote: turning a
// legitimate parenthetical into a truncated label. Matched case-insensitively
// against the last whitespace-delimited token before the dot, so `(e.g.` and
// `e.g.` both hit; `z.B.`/`d.h.` are the German designs' equivalents.
//
// Deliberately only abbreviations that essentially NEVER end a sentence. The
// obvious extensions (`etc.`, `vs.`, `no.`, `ca.`, `fig.`) routinely do, and
// listing one here would suppress a real boundary and silently restore the
// paragraph-as-label bug this whole function exists to avoid. A missing entry
// costs one over-long label, which `// @label` overrides anyway; a wrong entry
// costs a truncated one with nothing to notice it. Grow it on evidence, not on
// speculation.
const SENTENCE_ABBREVIATIONS = new Set(["e.g.", "i.e.", "z.b.", "d.h."]);

// Sentence boundary: `.!?` + whitespace + the start of the next sentence.
// The lookahead accepts a capital or an opening paren (as it always has)
// plus an opening QUOTE, without which a design that documents an enum by
// naming its values (`Text alignment. "center" (default) centres …`) never
// splits at all and the whole paragraph becomes the control's label. Straight and typographic quotes both count. Zero-width
// on both sides, so the captured sentence keeps its own terminator.
// Source-only (built per call below) rather than a shared /g literal, whose
// `lastIndex` would carry between calls.
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
  const items = hint.split(",").map((s) => s.trim()).filter(Boolean);
  if (items.length < 2) return null;
  if (items.every((i) => /^".*"$/.test(i))) {
    // quoted-string enum (e.g. font choices)
    return items.map((i) => {
      const v = i.replace(/^"|"$/g, "");
      return { value: v, label: v };
    });
  }
  if (items.some((i) => i.includes(":"))) {
    return items.map((i) => {
      const [value, ...rest] = i.split(":");
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
  const stringMatch = def.match(/^"([\s\S]*)"$/);
  const isString = stringMatch != null;

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
        default: isString ? stringMatch[1] : def,
        choices,
      };
    }
  }

  if (isString) return { ...base, type: "string", default: stringMatch[1] };
  if (!Number.isNaN(Number(def)))
    return { ...base, type: "number", default: Number(def) };
  // Fallback: opaque expression. Expose as raw text.
  return { ...base, type: "string", default: def, raw: true };
}

export function parseParams(absPath) {
  const text = readFileSync(absPath, "utf-8");
  const lines = text.split(/\r?\n/);
  let section = null;
  let pendingDoc = [];
  let pendingShowIf = null;
  let pendingShowIfLine = 0;
  let pendingFont = false;
  let pendingAdvanced = false;
  let sectionAdvanced = false;
  // Set by an `// @info [Label | unit]` line; consumed by the next parameter.
  let pendingInfo = null;
  // Set by an `// @review "<label>"` line; consumed by the next parameter.
  let pendingReview = null;
  // Set by an `// @label "<short label>"` line; consumed by the next parameter.
  let pendingLabel = null;
  // Set by an `// @svg [layers=<param>]` line; consumed by the next parameter.
  let pendingSvg = null;
  let pendingSvgLine = 0;
  // Set by an `// @filledBy <param>` line; consumed by the next parameter.
  let pendingFilledBy = null;
  let pendingFilledByLine = 0;
  // Set by an `// @editOnModel` line; consumed by the next parameter.
  let pendingEditOnModel = false;
  let pendingEditOnModelLine = 0;
  // Name of the param already marked `@editOnModel` in this design (at most one
  // is allowed): persists across the whole loop so a second one fails the build.
  let editOnModelName = null;
  // Set by a `// @collapsed` line; consumed by the next section header.
  let pendingSectionCollapsed = false;
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
  const reset = () => {
    pendingDoc = [];
    pendingShowIf = null;
    pendingFont = false;
    pendingAdvanced = false;
    pendingInfo = null;
    pendingReview = null;
    pendingLabel = null;
    pendingSvg = null;
    pendingFilledBy = null;
    pendingEditOnModel = false;
    pendingSectionCollapsed = false;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    // A section-collapse marker can precede the header even before the first
    // section, so handle it before the null-section guard below.
    if (COLLAPSE_RE.test(line)) {
      pendingSectionCollapsed = true;
      continue;
    }
    // File-level metadata is section-independent, so capture it before the
    // null-section guard too (a header comment sits above the first section).
    const dmeta = line.match(DESCRIPTION_RE);
    if (dmeta) {
      if (meta.description === null && dmeta[1].trim()) meta.description = dmeta[1].trim();
      continue;
    }
    const imeta = line.match(ICON_RE);
    if (imeta) {
      if (meta.icon === null && imeta[1].trim()) meta.icon = imeta[1].trim();
      continue;
    }
    const imagemeta = line.match(IMAGE_RE);
    if (imagemeta) {
      if (meta.image === null && imagemeta[1].trim()) meta.image = imagemeta[1].trim();
      continue;
    }
    const docmeta = line.match(FILEDOC_RE);
    if (docmeta) {
      if (meta.doc === null && docmeta[1].trim()) meta.doc = docmeta[1].trim();
      continue;
    }
    // `@reviewNote` is checked in two passes (see its regexes' comment): the
    // bare keyword first, so a shape that isn't a well-formed quoted string
    // fails the build instead of silently falling through to be read as
    // ordinary doc prose or an unrelated section/param line.
    if (REVIEWNOTE_KEYWORD_RE.test(line)) {
      const notemeta = line.match(REVIEWNOTE_RE);
      if (!notemeta)
        fail(absPath, lineNo, `malformed @reviewNote annotation: expected // @reviewNote "<text>"`);
      if (meta.reviewNote === null && notemeta[1].trim()) meta.reviewNote = notemeta[1].trim();
      continue;
    }
    const sm = line.match(SECTION_RE);
    if (sm) {
      section = sm[1];
      sectionAdvanced = pendingAdvanced;
      if (section !== "Hidden" && !sections.includes(section))
        sections.push(section);
      if (pendingSectionCollapsed && section !== "Hidden" && !collapsedSections.includes(section))
        collapsedSections.push(section);
      reset();
      continue;
    }
    if (section === null || section === "Hidden") {
      reset();
      continue;
    }
    const pm = line.match(PARAM_RE);
    if (pm) {
      const [, name, def, hint] = pm;
      // OpenSCAD's Customizer documents a parameter with the comment block
      // directly above it: its first sentence is the label and the full block
      // is help. Unless `// @label "…"` supplied one outright (see LABEL_RE).
      const trimmed = pendingDoc.map((d) => d.trim()).filter(Boolean);
      const help = trimmed.join(" ");
      const p = inferParam(name, def, hint, pendingLabel ?? firstSentence(help), help, section);
      if (pendingShowIf) p.showIf = pendingShowIf;
      // Flag font-family selectors: a free-text string OR an enum (dropdown)
      // param with an explicit `@font` annotation. The availability check then
      // runs against the known font set. Enums are included so a design can keep
      // the native OpenSCAD `// [...]` dropdown (which the desktop Customizer
      // renders) and still get the in-app import / fallback affordance.
      if ((p.type === "string" || p.type === "enum") && pendingFont)
        p.isFont = true;
      if (pendingAdvanced || sectionAdvanced) p.advanced = true;
      // Surface this param's value in the viewer info panel (see `// @info`).
      if (pendingInfo) p.info = pendingInfo;
      // This param's review-summary label (see `// @review`). Transient:
      // gen-schema.mjs's buildDesigns folds it into the design's own
      // `reviewLabels` map and strips it back off before the param reaches
      // designs.json: src/openscad/types.ts's ParamBase carries no such
      // field. That's deliberate, not an oversight to "fix": types.ts sits in
      // worker.ts's hashed import closure (scripts/lib/worker-deps.mjs feeds
      // scripts/lib/hash.mjs's computeRenderHash), so any edit to it.
      // Comments included. Changes renderHash and evicts every deployment's
      // persisted render cache. Real edits are fine, just worth batching
      // deliberately rather than trickling in one field at a time.
      if (pendingReview) p.reviewLabel = pendingReview;
      // Mark a string SVG field for the in-app wizard (see `// @svg`), and a
      // wizard-populated target for demoted rendering (see `// @filledBy`).
      // M9: a type mismatch (the annotation on a non-string param) fails the
      // build instead of silently dropping the annotation.
      if (pendingSvg) {
        if (p.type !== "string")
          fail(absPath, pendingSvgLine, `@svg on '${name}' must be a string parameter (got type ${p.type})`);
        p.svg = pendingSvg;
        lineInfo.svg.set(name, pendingSvgLine);
      }
      if (pendingFilledBy) {
        if (p.type !== "string")
          fail(
            absPath,
            pendingFilledByLine,
            `@filledBy on '${name}' must be a string parameter (got type ${p.type})`
          );
        p.filledBy = pendingFilledBy;
        lineInfo.filledBy.set(name, pendingFilledByLine);
      }
      // `@editOnModel`: only a plain string param (not a font, not an enum) may
      // be the on-model editable text, and a design may declare it on at most
      // one param. `isFont` is already resolved above, so the font check reads
      // the final flag; an enum (or any non-string type) is caught by the type
      // check. A second occurrence fails the build, naming the first owner.
      if (pendingEditOnModel) {
        if (p.type !== "string")
          fail(
            absPath,
            pendingEditOnModelLine,
            `@editOnModel on '${name}' must be a string parameter (got type ${p.type})`
          );
        if (p.isFont)
          fail(
            absPath,
            pendingEditOnModelLine,
            `@editOnModel on '${name}' cannot be a font parameter (a '@font' string is not editable on the model)`
          );
        if (editOnModelName)
          fail(
            absPath,
            pendingEditOnModelLine,
            `@editOnModel is already declared on '${editOnModelName}'; only one parameter per design may be @editOnModel`
          );
        p.editOnModel = true;
        editOnModelName = name;
      }
      if (pendingShowIf) lineInfo.showIf.set(name, pendingShowIfLine);
      params.push(p);
      reset();
      continue;
    }
    const dm = line.match(DOC_RE);
    if (dm && line.trim().startsWith("//")) {
      const content = dm[1].trim();
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
        pendingShowIf = expr;
        pendingShowIfLine = lineNo;
      } else if (FONT_ANNOT_RE.test(content)) pendingFont = true;
      else if (EDITONMODEL_RE.test(content)) {
        pendingEditOnModel = true;
        pendingEditOnModelLine = lineNo;
      } else if (ADVANCED_ANNOT_RE.test(content)) pendingAdvanced = true;
      else if (info) {
        // `@info`, `@info Label`, or `@info Label | unit`: split on a single
        // pipe; empty parts become null (label falls back to the param's own
        // description in the UI).
        const [label, unit] = info[1].split("|").map((s) => s.trim());
        pendingInfo = { label: label || null, unit: unit || null };
      } else if (review) {
        // The quoted label is required (see REVIEW_RE's own comment): a
        // blank one (`@review ""`) is always a mistake, unlike a file-level
        // `@reviewNote`/`@description`, which silently ignore blank text as
        // "not set".
        const label = review[1].trim();
        if (!label) fail(absPath, lineNo, `@review annotation must have a non-empty quoted label`);
        pendingReview = label;
      } else if (shortLabel) {
        const label = shortLabel[1].trim();
        if (!label) fail(absPath, lineNo, `@label annotation must have a non-empty quoted label`);
        pendingLabel = label;
      } else if (filledBy) {
        pendingFilledBy = filledBy[1];
        pendingFilledByLine = lineNo;
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
        pendingSvg = options;
        pendingSvgLine = lineNo;
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
      } else pendingDoc.push(dm[1]);
    } else if (line.trim() === "") {
      // keep doc across blank lines
    } else {
      reset();
    }
  }
  validateAnnotations(params, lineInfo, absPath);
  return { params, sections, collapsedSections, meta };
}
