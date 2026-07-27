// config-spec.mjs — the single declarative description of scadpub.config.json's
// surface: every top-level key, and (for the handful of keys that are
// themselves small nested objects) every key inside them. This file is data,
// not behaviour: three different consumers read it —
//
//   1. gen-schema.mjs derives `KNOWN_TOP_LEVEL_KEYS` (top-level unknown-key
//      rejection) from `Object.keys(CONFIG_SPEC)` instead of maintaining a
//      second hand-written list.
//   2. config-parsers.mjs's `applyGroupSpec` (see below) walks the `ui`,
//      `viewer`, `render`, `fileImport` and `popup` nodes' `properties` to
//      replace what used to be five near-identical stretches of
//      "check a boolean / check an enum / assign a default" if-blocks.
//   3. scripts/gen-config-schema.mjs turns the whole tree into a real JSON
//      Schema, and tests/config-spec.test.mjs cross-checks it against
//      docs/config.md so a key can't drift out of one without the other.
//
// What this file does NOT own: path existence, cross-field checks
// (`defaultDesign` naming a real design, `ui.afterExport.helpTab` naming a
// real help tab, `reviewLabels` keys naming real params, `presetImages` keys
// naming real presets), colour-value safety beyond "is this shape a plain
// object of strings", the `strings`-against-i18n-catalogue check, or anything
// that needs file I/O to answer. Those all stay exactly where they live today
// (gen-schema.mjs's generate(), and the bespoke parsers in config-parsers.mjs)
// — this spec only describes STRUCTURE: names, nesting, JSON types, enums,
// static defaults, and which nested keys are recognised at all.
//
// A handful of top-level keys (`colors`, `licenses`, `notices`, `strings`,
// `help`, `designs`, `categories`, `screenshots`, `shortcuts`) carry real
// bespoke validation logic elsewhere (or, for `help`, none at all — it's
// passed through verbatim). They still get a spec node each — with `type`,
// `description`, and, where it's cheap and useful for schema-emission /
// doc-coverage, a `properties`/`items` shape — but that node is never fed to
// `applyGroupSpec`; it exists purely so unknown-*top-level*-key rejection and
// `gen-config-schema.mjs` cover them. Their node carries `custom: true` as a
// marker for "the runtime behaviour lives elsewhere, don't try to derive it
// from this shape".
//
// ── Field-descriptor shapes used by `properties` entries ────────────────────
// Every property is at minimum { type, description }. The mechanically-
// collapsed groups (ui/viewer/render/fileImport/popup) add a few more flags
// that exist ONLY to let `applyGroupSpec` reproduce each field's exact
// historical behaviour byte-for-byte (this codebase's parsers grew organically
// and are not all consistent with each other — e.g. most `ui` fields treat an
// explicit `null` as an invalid value and throw, but `render`'s and
// `fileImport`'s fields treat `null` the same as "omitted"; `gotSuffix` is
// similarly inconsistent between groups). Rather than silently normalise that
// away (which the zero-behaviour-change constraint on this commit forbids),
// each field spells out which behaviour it wants:
//
//   skipOn:       "undefined" — only an actually-missing key uses the default;
//                 an explicit `null` is validated (and typically fails).
//                 "nullish"  — both a missing key AND an explicit `null` use
//                 the default / are treated as "not set".
//   gotSuffix:    for `type: "enum"`, whether the error message appends
//                 ` (got <value>)`. Some groups do, some don't.
//   nonBlank:     for `type: "string"`, whether an empty/whitespace-only
//                 string is rejected (vs. only the type being checked).
//   trimStore:    for `type: "string"`, whether the stored value is
//                 `.trim()`-ed (true) or kept exactly as given (false).
//   wording:      for `type: "string"`, which error phrasing to use —
//                 "required" ("<path> is required and must be a non-empty
//                 string"), "whenSet" ("<path>, when set, must be a
//                 non-empty string") or "plain" ("<path> must be a non-empty
//                 string" / "<path> must be a string", depending on
//                 `nonBlank`).
//   numberKind:   for `type: "number"`, "nonNegative" (>= 0) or "positive"
//                 (> 0) — two different messages, two different bounds.
//   required:     the field must validate even when entirely absent (only
//                 `popup.header`/`popup.body`).
//
// Object-typed properties (`render.cache`, `ui.afterExport`) additionally
// carry their own `properties` (recursed into by `applyGroupSpec`), plus:
//   unknownKeys:      "ignore" (default) or "reject" — whether a key outside
//                      `properties` fails the build.
//   unknownKeyError:  present when unknownKeys is "reject" — a
//                      `(key) => message` function giving the exact wording.
//   rootTypeError:    overrides the default "<path> must be an object"
//                      message — a string, or `(raw) => message` when the
//                      offending value needs to be echoed back.
//   collapseEmptyToNull: when true, an object with no recognised keys set is
//                      omitted from its parent entirely instead of being
//                      stored as `{}` (used by `render` itself and
//                      `render.cache`; NOT by `fileImport` or
//                      `ui.afterExport`, which keep `{}`).
//   messageStyle:      "quoted" (default; `gen-schema: '<path>' ...`) or
//                      "dotted" (`config.<path> ...`, no `gen-schema:`
//                      prefix — only `viewer` predates the newer convention).

