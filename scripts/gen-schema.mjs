// gen-schema.mjs — derive the configurator's parameter schema from a directory
// of OpenSCAD designs, parsing OpenSCAD's own Customizer syntax
// (SECTION_RE / PARAM_RE, skipping the [Hidden] section). Generic: the source
// directory, the design list, the always-on OpenSCAD features and the bundled
// fonts all come from scadpub.config.json (override with SCADPUB_CONFIG).
//
// For each design it parses the Customizer parameters and gathers the shared
// .scad the renderer needs, copying them (preserving their relative paths) into
// public/scad/ so the in-browser renderer can mount them. Dependencies come from
// the config's `assets` list (files, whole directories like "lib", or globs like
// "lib/*.scad" / "**/*.svg"); when that is omitted it falls back to following
// each design's `use`/`include` graph. Run
// via the `prebuild`/`predev` npm hooks so the UI never drifts from the source.
//
// `generate()` is exported (and pure-ish: all I/O paths are arguments) so the
// unit tests can drive it against fixtures; running the file directly builds the
// real schema.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  statSync,
  existsSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve, relative, sep } from "node:path";

// Optional build-time SVG→PNG rasterizer (@resvg/resvg-js). Present in dev
// builds; gracefully absent in minimal CI environments that didn't npm install.
let Resvg = null;
try {
  ({ Resvg } = await import("@resvg/resvg-js"));
} catch {
  /* not installed — icon rasterization will be skipped */
}

// A content hash over everything that determines a render's STL output — the
// mounted .scad sources, the bundled fonts (glyph outlines drive text geometry),
// the always-on render features, the OpenSCAD wasm build, and the renderer's own
// source (worker.ts, which fixes the OpenSCAD CLI flags — backend, export
// format, etc.). Folded into the render cache key (schema.renderHash) so any of
// these changing in a deploy invalidates persisted geometry automatically,
// rather than relying on a manual CACHE_VERSION bump for renderer-code changes.
// Fonts/wasm/renderer are hashed only when outPublicDir is given (the real
// build); the fixture tests omit it and hash just the sources + features.
function computeRenderHash({ SOURCE, scadFiles, features, format, fonts, rendererFiles, outPublicDir }) {
  const h = createHash("sha256");
  h.update("renderhash-v2\n"); // version of this recipe itself
  for (const rel of [...scadFiles].sort()) {
    h.update(`scad\0${rel}\0`);
    try {
      h.update(readFileSync(join(SOURCE, rel)));
    } catch {
      /* unreadable source — its absence is itself part of the hash */
    }
  }
  h.update(`features\0${[...features].sort().join(",")}\0`);
  // The export format is an OpenSCAD output flag, so it changes the rendered
  // bytes — fold it in so switching format invalidates persisted geometry.
  h.update(`format\0${format}\0`);
  if (outPublicDir) {
    // The render contract lives in app code, not the schema: hashing the worker
    // source means a change to its OpenSCAD flags or mounting logic invalidates
    // stale geometry without a manual cache-version bump.
    for (const abs of [...(rendererFiles ?? [])].sort()) {
      h.update(`renderer\0${abs.split(/[\\/]/).pop()}\0`);
      try {
        h.update(readFileSync(abs));
      } catch {
        /* renderer source unavailable in this build context */
      }
    }
    for (const name of [...fonts].sort()) {
      h.update(`font\0${name}\0`);
      try {
        h.update(readFileSync(join(outPublicDir, "fonts", name)));
      } catch {
        /* font not bundled here */
      }
    }
    // fontconfig matching rules — they steer which glyphs the text() geometry uses.
    try {
      h.update("fonts.conf\0");
      h.update(readFileSync(join(outPublicDir, "fonts", "fonts.conf")));
    } catch {
      /* no bundled fonts.conf */
    }
    try {
      h.update(readFileSync(join(outPublicDir, "wasm", "openscad.wasm")));
    } catch {
      /* wasm fetched separately; absent during some builds */
    }
  }
  return h.digest("hex").slice(0, 16);
}

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
// A `use <path>` / `include <path>` dependency directive.
const DEP_RE = /^\s*(?:use|include)\s*<([^>]+)>/;
// `@showIf <expr>` directive inside a param's doc block (conditional visibility).
const SHOWIF_RE = /^@show-?if\s+(.+)$/i;
// `@font` directive: marks a string parameter as a font-family selector, so the
// UI can check its value against the available font set. Invisible to OpenSCAD.
const FONT_ANNOT_RE = /^@font\s*$/i;
// `// @collapsed` on its own line, marking the NEXT section folded by default.
const COLLAPSE_RE = /^\s*\/\/\s*@collapsed?\s*$/i;

// The CSS custom-property tokens a consumer config may override via `colors`
// (see src/index.css), listed without the leading `--`. Overriding a token
// outside this set is almost always a typo, so we fail the build rather than
// silently emit a no-op rule.
export const COLOR_TOKENS = [
  "bg",
  "panel",
  "panel-2",
  "line",
  "text",
  "muted",
  "accent",
  "accent-solid",
  "on-accent",
  "focus",
  "link",
  "warn",
  "code-bg",
  "overlay",
  "viewer-bg",
  "viewer-grid",
  "viewer-grid-2",
  "viewer-model",
  // Phase 1 theme-revamp tokens
  "radius",
  "radius-sm",
  "glass-bg",
  "glass-border",
  "elevation",
];

