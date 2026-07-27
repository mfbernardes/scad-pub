// config-parsers.mjs — validation + normalisation of the optional scadpub.config
// keys (colours, format, licenses, fileImport, popup, notices, ui) plus the
// shared "safe interpolation of untrusted config values" helpers. Every parser
// fails the build with a clear message on a bad shape (gen-schema's fail-fast
// convention) and returns a normalised value (or a null/[]/defaults) otherwise.
//
// `ui`, `viewer`, `render` and `fileImport`, plus the scalar fields of
// `popup`, used to each hand-write the same "check a boolean / check an enum /
// assign a default" shape once per field (15 times over, for `ui` alone), and
// disagreed with each other about null-handling, error wording and unknown-key
// rejection along the way. They're now driven by `applyGroupSpec` below,
// walking the field tables in ./config-spec.mjs, which picks one behaviour per
// axis for every field (see that file's file-top comment) instead of
// reproducing the old disagreements. `parseColors`, `parseLicenses`,
// `parseNotices` and `parseStrings` are NOT
// driven by it: they carry real bespoke logic (cross-checks, defaulting rules
// that don't fit the shared shape) that isn't worth forcing into the same
// mould, and config-spec.mjs only registers their keys for unknown-key
// rejection and schema emission.
import { CONFIG_SPEC, COLOR_TOKENS } from "./config-spec.mjs";
export { COLOR_TOKENS };

// `prefix(path)` renders the leading part of a validation-error message. One
// convention everywhere now: "gen-schema: '<path>' ..." (previously `viewer`
// alone predated this and read "config.<path> ..." with no quotes — that was
// an accident of `viewer` being older code, not a meaningful distinction, so
// it's gone).
function messagePrefix(path) {
  return `gen-schema: '${path}'`;
}

function defaultRootTypeError(path) {
  return `${messagePrefix(path)} must be an object`;
}

// The two string-field message shapes every string field now uses (see
// config-spec.mjs's file-top comment): a field that's `required` outright, or
// one that's optional but was set to something invalid. (A third and fourth
// shape used to exist — "must be a non-empty string" / "must be a string",
// picked by a per-field `nonBlank` flag — but every string field rejects
// blank now, so there's no second shape left to pick between.)
function stringFieldError(path, field) {
  const prefix = messagePrefix(path);
  return new Error(
    field.required
      ? `${prefix} is required and must be a non-empty string`
      : `${prefix}, when set, must be a non-empty string`
  );
}

// The error a nested object's unrecognised key throws, built entirely from
// the spec node so the "valid keys" list can never go stale. `node.hints`
// (see config-spec.mjs) optionally appends a migration note for a
// specifically-named retired key (only `viewer.grid` uses this today).
function unknownNestedKeyError(path, node, key) {
  const hint = node.hints?.[key];
  return new Error(
    `${messagePrefix(path)}: unknown key '${key}'.\n` +
      `  Valid keys: ${Object.keys(node.properties).join(", ")}` +
      (hint ? `\n  (${hint})` : "")
  );
}

// Validate a single already-present (non-skipped) field value against its
// config-spec.mjs descriptor, returning the normalised value to store (or
// throwing gen-schema's fail-fast Error). `type: "object"` recurses into
// applyGroupSpec for a nested group (render.cache, ui.afterExport).
function validateFieldValue(value, field, path) {
  const prefix = messagePrefix(path);
  switch (field.type) {
    case "boolean":
      if (typeof value !== "boolean") throw new Error(`${prefix} must be a boolean`);
      return value;
    case "enum": {
      // Enum errors always say what they got — strictly more informative,
      // and every group agrees on it now (some used to omit it).
      if (!field.values.includes(value))
        throw new Error(
          `${prefix} must be one of ${field.values.map((v) => `"${v}"`).join(", ")} ` +
            `(got ${JSON.stringify(value)})`
        );
      return value;
    }
    case "number": {
      const positive = field.numberKind === "positive";
      const ok = typeof value === "number" && Number.isFinite(value) && (positive ? value > 0 : value >= 0);
      if (!ok) throw new Error(`${prefix} must be a ${positive ? "positive" : "non-negative"} number`);
      return value;
    }
    case "string": {
      // One string policy: reject empty/whitespace-only, store trimmed.
      if (typeof value !== "string" || !value.trim()) throw stringFieldError(path, field);
      return value.trim();
    }
    case "object":
      return applyGroupSpec(value, field, path);
    default:
      throw new Error(`config-spec: unsupported field type '${field.type}' at '${path}'`);
  }
}

// Walk one nested config object (ui, viewer, render, render.cache, popup, the
// object form of fileImport, ui.afterExport) against its config-spec.mjs
// node: shape check, unknown-key rejection, then each field in declaration
// order. `null` and an absent key are exactly equivalent throughout — a
// hand-written JSON config has no comments to delete a line with, so an
// explicit `null` is how an author says "leave this alone", not a typo the
// way a misspelled key name is.
export function applyGroupSpec(raw, node, path) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new Error(node.rootTypeError ?? defaultRootTypeError(path));
  for (const key of Object.keys(raw))
    if (!(key in node.properties)) throw unknownNestedKeyError(path, node, key);
  const out = {};
  for (const [key, field] of Object.entries(node.properties))
    if ("default" in field) out[key] = field.default;
  for (const [key, field] of Object.entries(node.properties)) {
    const value = raw[key];
    const missing = value === undefined || value === null;
    if (!field.required && missing) continue;
    const result = validateFieldValue(value, field, `${path}.${key}`);
    // A nested object field (render.cache) that collapses an empty result to
    // `null` is omitted from its parent entirely, matching e.g.
    // `parseRender({ cache: { maxEntries: null } })` -> `null`, not
    // `{ cache: {} }`.
    if (result === null) continue;
    out[key] = result;
  }
  if (node.collapseEmptyToNull && Object.keys(out).length === 0) return null;
  return out;
}

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

