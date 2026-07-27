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
// from this shape" — `gen-config-schema.mjs` also reads this marker to decide
// whether a node's JSON Schema tolerates an unrecognised key (`custom: true`,
// matching those parsers' own leniency) or rejects one (every other object
// node here, all of which `applyGroupSpec` makes genuinely closed at runtime).
//
// ── Field-descriptor shapes used by `properties` entries ────────────────────
// Every property is at minimum { type, description }. `applyGroupSpec` (see
// ./config-parsers.mjs) now applies ONE behaviour per axis to every field,
// rather than the per-field flags (`skipOn`, `gotSuffix`, `nonBlank`,
// `trimStore`, `wording`, `unknownKeys`, `unknownKeyError`, `messageStyle`)
// this file used to carry solely to reproduce five parsers' accidental
// disagreements byte-for-byte: an explicit `null` always means "not set";
// an enum error always appends ` (got <value>)`; a string is always rejected
// blank and stored trimmed; a nested object's unrecognised key always fails
// the build, with the valid-key list read straight off `properties`.
//
// What's left, because each encodes a real distinction rather than an
// accident: `numberKind` ("nonNegative" >= 0 vs. "positive" > 0 — two
// genuinely different bounds); `required` (validate even when entirely
// absent — only `popup.header`/`popup.body`); `custom` (object/array nodes
// whose runtime validation lives in a bespoke parser instead, per the file-top
// comment — and, since this commit, also a plain leaf FIELD nested inside an
// otherwise applyGroupSpec-driven group, e.g. `render.features`/`render.fonts`
// or `pwa.screenshots`/`pwa.categories`/`pwa.themeColor`: `applyGroupSpec`
// still accepts the key as recognised — so it can't be rejected as unknown —
// but skips it entirely otherwise, neither defaulting nor validating nor
// including it in its own return value, because the bespoke code that reads
// it (parseStringArray, parseFormat, parseFontFallback, parsePwaThemeColor,
// generatePwaAssets) reads the RAW config object directly instead);
// `collapseEmptyToNull` (an empty `{}` disappears entirely for a
// pure tuning knob like `render`/`render.cache` — contrast `ui.afterExport`,
// where the key's mere presence, even empty, is itself the "show the panel"
// toggle); `alwaysPresent` (the opposite problem: a nested group whose OWN
// fields carry defaults that must resolve even when the config omits the
// group entirely — only `viewer.controls` uses it today, since it replaces
// what used to be flat `ui.*` booleans that were always present with a
// built-in default; see `applyGroupSpec` in ./config-parsers.mjs); and
// `rootTypeError` (a plain-string override describing a field's actual
// accepted shapes — `fileImport` is `true`/an object/`null`, `popup` needs
// `header`+`body` — genuinely more useful than the generic message).

// ── Small factories for the repeated field shapes (still plain data — these
// just save re-typing the same few keys 30 times over). ────────────────────
const bool = (defaultValue, extra = {}) => ({
  type: "boolean",
  default: defaultValue,
  ...extra,
});

const enumField = (values, defaultValue, extra = {}) => ({
  type: "enum",
  values,
  default: defaultValue,
  ...extra,
});

const str = (extra = {}) => ({
  type: "string",
  ...extra,
});

const num = (numberKind, extra = {}) => ({
  type: "number",
  numberKind,
  ...extra,
});

// A CSS-colour-valued scalar field (hex / rgb() / hsl() / named — the same
// COLOR_VALUE_RE strictness every colour input in this config uses). Exists
// as its own field kind (rather than folding colour-shaped strings into
// plain `str()`) because `pwa.backgroundColor` and `pwa.themeColor`'s own
// `light`/`dark` children are genuinely generic scalar fields once `pwa` is
// applyGroupSpec-driven — see validateFieldValue's "color" case in
// ./config-parsers.mjs, which owns COLOR_VALUE_RE.
const color = (defaultValue, extra = {}) => ({
  type: "color",
  default: defaultValue,
  ...extra,
});

