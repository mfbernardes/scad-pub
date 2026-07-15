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
  // Shape / glass design tokens (non-colour values allowed)
  "radius",
  "radius-sm",
  "glass-bg",
  "glass-border",
  "elevation",
  // Font stacks — unquoted family names only (the value filter forbids quotes),
  // e.g. "Georgia, serif". Set them under `dark` (the `:root` block) to apply
  // to both themes; the light theme doesn't redeclare them.
  "font-sans",
  "font-display",
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

// A conservative BCP-47-ish language tag (letters, digits, hyphens only, e.g.
// "en", "pt-BR", "zh-Hant"). Strict enough that the value is safe to interpolate
// verbatim into the generated `<html lang="…">` attribute and the manifest.
export const LANG_RE = /^[A-Za-z0-9-]{1,35}$/;

// Validate the optional `lang` config key — the document/manifest language.
// Defaults to "en". Fails the build on anything that isn't a plain BCP-47 tag.
export function parseLang(raw) {
  if (raw == null) return "en";
  if (typeof raw !== "string" || !LANG_RE.test(raw.trim()))
    throw new Error(
      `gen-schema: 'lang' must be a BCP-47 language tag (got ${JSON.stringify(raw)})`
    );
  return raw.trim();
}

// The writing directions HTML and the web-app manifest both accept.
export const TEXT_DIRECTIONS = ["ltr", "rtl", "auto"];

