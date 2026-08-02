// config-spec.mjs: the single declarative description of scadpub.config.json's
// surface — every top-level key, and every key inside the handful that are
// themselves small nested objects. This file is data, not behaviour: it
// describes STRUCTURE only (names, nesting, JSON types, enums, static defaults,
// and which nested keys are recognised at all). Path existence, cross-field
// checks, colour-value safety and the strings-against-catalogue check stay in
// gen-schema.mjs's generate() and the bespoke parsers in ./config-parsers.mjs.
//
// Its three consumers and the full vocabulary of the field-descriptor markers
// (`custom`, `openKeys`, `required`, `collapseEmptyToNull`, `alwaysPresent`,
// `rootTypeError`) are documented in docs/config-pipeline.md. Add a marker
// there and here together.

// Small factories for the repeated field shapes, still plain data, they only
// save re-typing the same few keys 30 times over.
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

const num = (extra = {}) => ({
  type: "number",
  ...extra,
});

// A CSS-colour-valued scalar field (hex / rgb() / hsl() / named: the same
// COLOR_VALUE_RE strictness every colour input in this config uses). Exists
// as its own field kind (rather than folding colour-shaped strings into
// plain `str()`) because `pwa.backgroundColor` and `pwa.themeColor`'s own
// `light`/`dark` children are genuinely generic scalar fields once `pwa` is
// applyGroupSpec-driven, see validateFieldValue's "color" case in
// ./config-parsers.mjs, which owns COLOR_VALUE_RE. `type: "color"` is real
// for THAT dispatch (config-parsers.mjs's own switch), but "color" isn't a
// legal JSON Schema type, so gen-config-schema.mjs's `nodeToSchema` maps it
// to a plain `"string"` for emission. This factory folds the "this is a CSS
// colour, not any string" meaning into the description instead, so it isn't
// lost when the type collapses.
const color = (defaultValue, extra = {}) => {
  const { description, ...rest } = extra;
  return {
    type: "color",
    default: defaultValue,
    description: description
      ? `${description} A CSS colour string (hex, rgb()/rgba()/hsl()/hsla(), or a named colour).`
      : "A CSS colour string (hex, rgb()/rgba()/hsl()/hsla(), or a named colour).",
    ...rest,
  };
};

// The "<field>File" companion of a prose field resolved by gen-schema's
// prose-file pre-pass (scripts/lib/prose-files.mjs) or, for `licenses[].text`,
// the equivalent one-off in parseLicenses: a config-relative file whose
// contents become `field` at build time, before this spec's own
// applyGroupSpec walk (or parseLicenses) ever sees the resolved value.
// `custom: true` because the read-a-file behaviour is bespoke, like
// render.features/pwa.categories (see the file-top comment): registered here
// purely for doc-coverage / schema-emission, and never itself present by the
// time its sibling field is validated (the pre-pass deletes it after
// resolving `field`). Default wording assumes a Markdown file, matching
// `popup.bodyFile`/`fileImport.noteFile`; `licenses[].textFile` overrides it
// via `extra` since license text isn't Markdown-flavoured.
const fileAlt = (field, extra = {}) => ({
  type: "string",
  custom: true,
  description:
    `Config-relative Markdown file whose contents become '${field}' at build time. Mutually exclusive ` +
    `with '${field}' (setting both fails the build, naming both).`,
  ...extra,
});

// `ui.afterExport`: nested under `ui` below. It means only "show this panel",
// with one real option (`helpTab`), so it takes the same `true`-or-options-object
// shape as `fileImport` below: `true` (or `{}`) for defaults, `{ helpTab }` to
// also deep-link Help, `null`/absent for no panel. Copy overrides go through the
// `strings` catalogue instead: `exportSuccess.title`/`.body`, see
// src/components/ExportSuccess.tsx's own fallback. Like `fileImport`, that union
// means this field is `custom: true`
// (see the file-top comment on a plain leaf FIELD nested inside an
// applyGroupSpec-driven group). `parseAfterExport` in ./config-parsers.mjs
// handles the true/object dispatch itself, reusing this node's own
// `properties`/`rootTypeError` for the object-shape validation exactly the
// way `parseFileImport` reuses `CONFIG_SPEC.fileImport`. Unknown keys inside
// the object form are still rejected; `helpTab`'s cross-check against
// `help.tabs[].label` is a cross-field check and stays in gen-schema.mjs's
// generate().
const AFTER_EXPORT_SPEC = {
  type: "boolean",
  custom: true,
  description: "Turns on the after-export success panel: true for defaults, or { helpTab }.",
  rootTypeError: "gen-schema: 'ui.afterExport' must be true, an options object, or null",
  properties: {
    helpTab: str({
      description: "Opens Help scrolled to the tab with this label; must name a real help.tabs[].label.",
    }),
  },
};