// A deliberately strict CSS-colour value: hex, rgb()/rgba()/hsl()/hsla(), or a
// named colour. Forbids `;`, `{`, `}` and comment markers so a value can't break
// out of the generated `<style>` rule it gets interpolated into.
const COLOR_VALUE_RE = /^[#a-zA-Z0-9 ,.()%/-]+$/;

// Escape a value for safe interpolation into generated XML/SVG attribute text.
const xmlEscape = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Extract the family names embedded in a font file's `name` table. This MUST
// stay byte-for-byte equivalent to `fontFamilyNames` in src/lib/fonts.ts, which
// does the same in the browser for user-imported fonts — the app compares a
// design's font against this build-time data, so the two parsers disagreeing
// would desync the availability check (a cross-check test guards it). It's
// duplicated rather than shared because gen-schema runs as plain Node ESM with
// no TS loader, so it can't import the app's .ts module at build time. Returns
// [] for anything it can't parse, so a malformed font never breaks the build.
const FONT_FAMILY_NAME_IDS = [16, 1]; // 16 = typographic family, 1 = legacy family
export function fontFamilyNames(buf) {
  try {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const latin1 = (start, len) => {
      let s = "";
      for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(start + i));
      return s;
    };
    const utf16be = (start, len) => {
      let s = "";
      for (let i = 0; i + 1 < len; i += 2) s += String.fromCharCode(view.getUint16(start + i));
      return s;
    };
    const out = new Set();
    const fromSfnt = (sfntOffset) => {
      const numTables = view.getUint16(sfntOffset + 4);
      let nameOffset = -1;
      for (let i = 0; i < numTables; i++) {
        const rec = sfntOffset + 12 + i * 16;
        if (latin1(rec, 4) === "name") {
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
        if (!FONT_FAMILY_NAME_IDS.includes(nameID)) continue;
        const len = view.getUint16(rec + 8);
        const off = stringBase + view.getUint16(rec + 10);
        if (off + len > view.byteLength) continue;
        const str = platformID === 1 ? latin1(off, len) : utf16be(off, len);
        const trimmed = str.trim();
        if (trimmed) out.add(trimmed);
      }
    };
    if (latin1(0, 4) === "ttcf") {
      const numFonts = view.getUint32(8);
      for (let i = 0; i < numFonts; i++) fromSfnt(view.getUint32(12 + i * 4));
    } else {
      fromSfnt(0);
    }
    return [...out];
  } catch {
    return [];
  }
}

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

// The model formats OpenSCAD can export and the viewer can parse.
const FORMATS = ["3mf", "stl"];

// Validate the optional `format` config key. "3mf" (the default) carries
// per-object colour; "stl" is geometry-only. Fail fast on anything else.
export function parseFormat(raw) {
  if (raw == null) return "3mf";
  if (!FORMATS.includes(raw))
    throw new Error(
      `config.format must be one of ${FORMATS.map((f) => `"${f}"`).join(", ")} (got ${JSON.stringify(raw)})`
    );
  return raw;
}

// Validate and normalise the optional `colors` config block into
// { light?: {token: value}, dark?: {token: value} }. Unknown tokens and unsafe
// values fail the build with a clear message (consistent with gen-schema's other
// fail-fast checks). Colours don't affect geometry, so they're absent from
// renderHash. Returns null when nothing valid is configured.
export function parseColors(raw) {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error(
      "gen-schema: 'colors' must be an object with optional 'light' and 'dark' keys"
    );
  const out = {};
  for (const theme of ["light", "dark"]) {
    const tokens = raw[theme];
    if (tokens == null) continue;
    if (typeof tokens !== "object" || Array.isArray(tokens))
      throw new Error(
        `gen-schema: 'colors.${theme}' must be an object of token: colour pairs`
      );
    const cleaned = {};
    for (const [token, value] of Object.entries(tokens)) {
      if (!COLOR_TOKENS.includes(token))
        throw new Error(
          `gen-schema: unknown colour token 'colors.${theme}.${token}'.\n` +
            `  Valid tokens: ${COLOR_TOKENS.join(", ")}`
        );
      if (typeof value !== "string" || !COLOR_VALUE_RE.test(value.trim()))
        throw new Error(
          `gen-schema: 'colors.${theme}.${token}' must be a plain CSS colour ` +
            `(got ${JSON.stringify(value)})`
        );
      cleaned[token] = value.trim();
    }
    if (Object.keys(cleaned).length) out[theme] = cleaned;
  }
  return Object.keys(out).length ? out : null;
}

// Validate and normalise the optional `licenses` config block: extra
// third-party software / license notices that get APPENDED (never substituted)
// to the app's built-in open-source attributions (src/lib/licenses.ts) in the
// in-app licenses modal. Each entry mirrors that file's shape. Required string
// fields must be non-empty; recognised optional fields must be strings when
// present; unknown keys are dropped. Fails the build with a clear message
// (consistent with gen-schema's other fail-fast checks). Returns [] when unset.
export function parseLicenses(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw))
    throw new Error(
      "gen-schema: 'licenses' must be an array of software/license entries"
    );
  const REQUIRED = ["name", "license", "copyright", "url", "licenseUrl"];
  const OPTIONAL = ["version", "text", "sourceUrl", "note"];
  return raw.map((entry, i) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error(`gen-schema: 'licenses[${i}]' must be an object`);
    const out = {};
    for (const key of REQUIRED) {
      if (typeof entry[key] !== "string" || !entry[key].trim())
        throw new Error(
          `gen-schema: 'licenses[${i}].${key}' is required and must be a non-empty string`
        );
      out[key] = entry[key];
    }
    for (const key of OPTIONAL) {
      if (entry[key] === undefined) continue;
      if (typeof entry[key] !== "string")
        throw new Error(`gen-schema: 'licenses[${i}].${key}' must be a string`);
      out[key] = entry[key];
    }
    return out;
  });
}