// Validate the optional `dir` config key — the document/manifest text direction.
// Defaults to "ltr" (matching the previously hard-coded manifest value).
export function parseDir(raw) {
  if (raw == null) return "ltr";
  if (!TEXT_DIRECTIONS.includes(raw))
    throw new Error(
      `gen-schema: 'dir' must be one of ${TEXT_DIRECTIONS.map((d) => `"${d}"`).join(", ")} ` +
        `(got ${JSON.stringify(raw)})`
    );
  return raw;
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

// Validate the optional `restOnGrid` config key. When true the viewer rests a
// loaded model's base on the z=0 grid (X/Y centred); when false (the default)
// it centres the model on the origin in all three axes, as it always has. This
// only affects how the viewer frames the geometry, not the exported bytes, so
// it stays out of renderHash.
export function parseRestOnGrid(raw) {
  if (raw == null) return false;
  if (typeof raw !== "boolean")
    throw new Error(
      `config.restOnGrid must be a boolean (got ${JSON.stringify(raw)})`
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
  // Optional upload size cap (bytes). The app rejects a larger file with a
  // friendly message instead of persisting it to IndexedDB. Must be positive.
  if (raw.maxBytes !== undefined && raw.maxBytes !== null) {
    if (typeof raw.maxBytes !== "number" || !Number.isFinite(raw.maxBytes) || raw.maxBytes <= 0)
      throw new Error("gen-schema: 'fileImport.maxBytes' must be a positive number");
    out.maxBytes = raw.maxBytes;
  }
  return out;
}

// Validate and normalise the optional `render` config block: build-time render
// tuning. `heavyMs` sets the auto-pause threshold (a live render slower than
// this pauses auto-render for the design); `cache` tunes the runner's two-tier
// render cache (`maxEntries` L1 slot count, `maxBytes` total L1 budget,
// `maxEntryBytes` largest cacheable render, `persistent` the L2 IndexedDB
// store). Every key is optional — the app keeps its built-in default for any
// omitted value. None affect geometry, so `render` is absent from renderHash.
// Returns null when unset; fails the build with a clear message on a bad shape.
export function parseRender(raw) {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error("gen-schema: 'render' must be an object");
  const posNum = (v, key) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
      throw new Error(`gen-schema: 'render.${key}' must be a non-negative number`);
    return v;
  };
  const out = {};
  if (raw.heavyMs !== undefined && raw.heavyMs !== null)
    out.heavyMs = posNum(raw.heavyMs, "heavyMs");
  if (raw.cache !== undefined && raw.cache !== null) {
    if (typeof raw.cache !== "object" || Array.isArray(raw.cache))
      throw new Error("gen-schema: 'render.cache' must be an object");
    const cache = {};
    for (const key of ["maxEntries", "maxBytes", "maxEntryBytes"]) {
      if (raw.cache[key] !== undefined && raw.cache[key] !== null)
        cache[key] = posNum(raw.cache[key], `cache.${key}`);
    }
    if (raw.cache.persistent !== undefined && raw.cache.persistent !== null) {
      if (typeof raw.cache.persistent !== "boolean")
        throw new Error("gen-schema: 'render.cache.persistent' must be a boolean");
      cache.persistent = raw.cache.persistent;
    }
    if (Object.keys(cache).length) out.cache = cache;
  }
  return Object.keys(out).length ? out : null;
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
  // Optional label for the primary button (the app defaults to "OK"). A blank
  // string would render an empty button, so require non-empty when present.
  if (raw.button !== undefined && (typeof raw.button !== "string" || !raw.button.trim()))
    throw new Error(
      "gen-schema: 'popup.button', when set, must be a non-empty string"
    );
  const out = { header: raw.header, body: raw.body, mode };
  if (raw.button !== undefined) out.button = raw.button;
  return out;
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

// The client-side experience-mode seeds a config may set under `ui.experience`.
// Every field only seeds the FIRST-EVER client state — src/lib/useExperience.ts
// reads a persisted user preference ahead of these, and once the user changes
// either state client-side, the persisted choice wins on every later visit.
export const EXPERIENCE_DEFAULTS = ["guided", "standard"];
export const EXPERIENCE_SETTINGS_VIEWS = ["essentials", "all"];
export const EXPERIENCE_MOBILE_SHEETS = ["peek", "half"];
const EXPERIENCE_KEYS = ["default", "settingsView", "mobileInitialSheet"];

// Validate and normalise the optional `ui.experience` config block. Unlike
// `ui`'s other keys (flat booleans/enums with built-in defaults merged in by
// parseUi below), every field here is left absent when unset — the hook
// itself decides the final fallback — so this returns only the keys the
// config actually set. Unknown nested keys fail the build, matching this
// file's convention for nested objects (see `colors`' token check above)
// rather than being silently ignored.
function parseExperience(raw) {
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error("gen-schema: 'ui.experience' must be an object");
  for (const key of Object.keys(raw)) {
    if (!EXPERIENCE_KEYS.includes(key))
      throw new Error(
        `gen-schema: unknown 'ui.experience' key '${key}'.\n` +
          `  Valid keys: ${EXPERIENCE_KEYS.join(", ")}`
      );
  }
  const out = {};
  if (raw.default !== undefined) {
    if (!EXPERIENCE_DEFAULTS.includes(raw.default))
      throw new Error(
        `gen-schema: 'ui.experience.default' must be one of ${EXPERIENCE_DEFAULTS.map((s) => `"${s}"`).join(", ")} ` +
          `(got ${JSON.stringify(raw.default)})`
      );
    out.default = raw.default;
  }
  if (raw.settingsView !== undefined) {
    if (!EXPERIENCE_SETTINGS_VIEWS.includes(raw.settingsView))
      throw new Error(
        `gen-schema: 'ui.experience.settingsView' must be one of ${EXPERIENCE_SETTINGS_VIEWS.map((s) => `"${s}"`).join(", ")} ` +
          `(got ${JSON.stringify(raw.settingsView)})`
      );
    out.settingsView = raw.settingsView;
  }
  if (raw.mobileInitialSheet !== undefined) {
    if (!EXPERIENCE_MOBILE_SHEETS.includes(raw.mobileInitialSheet))
      throw new Error(
        `gen-schema: 'ui.experience.mobileInitialSheet' must be one of ${EXPERIENCE_MOBILE_SHEETS.map((s) => `"${s}"`).join(", ")} ` +
          `(got ${JSON.stringify(raw.mobileInitialSheet)})`
      );
    out.mobileInitialSheet = raw.mobileInitialSheet;
  }
  return out;
}

// Validate and normalise the optional `ui` config block: build-time UI behaviour
// overrides. None affect geometry (absent from renderHash). Applies defaults for
// omitted keys. Returns the defaults object when the config omits `ui` entirely.
export function parseUi(raw) {
  const defaults = { panelSide: "left", panelDefault: "open", outputDefault: "closed", install: "auto", showVarName: false, measure: true, viewPicker: true, reset: true, zoom: false, fullscreen: true, presetsLabel: "Presets", parametersLabel: "Customize", gallery: false };
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
  if (raw.fullscreen !== undefined) {
    if (typeof raw.fullscreen !== "boolean")
      throw new Error("gen-schema: 'ui.fullscreen' must be a boolean");
    out.fullscreen = raw.fullscreen;
  }
  for (const key of ["presetsLabel", "parametersLabel"]) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== "string" || !raw[key].trim())
        throw new Error(`gen-schema: 'ui.${key}' must be a non-empty string`);
      out[key] = raw[key].trim();
    }
  }
  if (raw.gallery !== undefined) {
    if (typeof raw.gallery !== "boolean")
      throw new Error("gen-schema: 'ui.gallery' must be a boolean");
    out.gallery = raw.gallery;
  }
  if (raw.experience !== undefined && raw.experience !== null) {
    out.experience = parseExperience(raw.experience);
  }
  return out;
}