// ── `ui.afterExport` — nested under `ui` below. Unknown keys are rejected
// (matches parseAfterExport's own AFTER_EXPORT_KEYS loop); `helpTab`'s
// cross-check against `help.tabs[].label` is a cross-field check and stays in
// gen-schema.mjs's generate().
const AFTER_EXPORT_SPEC = {
  type: "object",
  description: "Turns on the after-export success panel; every field optional.",
  properties: {
    title: str({ description: "Overrides the panel headline." }),
    body: str({ description: "Overrides the panel's one-line next step (Markdown subset)." }),
    helpTab: str({
      description: "Opens Help scrolled to the tab with this label; must name a real help.tabs[].label.",
    }),
  },
};

// ── `viewer.controls` — nested under `viewer` below. `alwaysPresent: true`
// (see the file-top comment) is what makes its five booleans behave like the
// flat `ui.*` booleans they replace: always resolved to their default even
// when the config sets neither `viewer` nor `viewer.controls` at all, rather
// than silently absent the way `render.cache`/`ui.afterExport` are when unset.
const VIEWER_CONTROLS_SPEC = {
  type: "object",
  alwaysPresent: true,
  description: "Visibility of the individual viewer HUD control buttons. None of these hide the 3D canvas itself.",
  properties: {
    measure: bool(true, { description: "Show the viewer's measure (ruler) toggle." }),
    viewPicker: bool(true, { description: "Show the camera-angle cube button." }),
    reset: bool(true, { description: "Show the 'reset view' button." }),
    zoom: bool(false, { description: "Show explicit zoom in/out buttons." }),
    fullscreen: bool(true, { description: "Show the fullscreen toggle (browser tabs only)." }),
  },
};

// ── `render.cache` — nested under `render` below.
const RENDER_CACHE_SPEC = {
  type: "object",
  description: "Sizes the runner's two-tier render cache.",
  // Pure tuning: an empty `{}` means nothing was configured, so it collapses
  // to nothing rather than being stored (see the file-top comment).
  collapseEmptyToNull: true,
  properties: {
    maxEntries: num("nonNegative", { description: "In-memory (L1) slot count." }),
    maxBytes: num("nonNegative", { description: "In-memory (L1) total byte budget." }),
    maxEntryBytes: num("nonNegative", { description: "Largest single render worth caching." }),
    // No `default` key (unlike the bool()-built ui toggles): omitted entirely
    // unless the config sets it, so an empty `cache` collapses to nothing
    // rather than `{ persistent: undefined }`.
    persistent: { type: "boolean", description: "Persist renders to IndexedDB (L2)." },
  },
};

// ── `pwa.themeColor` — nested under `pwa` below. Same SHAPE as `logo` (a
// plain string used for both themes, or a { light, dark } object with either
// side optional) — but NOT the same fallback rule: `logo`'s object form has a
// missing side fall back to the OTHER side (better to show one logo image on
// both themes than none), while a missing light/dark colour here resolves to
// its OWN independent built-in default (see parsePwaThemeColor in
// ./config-parsers.mjs) — light and dark chrome colours are genuinely
// different colours, not interchangeable the way a single logo asset is.
// `custom: true` because the string-or-object shape and the per-theme
// defaulting are bespoke (parsePwaThemeColor), like `logo` itself.
const PWA_THEME_COLOR_SPEC = {
  type: "string",
  custom: true,
  description:
    "Per-theme PWA/browser-chrome colour: a string for both themes, or { light, dark } (either may be " +
    "omitted, defaulting independently: light '#ffffff', dark '#1f2229'). Same shape as 'logo'.",
  properties: {
    light: { type: "string", description: "Light-scheme <meta name=theme-color>. Default '#ffffff'." },
    dark: { type: "string", description: "Dark-scheme browser-chrome / PWA colour. Default '#1f2229'." },
  },
};

