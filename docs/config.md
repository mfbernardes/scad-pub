# Configuration reference

`scripts/gen-schema.mjs` reads `scadpub.config.json` (override path with `SCADPUB_CONFIG`):

```jsonc
{
  // ── App identity & PWA ─────────────────────────────────────────────
  "title": "ScadPub",             // page/header title
  "id": "scadpub",                // namespaces browser storage (default "scadpub")
  "shortName": "ScadPub",         // PWA short_name (default: title)
  "description": "Configure …",   // page <meta> + PWA description
  "lang": "en",                   // document / manifest language (BCP-47; default "en")
  "dir": "ltr",                   // text direction: "ltr" | "rtl" | "auto"; default "ltr"
  "icon": "branding/icon.svg",    // PWA/favicon icon
  "iconMaskable": "branding/icon-maskable.svg", // optional maskable icon (defaults to `icon`)
  "themeColor": "#1f2229",        // browser-chrome / PWA colour
  "themeColorLight": "#ffffff",   // light-scheme browser-chrome colour (default "#ffffff")
  "backgroundColor": "#15171c",   // PWA splash background
  "categories": ["productivity", "graphics"],  // optional PWA manifest categories
  "screenshots": [                // optional, for the Android rich install UI
    { "src": "shot-narrow.png", "sizes": "390x844", "form_factor": "narrow", "label": "Home" }
  ],
  "shortcuts": [                  // optional app shortcuts (auto-derived per design if omitted)
    { "name": "Open Tag", "short_name": "Tag", "url": "./#d=tag" }
  ],

  // ── Design sources ─────────────────────────────────────────────────
  "source": "examples",           // directory of .scad designs (relative to this file)
  "defaultDesign": "tag",         // optional: design shown when no #d= deep link (default: first)
  "designs": [
    { "id": "tag", "label": "Tag", "heavy": false, "description": "A name tag.", "icon": "branding/tag.svg" }
  ],                              // omit to auto-discover *.scad in source; presets auto-detected as <id>.json
  "assets": ["lib"],              // files/dirs to bundle verbatim, preserving paths

  // ── Rendering ──────────────────────────────────────────────────────
  "features": ["textmetrics"],    // OpenSCAD --enable flags for every render
  "format": "3mf",                // export/preview format: "3mf" (colour) or "stl"; default "3mf"
  "fonts": ["LiberationSans-Regular.ttf"],  // fonts to mount; a basename already in public/fonts/, or a path into `source` to bundle
  "fontFallback": "Liberation Mono",  // optional deterministic last-resort family (must be bundled)
  "render": {                     // optional render tuning (see "Render tuning" below)
    "heavyMs": 6000,              // auto-pause live re-render above this many ms
    "cache": { "maxEntries": 16, "persistent": true }
  },

  // ── Appearance & UI behaviour ──────────────────────────────────────
  "logo": "logo.svg",             // header logo (omit for text title)
  "colors": {                     // optional per-theme colour-scheme overrides
    "dark":  { "accent": "#ff7849", "viewer-model": "#ff7849" },
    "light": { "accent": "#b8430f" }
  },
  "extraCss": "theme.css",        // optional raw-CSS escape hatch (advanced)
  "ui": {                         // optional UI behaviour (see "UI behaviour" below)
    "panelSide": "left",          // desktop dock edge: "left" | "right"
    "panelDefault": "open",       // first-load desktop panel: "open" | "collapsed"
    "outputDefault": "closed",    // OpenSCAD output console: "closed" | "open"
    "install": "auto",            // PWA install affordance: "auto" | "off"
    "showVarName": true,          // show OpenSCAD variable names by parameters: true | false
    "measure": true,              // viewer measure (dimensions) toggle: true | false
    "viewPicker": true,           // viewer view picker (camera angles): true | false
    "reset": true,                // viewer "reset view" button: true | false
    "zoom": false,                // viewer zoom in/out buttons: true | false (default false)
    "fullscreen": true,           // viewer fullscreen toggle: true | false (default true)
    "presetsLabel": "Presets",    // label for the Presets tab/section
    "parametersLabel": "Parameters" // label for the Parameters tab/section
  },
  "fileImport": true,             // optional "Import file" button for user-supplied files

  // ── In-app content ─────────────────────────────────────────────────
  "popup": { "header": "…", "body": "…", "mode": "once" },  // optional notice dialog on load
  "help": { "sections": [ { "title": "…", "body": "…" } ] },  // optional Help content (single pane or tabs)
  "notices": [                    // design-defined log markers -> count badges (off by default)
    { "marker": "alert", "label": "alerts", "color": "#e0a458" },
    { "marker": "note",  "label": "notes",  "color": "#86a9ff" }
  ],
  "licenses": [ { "name": "…", "license": "…", … } ]  // optional extra open-source notices (appended)
}
```