// `viewer.controls`: nested under `viewer` below. `alwaysPresent: true`
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

// `render.cache`: nested under `render` below.
const RENDER_CACHE_SPEC = {
  type: "object",
  description: "Sizes the runner's two-tier render cache.",
  // Pure tuning: an empty `{}` means nothing was configured, so it collapses
  // to nothing rather than being stored (see the file-top comment).
  collapseEmptyToNull: true,
  properties: {
    maxEntries: num({ description: "In-memory (L1) slot count." }),
    maxBytes: num({ description: "In-memory (L1) total byte budget." }),
    maxEntryBytes: num({ description: "Largest single render worth caching." }),
    // No `default` key (unlike the bool()-built ui toggles): omitted entirely
    // unless the config sets it, so an empty `cache` collapses to nothing
    // rather than `{ persistent: undefined }`.
    persistent: { type: "boolean", description: "Persist renders to IndexedDB (L2)." },
  },
};

// `pwa.themeColor`: nested under `pwa` below. Same SHAPE as `logo` (a
// plain string used for both themes, or a { light, dark } object with either
// side optional), but NOT the same fallback rule: `logo`'s object form has a
// missing side fall back to the OTHER side (better to show one logo image on
// both themes than none), while a missing light/dark colour here resolves to
// its OWN independent built-in default (see parsePwaThemeColor in
// ./config-parsers.mjs). Light and dark chrome colours are genuinely
// different colours, not interchangeable the way a single logo asset is.
// `custom: true` because the string-or-object shape and the per-theme
// defaulting are bespoke (parsePwaThemeColor), like `logo` itself.
// The two built-in theme colours, declared once. They appear in the field
// descriptions below, in parsePwaThemeColor's fallback (config-parsers.mjs) and
// in vite.config.ts's meta-tag injection; each of those used to carry its own
// literal, so "the default" existed in four places and could disagree with what
// gen-schema actually emits.
export const PWA_THEME_COLOR_DEFAULTS = { light: "#ffffff", dark: "#1f2229" };

const PWA_THEME_COLOR_SPEC = {
  type: "string",
  custom: true,
  description:
    "Per-theme PWA/browser-chrome colour: a string for both themes, or { light, dark } (either may be " +
    `omitted, defaulting independently: light '${PWA_THEME_COLOR_DEFAULTS.light}', ` +
    `dark '${PWA_THEME_COLOR_DEFAULTS.dark}'). Same shape as 'logo'.`,
  properties: {
    light: {
      type: "string",
      description: `Light-scheme <meta name=theme-color>. Default '${PWA_THEME_COLOR_DEFAULTS.light}'.`,
    },
    dark: {
      type: "string",
      description: `Dark-scheme browser-chrome / PWA colour. Default '${PWA_THEME_COLOR_DEFAULTS.dark}'.`,
    },
  },
};

// `pwa`: manifest-only PWA chrome: install metadata, icons and theming
// that feed manifest.webmanifest and the icon rasterizer
// (scripts/lib/pwa-assets.mjs). Unlike `viewer` (which the app itself reads
// at runtime, and which designs.json therefore mirrors as its own nested
// `viewer` object), NOTHING under `pwa` has a runtime reader, see
// gen-schema.mjs's schema-assembly comment for the resulting rule: mirror the
// config's grouping in designs.json when the app shares the concept, keep
// designs.json's existing flat shape when it doesn't. `icon`/`iconMaskable`/
// `shortName` are plain scalars (applyGroupSpec-driven, unremarkable);
// `categories`/`screenshots`/`shortcuts` are `custom: true`. The same
// bespoke, lenient-to-malformed-entries validation these already had at the
// top level (see parsePwa in ./config-parsers.mjs and generatePwaAssets);
// `install` is a real behaviour toggle the app DOES read, see
// gen-schema.mjs's UI assembly for how its value still lands at
// `schema.ui.install`.
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