// ── `pwa` — manifest-only PWA chrome: install metadata, icons and theming
// that feed manifest.webmanifest and the icon rasterizer
// (scripts/lib/pwa-assets.mjs). Unlike `viewer` (which the app itself reads
// at runtime, and which designs.json therefore mirrors as its own nested
// `viewer` object), NOTHING under `pwa` has a runtime reader — see
// gen-schema.mjs's schema-assembly comment for the resulting rule: mirror the
// config's grouping in designs.json when the app shares the concept, keep
// designs.json's existing flat shape when it doesn't. `icon`/`iconMaskable`/
// `shortName` are plain scalars (applyGroupSpec-driven, unremarkable);
// `categories`/`screenshots`/`shortcuts` are `custom: true` — the same
// bespoke, lenient-to-malformed-entries validation these already had at the
// top level (see parsePwa in ./config-parsers.mjs and generatePwaAssets);
// `install` is a real behaviour toggle the app DOES read — see
// gen-schema.mjs's UI assembly for how its value lands at `schema.ui.install`.
const PWA_SPEC = {
  type: "object",
  description:
    "Manifest-only PWA chrome (install metadata, icons, theming) that feeds manifest.webmanifest and the " +
    "icon rasterizer at build time. Not mirrored into designs.json — the app itself never reads a 'pwa' object.",
  properties: {
    shortName: str({ description: "Short PWA name; defaults to 'title'." }),
    icon: str({ description: "PWA/favicon icon path, relative to the config file." }),
    iconMaskable: str({ description: "Separate SVG for the maskable icon; defaults to 'icon'." }),
    themeColor: PWA_THEME_COLOR_SPEC,
    backgroundColor: color("#15171c", { description: "PWA manifest background colour." }),
    categories: {
      type: "array",
      items: { type: "string" },
      custom: true,
      description: "Manifest categories array.",
    },
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
    install: enumField(["auto", "off"], "auto", {
      description: "PWA install affordance; 'off' hides it entirely.",
    }),
  },
};