**App identity & PWA**

- **`title`** / **`logo`** — see [Title & logo](#title--logo).
- **`id`** — namespaces localStorage, IndexedDB, and preset cache. Defaults to `"scadpub"`.
- **`description`** / **`shortName`** / **`icon`** / **`themeColor`** / **`backgroundColor`** — `<meta>` and PWA manifest fields. `gen-schema` generates `public/manifest.webmanifest` and `public/icon.svg`.
- **`lang`** / **`dir`** — document + manifest language (a BCP-47 tag, default `"en"`) and text direction (`"ltr"` (default), `"rtl"`, or `"auto"`). Emitted onto `<html lang dir>` and into the manifest.
- **`themeColorLight`** / **`categories`** / **`iconMaskable`** / **`screenshots`** / **`shortcuts`** — see [UI behaviour & PWA](#ui-behaviour--pwa).

**Design sources**

- **`source`** — directory of Customizer-style `.scad` designs, relative to this config file. Defaults to `"."`.
- **`designs`** — explicit list with id, label, optional `file`. Omit to auto-discover. Set `"heavy": true` to start a design in manual-render mode. Each entry also takes an optional **`description`** (a short line shown under the label in the design picker) and **`icon`** (a path, relative to the config file like `logo`, shown in the picker and used as the design's manifest shortcut icon). The `icon` may be an **SVG, PNG, or WebP** — it's served as-is (not rasterized); for a PNG the build reads its pixel dimensions so the manifest shortcut advertises the real `sizes`. Both `description` and `icon` fall back to the design's own [`// @description` / `// @icon` annotations](annotations.md#design-metadata--description--icon) when omitted here, so a design can carry them in its `.scad` (a config value still wins).
- **`defaultDesign`** — optional design `id` shown on a visit that carries no `#d=` deep link (a saved session or hash still wins). Must name a configured design; defaults to the first.
- **`assets`** — files/directories to copy verbatim. If omitted, `gen-schema` follows each design's `use`/`include` graph.
- **Bundled presets** are auto-detected: a `<design>.json` file beside `<design>.scad` is bundled automatically and appears read-only under "Bundled" in the preset picker.

**Rendering**

- **`features`** — applied to all designs as `--enable=<feature>`.
- **`format`** — the model format OpenSCAD exports and the viewer parses, fixed at build time. `"3mf"` (the default) carries per-object colour from each design's `color(...)` calls — shown in the preview and written into the exported file. `"stl"` is geometry-only (no colour). Changing it invalidates the render cache automatically.
- **`fonts`** / **`fontFallback`** — see [Fonts](#fonts-fonts-fontfallback).
- **`render`** — optional render tuning (heavy-render threshold + cache sizing); see [Render tuning](#render-tuning-render).

**Appearance & UI behaviour**

- **`colors`** — optional per-theme CSS colour overrides; see [Theme & colour scheme](#theme--colour-scheme).
- **`extraCss`** — optional raw-CSS escape hatch for advanced restyling; see [Custom CSS](#custom-css-extracss).
- **`ui`** — see [UI behaviour & PWA](#ui-behaviour--pwa).
- **`fileImport`** — see [Import file button](#import-file-fileimport).

**In-app content**

- **`popup`** — optional notice dialog shown over the app on load. See [Popup notice](#popup-notice-popup).
- **`help`** — `{ title?, intro?, sections?: [{ title, body }], tabs?: [{ label, intro?, sections }] }` where `body` is a Markdown subset (`**bold**`, `` `code` ``, `[text](url)`, blank-line paragraphs, `- ` bullets). Use `sections` for a single pane, or `tabs` for a tabbed guide (many tabs supported). Omit for a generic default. See [Help content](#help-content-help).
- **`notices`** — see [Notice badges](#notice-badges-notices).
- **`licenses`** — optional list of extra third-party software/license notices, **appended** to the app's built-in open-source attributions in the ⓘ panel (the built-ins are never removed). See [Open-source notices](#open-source-notices-licenses).

Missing `source`, `assets`, design, `logo`, or design-`icon` paths fail the build with a clear error. So does an **unknown top-level key** — a whole-key typo like `"popups"` or `"fontfallback"` fails the build rather than being silently ignored (add a `"$schema"` key for editor tooling if you want; it's allowed).

## Title & logo

- **`title`** — browser tab title and header text.
- **`logo`** — path relative to the config file; shown in the header instead of the title text. The `title` is still used for `document.title` and the logo's `alt`. Provide per-theme variants:

  ```jsonc
  { "logo": { "light": "branding/logo-light.svg", "dark": "branding/logo-dark.svg" } }
  ```

  A single string applies to both themes. In the object form, a missing side falls back to the other.

## Theme & colour scheme

A consumer project can recolour the whole app from its config with the optional
**`colors`** block — no fork or CSS edit required:

```jsonc
{
  "colors": {
    "dark":  { "accent": "#ff7849", "accent-solid": "#e8551f", "viewer-model": "#ff7849" },
    "light": { "accent": "#b8430f", "accent-solid": "#c2410c" }
  }
}
```

- Each key is a CSS token from the table below, **without** the leading `--`.
- Each value is a plain CSS value. For the colour tokens that's a colour
  (`#rrggbb`, `rgb()/rgba()`, `hsl()/hsla()`, a named colour); the design tokens
  take their own units (a length for `radius`/`radius-sm`, a `box-shadow` for
  `elevation`). Values containing `;`/`{`/`}` are rejected so a config can't break
  the generated stylesheet.
- `light` and `dark` are independent; omit either to leave that theme at its
  default, and omit any token to keep its built-in value.
- An unknown token name fails the build (it's almost always a typo).

`gen-schema` validates the block and records it in `designs.json`; `vite.config.ts`
emits it as a `<style>` override at build time, so there's no runtime cost or flash.
The 3D viewer reads its colours from the same CSS variables, so `viewer-*` overrides
apply automatically.

> **Accessibility:** ScadPub ships AA-compliant palettes. If you override colours,
> re-verify contrast (`npm run smoke` — 0 serious/critical axe-core violations).

The full set of tokens (defined in [`src/index.css`](../src/index.css)):

```css
:root { /* dark — the default */
  --accent: #86a9ff;
  --accent-solid: #2f55ff;
  --on-accent: #ffffff;
  /* --bg, --panel, --panel-2, --line, --text, --muted, --focus, --link, --warn,
     --code-bg, --overlay, --glass-bg, --glass-border, --elevation,
     --radius, --radius-sm, --viewer-bg/-grid/-grid-2, --viewer-model */
}
:root[data-theme="light"] {
  --accent: #1d4ed8;
  --accent-solid: #1f3df5;
  /* … */
}
```

| Token | Controls |
|-------|----------|
| `--bg` / `--panel` / `--panel-2` | app, panel, and inset backgrounds |
| `--line` | borders and dividers |
| `--text` / `--muted` | primary and secondary text |
| `--accent` | accent text/icons: group headers, carets, notice icon, spinner |
| `--accent-solid` | filled accent surfaces: primary button, badges |
| `--on-accent` | text on `--accent-solid` (usually white) |
| `--focus` | keyboard focus ring |
| `--link` | hyperlinks |
| `--warn` | warning text/icons |
| `--code-bg` | code and log backgrounds (output console, inline code) |
| `--overlay` | modal/dialog scrim backdrop |
| `--glass-bg` / `--glass-border` | translucent "glass" surfaces: command bar, sheets, viewer HUD |
| `--elevation` | drop shadow on raised surfaces (a `box-shadow`, not a colour) |
| `--radius` / `--radius-sm` | corner radius, base and small (a length, not a colour) |
| `--font-sans` / `--font-display` | UI font stacks: body text / the display voice (brand, headings, tabs, buttons). Unquoted family names only (e.g. `Georgia, serif`); set them under `dark` (the `:root` block) to apply to both themes |
| `--viewer-bg` / `--viewer-grid` / `--viewer-grid-2` | 3D preview background and grid |
| `--viewer-model` | rendered model material colour |

`--accent` and `--accent-solid` are separate tokens because the same colour rarely passes WCAG AA both as small text on `--panel` and as a filled button background.

After changing colours, regenerate baselines and re-verify contrast:

```bash
npm run vis -- --update   # regenerate visual-regression baselines
npm run smoke             # axe-core run; 0 serious/critical = AA holds
```

## Custom CSS (`extraCss`)

When the `colors` token map isn't enough — you want different spacing, fonts,
border-radius, logo sizing, etc. — `extraCss` is a full escape hatch: a path to a
stylesheet (relative to the config file) that ships verbatim and loads **after**
the app's own styles, so it can override anything.

```jsonc
{ "extraCss": "branding/theme.css" }
```

```css
/* branding/theme.css */
.topbar { padding: 0.4rem 1.5rem; }
.param-group { border-radius: 14px; }
.brand-logo { height: 2.2rem; }
:root { --radius: 10px; }   /* you can still set custom properties here too */
```

`gen-schema` copies the file into the served tree (under the gitignored, auto-wiped
`public/scad/`, so it never goes stale or gets committed) and records its URL;
`vite.config.ts` injects a `<link>` after the bundled CSS. Because it loads last,
your rules win on source order — no specificity hacks needed.

> **This is an unsupported, advanced escape hatch — use `colors` first.** Unlike
> the token map, `extraCss` targets internal class names (`.param-panel`,
> `.param-group`, `.action-cluster`, …). Those are **not a stable API**:
> a future refactor can rename or restructure them and silently break your
> overrides. It is also **outside the accessibility guarantees** — you can hide
> focus rings, break contrast, or disturb layout. If you use it, pin the ScadPub
> version you build against and re-run `npm run smoke` (0 serious/critical
> axe-core violations) after changes. Prefer `colors` for anything it can express.

Load order, last wins: app bundle CSS → `colors` `<style>` → `extraCss` `<link>`.

## Import file (`fileImport`)

Designs sometimes need a file the app can't bundle — a license-restricted font, an SVG to `import()`, a `surface()` data file, etc. Setting `fileImport` adds a single **Import file** button to the preset panel that lets the user supply any such file at runtime, entirely client-side (nothing is uploaded to a server).

```jsonc
{
  // Shorthand: enable with defaults (accepts any file type).
  "fileImport": true

  // …or an options object:
  "fileImport": {
    "accept": ".svg,.ttf,.otf",  // optional: file-picker filter (omit to accept any file)
    "label": "Import file",      // optional: button label (default "Import file")
    "note": "…",                 // optional: help text shown above the file list (Markdown)
    "maxBytes": 5242880          // optional: reject uploads larger than this (bytes)
  }
}
```

When **`maxBytes`** is set, an upload larger than the cap is rejected with a friendly toast (showing the file's size and the limit) and is never stored; omit it for no cap.

`note` is rendered as a small Markdown subset (paragraphs, `- ` bullet lists, `**bold**`, `` `code` ``, and `[links](url)`) — the same renderer used for help and popup content.

**How uploads are made available to OpenSCAD** — decided automatically by file extension, so one button covers both cases:

- **Fonts** (`.ttf`/`.otf`/`.ttc`) are mounted where the renderer's fontconfig can find them, so `text(font = "…")` can use them. They're matched by their **embedded family name**, not the filename — so a renamed file still resolves.
- **Any other file** is mounted at the render filesystem **root**, so a design can reference it by name, e.g. `import("logo.svg")` or `surface("data.dat")`. The reference must match the uploaded file's name (use `note` to tell users which name to use).

Uploaded files persist in IndexedDB and are re-applied on the next visit; the panel lists what's currently loaded, with a **Clear** button to remove them all. Importing or clearing files drops the render cache (in-memory and persistent) so no stale geometry is served. Omit `fileImport` (or set it to `null`/`false`) and no import button is shown.

## Fonts (`fonts`, `fontFallback`)

`fonts` lists the font files the renderer bundles and mounts (a basename already in `public/fonts/`, or a path into `source` to copy one in). Their embedded family and style names are read at build time, so the app knows the authoritative available set — and can name each face the way a user knows it.

A string or enum (dropdown) parameter annotated `// @font` (see [annotations](annotations.md#font-selectors--font)) renders as a **font dropdown** listing every face the renderer can actually use (bundled **∪** any imported fonts) under friendly names ("Liberation Sans Bold" — never the raw Fontconfig `Family:style=Style` string), with imported faces labelled as such and an **Import font…** action at the bottom; the list updates the moment a font is imported. Faces the design suggests (or the current value names) that are **not** loaded stay visible and selectable in a marked "Needs a font file" group, and while the selected family isn't loaded the control also shows a non-alarming inline hint with **Import font…** and a one-click **Use \<available family\>** fallback — so availability is known immediately, without needing a render to find out. (A family that *is* loaded never warns.)

```jsonc
{
  // Bundle the fallback face too — fontFallback must name a family you bundle.
  "fonts": ["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf", "LiberationMono-Regular.ttf"],
  "fontFallback": "Liberation Mono"  // optional, see below
}
```

**`fontFallback`** (optional) pins a deterministic last-resort family in the generated `fonts.conf`. Without it, once a user imports a font, Fontconfig can pick that font as the global default for any *unmatched* family — making OpenSCAD's own substitution unpredictable. Set `fontFallback` to a **bundled** family that you **don't** offer as a selectable lettering choice (e.g. a monospace face), and any absent family deterministically falls back to it instead. Omit it for the default (no fallback rule).

## Render tuning (`render`)

An optional build-time object that tunes rendering behaviour. Every field is optional; the app keeps its built-in default for any you omit. None affect geometry, so `render` is absent from `renderHash` (changing it doesn't invalidate cached renders).

```jsonc
{
  "render": {
    "heavyMs": 6000,       // auto-pause threshold (ms); default ≈ 6000
    "cache": {
      "maxEntries": 16,    // in-memory (L1) slot count; default 16
      "maxBytes": 67108864,    // in-memory (L1) total budget; default derived from device memory
      "maxEntryBytes": 33554432,  // largest single render that may be cached
      "persistent": true   // persist renders to IndexedDB (L2); default on where available
    }
  }
}
```

- **`heavyMs`** — when a *live* (auto-render) pass takes longer than this, auto-render pauses for that design and the user renders on demand with **Render now** (designs flagged `"heavy": true` start paused regardless). Raise it for a fast machine, lower it to pause sooner.
- **`cache`** — sizes the runner's two-tier render cache: `maxEntries` / `maxBytes` bound the in-memory L1 (slot count / total bytes), `maxEntryBytes` caps the largest single render that's worth caching, and `persistent` toggles the IndexedDB L2 store (set `false` to render fresh each session / for privacy-sensitive deployments).

## Popup notice (`popup`)

Show a one-off notice dialog over the app on load — a welcome message, a usage caveat, a link to docs or to where a required font/license can be obtained. It's a build-time setting; all copy is config-driven, so the app stays project-agnostic. Omit `popup` (the default) and nothing is shown.

```jsonc
{
  "popup": {
    "header": "Welcome to Tag Studio",          // required: dialog title
    "body": "Configure a nameplate and export a 3MF.\n\nSee the [print guide](https://example.com/guide) for material tips.",  // required
    "mode": "once"                               // optional: "always" | "once" | "dismissible" (default "once")
  }
}
```

- **`header`** — the dialog title.
- **`body`** — the message, in the same Markdown subset used elsewhere (`**bold**`, `` `code` ``, `[text](url)` links, blank-line paragraphs, `- ` bullet lists). Links open in a new tab.
- **`mode`** — how often the popup appears:
  - **`always`** — shown on every visit. No opt-out.
  - **`once`** (default) — shown on the first visit only; dismissing it (the **OK** button, the ✕, Escape, or clicking outside) remembers it so it won't return.
  - **`dismissible`** — shown on every visit until the user ticks **Don't show this again**; closing without ticking the box shows it again next time.

The remembered state is namespaced by the configurator's `id` and keyed by the popup's content, so changing the `header`/`body`/`mode` in a later deploy re-shows the notice to returning users. It's purely informational and doesn't affect renders, so it never invalidates the geometry cache.

## UI behaviour & PWA

### `ui`
An optional object (validated as a unit; defaults applied when absent). None of these affect geometry, so they never invalidate the render cache.

- **`panelSide`** — `"left"` (default) or `"right"`: which edge the desktop parameter panel docks against.
- **`panelDefault`** — `"open"` (default) or `"collapsed"`: the first-load desktop panel state (the user's later choice persists per browser).
- **`outputDefault`** — `"closed"` (default) or `"open"`: whether the OpenSCAD output console starts open.
- **`install`** — `"auto"` (default) or `"off"`: when `"off"`, no PWA install affordance is offered even on browsers that support it.
- **`showVarName`** — `true` (default) or `false`: whether each parameter control shows the underlying OpenSCAD variable name beside its label. Shown as visually-secondary monospace text; set `false` to hide it.
- **`measure`** — `true` (default) or `false`: whether the viewer offers the measure (dimensions) toggle — the ruler button that draws the W×D×H overlay and shows the measurements/`@info` panel. Set `false` to hide the button entirely (the overlay and panel are only reachable through it).
- **`viewPicker`** — `true` (default) or `false`: whether the viewer offers the view picker — the cube button whose menu snaps the camera to standard angles (Isometric, Top, Front, …). Set `false` to hide it.
- **`reset`** — `true` (default) or `false`: whether the viewer offers the "reset view" button (re-frames the model in the current view). Mouse/touch orbit and zoom still work regardless.
- **`zoom`** — `false` (default) or `true`: whether the viewer offers the zoom in/out buttons. Off by default since mouse-wheel / pinch zoom already works; set `true` to show the two buttons.
- **`fullscreen`** — `true` (default) or `false`: whether the viewer offers the fullscreen toggle. It only ever appears in a browser tab whose browser supports the Fullscreen API (never in an installed PWA, which is already its own window); set `false` to suppress it even there.
- **`presetsLabel`** — string (default `"Presets"`): the label shown for the Presets tab/section (the mobile sheet tab, the desktop presets dropdown, and the presets popover title).
- **`parametersLabel`** — string (default `"Parameters"`): the label shown for the Parameters tab/section (the mobile sheet tab and the desktop parameter panel).

### PWA manifest

`gen-schema` writes `public/manifest.webmanifest` (always including a `launch_handler` so an already-open install is reused rather than re-launched). When the optional `@resvg/resvg-js` rasterizer is installed it also rasterizes the `icon` SVG to PNGs (192/512, a 512 maskable, and a 180 `apple-touch-icon`) and generates the per-device iOS launch images (`apple-touch-startup-image`); without it the PNGs fall back to the SVG and the iOS splash images are skipped. The following keys feed the manifest:

- **`themeColorLight`** — light-scheme `<meta name="theme-color">` (default `"#ffffff"`); the dark value comes from `themeColor`.
- **`categories`** — optional array of [manifest categories](https://developer.mozilla.org/docs/Web/Manifest/categories).
- **`iconMaskable`** — optional separate SVG (safe-zone padded) for the maskable icon; defaults to `icon`.
- **`screenshots`** — optional `[{ src, sizes, form_factor, label?, platform? }]` for the richer Android install UI (`form_factor`: `"wide"` or `"narrow"`; `label` is the accessible caption; `platform` targets a store listing). `label`/`platform` are passed through to the manifest when present.
- **`shortcuts`** — optional `[{ name, short_name?, url, icons? }]` app shortcuts (Android long-press / desktop jump list); `icons` (an array of `{ src, sizes?, type? }`) is passed through when supplied. If omitted and the config has **more than one design**, a shortcut per design is derived automatically, deep-linking to it (`./#d=<id>`) and carrying that design's `icon` (if it has one).

## Notice badges (`notices`)

The collapsible **OpenSCAD output** panel below the preview can show count badges for non-fatal messages your designs emit. A design surfaces a message by `echo`-ing a string in the convention `"<context>: <marker>: <message>"`, where `<marker>` is any word **you** choose — there is nothing special about any particular marker. For example:

```scad
echo("tag: alert: the label text is tall and may overflow the plate");
echo("tag: note: the label is engraved into the plate rather than raised");
```

`notices` is the build-time list of marker categories to recognise. Each matched echo becomes a friendly message in the console's **Notices** tab (with the marker stripped: *"tag: the label text is tall and may overflow the plate"*) and increments a coloured count badge on that tab.

```jsonc
{
  "notices": [
    { "marker": "alert", "label": "alerts", "color": "#e0a458" },
    { "marker": "note",  "label": "notes",  "color": "#86a9ff" }
  ]
}
```

- **`marker`** — required. The design-defined word, matched as `: <marker>:` inside an echo (case-insensitive). The first configured category that matches a line claims it.
- **`label`** — optional badge noun (e.g. `"alerts"`). Defaults to the `marker`.
- **`color`** — optional badge fill, a plain CSS colour (hex, `rgb()/hsl()`, or a named colour). For `#rgb`/`#rrggbb` the badge text auto-switches between black and white to stay legible; other colour forms keep the default badge text, so their contrast is your responsibility (as with [`colors`](#theme--colour-scheme)). Omit to use the default accent badge styling.

**Off by default:** omit `notices` (or set it to `[]`) and no marker categories are recognised — design echoes appear only in the raw log. The bundled example config (`scadpub.config.json`) opts in with `alert` and `note` categories, and the example `tag` design echoes them in specific, parameter-driven situations so you can see the badges appear.

> **Hardcoded, not configurable:** OpenSCAD's own `WARNING:` lines surface as warning messages, and `assert()` failures (`ERROR: Assertion …`) surface as a message **and** an `asserts` count badge. These work regardless of `notices`.

## Help content (`help`)

The **Help** dialog (the **?** button) is generated from `help`. Omit it for a generic, project-agnostic default; supply it to document your own designs. `body` (and `intro`) use the same Markdown subset as everywhere else: `**bold**`, `` `code` ``, `[text](url)`, blank-line paragraphs, and `- ` bullets.

An optional **`title`** sets the dialog heading (default `"How to use this configurator"`).

**Single pane** — a flat list of sections (the original form):

```jsonc
{
  "help": {
    "title": "User guide",                             // optional dialog heading
    "intro": "Configure a design and export a 3MF.",   // optional, shown at the top
    "sections": [
      { "title": "1. Pick a design", "body": "Use the **Design** dropdown…" },
      { "title": "2. Adjust parameters", "body": "The left panel lists…" }
    ]
  }
}
```

**Tabs** — group the guide into many tabs, each with its own content. Add a `tabs` array; a tab strip appears and each tab has a `label`, an optional `intro`, and its own `sections`:

```jsonc
{
  "help": {
    "intro": "Shown once above every tab.",   // optional shared intro
    "tabs": [
      {
        "label": "Getting started",
        "intro": "The basics.",               // optional per-tab intro
        "sections": [
          { "title": "Pick a design", "body": "Use the **Design** dropdown…" }
        ]
      },
      {
        "label": "Printing tips",
        "sections": [
          { "title": "Material", "body": "**PLA** works well." },
          { "title": "Supports", "body": "Usually none are needed." }
        ]
      }
    ]
  }
}
```

- Any number of tabs is supported; the strip is keyboard-navigable (arrow keys / Home / End) per the ARIA tabs pattern.
- A top-level `intro` renders once above the tab strip; a per-tab `intro` renders above that tab's sections.
- If you supply **both** top-level `sections` and `tabs`, the top-level sections become a leading **Overview** tab — so adding `tabs` to an existing single-pane help never drops the original content. To control every label yourself, put all content inside `tabs` and leave top-level `sections` out.

## Open-source notices (`licenses`)

The **ⓘ** button lists the third-party components ScadPub itself bundles (OpenSCAD-WASM, React, three.js, Liberation fonts) with their licenses and source links. If your deployment bundles **additional** software — an extra `.scad` library, a custom font, a vendored script — add its notice here. Entries are **appended** to the built-in list; ScadPub's own attributions are never removed.

```jsonc
{
  "licenses": [
    {
      "name": "Acme Widget Library",        // required: component name
      "license": "MIT",                      // required: SPDX identifier
      "copyright": "Copyright (c) 2024 Acme Corp",  // required
      "url": "https://example.com/acme",     // required: project homepage
      "licenseUrl": "https://example.com/acme/LICENSE",  // required: where the license lives
      "version": "3.1",                      // optional
      "sourceUrl": "https://example.com/acme/src",  // optional (required by copyleft licenses)
      "text": "MIT License\n\n…",            // optional: full license text, shown in a details panel
      "note": "Bundled helper geometry."     // optional: one-line description
    }
  ]
}
```

- `name`, `license`, `copyright`, `url`, and `licenseUrl` are required; the rest are optional. Unknown keys are ignored.
- Provide `sourceUrl` for copyleft (e.g. GPL) components so the corresponding-source requirement is met. Provide `text` to reproduce a permissive license inline.
- A malformed entry fails the build with a clear message.
