// params.mjs — parse OpenSCAD's Customizer syntax (the `// [Section]` headers,
// `name = default; // [hint]` parameter lines, and the doc comments above them,
// plus ScadPub's `@showIf` / `@font` / `@info` / `@collapsed` annotations) into
// the typed parameter schema the UI is generated from. Skips the [Hidden]
// section, exactly as OpenSCAD's own Customizer does.
import { readFileSync } from "node:fs";

const SECTION_RE = /\/\*\s*\[([^\]]+)\]\s*\*\//;
// name = default; // [hint]
// The name uses OpenSCAD's identifier grammar — a letter or underscore, then
// letters/digits/underscores — so camelCase (wallThickness), PascalCase
// (FontSize) and leading-underscore (_offset) params are all captured, not just
// lowercase ones. ($-prefixed special variables aren't Customizer params.)
const PARAM_RE =
  /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?);\s*(?:\/\/\s*\[([^\]]*)\])?\s*$/;
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
// `// @collapsed` on its own line, marking the NEXT section folded by default.
const COLLAPSE_RE = /^\s*\/\/\s*@collapsed?\s*$/i;
// File-level design metadata, read anywhere in the file (typically a header
// comment, so it works even before the first section). `@description` is the
// design's picker sub-label; `@icon` is a path to its thumbnail, resolved
// relative to the design's own .scad file. Both are ScadPub-only fallbacks —
// a config `designs[]` entry still overrides them — and invisible to OpenSCAD.
const DESCRIPTION_RE = /^\s*\/\/\s*@description\b\s*(.*)$/i;
const ICON_RE = /^\s*\/\/\s*@icon\b\s*(.*)$/i;
// `@svg [layers=<param>]` directive: marks a string parameter as an SVG file the
// in-app wizard prepares (check / fix / import). The optional `layers=<param>`
// binds the wizard's derived per-region colour string to a second parameter.
// Invisible to OpenSCAD.
const SVG_ANNOT_RE = /^@svg\b\s*(.*)$/i;
const SVG_LAYERS_RE = /^layers=([A-Za-z_][A-Za-z0-9_]*)$/i;
// `@filledBy <param>` directive: marks a parameter as populated by the wizard on
// the named `@svg` field, so the UI can render it demoted. Invisible to OpenSCAD.
const FILLEDBY_RE = /^@filledBy\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i;

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
  // "min:step:max" or "min:max"
  const parts = hint.split(":").map((p) => Number(p.trim()));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return { min: parts[0], step: parts[1], max: parts[2] };
  if (parts.length === 2) return { min: parts[0], max: parts[1] };
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
  let pendingFont = false;
  // Set by an `// @info [Label | unit]` line; consumed by the next parameter.
  let pendingInfo = null;
  // Set by an `// @svg [layers=<param>]` line; consumed by the next parameter.
  let pendingSvg = null;
  // Set by an `// @filledBy <param>` line; consumed by the next parameter.
  let pendingFilledBy = null;
  // Set by a `// @collapsed` line; consumed by the next section header.
  let pendingSectionCollapsed = false;
  const params = [];
  const sections = [];
  const collapsedSections = [];
  // File-level design metadata (`// @description` / `// @icon`); first non-empty
  // wins. Populated regardless of section, so a header comment above the first
  // `/* [Section] */` is honoured.
  const meta = { description: null, icon: null };
  const reset = () => {
    pendingDoc = [];
    pendingShowIf = null;
    pendingFont = false;
    pendingInfo = null;
    pendingSvg = null;
    pendingFilledBy = null;
    pendingSectionCollapsed = false;
  };
  for (const line of lines) {
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
    const sm = line.match(SECTION_RE);
    if (sm) {
      section = sm[1];
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
      // Surface this param's value in the viewer info panel (see `// @info`).
      if (pendingInfo) p.info = pendingInfo;
      // Mark a string SVG field for the in-app wizard (see `// @svg`), and a
      // wizard-populated target for demoted rendering (see `// @filledBy`).
      if (pendingSvg && p.type === "string") p.svg = pendingSvg;
      if (pendingFilledBy) p.filledBy = pendingFilledBy;
      params.push(p);
      reset();
      continue;
    }
    const dm = line.match(DOC_RE);
    if (dm && line.trim().startsWith("//")) {
      // Pull `@showIf <expr>` out of the doc block so it doesn't pollute the
      // label/help; it drives conditional visibility in the UI instead.
      const showIf = dm[1].trim().match(SHOWIF_RE);
      const info = dm[1].trim().match(INFO_RE);
      const svg = dm[1].trim().match(SVG_ANNOT_RE);
      const filledBy = dm[1].trim().match(FILLEDBY_RE);
      if (showIf) pendingShowIf = showIf[1].trim();
      else if (FONT_ANNOT_RE.test(dm[1].trim())) pendingFont = true;
      else if (info) {
        // `@info`, `@info Label`, or `@info Label | unit` — split on a single
        // pipe; empty parts become null (label falls back to the param's own
        // description in the UI).
        const [label, unit] = info[1].split("|").map((s) => s.trim());
        pendingInfo = { label: label || null, unit: unit || null };
      } else if (filledBy) pendingFilledBy = filledBy[1];
      else if (svg) {
        // `@svg` or `@svg layers=<param>` — capture the optional layers binding.
        const layersMatch = svg[1].trim().match(SVG_LAYERS_RE);
        pendingSvg = { layers: layersMatch ? layersMatch[1] : null };
      } else pendingDoc.push(dm[1]);
    } else if (line.trim() === "") {
      // keep doc across blank lines
    } else {
      reset();
    }
  }
  return { params, sections, collapsedSections, meta };
}