// ── Small factories for the repeated field shapes (still plain data — these
// just save re-typing the same five keys 30 times over). ────────────────────
const bool = (defaultValue, extra = {}) => ({
  type: "boolean",
  default: defaultValue,
  skipOn: "undefined",
  ...extra,
});

const enumField = (values, defaultValue, extra = {}) => ({
  type: "enum",
  values,
  default: defaultValue,
  skipOn: "undefined",
  gotSuffix: false,
  ...extra,
});

const str = (extra = {}) => ({
  type: "string",
  skipOn: "undefined",
  nonBlank: true,
  trimStore: false,
  wording: "plain",
  ...extra,
});

const num = (numberKind, extra = {}) => ({
  type: "number",
  numberKind,
  skipOn: "nullish",
  ...extra,
});

// ── `ui.afterExport` — nested under `ui` below. Unknown keys are rejected
// (matches parseAfterExport's own AFTER_EXPORT_KEYS loop); `helpTab`'s
// cross-check against `help.tabs[].label` is a cross-field check and stays in
// gen-schema.mjs's generate().
const AFTER_EXPORT_SPEC = {
  type: "object",
  description: "Turns on the after-export success panel; every field optional.",
  skipOn: "nullish",
  unknownKeys: "reject",
  unknownKeyError: (key) =>
    `gen-schema: unknown 'ui.afterExport' key '${key}'.\n` +
    `  Valid keys: ${Object.keys(AFTER_EXPORT_SPEC.properties).join(", ")}`,
  properties: {
    title: str({ trimStore: true, description: "Overrides the panel headline." }),
    body: str({ trimStore: true, description: "Overrides the panel's one-line next step (Markdown subset)." }),
    helpTab: str({
      trimStore: true,
      description: "Opens Help scrolled to the tab with this label; must name a real help.tabs[].label.",
    }),
  },
};

// ── `render.cache` — nested under `render` below. No unknown-key rejection
// (matches parseRender's cache loop, which only ever reads four names).
const RENDER_CACHE_SPEC = {
  type: "object",
  description: "Sizes the runner's two-tier render cache.",
  skipOn: "nullish",
  collapseEmptyToNull: true,
  properties: {
    maxEntries: num("nonNegative", { description: "In-memory (L1) slot count." }),
    maxBytes: num("nonNegative", { description: "In-memory (L1) total byte budget." }),
    maxEntryBytes: num("nonNegative", { description: "Largest single render worth caching." }),
    // No `default` key (unlike the bool()-built ui toggles): omitted entirely
    // unless the config sets it, so an empty `cache` collapses to nothing
    // rather than `{ persistent: undefined }`.
    persistent: { type: "boolean", skipOn: "nullish", description: "Persist renders to IndexedDB (L2)." },
  },
};

// The CSS custom-property tokens `colors.<theme>.*` may set (see
// src/index.css). Registered here so gen-config-schema.mjs and the
// docs-coverage test see them; parseColors (untouched) still does the actual
// validation and owns this exact list independently as COLOR_TOKENS.
export const COLOR_TOKENS = [
  "bg", "panel", "panel-2", "line", "text", "muted", "accent", "accent-solid",
  "on-accent", "focus", "link", "warn", "warn-bg", "success", "success-bg",
  "code-bg", "overlay", "viewer-bg", "viewer-grid", "viewer-grid-2",
  "viewer-model", "viewer-dim", "radius", "radius-sm", "glass-bg",
  "glass-border", "elevation", "font-sans", "font-display",
];