// `designs[].presets`: nested under `designs.items` below. A design's own
// metadata lives ONLY in its .scad file: `// @description`/`// @icon`/
// `// @image`/`// @doc`, a parameter's own `// @review "<label>"`, the design's
// `// @reviewNote "<text>"` (see docs/annotations.md), with no config-level
// override or escape hatch. `presets` is the one nested group here, because
// `presets.images` itself carries two forms (see its own comment below) and
// has no annotation counterpart at all (a bundled-preset thumbnail isn't
// something a .scad file could name).
//
// `presets` is an ordinary applyGroupSpec-driven node (like `ui`/`viewer`),
// NOT `custom: true` itself. A config setting `designs[].presets.nope` gets
// the same unknown-key rejection `ui`'s nested keys do (unlike `designs`
// itself, and `designs[].presets.images` below, which stays `custom: true`:
// the FIELD is closed and mechanical, its cross-referenced VALUE needs parse
// results only buildDesigns has). `resolveDesignList`/`buildDesigns`
// (scripts/gen-schema.mjs) call `applyGroupSpec` directly against this node
// per design entry: the design item as a WHOLE stays hand-rolled (id/label/
// file defaulting, duplicate-id detection are cross-field logic no spec can
// express), but this one sub-group is exactly the "check a string / reject
// an unknown key" shape `applyGroupSpec` already generalizes, so re-deriving
// that by hand a second time would be the wrong kind of bespoke.
const DESIGN_PRESETS_SPEC = {
  type: "object",
  description: "This design's bundled-preset presentation.",
  properties: {
    images: {
      type: "object",
      // Two shapes, both `custom: true` (the cross-referenced VALUE — a real
      // preset name, a file that actually exists — needs parse results only
      // buildDesigns has, so this field's own shape check stays minimal):
      //   - an object: preset-name -> thumbnail-image-path map (the original
      //     form, and the escape hatch for a preset whose name and file
      //     genuinely don't correspond mechanically);
      //   - a string: a config-relative DIRECTORY. Each bundled preset's
      //     image is looked up by slugifying its name (scripts/lib/preset-slug.mjs
      //     — matching a maintainer's own thumbnail-rendering script byte for
      //     byte) and trying '.svg'/'.png'/'.webp' in turn. A preset with no
      //     matching file is fine (see "optional per preset" below); a
      //     directory that doesn't exist fails the build.
      // `acceptsString` tells gen-config-schema.mjs's nodeToSchema to emit an
      // `anyOf` of `string`/`object` for this field specifically (distinct
      // from the primitive-shorthand-plus-options-object `anyOf` fileImport/
      // logo/pwa.themeColor use — see nodeToSchema's own comment — since this
      // object form has no fixed key set to describe as `properties`).
      acceptsString: true,
      custom: true,
      description:
        "Bundled-preset thumbnails: either a preset-name -> image-path map (every key must match a real " +
        "bundled preset name), or a single config-relative directory string (each preset's image looked up " +
        "by slugifying its name — see docs/config.md). Preset images are optional per preset either way.",
    },
  },
};

// The CSS custom-property tokens `colors.<theme>.*` may set (see
// src/index.css). Registered here so gen-config-schema.mjs and the
// docs-coverage test see them; config-parsers.mjs imports and re-exports this
// exact array, so parseColors's runtime validation and this schema/doc
// metadata can never drift apart: there is one owner, this one.
export const COLOR_TOKENS = [
  "bg", "panel", "panel-2", "line", "text", "muted", "accent", "accent-solid",
  "on-accent", "focus", "link", "warn", "warn-bg", "success", "success-bg",
  "code-bg", "overlay", "viewer-bg", "viewer-grid", "viewer-grid-2",
  "viewer-model", "viewer-dim", "radius", "radius-sm", "glass-bg",
  "glass-border", "elevation", "font-sans", "font-display",
];

