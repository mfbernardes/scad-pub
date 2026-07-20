// params.mjs — parse OpenSCAD's Customizer syntax (the `// [Section]` headers,
// `name = default; // [hint]` parameter lines, and the doc comments above them,
// plus ScadPub's `@showIf` / `@font` / `@info` / `@collapsed` / `@stage`
// annotations) into
// the typed parameter schema the UI is generated from. Skips the [Hidden]
// section, exactly as OpenSCAD's own Customizer does.
import { readFileSync } from "node:fs";

// A section header must be the WHOLE line (leading/trailing whitespace only) —
// otherwise a trailing section-shaped comment on a param line (`w = 10; /* [Oops] */`)
// would be mistaken for a section header, since this is tested before PARAM_RE.
const SECTION_RE = /^\s*\/\*\s*\[([^\]]+)\]\s*\*\/\s*$/;
// name = default; // [hint]
// The name uses OpenSCAD's identifier grammar — a letter or underscore, then
// letters/digits/underscores — so camelCase (wallThickness), PascalCase
// (FontSize) and leading-underscore (_offset) params are all captured, not just
// lowercase ones. ($-prefixed special variables aren't Customizer params.)
// The trailing `\s*` used to sit AFTER the optional `(?:// [hint])?` group,
// so a failing match (trailing text that's neither whitespace nor a valid
// hint) let two adjacent `\s*` quantifiers backtrack against each other —
// O(n²) on a long run of whitespace. Folding it inside the group leaves a
// single free-length `\s*` on any given path, so a non-match fails in O(n).
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
// `// @collapsed` on its own line, marking the NEXT section folded by default.
const COLLAPSE_RE = /^\s*\/\/\s*@collapsed?\s*$/i;
// `// @stage <id> [| Label]` directly above a section header groups that
// section into a named guided-flow stage. Labels are optional after the first
// occurrence (and default to a humanised id when omitted everywhere).
const STAGE_RE = /^\s*\/\/\s*@stage\s+([A-Za-z][A-Za-z0-9_-]*)(?:\s*\|\s*(.+?))?\s*$/i;
const STAGE_ATTEMPT_RE = /^\s*\/\/\s*@stage\b/i;
// File-level design metadata, read anywhere in the file (typically a header
// comment, so it works even before the first section). `@description` is the
// design's picker sub-label; `@icon` is a path to its thumbnail; `@doc` is a
// path to the design's own user-documentation Markdown file. All three resolve
// relative to the design's own .scad file, are ScadPub-only fallbacks — a
// config `designs[]` entry still overrides them — and invisible to OpenSCAD.
const DESCRIPTION_RE = /^\s*\/\/\s*@description\b\s*(.*)$/i;
const ICON_RE = /^\s*\/\/\s*@icon\b\s*(.*)$/i;
const IMAGE_RE = /^\s*\/\/\s*@image\b\s*(.*)$/i;
const FILEDOC_RE = /^\s*\/\/\s*@doc\b\s*(.*)$/i;
// `@svg [layers=<param>]` directive: marks a string parameter as an SVG file the
// in-app wizard prepares (check / fix / import). The optional `layers=<param>`
// binds the wizard's derived per-region colour string to a second parameter.
// Invisible to OpenSCAD.
const SVG_ANNOT_RE = /^@svg\b\s*(.*)$/i;
const SVG_LAYERS_RE = /^layers=([A-Za-z_][A-Za-z0-9_]*)$/i;
// `@filledBy <param>` directive: marks a parameter as populated by the wizard on
// the named `@svg` field, so the UI can render it demoted. Invisible to OpenSCAD.
const FILLEDBY_RE = /^@filledBy\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i;

// ── M9: annotation grammar + cross-parameter validation ────────────────────
// A doc-comment line starting with `@word` is treated as an annotation
// attempt. Each recognised keyword below has an explicit grammar (its *_RE
// above); anything that starts with a recognised keyword but doesn't match
// that grammar — or starts with an unrecognised `@word` at all — fails the
// build with the file and line, instead of silently degrading to plain doc
// prose (a typo'd `@shwoIf` used to just become part of the help text).
const KNOWN_ANNOTATIONS = new Set(["showif", "show-if", "font", "advanced", "info", "svg", "filledby", "stage"]);
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
// Doesn't check that referenced parameter names exist — that needs the full
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