// Validate and normalise the optional `fileImport` config block: the generic
// "Import file" button that lets the user supply any file their designs
// reference but the app can't bundle (a font, an SVG to import(), a surface()
// data file, …). Accepts `true` (defaults) or an options object. Fails the
// build with a clear message on a bad shape. Returns null when not configured.
export function parseFileImport(fileImport) {
  const raw = fileImport;
  if (raw == null || raw === false) return null;
  if (raw === true) return {};
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error("gen-schema: 'fileImport' must be true, an options object, or null");
  const out = {};
  for (const key of ["accept", "label", "note"]) {
    if (raw[key] === undefined || raw[key] === null) continue;
    if (typeof raw[key] !== "string")
      throw new Error(`gen-schema: 'fileImport.${key}' must be a string`);
    out[key] = raw[key];
  }
  return out;
}

// The display policies a `popup` may choose: shown on every visit ("always"),
// only the first visit ("once"), or every visit until the user opts out with a
// "Don't show this again" checkbox ("dismissible").
export const POPUP_MODES = ["always", "once", "dismissible"];

// Validate and normalise the optional `popup` config block: a notice dialog
// shown over the app on load. `header` (dialog title) and `body` (a
// Markdown-subset string — bold/code/links/lists, same renderer as `help`) are
// required; `mode` (one of POPUP_MODES) chooses how often it appears and
// defaults to "once". Purely informational, so it's absent from renderHash.
// Returns null when not configured; fails the build with a clear message on a
// bad shape (consistent with gen-schema's other fail-fast checks).
export function parsePopup(raw) {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error(
      "gen-schema: 'popup' must be an object with 'header', 'body' and an optional 'mode'"
    );
  for (const key of ["header", "body"]) {
    if (typeof raw[key] !== "string" || !raw[key].trim())
      throw new Error(
        `gen-schema: 'popup.${key}' is required and must be a non-empty string`
      );
  }
  const mode = raw.mode ?? "once";
  if (!POPUP_MODES.includes(mode))
    throw new Error(
      `gen-schema: 'popup.mode' must be one of ${POPUP_MODES.map((m) => `"${m}"`).join(", ")} ` +
        `(got ${JSON.stringify(raw.mode)})`
    );
  return { header: raw.header, body: raw.body, mode };
}

// Validate and normalise the optional `notices` config block: the design-defined
// notice categories surfaced on the "OpenSCAD output" panel. A design echoes
// `ECHO: "<context>: <marker>: <message>"` and each configured category turns
// matching echoes into a friendly notice and a coloured count badge. Each entry
// is { marker (required), label?, color? }:
//   - marker: the design-defined string matched as `: <marker>:` in an echo
//     (e.g. "alert", "note"); case-insensitive.
//   - label: the badge / notice noun (e.g. "alerts"); defaults to marker.
//   - color: an optional badge fill colour, validated as a plain CSS colour
//     (same strictness as `colors`) so it can't break out of the inline style
//     it gets interpolated into.
// Notices don't affect geometry, so they're absent from renderHash. Off by
// default: omitted (or []) -> no notice categories. OpenSCAD's own WARNING/ERROR
// lines and assert failures stay hardcoded (see lib/diagnostics).
export function parseNotices(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw))
    throw new Error(
      "gen-schema: 'notices' must be an array of notice categories"
    );
  return raw.map((entry, i) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error(`gen-schema: 'notices[${i}]' must be an object`);
    if (typeof entry.marker !== "string" || !entry.marker.trim())
      throw new Error(
        `gen-schema: 'notices[${i}].marker' is required and must be a non-empty string`
      );
    const out = { marker: entry.marker.trim() };
    if (entry.label === undefined || entry.label === null) {
      out.label = out.marker;
    } else if (typeof entry.label !== "string" || !entry.label.trim()) {
      throw new Error(
        `gen-schema: 'notices[${i}].label' must be a non-empty string`
      );
    } else {
      out.label = entry.label.trim();
    }
    if (entry.color !== undefined && entry.color !== null) {
      if (typeof entry.color !== "string" || !COLOR_VALUE_RE.test(entry.color.trim()))
        throw new Error(
          `gen-schema: 'notices[${i}].color' must be a plain CSS colour ` +
            `(got ${JSON.stringify(entry.color)})`
        );
      out.color = entry.color.trim();
    }
    return out;
  });
}

// Validate and normalise the optional `ui` config block: build-time UI behaviour
// overrides. None affect geometry (absent from renderHash). Applies defaults for
// omitted keys. Returns the defaults object when the config omits `ui` entirely.
export function parseUi(raw) {
  const defaults = { panelSide: "left", panelDefault: "open", outputDefault: "closed", install: "auto", showVarName: true };
  if (raw == null) return defaults;
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error("gen-schema: 'ui' must be an object");
  const out = { ...defaults };
  const PANEL_SIDES = ["left", "right"];
  const PANEL_DEFAULTS = ["open", "collapsed"];
  const OUTPUT_DEFAULTS = ["closed", "open"];
  const INSTALL_MODES = ["auto", "off"];
  if (raw.panelSide !== undefined) {
    if (!PANEL_SIDES.includes(raw.panelSide))
      throw new Error(`gen-schema: 'ui.panelSide' must be one of ${PANEL_SIDES.map((s) => `"${s}"`).join(", ")}`);
    out.panelSide = raw.panelSide;
  }
  if (raw.panelDefault !== undefined) {
    if (!PANEL_DEFAULTS.includes(raw.panelDefault))
      throw new Error(`gen-schema: 'ui.panelDefault' must be one of ${PANEL_DEFAULTS.map((s) => `"${s}"`).join(", ")}`);
    out.panelDefault = raw.panelDefault;
  }
  if (raw.outputDefault !== undefined) {
    if (!OUTPUT_DEFAULTS.includes(raw.outputDefault))
      throw new Error(`gen-schema: 'ui.outputDefault' must be one of ${OUTPUT_DEFAULTS.map((s) => `"${s}"`).join(", ")}`);
    out.outputDefault = raw.outputDefault;
  }
  if (raw.install !== undefined) {
    if (!INSTALL_MODES.includes(raw.install))
      throw new Error(`gen-schema: 'ui.install' must be one of ${INSTALL_MODES.map((s) => `"${s}"`).join(", ")}`);
    out.install = raw.install;
  }
  if (raw.showVarName !== undefined) {
    if (typeof raw.showVarName !== "boolean")
      throw new Error("gen-schema: 'ui.showVarName' must be a boolean");
    out.showVarName = raw.showVarName;
  }
  return out;
}