export const CONFIG_SPEC = {
  $schema: {
    type: "string",
    description: "Optional pointer to a JSON Schema for editor tooling; not read by gen-schema itself.",
  },

  // title/id/description/lang/dir are document chrome and storage namespacing
  // first, read by the running app itself, even though several are ALSO manifest
  // inputs; the `pwa` node below holds the keys that are manifest/icon-rasterizer
  // INPUTS ONLY, with no runtime reader.
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

  // Manifest-only; see PWA_THEME_COLOR_SPEC and the `pwa` node below.
  pwa: PWA_SPEC,

  source: { type: "string", default: ".", description: "Directory of Customizer-style .scad designs, relative to the config file." },
  designs: {
    type: "array",
    custom: true,
    description: "Explicit design list; omit to auto-discover *.scad in 'source'.",
    items: {
      type: "object",
      custom: true,
      properties: {
        // `required: true` even though resolveDesignList/buildDesigns (not
        // applyGroupSpec) enforce it: `checkId` throws on a missing OR null
        // `id` (see the file-top comment), so the schema shouldn't offer a
        // null alternative here either.
        id: {
          type: "string",
          required: true,
          description: "Design id (charset [A-Za-z0-9._-]+); used in URLs, storage, filenames.",
        },
        label: { type: "string", description: "Picker label; defaults to a humanized id." },
        file: { type: "string", description: "Path to the .scad file, relative to 'source'; defaults to '<id>.scad'." },
        heavy: { type: "boolean", default: false, description: "Start this design in manual-render mode." },
        group: { type: "string", description: "Dropdown/gallery grouping header; consecutive same-value designs cluster." },
        // No `description`/`media`/`review` here: a design's picker
        // description, icon, gallery image, doc, and curated review
        // label/note come ONLY from its own .scad annotations now
        // (`// @description`, `// @icon`, `// @image`, `// @doc`,
        // `// @review "<label>"`, `// @reviewNote "<text>"`, see
        // docs/annotations.md). There is no config-level override left.
        presets: DESIGN_PRESETS_SPEC,
      },
    },
  },
  defaultDesign: { type: "string", description: "Design id shown on a visit with no #d= deep link; must name a configured design." },
  assets: { type: "array", items: { type: "string" }, description: "Files/directories/globs to bundle verbatim; omit to follow use/include." },

  // `render` is not wholly absent from renderHash: `features`/`format`/
  // `fonts`/`fontFallback` live here too, and ARE hashed (an --enable flag, the
  // export format, and bundled glyph outlines all change the rendered
  // bytes). `heavyMs`/`cache` stay display/perf-only and stay OUT of
  // renderHash, same as before. The four render-input fields are `custom:
  // true` (see the file-top comment): applyGroupSpec recognises the key so
  // it isn't rejected as unknown, but skips producing/validating it. This
  // group's real return value (parseRender's result, schema.render) still
  // holds only `heavyMs`/`cache`, while
  // `parseStringArray`/`parseFormat`/`parseFontFallback` (unchanged, bespoke,
  // individually unit-tested) read `config.render.features` etc. directly and
  // feed the schema's separate flat `features`/`format`/`fonts` keys —
  // `fontFallback` gets no schema key at all, it is rendered into the generated
  // `fonts.conf` and reaches renderHash from there — see gen-schema.mjs's
  // schema assembly and its comment on why designs.json does NOT gain a nested
  // `render.features` etc. to match.
  render: {
    type: "object",
    description:
      "Rendering: OpenSCAD flags/format/fonts (render inputs — folded into renderHash) plus build-time " +
      "heavy-render-threshold/cache tuning ('heavyMs'/'cache' — display/perf only, absent from renderHash).",
    // Pure tuning: an empty `{}` collapses to nothing (see the file-top comment).
    // (Only heavyMs/cache participate in this collapse, see above.)
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
      heavyMs: num({ description: "Auto-pause threshold (ms) for a slow live render. NOT in renderHash." }),
      cache: RENDER_CACHE_SPEC,
    },
  },

  logo: {
    type: "string",
    custom: true,
    // copyLogoAssets (scripts/gen-schema.mjs) reads only `light`/`dark` off
    // the object form and silently ignores anything else: genuinely open,
    // unlike `colors.light`/`colors.dark` below.
    openKeys: true,
    description: "Header logo: a path, or { light, dark } per-theme paths (config-relative).",
    properties: {
      light: { type: "string", description: "Logo path used in the light theme." },
      dark: { type: "string", description: "Logo path used in the dark theme." },
    },
  },
  colors: {
    type: "object",
    custom: true,
    // parseColors (scripts/lib/config-parsers.mjs) reads only `light`/`dark`
    // off this object and silently ignores anything else: genuinely open,
    // unlike its own `light`/`dark` children immediately below, which throw on any
    // token outside COLOR_TOKENS and so do NOT carry `openKeys`.
    openKeys: true,
    description: "Optional per-theme CSS colour/design-token overrides.",
    properties: {
      light: {
        type: "object",
        custom: true,
        properties: Object.fromEntries(COLOR_TOKENS.map((t) => [t, { type: "string" }])),
      },
      dark: {
        type: "object",
        custom: true,
        properties: Object.fromEntries(COLOR_TOKENS.map((t) => [t, { type: "string" }])),
      },
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
      // default), but its value still lands at `schema.ui.install`, since
      // that's what the app itself reads (App.tsx); see gen-schema.mjs.
      showVarName: bool(false, { description: "Show the OpenSCAD variable name beside each parameter label." }),
      // No `default` key: present only when the config sets it, matching
      // `parseUi(undefined).saveImage === undefined` (unlike the toggles
      // above, which always carry a built-in default).
      saveImage: { type: "boolean", description: "Show the 'Save image (PNG)' action." },
      gallery: bool(false, { description: "Replace the compact design dropdown with a searchable card grid." }),
      essentials: bool(false, { description: "Start with // @advanced parameters hidden behind 'Show all settings'." }),
      // The Presets/Customize tab labels are the i18n catalogue
      // (`strings["presets.title"]`/`strings["settings.title"]`,
      // src/locales/en.json) since that's what they always were: chrome
      // copy, not build-time behaviour.
      afterExport: AFTER_EXPORT_SPEC,
    },
  },
  // Everything display-only the 3D viewer owns, gathered in one place. None of
  // it affects the exported bytes or the render cache.
  viewer: {
    type: "object",
    description: "The 3D viewer's presentation, framing, and per-control visibility, fixed at build time.",
    rootTypeError:
      "gen-schema: 'viewer' must be an object with optional 'style', 'restOnGrid', 'grid' and 'controls' keys",
    properties: {
      style: enumField(["plain", "studio"], "plain", {
        description: "'plain' is the classic CAD preview; 'studio' adds image-based lighting and a contact shadow.",
      }),
      restOnGrid: bool(false, { description: "Rest the model's base on the z=0 grid instead of centring in Z (display-only)." }),
      // NOT a control-visibility flag like its `controls` neighbours below:
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
      note: str({ description: "Markdown-subset guidance shown atop the Files dialog. Mutually exclusive with 'noteFile'." }),
      // Same pre-pass/resolution pattern as popup.bodyFile above (see its
      // comment): resolved into 'note' before applyGroupSpec ever sees this
      // key, so it's registered here as `custom: true` purely for doc
      // coverage / schema emission.
      noteFile: fileAlt("note"),
    },
  },

  popup: {
    type: "object",
    description: "One-off notice dialog shown over the app on load.",
    rootTypeError: "gen-schema: 'popup' must be an object with 'header', 'body' and an optional 'mode'",
    properties: {
      header: str({ required: true, description: "Dialog title." }),
      body: str({ required: true, description: "Dialog message (Markdown subset). Mutually exclusive with 'bodyFile'." }),
      // Resolved by gen-schema.mjs's prose-file pre-pass (scripts/lib/prose-files.mjs)
      // BEFORE this spec's own applyGroupSpec walk ever runs: a config-relative
      // Markdown file whose contents become 'body', so `body` is populated by the
      // time the `required` check above sees it. `custom: true` because the
      // read-a-file behaviour is bespoke, like render.features/pwa.categories (see
      // the file-top comment). It's registered here purely for doc-coverage /
      // schema-emission, and is never itself present by the time applyGroupSpec
      // walks this node (the pre-pass deletes it after resolving 'body').
      bodyFile: fileAlt("body"),
      mode: enumField(["always", "once", "dismissible", "picker"], "once", { description: "Popup frequency." }),
      button: str({ description: "Primary-button label; overrides the default 'OK'." }),
      footnote: str({ description: "Short plain-text line shown small and muted at the bottom." }),
    },
  },
  help: {
    type: "object",
    custom: true,
    // Passed through verbatim (see the description below): a genuinely
    // open-ended shape with no fixed property list to close against, so this
    // carries no `properties` of its own and `openKeys` is documentation more
    // than mechanism here (see this file's file-top comment).
    openKeys: true,
    description:
      "Help dialog content: 'sections' for a single pane, or 'tabs' for a tabbed guide. A pane (the top-level " +
      "object, or any 'tabs[]' entry) may set 'file' instead of 'sections' — a config-relative Markdown file " +
      "gen-schema splits into 'intro'/'sections' at build time (see docs/config.md). Passed through verbatim " +
      "otherwise, with any 'file' already resolved.",
  },
  notices: {
    type: "array",
    custom: true,
    description: "Design-defined notice categories surfaced on the OpenSCAD output panel.",
    items: {
      type: "object",
      custom: true,
      // parseNotices (scripts/lib/config-parsers.mjs) copies the fields it
      // knows about and silently drops anything else: genuinely open.
      openKeys: true,
      properties: {
        // `required: true` (see the file-top comment): parseNotices throws on
        // a missing OR null `marker`, even though that check lives in its own
        // hand-rolled code rather than `applyGroupSpec`.
        marker: {
          type: "string",
          required: true,
          description: "Design-defined word matched as ': <marker>:' inside an echo (case-insensitive).",
        },
        // Real union, not a plain string: `parseNoticeLabel` (config-parsers.mjs)
        // accepts either a bare string (shorthand for "the same word regardless
        // of count") or an object `{ one?, other }`. `other` is the ONLY
        // required key inside that object form (`one` falls back to it when
        // unset), and any key outside `one`/`other` fails the build, so this
        // node is NOT `openKeys`. Reuses the `logo`/`pwa.themeColor` idiom: a
        // primitive `type` alongside a `properties` map becomes an `anyOf` of
        // the primitive form and the object form in gen-config-schema.mjs's
        // `nodeToSchema`, see that function's own comment.
        label: {
          type: "string",
          description:
            "Badge/notice noun: a plain string used for both counts, or { one, other } for distinct " +
            "singular/plural forms (selected via Intl.PluralRules, the same as src/lib/i18n.ts's tn()). " +
            "Defaults to 'marker'.",
          properties: {
            one: str({ description: "Singular override; falls back to 'other' when omitted." }),
            other: str({ required: true, description: "Plural/default form, used whenever 'one' is unset." }),
          },
        },
        color: { type: "string", description: "Badge fill colour, a plain CSS colour." },
        attention: {
          type: "boolean",
          default: false,
          description: "Join the pre-download review dialog's attention items.",
        },
        subsumedByFont: {
          type: "boolean",
          default: false,
          description: "Fold into a missing-font item instead of listing separately.",
        },
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
      // parseLicenses (scripts/lib/config-parsers.mjs) copies the required
      // and optional fields it knows about and silently drops anything else
      // — genuinely open, same as `notices[]` above.
      openKeys: true,
      properties: {
        // `name`/`license`/`copyright`/`url`/`licenseUrl` all carry
        // `required: true` (see the file-top comment): parseLicenses's own
        // REQUIRED loop throws on any of them missing OR null, even though
        // that check lives in its own hand-rolled code rather than
        // `applyGroupSpec`.
        name: { type: "string", required: true, description: "Component name." },
        license: { type: "string", required: true, description: "SPDX identifier." },
        copyright: { type: "string", required: true, description: "Copyright line." },
        url: { type: "string", required: true, description: "Project homepage." },
        licenseUrl: { type: "string", required: true, description: "Where the license text lives." },
        version: { type: "string", description: "Component version." },
        text: {
          type: "string",
          description: "Full license text, shown in a details panel. Mutually exclusive with 'textFile'.",
        },
        // Same pre-pass/resolution pattern as popup.bodyFile (see its
        // comment): resolved into 'text' before parseLicenses ever sees this
        // entry, so it's registered here as `custom: true` purely for doc
        // coverage / schema emission.
        textFile: fileAlt("text", {
          description:
            "Config-relative file whose contents become 'text' at build time. Mutually exclusive with " +
            "'text' (setting both fails the build, naming both).",
        }),
        sourceUrl: {
          type: "string",
          description: "Corresponding-source link (required by copyleft licenses).",
        },
        note: { type: "string", description: "One-line description." },
      },
    },
  },

  strings: {
    type: "object",
    custom: true,
    // Keyed by the i18n catalogue's own key set (parseStrings validates
    // against it, not against a fixed property list here): a genuinely
    // open-ended key space, like `help` above; no `properties` of its own, so
    // `openKeys` is documentation more than mechanism here too.
    openKeys: true,
    description: "Per-deployment overrides of src/locales/en.json, keyed by the same catalogue keys.",
  },
};

// KNOWN_TOP_LEVEL_KEYS (re-exported by gen-schema.mjs, imported by tests):
// every recognised top-level config key is exactly the spec's own key set, so
// adding a key here is the only edit needed to allow it through loadConfig.
export const KNOWN_TOP_LEVEL_KEYS = new Set(Object.keys(CONFIG_SPEC));