// Levenshtein edit distance, used only to offer a "did you mean" suggestion
// for a typo'd `strings` key. Deliberately simple (no memoized matrix beyond a
// single rolling row) — catalogue keys are short and this only runs on a
// build-time validation error path.
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j - 1], prev[j], row[j - 1]);
    }
    prev = row;
  }
  return prev[b.length];
}

// The closest known key to an unrecognised `strings` key, when the edit
// distance is small enough that it's plausibly a typo rather than an
// unrelated string. Returns null when nothing is close.
function suggestKey(badKey, validKeys) {
  let best = null;
  let bestDist = Infinity;
  for (const key of validKeys) {
    const dist = editDistance(badKey, key);
    if (dist < bestDist) {
      best = key;
      bestDist = dist;
    }
  }
  // Trivial-near-miss threshold: allow a couple of edits, but scale with the
  // key's length so a short key doesn't match everything.
  const threshold = Math.max(2, Math.floor(badKey.length / 3));
  return best !== null && bestDist <= threshold ? best : null;
}

// Validate and normalise the optional `strings` config block: per-deployment
// overrides of the built-in UI text catalogue (src/locales/en.json), keyed by
// the same dot-namespaced keys (including plural `#category` variants, e.g.
// "foo.count#other") that src/lib/i18n.ts's `t`/`tn` resolve. Consulted first,
// ahead of the active/English bundles — see i18n.ts's resolution order. Every
// key must already exist in the English catalogue; `validKeys` is the caller's
// (gen-schema's) already-loaded key set so this module stays free of file I/O.
// Fails the build with a clear message (a "did you mean" suggestion when the
// bad key is a plausible typo of a real one) rather than silently accepting a
// key `t()` will never resolve. Returns {} when unset.
export function parseStrings(raw, validKeys) {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error("gen-schema: 'strings' must be an object of key: string pairs");
  const known = new Set(validKeys);
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!known.has(key)) {
      const suggestion = suggestKey(key, known);
      throw new Error(
        `gen-schema: unknown 'strings' key '${key}'.\n` +
          (suggestion
            ? `  Did you mean '${suggestion}'?`
            : `  See src/locales/en.json for the full list of valid keys.`)
      );
    }
    if (typeof value !== "string")
      throw new Error(`gen-schema: 'strings.${key}' must be a string (got ${JSON.stringify(value)})`);
    out[key] = value;
  }
  return out;
}