// The concise label is the first sentence of the doc block; the rest is help.
// Split on sentence-ending .!? + whitespace + a capital/opening paren, so we
// don't break on decimals (1.5 mm) or lowercase abbreviations (e.g., i.e.).
export function firstSentence(text) {
  if (!text) return "";
  return text.split(/(?<=[.!?])\s+(?=[A-Z(])/)[0];
}

// Turn a file stem into a human label ("learning_tile" -> "Learning tile").
function humanize(stem) {
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
  // Set by a `// @collapsed` line; consumed by the next section header.
  let pendingSectionCollapsed = false;
  const params = [];
  const sections = [];
  const collapsedSections = [];
  const reset = () => {
    pendingDoc = [];
    pendingShowIf = null;
    pendingFont = false;
    pendingSectionCollapsed = false;
  };
  for (const line of lines) {
    // A section-collapse marker can precede the header even before the first
    // section, so handle it before the null-section guard below.
    if (COLLAPSE_RE.test(line)) {
      pendingSectionCollapsed = true;
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
      // Flag font-family selectors: a string param with an explicit `@font`
      // annotation. The availability check then runs against the known font set.
      if (p.type === "string" && pendingFont) p.isFont = true;
      params.push(p);
      reset();
      continue;
    }
    const dm = line.match(DOC_RE);
    if (dm && line.trim().startsWith("//")) {
      // Pull `@showIf <expr>` out of the doc block so it doesn't pollute the
      // label/help; it drives conditional visibility in the UI instead.
      const showIf = dm[1].trim().match(SHOWIF_RE);
      if (showIf) pendingShowIf = showIf[1].trim();
      else if (FONT_ANNOT_RE.test(dm[1].trim())) pendingFont = true;
      else pendingDoc.push(dm[1]);
    } else if (line.trim() === "") {
      // keep doc across blank lines
    } else {
      reset();
    }
  }
  return { params, sections, collapsedSections };
}

/**
 * Build the configurator schema and copy the needed .scad/preset files.
 * @param {object} opts
 * @param {string} opts.configPath  Path to the configurator config JSON.
 * @param {string} opts.outSchemaDir  Where designs.json is written.
 * @param {string} opts.outScadDir  Where the copied .scad/presets are written.
 * @returns {object} the schema (also written to outSchemaDir/designs.json).
 */
export function generate({ configPath, outSchemaDir, outScadDir, outPublicDir, rendererFiles }) {
  // Fail early and clearly when a configured path doesn't exist — these are the
  // most common ways a config drifts from the designs it points at.
  const mustExist = (abs, what) => {
    if (!existsSync(abs))
      throw new Error(
        `gen-schema: ${what} not found:\n  ${abs}\n` +
          `  (referenced from ${configPath} — check its source/assets/designs/logo/icon)`
      );
    return abs;
  };

  mustExist(configPath, "config file");
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  // Everything in the config is resolved relative to the config file's directory.
  // `source` defaults to "." (designs live beside the config); set it to point
  // elsewhere (e.g. "examples", a sibling checkout, or an absolute path).
  const CONFIG_DIR = dirname(configPath);
  const SOURCE = resolve(CONFIG_DIR, config.source ?? ".");
  mustExist(SOURCE, `source directory '${config.source ?? "."}'`);
  const FEATURES = config.features ?? [];
  const FORMAT = parseFormat(config.format);
  // Fonts are referenced by basename under /fonts. An entry is either a font
  // already present in public/fonts (the Liberation fallbacks that ship with the
  // app) or a path into the source tree (a design repo bundling its own font),
  // which we copy into public/fonts so it is served like the rest.
  const FONTS = (config.fonts ?? []).map((entry) => {
    const name = String(entry).split(/[\\/]/).pop();
    const srcAbs = resolve(SOURCE, entry);
    if (outPublicDir && existsSync(srcAbs) && statSync(srcAbs).isFile()) {
      const dest = join(outPublicDir, "fonts", name);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(srcAbs, dest);
    }
    return name;
  });
  // The fontconfig config the renderer mounts. Optionally pins a weak last-resort
  // fallback family (config.fontFallback) so an imported font can't hijack
  // Fontconfig's global default. Generated into the served tree (and hashed into
  // renderHash) so the matching rules stay config-driven, not hand-maintained.
  const FONT_FALLBACK = parseFontFallback(config.fontFallback);
  if (outPublicDir) {
    mkdirSync(join(outPublicDir, "fonts"), { recursive: true });
    writeFileSync(join(outPublicDir, "fonts", "fonts.conf"), renderFontsConf(FONT_FALLBACK));
  }
  // The bundled fonts' real embedded family names, so the app can decide font
  // availability by family rather than filename. Read from the copied files in
  // the served tree; only meaningful in a real build (outPublicDir present).
  const FONT_FAMILIES = [];
  if (outPublicDir) {
    const seen = new Set();
    for (const name of FONTS) {
      let buf;
      try {
        buf = readFileSync(join(outPublicDir, "fonts", name));
      } catch {
        continue; // font not bundled here (e.g. a fixture's placeholder name)
      }
      for (const fam of fontFamilyNames(buf)) {
        const key = fam.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          FONT_FAMILIES.push(fam);
        }
      }
    }
    FONT_FAMILIES.sort((a, b) => a.localeCompare(b));
  }
  const TITLE = config.title ?? "ScadPub";
  const SHORT_NAME = config.shortName ?? TITLE;
  const ID = config.id ?? "scadpub";
  const DESCRIPTION =
    config.description ?? "Configure and export designs in your browser.";
  // PWA / browser chrome colours (default to the dark palette's chrome).
  // Validated like every other colour input (COLOR_VALUE_RE) so they stay safe
  // when interpolated into generated SVG/HTML attributes below.
  const THEME_COLOR = config.themeColor ?? "#1f2229";
  const THEME_COLOR_LIGHT = config.themeColorLight ?? "#ffffff";
  const BG_COLOR = config.backgroundColor ?? "#15171c";
  for (const [key, val] of [
    ["themeColor", THEME_COLOR],
    ["themeColorLight", THEME_COLOR_LIGHT],
    ["backgroundColor", BG_COLOR],
  ]) {
    if (typeof val !== "string" || !COLOR_VALUE_RE.test(val.trim()))
      throw new Error(`gen-schema: '${key}' must be a CSS colour string (got ${JSON.stringify(val)})`);
  }
  const CATEGORIES = Array.isArray(config.categories) ? config.categories : [];
  // Optional generic file-import button (fonts, SVGs, data files, …). Validated.
  // Absent -> null -> no import button.
  const FILE_IMPORT = parseFileImport(config.fileImport);
  // Optional one-off notice dialog shown over the app on load. Validated; absent
  // -> null -> no popup.
  const POPUP = parsePopup(config.popup);
  // Config-driven notice categories surfaced on the OpenSCAD output panel.
  // Validated; off by default (omitted -> none).
  const NOTICES = parseNotices(config.notices);
  // Optional help content; passed through verbatim. Absent -> null -> the app
  // falls back to its generic, project-agnostic default help.
  const HELP = config.help ?? null;
  // Optional extra third-party software / license notices. Validated and
  // appended (never replacing the built-ins) by the in-app licenses modal.
  const LICENSES_EXTRA = parseLicenses(config.licenses);
  // Optional per-theme colour-scheme overrides. Validated against the known CSS
  // tokens; emitted by vite.config.ts as a <style> block so a consumer project
  // can restyle the app entirely from its config. Absent -> null.
  const COLORS = parseColors(config.colors);
  // Build-time UI behaviour config (panel side, default state, etc.).
  const UI = parseUi(config.ui);

  // outScadDir is entirely generated: wipe it before repopulating so files from
  // a previous config/build (a removed, renamed or briefly-private design or
  // dependency) can't survive into the published tree. Recreated empty below.
  rmSync(outScadDir, { recursive: true, force: true });

  // Optional header logo, per theme. `logo` may be a string (used for both
  // themes) or { light, dark } (either may be omitted -> the other is used).
  // Each referenced file is copied into the served tree; the schema records the
  // resolved { light, dark } URLs.
  mkdirSync(outScadDir, { recursive: true });
  let logo = null;
  if (config.logo) {
    // Map each resolved source to the URL it was copied to, so a single source
    // used for both themes is copied once and two distinct sources never clobber
    // each other — even when they share a basename (light/logo.svg vs
    // dark/logo.svg), which a flat basename would silently overwrite.
    const copiedByAbs = new Map();
    const usedNames = new Set();
    const copyLogo = (src) => {
      const abs = mustExist(resolve(CONFIG_DIR, src), `logo '${src}'`);
      const existing = copiedByAbs.get(abs);
      if (existing) return existing;
      let name = abs.split(/[\\/]/).pop();
      if (usedNames.has(name)) {
        // Same basename, different source: disambiguate with a short hash of the
        // source path so the second logo doesn't overwrite the first.
        const tag = createHash("sha256").update(abs).digest("hex").slice(0, 8);
        const dot = name.lastIndexOf(".");
        name = dot > 0 ? `${name.slice(0, dot)}-${tag}${name.slice(dot)}` : `${name}-${tag}`;
      }
      usedNames.add(name);
      copyFileSync(abs, join(outScadDir, name));
      const url = `scad/${name}`;
      copiedByAbs.set(abs, url);
      return url;
    };
    const entry = config.logo;
    const lightSrc = typeof entry === "string" ? entry : entry.light ?? entry.dark;
    const darkSrc = typeof entry === "string" ? entry : entry.dark ?? entry.light;
    logo = { light: copyLogo(lightSrc), dark: copyLogo(darkSrc) };
  }

  // A source-relative POSIX path (the key the renderer mounts files under).
  const relPosix = (absPath) => relative(SOURCE, absPath).split(sep).join("/");

  // Every .scad under a directory (recursively), as source-relative POSIX paths.
  const scadFilesUnder = (absDir) => {
    const out = [];
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) out.push(...scadFilesUnder(abs));
      else if (entry.name.endsWith(".scad")) out.push(relPosix(abs));
    }
    return out;
  };

  // Every file under a directory (recursively), as source-relative POSIX paths.
  const filesUnder = (absDir) => {
    const out = [];
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) out.push(...filesUnder(abs));
      else out.push(relPosix(abs));
    }
    return out;
  };

  // A glob entry uses `*` or `?` wildcards rather than naming a concrete file or
  // directory. (`[`…`]` classes aren't supported — they'd be matched literally.)
  const isGlob = (entry) => /[*?]/.test(entry);

  // Compile one glob path-segment (no slashes) to an anchored RegExp: `*` spans
  // any run of non-separator characters, `?` a single one, everything else is a
  // literal (regex metacharacters escaped so a pattern can't inject regex).
  const segmentToRe = (seg) => {
    let re = "";
    for (const ch of seg) {
      if (ch === "*") re += "[^/]*";
      else if (ch === "?") re += "[^/]";
      else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${re}$`);
  };

  // Match files under SOURCE against a POSIX glob. `*`/`?` match within a single
  // path segment; `**` spans zero or more directories (so `lib/**/*.scad` reaches
  // nested files, `**/*.svg` every svg in the tree, `lib/**` every file under
  // lib). Only files match — directories are traversed, never emitted, mirroring
  // copyAsset which copies a file. Returns source-relative POSIX paths.
  const globAssets = (pattern) => {
    const segments = pattern.split("/").filter(Boolean);
    const out = [];
    const walk = (absDir, relParts, segIdx) => {
      const seg = segments[segIdx];
      const last = segIdx === segments.length - 1;
      if (seg === "**") {
        // Trailing `**`: every file at or below here. Otherwise `**` consumes
        // zero directories (match the rest right here) or one+ (descend, retry).
        if (last) {
          for (const f of filesUnder(absDir)) out.push(f);
          return;
        }
        walk(absDir, relParts, segIdx + 1);
        for (const entry of readdirSync(absDir, { withFileTypes: true }))
          if (entry.isDirectory())
            walk(join(absDir, entry.name), [...relParts, entry.name], segIdx);
        return;
      }
      const re = segmentToRe(seg);
      for (const entry of readdirSync(absDir, { withFileTypes: true })) {
        if (!re.test(entry.name)) continue;
        const parts = [...relParts, entry.name];
        if (last) {
          if (entry.isFile()) out.push(parts.join("/"));
        } else if (entry.isDirectory()) {
          walk(join(absDir, entry.name), parts, segIdx + 1);
        }
      }
    };
    walk(SOURCE, [], 0);
    return out;
  };

  // Expand the config's `assets`: a glob (`*`/`?`/`**`) contributes every file it
  // matches; a directory contributes all the .scad under it; a plain file is
  // taken as-is. So "lib" bundles lib/*.scad, "lib/*.scad" the same explicitly,
  // and "**/*.svg" every svg in the tree.
  const expandConfiguredAssets = (entries) => {
    const set = new Set();
    for (const entry of entries) {
      if (isGlob(entry)) {
        const matches = globAssets(entry);
        if (!matches.length)
          throw new Error(
            `gen-schema: asset pattern '${entry}' matched no files under ${SOURCE}\n` +
              `  (referenced from ${configPath} — check its 'assets' globs)`
          );
        for (const f of matches) set.add(f);
        continue;
      }
      const abs = mustExist(resolve(SOURCE, entry), `asset '${entry}'`);
      if (statSync(abs).isDirectory()) {
        for (const f of scadFilesUnder(abs)) set.add(f);
      } else {
        set.add(relPosix(abs));
      }
    }
    return set;
  };

  // Walk the use/include graph from a design, returning every dependency's
  // source-relative POSIX path. Each `<path>` is resolved relative to the file
  // that references it, matching OpenSCAD. Used only when `assets` is omitted.
  const collectDeps = (designAbs) => {
    const deps = new Set();
    const visited = new Set([designAbs]);
    const queue = [designAbs];
    while (queue.length) {
      const cur = queue.shift();
      const curDir = dirname(cur);
      const text = readFileSync(cur, "utf-8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(DEP_RE);
        if (!m) continue;
        const depAbs = resolve(curDir, m[1].trim());
        if (visited.has(depAbs)) continue;
        visited.add(depAbs);
        deps.add(relPosix(depAbs));
        queue.push(depAbs);
      }
    }
    return deps;
  };

  // A design id namespaces storage and is interpolated into a default filename
  // (`${id}.scad`), the URL deep link (`#d=${id}`) and manifest shortcuts, so
  // restrict it to a safe, path/URL-friendly character set.
  const checkId = (id) => {
    if (typeof id !== "string" || !/^[A-Za-z0-9._-]+$/.test(id))
      throw new Error(
        `gen-schema: design id ${JSON.stringify(id)} must match [A-Za-z0-9._-]+`
      );
    return id;
  };

  // The design list from the config, or auto-discovered root .scad files.
  const resolveDesigns = () => {
    if (Array.isArray(config.designs) && config.designs.length) {
      return config.designs.map((d) => ({
        id: checkId(d.id),
        label: d.label ?? humanize(d.id),
        file: d.file ?? `${d.id}.scad`,
        // Heavy designs skip the debounced auto-render (the user renders on demand).
        heavy: d.heavy ?? false,
        // Optional dropdown grouping header (designs sharing a group cluster).
        group: typeof d.group === "string" && d.group.trim() ? d.group.trim() : null,
      }));
    }
    return readdirSync(SOURCE)
      .filter((f) => f.endsWith(".scad"))
      .sort()
      .map((f) => {
        const id = f.replace(/\.scad$/, "");
        return { id, label: humanize(id), file: f, heavy: false, group: null };
      });
  };

  // Copy a source file into outScadDir, preserving its relative path.
  const copyAsset = (relPath) => {
    const dest = join(outScadDir, relPath);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(SOURCE, relPath), dest);
  };

  mkdirSync(outSchemaDir, { recursive: true });
  mkdirSync(outScadDir, { recursive: true });

  const designs = resolveDesigns().map((d) => {
    const abs = mustExist(join(SOURCE, d.file), `design '${d.id}' source file '${d.file}'`);
    const { params, sections, collapsedSections } = parseParams(abs);
    copyAsset(d.file);
    // Auto-detect a sibling OpenSCAD parameterSets file: <name>.scad -> <name>.json
    // next to it. One file can hold many named sets; absent -> no bundled presets.
    const presetRel = d.file.replace(/\.scad$/, ".json");
    const presets = existsSync(join(SOURCE, presetRel)) ? [presetRel] : [];
    if (presets.length) copyAsset(presetRel);
    return { ...d, presets, abs, sections, collapsedSections, params };
  });

  // Shared dependency files: from the config's `assets` (files/directories) when
  // given, otherwise discovered by following each design's use/include graph.
  const assets = new Set();
  if (Array.isArray(config.assets) && config.assets.length) {
    for (const a of expandConfiguredAssets(config.assets)) assets.add(a);
  } else {
    for (const d of designs) for (const dep of collectDeps(d.abs)) assets.add(dep);
  }
  for (const a of assets) copyAsset(a);

  // Optional raw-CSS escape hatch. Unlike `colors` — a safe, validated token map
  // — this is a stylesheet the consumer fully controls, copied verbatim into the
  // served tree and (see vite.config.ts) loaded *after* the app's own styles so
  // it can override anything. It targets internal class names at the consumer's
  // own risk: not a stable API, and not covered by the accessibility guarantees.
  // Lives under the (gitignored, auto-wiped) scad output dir, so it never goes
  // stale or gets committed. The schema records its served URL, or null.
  let extraCss = null;
  if (config.extraCss) {
    const abs = mustExist(
      resolve(CONFIG_DIR, config.extraCss),
      `extraCss '${config.extraCss}'`
    );
    const name = abs.split(/[\\/]/).pop();
    copyFileSync(abs, join(outScadDir, name));
    extraCss = `scad/${name}`;
  }

  // iOS standalone launch images (apple-touch-startup-image). Populated below
  // when a rasterizer is available; injected into index.html by vite.
  let appleSplash = [];

  // Generate the PWA manifest + app icon from the config (skipped for the
  // fixture-driven unit tests, which don't pass outPublicDir).
  if (outPublicDir) {
    mkdirSync(outPublicDir, { recursive: true });

    // Build (or use the default) icon SVG source.
    let iconSvg;
    if (config.icon) {
      iconSvg = readFileSync(
        mustExist(resolve(CONFIG_DIR, config.icon), `icon '${config.icon}'`),
        "utf-8"
      );
      copyFileSync(resolve(CONFIG_DIR, config.icon), join(outPublicDir, "icon.svg"));
    } else {
      // Neutral default icon when the config supplies none.
      iconSvg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="${xmlEscape(TITLE)}">\n` +
        `  <rect width="512" height="512" rx="96" fill="${THEME_COLOR}"/>\n` +
        `  <rect x="150" y="150" width="212" height="212" rx="28" fill="none" stroke="#86a9ff" stroke-width="30"/>\n` +
        `</svg>\n`;
      writeFileSync(join(outPublicDir, "icon.svg"), iconSvg);
    }

    // Maskable icon: separate source (safe-zone padded) or fall back to the
    // main icon. The maskable PNG is rendered from this SVG.
    let maskableSvg = iconSvg;
    if (config.iconMaskable) {
      maskableSvg = readFileSync(
        mustExist(resolve(CONFIG_DIR, config.iconMaskable), `iconMaskable '${config.iconMaskable}'`),
        "utf-8"
      );
    }

    // Single SVG→PNG rasterizer (@resvg/resvg-js — Rust/WASM, no headless
    // browser) shared by the icon and the iOS splash generation below. Null when
    // the optional dep is absent, in which case both fall back to copying the SVG.
    const rasterize = Resvg
      ? (svg, width) =>
          new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } })
            .render()
            .asPng()
      : null;

    // Rasterize PNGs at build time. Sizes: 192 & 512 for the manifest, 180 for
    // apple-touch-icon. The maskable 512 uses the safe-zone-padded source.
    if (rasterize) {
      try {
        writeFileSync(join(outPublicDir, "icon-192.png"), rasterize(iconSvg, 192));
        writeFileSync(join(outPublicDir, "icon-512.png"), rasterize(iconSvg, 512));
        writeFileSync(join(outPublicDir, "icon-512-maskable.png"), rasterize(maskableSvg, 512));
        writeFileSync(join(outPublicDir, "icon-180.png"), rasterize(iconSvg, 180));
      } catch (err) {
        console.warn(`gen-schema: icon rasterization failed (${err.message})`);
        copyFileSync(join(outPublicDir, "icon.svg"), join(outPublicDir, "icon-180.png"));
      }
    } else {
      // Fallback: copy SVG as apple-touch-icon placeholder when resvg unavailable.
      copyFileSync(join(outPublicDir, "icon.svg"), join(outPublicDir, "icon-180.png"));
    }

    // iOS standalone launch ("splash") images. iOS only shows one whose media
    // query matches the device exactly, so emit a portrait PNG (the icon centred
    // on the background colour) per common iPhone resolution. Generated only when
    // the rasterizer is present; each becomes an <link rel="apple-touch-startup-image">.
    if (rasterize) {
      // device px width × height, devicePixelRatio — current/common iPhones.
      const DEVICES = [
        [1290, 2796, 3], [1179, 2556, 3], [1284, 2778, 3], [1170, 2532, 3],
        [1125, 2436, 3], [828, 1792, 2], [750, 1334, 2],
      ];
      try {
        for (const [w, h, dpr] of DEVICES) {
          const s = Math.round(Math.min(w, h) * 0.32);
          const x = Math.round((w - s) / 2);
          const y = Math.round((h - s) / 2);
          const iconB64 = rasterize(iconSvg, s).toString("base64");
          const splashSvg =
            `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
            `<rect width="${w}" height="${h}" fill="${BG_COLOR}"/>` +
            `<image x="${x}" y="${y}" width="${s}" height="${s}" ` +
            `href="data:image/png;base64,${iconB64}"/></svg>`;
          const href = `apple-splash-${w}x${h}.png`;
          writeFileSync(join(outPublicDir, href), rasterize(splashSvg, w));
          appleSplash.push({
            href,
            media:
              `(device-width: ${w / dpr}px) and (device-height: ${h / dpr}px) ` +
              `and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`,
          });
        }
      } catch (err) {
        console.warn(`gen-schema: splash generation failed (${err.message})`);
        appleSplash = [];
      }
    }

    // Manifest screenshot entries (optional — enables rich Android install UI).
    const screenshots = [];
    if (Array.isArray(config.screenshots)) {
      for (const shot of config.screenshots) {
        if (shot.src && shot.sizes && shot.form_factor) {
          const abs = mustExist(resolve(CONFIG_DIR, shot.src), `screenshot '${shot.src}'`);
          const name = abs.split(/[\\/]/).pop();
          copyFileSync(abs, join(outPublicDir, name));
          screenshots.push({ src: name, sizes: shot.sizes, type: "image/png", form_factor: shot.form_factor });
        }
      }
    }

    const manifestIcons = [
      { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ];

    // App shortcuts (Android long-press / desktop jump list). Author-provided
    // `shortcuts` win; otherwise, with multiple designs, derive one per design
    // that deep-links to it (#d=<id>, the same hash readInitialState parses).
    let shortcuts = [];
    if (Array.isArray(config.shortcuts)) {
      shortcuts = config.shortcuts
        .filter((sc) => sc && typeof sc.name === "string" && typeof sc.url === "string")
        .map((sc) => ({
          name: sc.name,
          ...(sc.short_name ? { short_name: sc.short_name } : {}),
          url: sc.url,
        }));
    } else if (designs.length > 1) {
      shortcuts = designs.map((d) => ({
        name: d.label,
        short_name: d.label,
        url: `./#d=${d.id}`,
      }));
    }

    const manifest = {
      id: `/${ID}/`,
      name: TITLE,
      short_name: SHORT_NAME,
      description: DESCRIPTION,
      lang: "en",
      dir: "ltr",
      start_url: ".",
      scope: ".",
      display: "standalone",
      background_color: BG_COLOR,
      theme_color: THEME_COLOR,
      launch_handler: { client_mode: "navigate-existing" },
      icons: manifestIcons,
    };
    if (CATEGORIES.length) manifest.categories = CATEGORIES;
    if (screenshots.length) manifest.screenshots = screenshots;
    if (shortcuts.length) manifest.shortcuts = shortcuts;

    writeFileSync(
      join(outPublicDir, "manifest.webmanifest"),
      JSON.stringify(manifest, null, 2) + "\n"
    );
  }

  const renderHash = computeRenderHash({
    SOURCE,
    scadFiles: [...designs.map((d) => d.file), ...assets],
    features: FEATURES,
    format: FORMAT,
    fonts: FONTS,
    rendererFiles,
    outPublicDir,
  });

  const schema = {
    generatedFrom: relPosix(SOURCE) || ".",
    renderHash,
    title: TITLE,
    shortName: SHORT_NAME,
    id: ID,
    description: DESCRIPTION,
    themeColor: THEME_COLOR,
    themeColorLight: THEME_COLOR_LIGHT,
    appleSplash,
    colors: COLORS,
    extraCss,
    logo,
    format: FORMAT,
    features: FEATURES,
    fonts: FONTS,
    fontFamilies: FONT_FAMILIES,
    fileImport: FILE_IMPORT,
    popup: POPUP,
    notices: NOTICES,
    help: HELP,
    licenses: LICENSES_EXTRA,
    ui: UI,
    assets: [...assets].sort(),
    designs: designs.map(({ abs, ...d }) => d),
  };
  if (outPublicDir) {
    const precache = new Set([
      "icon.svg",
      "icon-192.png",
      "icon-512.png",
      "icon-512-maskable.png",
      "icon-180.png",
      "manifest.webmanifest",
      "wasm/openscad.js",
      "fonts/fonts.conf",
    ]);
    for (const splash of appleSplash) precache.add(splash.href);
    for (const font of FONTS) precache.add(`fonts/${font}`);
    for (const asset of assets) precache.add(`scad/${asset}`);
    for (const d of schema.designs) {
      precache.add(`scad/${d.file}`);
      for (const preset of d.presets) precache.add(`scad/${preset}`);
    }
    if (logo) {
      precache.add(logo.light);
      precache.add(logo.dark);
    }
    if (extraCss) precache.add(extraCss);
    writeFileSync(
      join(outPublicDir, "precache-manifest.json"),
      JSON.stringify([...precache].sort(), null, 2) + "\n"
    );
  }
  writeFileSync(
    join(outSchemaDir, "designs.json"),
    JSON.stringify(schema, null, 2) + "\n"
  );
  return schema;
}

// CLI: build the real schema into the app's source/public trees.
function main() {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const WEB = join(HERE, "..");
  const schema = generate({
    configPath:
      process.env.SCADPUB_CONFIG || join(WEB, "scadpub.config.json"),
    outSchemaDir: join(WEB, "src", "generated"),
    outScadDir: join(WEB, "public", "scad"),
    outPublicDir: join(WEB, "public"),
    // The renderer's source fixes the OpenSCAD CLI contract (flags, mounting),
    // so its bytes belong in renderHash — a worker change invalidates the cache.
    rendererFiles: [join(WEB, "src", "openscad", "worker.ts")],
  });
  console.log(
    `gen-schema: ${schema.designs.length} designs, ${schema.assets.length} ` +
      `dependency files, ${schema.features.length} feature(s) -> ` +
      `src/generated/designs.json, public/scad/`
  );
}

// Run only when executed directly (not when imported by the tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