// ── The full top-level surface, in the same grouping/order as the old
// KNOWN_TOP_LEVEL_KEYS so a diff against history stays readable. ────────────
export const CONFIG_SPEC = {
  $schema: {
    type: "string",
    description: "Optional pointer to a JSON Schema for editor tooling; not read by gen-schema itself.",
  },

  // — App identity & PWA chrome —
  title: { type: "string", default: "ScadPub", description: "Browser tab title and header text." },
  shortName: { type: "string", description: "Short PWA name; defaults to 'title'." },
  id: {
    type: "string",
    default: "scadpub",
    description: "Namespaces localStorage, IndexedDB and the preset cache (charset [A-Za-z0-9._-]+).",
  },
  description: {
    type: "string",
    default: "Configure and export designs in your browser.",
    description: "Page <meta> description and PWA description.",
  },
  lang: { type: "string", default: "en", description: "Document/manifest language, a BCP-47 tag." },
  dir: { type: "enum", values: ["ltr", "rtl", "auto"], default: "ltr", description: "Document/manifest text direction." },
  icon: { type: "string", description: "PWA/favicon icon path, relative to the config file." },
  iconMaskable: { type: "string", description: "Separate SVG for the maskable icon; defaults to 'icon'." },
  themeColor: { type: "string", default: "#1f2229", description: "Dark-scheme browser-chrome / PWA colour." },
  themeColorLight: { type: "string", default: "#ffffff", description: "Light-scheme <meta name=theme-color>." },
  backgroundColor: { type: "string", default: "#15171c", description: "PWA manifest background colour." },
  categories: { type: "array", items: { type: "string" }, custom: true, description: "Manifest categories array." },
  screenshots: {
    type: "array",
    items: { type: "object", custom: true },
    custom: true,
    description: "Richer Android install-UI screenshots: [{ src, sizes, form_factor, label?, platform? }].",
  },
  shortcuts: {
    type: "array",
    items: { type: "object", custom: true },
    custom: true,
    description: "App shortcuts for Android long-press / desktop jump lists: [{ name, short_name?, url, icons? }].",
  },

  // — Design sources —
  source: { type: "string", default: ".", description: "Directory of Customizer-style .scad designs, relative to the config file." },
  designs: {
    type: "array",
    custom: true,
    description: "Explicit design list; omit to auto-discover *.scad in 'source'.",
    items: {
      type: "object",
      custom: true,
      properties: {
        id: { type: "string", description: "Design id (charset [A-Za-z0-9._-]+); used in URLs, storage, filenames." },
        label: { type: "string", description: "Picker label; defaults to a humanized id." },
        file: { type: "string", description: "Path to the .scad file, relative to 'source'; defaults to '<id>.scad'." },
        heavy: { type: "boolean", default: false, description: "Start this design in manual-render mode." },
        group: { type: "string", description: "Dropdown/gallery grouping header; consecutive same-value designs cluster." },
        description: { type: "string", description: "Picker description line; falls back to the design's // @description." },
        icon: { type: "string", description: "Picker icon path (config-relative); falls back to the design's // @icon." },
        image: { type: "string", description: "Larger ui.gallery card artwork; falls back to the design's // @image." },
        doc: { type: "string", description: "Path to a Markdown user-doc file; falls back to the design's // @doc." },
        presetImages: {
          type: "object",
          custom: true,
          description: "Bundled-preset-name -> thumbnail-image-path map.",
        },
        reviewLabels: {
          type: "object",
          custom: true,
          description: "Declared-param-name -> review-summary-label map.",
        },
        reviewNote: { type: "string", description: "Short callout shown in the review summary." },
      },
    },
  },
  defaultDesign: { type: "string", description: "Design id shown on a visit with no #d= deep link; must name a configured design." },
  assets: { type: "array", items: { type: "string" }, description: "Files/directories/globs to bundle verbatim; omit to follow use/include." },

  // — Rendering —
  features: { type: "array", items: { type: "string" }, description: "OpenSCAD --enable=<feature> flags applied to every render." },
  format: { type: "enum", values: ["3mf", "stl"], default: "3mf", description: "Export/preview model format." },
  restOnGrid: { type: "boolean", default: false, description: "Rest the model's base on z=0 instead of centring in Z (display-only)." },
  fonts: { type: "array", items: { type: "string" }, description: "Bundled font files (public/fonts basenames or 'source'-relative paths)." },
  fontFallback: { type: "string", description: "A bundled family pinned as fontconfig's last-resort default." },
  render: {
    type: "object",
    description: "Build-time render tuning: heavy-render threshold + cache sizing.",
    collapseEmptyToNull: true,
    properties: {
      heavyMs: num("nonNegative", { description: "Auto-pause threshold (ms) for a slow live render." }),
      cache: RENDER_CACHE_SPEC,
    },
  },

  // — Appearance & UI behaviour —
  logo: {
    type: "string",
    custom: true,
    description: "Header logo: a path, or { light, dark } per-theme paths (config-relative).",
    properties: {
      light: { type: "string", description: "Logo path used in the light theme." },
      dark: { type: "string", description: "Logo path used in the dark theme." },
    },
  },
  colors: {
    type: "object",
    custom: true,
    description: "Optional per-theme CSS colour/design-token overrides.",
    properties: {
      light: { type: "object", custom: true, properties: Object.fromEntries(COLOR_TOKENS.map((t) => [t, { type: "string" }])) },
      dark: { type: "object", custom: true, properties: Object.fromEntries(COLOR_TOKENS.map((t) => [t, { type: "string" }])) },
    },
  },
  extraCss: { type: "string", description: "Raw-CSS stylesheet path (config-relative), loaded after the app's own styles." },
  ui: {
    type: "object",
    description: "Build-time UI behaviour: panel/output defaults, viewer controls, labels.",
    properties: {
      panelSide: enumField(["left", "right"], "left", { description: "Which edge the desktop parameter panel docks against." }),
      panelDefault: enumField(["open", "collapsed"], "open", { description: "First-load desktop panel state." }),
      outputDefault: enumField(["closed", "open"], "closed", { description: "Whether the OpenSCAD output console starts open." }),
      install: enumField(["auto", "off"], "auto", { description: "PWA install affordance; 'off' hides it entirely." }),
      showVarName: bool(false, { description: "Show the OpenSCAD variable name beside each parameter label." }),
      measure: bool(true, { description: "Show the viewer's measure (ruler) toggle." }),
      viewPicker: bool(true, { description: "Show the camera-angle cube button." }),
      reset: bool(true, { description: "Show the 'reset view' button." }),
      zoom: bool(false, { description: "Show explicit zoom in/out buttons." }),
      fullscreen: bool(true, { description: "Show the fullscreen toggle (browser tabs only)." }),
      grid: enumField(["off", "on"], "off", { description: "Seeds the viewer's reference-grid toggle on first visit." }),
      // No `default` key: present only when the config sets it, matching
      // `parseUi(undefined).saveImage === undefined` (unlike the toggles
      // above, which always carry a built-in default).
      saveImage: { type: "boolean", skipOn: "undefined", description: "Show the 'Save image (PNG)' action." },
      gallery: bool(false, { description: "Replace the compact design dropdown with a searchable card grid." }),
      essentials: bool(false, { description: "Start with // @advanced parameters hidden behind 'Show all settings'." }),
      presetsLabel: str({ trimStore: true, default: "Presets", description: "Label for the Presets tab/section." }),
      parametersLabel: str({ trimStore: true, default: "Customize", description: "Label for the parameters tab/section." }),
      afterExport: AFTER_EXPORT_SPEC,
    },
  },
  viewer: {
    type: "object",
    description: "The 3D viewer's presentation, fixed at build time.",
    messageStyle: "dotted",
    unknownKeys: "reject",
    rootTypeError: (raw) => `config.viewer must be an object with an optional 'style' key (got ${JSON.stringify(raw)})`,
    unknownKeyError: (key) =>
      `config.viewer: unknown key '${key}' (valid keys: style)` +
      (key === "grid" ? " — the reference grid is now seeded by 'ui.grid'" : ""),
    properties: {
      style: enumField(["plain", "studio"], "plain", {
        skipOn: "nullish",
        gotSuffix: true,
        description: "'plain' is the classic CAD preview; 'studio' adds image-based lighting and a contact shadow.",
      }),
    },
  },
  fileImport: {
    // oneOf boolean | options object (see the anyOf handling in
    // gen-config-schema.mjs for nodes that have BOTH a primitive `type` and a
    // `properties` map).
    type: "boolean",
    description: "Enables the Files dialog. true for defaults, or an options object; omit/false/null for no Files action.",
    rootTypeError: "gen-schema: 'fileImport' must be true, an options object, or null",
    properties: {
      accept: str({ nonBlank: false, skipOn: "nullish", description: "Deprecated/vestigial; kept for backward compatibility." }),
      label: str({ nonBlank: false, skipOn: "nullish", description: "Deprecated/vestigial; kept for backward compatibility." }),
      note: str({ nonBlank: false, skipOn: "nullish", description: "Markdown-subset guidance shown atop the Files dialog." }),
      maxBytes: num("positive", { description: "Deprecated/vestigial upload size cap; kept for backward compatibility." }),
    },
  },

  // — In-app content —
  popup: {
    type: "object",
    description: "One-off notice dialog shown over the app on load.",
    rootTypeError: "gen-schema: 'popup' must be an object with 'header', 'body' and an optional 'mode'",
    properties: {
      header: str({ required: true, wording: "required", description: "Dialog title." }),
      body: str({ required: true, wording: "required", description: "Dialog message (Markdown subset)." }),
      mode: enumField(["always", "once", "dismissible", "picker"], "once", {
        skipOn: "nullish",
        gotSuffix: true,
        description: "Popup frequency.",
      }),
      button: str({ wording: "whenSet", description: "Primary-button label; overrides the default 'OK'." }),
      footnote: str({ wording: "whenSet", description: "Short plain-text line shown small and muted at the bottom." }),
    },
  },
  help: {
    type: "object",
    custom: true,
    description: "Help dialog content: 'sections' for a single pane, or 'tabs' for a tabbed guide. Passed through verbatim.",
  },
  notices: {
    type: "array",
    custom: true,
    description: "Design-defined notice categories surfaced on the OpenSCAD output panel.",
    items: {
      type: "object",
      custom: true,
      properties: {
        marker: { type: "string", description: "Design-defined word matched as ': <marker>:' inside an echo (case-insensitive)." },
        label: { type: "string", description: "Badge/notice noun; defaults to 'marker'." },
        labelOne: { type: "string", description: "Singular form of 'label', used when the live count is exactly 1." },
        color: { type: "string", description: "Badge fill colour, a plain CSS colour." },
        attention: { type: "boolean", default: false, description: "Join the pre-download review dialog's attention items." },
        subsumedByFont: { type: "boolean", default: false, description: "Fold into a missing-font item instead of listing separately." },
      },
    },
  },
  licenses: {
    type: "array",
    custom: true,
    description: "Extra third-party software/license notices, appended to the built-in attributions.",
    items: {
      type: "object",
      custom: true,
      properties: {
        name: { type: "string", description: "Component name." },
        license: { type: "string", description: "SPDX identifier." },
        copyright: { type: "string", description: "Copyright line." },
        url: { type: "string", description: "Project homepage." },
        licenseUrl: { type: "string", description: "Where the license text lives." },
        version: { type: "string", description: "Component version." },
        text: { type: "string", description: "Full license text, shown in a details panel." },
        sourceUrl: { type: "string", description: "Corresponding-source link (required by copyleft licenses)." },
        note: { type: "string", description: "One-line description." },
      },
    },
  },

  // — UI text overrides —
  strings: {
    type: "object",
    custom: true,
    description: "Per-deployment overrides of src/locales/en.json, keyed by the same catalogue keys.",
  },
};

// KNOWN_TOP_LEVEL_KEYS (re-exported by gen-schema.mjs, imported by tests):
// every recognised top-level config key is exactly the spec's own key set, so
// adding a key here is the only edit needed to allow it through loadConfig.
export const KNOWN_TOP_LEVEL_KEYS = new Set(Object.keys(CONFIG_SPEC));