// Validate the optional `viewer` config key — the 3D viewer's presentation,
// fixed at build time. Its only key is `style`, which picks the look: "plain"
// (the default) is the classic CAD preview; "studio" adds image-based studio
// lighting, tone mapping, and a soft contact shadow under the model for a
// product-shot look. Display-only: it doesn't affect the exported bytes, so —
// like restOnGrid — it stays out of renderHash.
//
// The reference grid is deliberately NOT configured here. It is a runtime
// toggle the visitor owns, seeded once by `ui.grid` and persisted thereafter
// (see parseUi and src/lib/viewerPrefs.ts); a build-time gate here would make
// that toggle a no-op. A config still passing `viewer.grid` therefore fails as
// an unknown key rather than being silently ignored.
export function parseViewer(raw) {
  return applyGroupSpec(raw ?? {}, CONFIG_SPEC.viewer, "viewer");
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
  return applyGroupSpec(raw, CONFIG_SPEC.fileImport, "fileImport");
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
  return applyGroupSpec(raw, CONFIG_SPEC.render, "render");
}

// Validate and normalise the optional `popup` config block: a notice dialog
// shown over the app on load. `header` (dialog title) and `body` (a
// Markdown-subset string — bold/code/links/lists, same renderer as `help`) are
// required; `mode` (one of CONFIG_SPEC.popup.properties.mode.values) chooses
// how often it appears and defaults to "once". Purely informational, so it's
// absent from renderHash. Returns null when not configured; fails the build
// with a clear message on a bad shape (consistent with gen-schema's other
// fail-fast checks).
export function parsePopup(raw) {
  if (raw == null) return null;
  return applyGroupSpec(raw, CONFIG_SPEC.popup, "popup");
}

// Validate and normalise the optional `notices` config block: the design-defined
// notice categories surfaced on the "OpenSCAD output" panel. A design echoes
// `ECHO: "<context>: <marker>: <message>"` and each configured category turns
// matching echoes into a friendly notice and a coloured count badge. Each entry
// is { marker (required), label?, labelOne?, color? }:
//   - marker: the design-defined string matched as `: <marker>:` in an echo
//     (e.g. "alert", "note"); case-insensitive.
//   - label: the badge / notice noun (e.g. "alerts"); defaults to marker.
//   - labelOne: optional singular form of `label` (e.g. "alert"), used
//     wherever a count renders alongside it whenever the live count is
//     exactly 1. Omit to keep `label` regardless of count.
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
    if (entry.labelOne !== undefined && entry.labelOne !== null) {
      if (typeof entry.labelOne !== "string" || !entry.labelOne.trim())
        throw new Error(
          `gen-schema: 'notices[${i}].labelOne' must be a non-empty string`
        );
      out.labelOne = entry.labelOne.trim();
    }
    if (entry.color !== undefined && entry.color !== null) {
      if (typeof entry.color !== "string" || !COLOR_VALUE_RE.test(entry.color.trim()))
        throw new Error(
          `gen-schema: 'notices[${i}].color' must be a plain CSS colour ` +
            `(got ${JSON.stringify(entry.color)})`
        );
      out.color = entry.color.trim();
    }
    if (entry.attention !== undefined) {
      if (typeof entry.attention !== "boolean")
        throw new Error(`gen-schema: 'notices[${i}].attention' must be a boolean`);
      out.attention = entry.attention;
    }
    if (entry.subsumedByFont !== undefined) {
      if (typeof entry.subsumedByFont !== "boolean")
        throw new Error(`gen-schema: 'notices[${i}].subsumedByFont' must be a boolean`);
      out.subsumedByFont = entry.subsumedByFont;
    }
    return out;
  });
}

// Validate and normalise the optional `ui` config block: build-time UI
// behaviour overrides (panel/output defaults, viewer controls, labels, and
// the nested `afterExport` panel — `helpTab`'s cross-check against a real
// `help.tabs[].label` can't happen here, since `help` isn't available yet; it
// stays a cross-field check in gen-schema.mjs's generate(), search that file
// for 'ui.afterExport.helpTab'). None of it affects geometry (absent from
// renderHash). Returns CONFIG_SPEC.ui's defaults object when `ui` is omitted.
export function parseUi(raw) {
  return applyGroupSpec(raw ?? {}, CONFIG_SPEC.ui, "ui");
}

// Validate and normalise the optional `strings` config block: per-deployment
// overrides of the built-in UI text catalogue (src/locales/en.json), keyed by
// the same dot-namespaced keys (including plural `#category` variants, e.g.
// "settings.showAllCount#other") that src/lib/i18n.ts's `t`/`tn` resolve.
// Consulted first, ahead of the bundled English catalogue — see i18n.ts's
// resolution order. Every key must already exist in the English catalogue;
// `validKeys` is the caller's (gen-schema's) already-loaded key set so this
// module stays free of file I/O. Fails the build with a clear message pointing
// at the catalogue rather than silently accepting a key `t()` will never
// resolve. Returns {} when unset.
export function parseStrings(raw, validKeys) {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error("gen-schema: 'strings' must be an object of key: string pairs");
  const known = new Set(validKeys);
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!known.has(key))
      throw new Error(
        `gen-schema: unknown 'strings' key '${key}'.\n` +
          `  See src/locales/en.json for the full list of valid keys.`
      );
    if (typeof value !== "string")
      throw new Error(`gen-schema: 'strings.${key}' must be a string (got ${JSON.stringify(value)})`);
    out[key] = value;
  }
  return out;
}