// The CSS custom-property tokens `colors.<theme>.*` may set (see
// src/index.css). Registered here so gen-config-schema.mjs and the
// docs-coverage test see them; config-parsers.mjs imports and re-exports this
// exact array, so parseColors's runtime validation and this schema/doc
// metadata can never drift apart — there is one owner, this one.
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

  // — App identity —
  // (title/id/description/lang/dir stay here even though several are ALSO
  // manifest inputs: they're document chrome and storage namespacing first,
  // read by the running app itself — see PWA_THEME_COLOR_SPEC's neighbour
  // `pwa` node below for the keys that are manifest/icon-rasterizer INPUTS
  // ONLY, with no runtime reader.)
  title: { type: "string", default: "ScadPub", description: "Browser tab title and header text." },
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

  // — PWA (manifest-only; see PWA_THEME_COLOR_SPEC + the `pwa` node below) —
  pwa: PWA_SPEC,

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
  // `render` used to be documented as wholly absent from renderHash; that's
  // no longer true once `features`/`format`/`fonts`/`fontFallback` live here
  // too — they're genuine render inputs and ARE hashed (an --enable flag, the
  // export format, and bundled glyph outlines all change the rendered
  // bytes). `heavyMs`/`cache` stay display/perf-only and stay OUT of
  // renderHash, same as before. The four render-input fields are `custom:
  // true` (see the file-top comment): applyGroupSpec recognises the key so
  // it isn't rejected as unknown, but skips producing/validating it — this
  // group's real return value (parseRender's result, schema.render) still
  // holds only `heavyMs`/`cache`, exactly as before this move, while
  // `parseStringArray`/`parseFormat`/`parseFontFallback` (unchanged, bespoke,
  // individually unit-tested) read `config.render.features` etc. directly and
  // feed the schema's separate flat `features`/`format`/`fonts`/`fontFallback`
  // keys — see gen-schema.mjs's schema assembly and its comment on why
  // designs.json does NOT gain a nested `render.features` etc. to match.
  render: {
    type: "object",
    description:
      "Rendering: OpenSCAD flags/format/fonts (render inputs — folded into renderHash) plus build-time " +
      "heavy-render-threshold/cache tuning ('heavyMs'/'cache' — display/perf only, absent from renderHash).",
    // Pure tuning: an empty `{}` collapses to nothing (see the file-top comment).
    // (Only heavyMs/cache participate in this collapse — see above.)
    collapseEmptyToNull: true,
    properties: {
      features: {
        type: "array",
        items: { type: "string" },
        custom: true,
        description: "OpenSCAD --enable=<feature> flags applied to every render. Folded into renderHash.",
      },
      format: {
        type: "enum",
        values: ["3mf", "stl"],
        default: "3mf",
        custom: true,
        description: "Export/preview model format. Folded into renderHash.",
      },
      fonts: {
        type: "array",
        items: { type: "string" },
        custom: true,
        description: "Bundled font files (public/fonts basenames or 'source'-relative paths). Folded into renderHash.",
      },
      fontFallback: {
        type: "string",
        custom: true,
        description: "A bundled family pinned as fontconfig's last-resort default. Folded into renderHash.",
      },
      heavyMs: num("nonNegative", { description: "Auto-pause threshold (ms) for a slow live render. NOT in renderHash." }),
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
    description: "Build-time UI behaviour: panel/output defaults and labels.",
    properties: {
      panelSide: enumField(["left", "right"], "left", { description: "Which edge the desktop parameter panel docks against." }),
      panelDefault: enumField(["open", "collapsed"], "open", { description: "First-load desktop panel state." }),
      outputDefault: enumField(["closed", "open"], "closed", { description: "Whether the OpenSCAD output console starts open." }),
      // `install` moved to `pwa.install` (a PWA/manifest concern, not a panel
      // default) — but its value still lands at `schema.ui.install`, since
      // that's what the app itself reads (App.tsx); see gen-schema.mjs.
      showVarName: bool(false, { description: "Show the OpenSCAD variable name beside each parameter label." }),
      // No `default` key: present only when the config sets it, matching
      // `parseUi(undefined).saveImage === undefined` (unlike the toggles
      // above, which always carry a built-in default).
      saveImage: { type: "boolean", description: "Show the 'Save image (PNG)' action." },
      gallery: bool(false, { description: "Replace the compact design dropdown with a searchable card grid." }),
      essentials: bool(false, { description: "Start with // @advanced parameters hidden behind 'Show all settings'." }),
      presetsLabel: str({ default: "Presets", description: "Label for the Presets tab/section." }),
      parametersLabel: str({ default: "Customize", description: "Label for the parameters tab/section." }),
      afterExport: AFTER_EXPORT_SPEC,
    },
  },
  // Everything display-only the 3D viewer owns, gathered in one place rather
  // than spread across the top level (`restOnGrid`) and `ui` (`grid`, and the
  // five per-control booleans) — see this commit's message for why that
  // spread was the wrong boundary. None of it affects the exported bytes or
  // the render cache.
  viewer: {
    type: "object",
    description: "The 3D viewer's presentation, framing, and per-control visibility, fixed at build time.",
    rootTypeError:
      "gen-schema: 'viewer' must be an object with optional 'style', 'restOnGrid', 'grid' and 'controls' keys",
    properties: {
      style: enumField(["plain", "studio"], "plain", {
        description: "'plain' is the classic CAD preview; 'studio' adds image-based lighting and a contact shadow.",
      }),
      restOnGrid: bool(false, {
        description: "Rest the model's base on the z=0 grid instead of centring in Z (display-only).",
      }),
      // NOT a control-visibility flag like its `controls` neighbours below —
      // the grid toggle is always offered regardless of this value. It only
      // seeds that toggle's first-ever value; a visitor's own later choice
      // persists and wins forever after (see src/lib/viewerPrefs.ts). That
      // distinction is exactly why this sits directly on `viewer` rather than
      // inside `viewer.controls`.
      grid: enumField(["off", "on"], "off", {
        description:
          "Seeds the viewer's reference-grid toggle's first-ever value. The toggle itself is always offered — " +
          "this is not a visibility flag, unlike 'controls' below — and a visitor's own later choice persists " +
          "and wins on every subsequent visit.",
      }),
      controls: VIEWER_CONTROLS_SPEC,
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
      accept: str({ description: "Deprecated/vestigial; kept for backward compatibility." }),
      label: str({ description: "Deprecated/vestigial; kept for backward compatibility." }),
      note: str({ description: "Markdown-subset guidance shown atop the Files dialog." }),
      maxBytes: num("positive", { description: "Deprecated/vestigial upload size cap; kept for backward compatibility." }),
    },
  },

  // — In-app content —
  popup: {
    type: "object",
    description: "One-off notice dialog shown over the app on load.",
    rootTypeError: "gen-schema: 'popup' must be an object with 'header', 'body' and an optional 'mode'",
    properties: {
      header: str({ required: true, description: "Dialog title." }),
      body: str({ required: true, description: "Dialog message (Markdown subset)." }),
      mode: enumField(["always", "once", "dismissible", "picker"], "once", { description: "Popup frequency." }),
      button: str({ description: "Primary-button label; overrides the default 'OK'." }),
      footnote: str({ description: "Short plain-text line shown small and muted at the bottom." }),
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
