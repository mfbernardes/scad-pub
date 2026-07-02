// config-parsers.mjs — validation + normalisation of the optional scadpub.config
// keys (colours, format, licenses, fileImport, popup, notices, ui) plus the
// shared "safe interpolation of untrusted config values" helpers. Every parser
// fails the build with a clear message on a bad shape (gen-schema's fail-fast
// convention) and returns a normalised value (or a null/[]/defaults) otherwise.

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
  "viewer-dim",
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
export const COLOR_VALUE_RE = /^[#a-zA-Z0-9 ,.()%/-]+$/;

// Escape a value for safe interpolation into generated XML/SVG attribute text.
export const xmlEscape = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

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
  const defaults = { panelSide: "left", panelDefault: "open", outputDefault: "closed", install: "auto", showVarName: true, measure: true, viewPicker: true, reset: true, zoom: false, presetsLabel: "Presets", parametersLabel: "Parameters" };
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
  if (raw.measure !== undefined) {
    if (typeof raw.measure !== "boolean")
      throw new Error("gen-schema: 'ui.measure' must be a boolean");
    out.measure = raw.measure;
  }
  if (raw.viewPicker !== undefined) {
    if (typeof raw.viewPicker !== "boolean")
      throw new Error("gen-schema: 'ui.viewPicker' must be a boolean");
    out.viewPicker = raw.viewPicker;
  }
  if (raw.reset !== undefined) {
    if (typeof raw.reset !== "boolean")
      throw new Error("gen-schema: 'ui.reset' must be a boolean");
    out.reset = raw.reset;
  }
  if (raw.zoom !== undefined) {
    if (typeof raw.zoom !== "boolean")
      throw new Error("gen-schema: 'ui.zoom' must be a boolean");
    out.zoom = raw.zoom;
  }
  for (const key of ["presetsLabel", "parametersLabel"]) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== "string" || !raw[key].trim())
        throw new Error(`gen-schema: 'ui.${key}' must be a non-empty string`);
      out[key] = raw[key].trim();
    }
  }
  return out;
}