// The concise label is the first sentence of the doc block; the rest is help.
// Split on sentence-ending .!? + whitespace + a capital/opening paren, so we
// don't break on decimals (1.5 mm) or lowercase abbreviations (e.g., i.e.).
export function firstSentence(text) {
  if (!text) return "";
  return text.split(/(?<=[.!?])\s+(?=[A-Z(])/)[0];
}

// Turn a file stem into a human label ("learning_tile" -> "Learning tile").
export function humanize(stem) {
  const s = stem.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseNumberHint(hint) {
  // "min:step:max", "min:max", or OpenSCAD's single-value shorthand "max"
  // (a 0..max slider, no step). An empty segment ("1::10", ":10") is NOT the
  // same as an explicit 0 — Number("") is 0, so reject it up front rather
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
  // Fallback: opaque expression — expose as raw text.
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
  // Set by an `// @svg [layers=<param>]` line; consumed by the next parameter.
  let pendingSvg = null;
  let pendingSvgLine = 0;
  // Set by an `// @filledBy <param>` line; consumed by the next parameter.
  let pendingFilledBy = null;
  let pendingFilledByLine = 0;
  // Set by a `// @collapsed` line; consumed by the next section header.
  let pendingSectionCollapsed = false;
  // Set by `// @stage ...`; consumed by the next section header.
  let pendingSectionStage = null;
  let sectionStage = null;
  const params = [];
  const sections = [];
  const collapsedSections = [];
  const stages = [];
  // File-level design metadata (`// @description` / `// @icon`); first non-empty
  // wins. Populated regardless of section, so a header comment above the first
  // `/* [Section] */` is honoured.
  const meta = { description: null, icon: null, image: null, doc: null };
  // The line each param's @showIf/@svg/@filledBy annotation was declared on,
  // keyed by param name — fed into validateAnnotations below for diagnostics.
  const lineInfo = { showIf: new Map(), svg: new Map(), filledBy: new Map() };
  const reset = () => {
    pendingDoc = [];
    pendingShowIf = null;
    pendingFont = false;
    pendingAdvanced = false;
    pendingInfo = null;
    pendingSvg = null;
    pendingFilledBy = null;
    pendingSectionCollapsed = false;
    pendingSectionStage = null;
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
    const stageMatch = line.match(STAGE_RE);
    if (stageMatch) {
      pendingSectionStage = {
        id: stageMatch[1],
        label: stageMatch[2]?.trim() || null,
        line: lineNo,
      };
      continue;
    }
    if (STAGE_ATTEMPT_RE.test(line))
      fail(absPath, lineNo, `malformed @stage annotation: '${line.trim().replace(/^\/\/\s*/, "")}'`);
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
    const sm = line.match(SECTION_RE);
    if (sm) {
      section = sm[1];
      sectionAdvanced = pendingAdvanced;
      sectionStage = null;
      if (section !== "Hidden" && pendingSectionStage) {
        const prior = stages.find((stage) => stage.id === pendingSectionStage.id);
        if (prior && pendingSectionStage.label && prior.label !== pendingSectionStage.label)
          fail(
            absPath,
            pendingSectionStage.line,
            `@stage '${pendingSectionStage.id}' label '${pendingSectionStage.label}' conflicts with earlier label '${prior.label}'`
          );
        if (!prior) {
          stages.push({
            id: pendingSectionStage.id,
            label: pendingSectionStage.label ?? humanize(pendingSectionStage.id),
          });
        }
        sectionStage = pendingSectionStage.id;
      }
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
      // directly above it. The first sentence is the label, the full block is help.
      const trimmed = pendingDoc.map((d) => d.trim()).filter(Boolean);
      const help = trimmed.join(" ");
      const p = inferParam(name, def, hint, firstSentence(help), help, section);
      if (pendingShowIf) p.showIf = pendingShowIf;
      // Flag font-family selectors: a free-text string OR an enum (dropdown)
      // param with an explicit `@font` annotation. The availability check then
      // runs against the known font set. Enums are included so a design can keep
      // the native OpenSCAD `// [...]` dropdown (which the desktop Customizer
      // renders) and still get the in-app import / fallback affordance.
      if ((p.type === "string" || p.type === "enum") && pendingFont)
        p.isFont = true;
      if (pendingAdvanced || sectionAdvanced) p.advanced = true;
      if (sectionStage) p.stage = sectionStage;
      // Surface this param's value in the viewer info panel (see `// @info`).
      if (pendingInfo) p.info = pendingInfo;
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
      const svg = content.match(SVG_ANNOT_RE);
      const filledBy = content.match(FILLEDBY_RE);
      const word = content.match(ANNOTATION_WORD_RE);
      if (showIf) {
        const expr = showIf[1].trim();
        validateShowIfGrammar(expr, absPath, lineNo);
        pendingShowIf = expr;
        pendingShowIfLine = lineNo;
      } else if (FONT_ANNOT_RE.test(content)) pendingFont = true;
      else if (ADVANCED_ANNOT_RE.test(content)) pendingAdvanced = true;
      else if (info) {
        // `@info`, `@info Label`, or `@info Label | unit` — split on a single
        // pipe; empty parts become null (label falls back to the param's own
        // description in the UI).
        const [label, unit] = info[1].split("|").map((s) => s.trim());
        pendingInfo = { label: label || null, unit: unit || null };
      } else if (filledBy) {
        pendingFilledBy = filledBy[1];
        pendingFilledByLine = lineNo;
      } else if (svg) {
        // `@svg` or `@svg layers=<param>` — capture the optional layers binding.
        // M9: any other trailing text is an unknown @svg option, not a bare
        // annotation — reject it instead of silently ignoring it.
        const rest = svg[1].trim();
        const layersMatch = rest.match(SVG_LAYERS_RE);
        if (rest !== "" && !layersMatch)
          fail(
            absPath,
            lineNo,
            `unknown @svg option '${rest}' (expected bare '@svg' or '@svg layers=<param>')`
          );
        pendingSvg = { layers: layersMatch ? layersMatch[1] : null };
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
          `unknown annotation '@${word[1]}' (expected one of: @showIf, @font, @advanced, @info, @svg, @filledBy, @stage, @collapsed, @description, @icon, @image, @doc)`
        );
      } else pendingDoc.push(dm[1]);
    } else if (line.trim() === "") {
      // keep doc across blank lines
    } else {
      reset();
    }
  }
  validateAnnotations(params, lineInfo, absPath);
  return { params, sections, collapsedSections, stages, meta };
}
