<!--
meta.contentType: Reference
content plan: show a representative config, define each top-level key by surface, and link related annotation and runtime behavior.
-->

# Configuration reference

`scripts/gen-schema.mjs` reads `scadpub.config.json`. Set `SCADPUB_CONFIG` to read a different config file.

This representative config shows the major surfaces. The sections below define every key:

```jsonc
{
  "title": "ScadPub",             // page/header title
  "id": "scadpub",                // namespaces browser storage (default "scadpub")
  "description": "Configure …",   // page <meta> + PWA description
  "icon": "branding/icon.svg",    // PWA/favicon icon
  "themeColor": "#1f2229",        // browser-chrome / PWA colour
  "source": "examples",           // directory of .scad designs (relative to this file)
  "designs": [
    { "id": "tag", "label": "Tag", "heavy": false, "description": "A name tag.", "icon": "branding/tag.svg" }
  ],                              // omit to auto-discover *.scad in source; presets auto-detected as <id>.json
  "assets": ["lib"],              // files/dirs to bundle verbatim, preserving paths
  "features": ["textmetrics"],    // OpenSCAD --enable flags for every render
  "format": "3mf",                // export/preview format: "3mf" (colour) or "stl"; default "3mf"
  "restOnGrid": false,            // rest the model's base on the z=0 grid instead of centring in Z; default false
  "fileImport": true              // optional "Import file" button
}
```

## Top-level keys

The top-level keys map to app identity, design discovery, rendering, appearance, and in-app content.

### App identity and PWA

These keys set the document chrome and the Progressive Web App (PWA) manifest:

- **`title`** / **`logo`**: see [Title and logo](#title-and-logo)
- **`id`**: namespaces localStorage, IndexedDB, and preset cache. Defaults to `"scadpub"`
- **`description`** / **`shortName`** / **`icon`** / **`themeColor`** / **`backgroundColor`**: `<meta>` and PWA manifest fields. `gen-schema` generates `public/manifest.webmanifest` and `public/icon.svg`
- **`lang`** / **`dir`**: document and manifest language (a BCP-47 tag, default `"en"`) and text direction (`"ltr"` by default, `"rtl"`, or `"auto"`). ScadPub emits them onto `<html lang dir>` and into the manifest
- **`themeColorLight`** / **`categories`** / **`iconMaskable`** / **`screenshots`** / **`shortcuts`**: see [UI behaviour and PWA](#ui-behaviour-and-pwa)

### Design sources

These keys tell `gen-schema` which `.scad` files and assets to bundle:

- **`source`**: directory of Customizer-style `.scad` designs, relative to this config file. Defaults to `"."`
- **`designs`**: explicit list with id, label, and optional `file`. Omit it to auto-discover designs. Set `"heavy": true` to start a design in manual-render mode
- **`defaultDesign`**: optional design `id` shown on a visit that carries no `#d=` deep link. A saved session or hash still wins. Must name a configured design; defaults to the first
- **`assets`**: files or directories to copy verbatim. If omitted, `gen-schema` follows each design's `use`/`include` graph
- **Bundled presets** are auto-detected: a `<design>.json` file beside `<design>.scad` is bundled automatically and appears read-only under "Bundled" in the preset picker.

Each `designs[]` entry also accepts optional `description`, `icon`, `image`, and `doc` fields. `description` is the short line shown under the label in the design picker. `icon` is a path relative to the config file, shown in the picker and used as the design's manifest shortcut icon. The icon may be an SVG, PNG, or WebP file. ScadPub serves SVG/WebP as-is. For PNG, the build reads the pixel dimensions so the manifest shortcut advertises the real `sizes`. `image` is a path (same formats, same config-relative resolution) to picker-card artwork — a real photo or render of the model — shown by the [card-grid design picker](#ui-behaviour-and-pwa) (`ui.gallery`); `icon` stays the small glyph used everywhere else (the classic dropdown, the manifest shortcut) and is never replaced by `image`. An easy way to produce one: the app's own **Image** snapshot button on a rendered design, or a still from `npm run screens`. `doc` is a path (also config-relative) to a Markdown file of user documentation; when present, the app shows a button that opens it in a modal.

All four fall back to the design's own [`// @description` / `// @icon` / `// @image` / `// @doc` annotations](annotations.md#design-metadata--description--icon--image--doc) when omitted here. A config value still wins.

### Rendering

These keys affect render arguments, bundled fonts, and cache behavior:

- **`features`**: applied to all designs as `--enable=<feature>`
- **`format`**: the model format OpenSCAD exports and the viewer parses, fixed at build time. `"3mf"` is the default and carries per-object colour from each design's `color(...)` calls. `"stl"` is geometry-only. Changing it invalidates the render cache automatically
- **`restOnGrid`**: how the viewer frames a loaded model, fixed at build time. `false` (the default) centres the model on the origin in all three axes, as it always has. `true` centres it in X/Y but rests its base on the `z=0` grid plane, which suits designs modelled with their base on `z=0` (as OpenSCAD designs typically are) where centring in Z would sink them half-way through the grid. Display-only: it does not change the exported file or the render cache
- **`fonts`** / **`fontFallback`**: see [Fonts](#fonts-fonts-fontfallback)
- **`render`**: optional render tuning for the heavy-render threshold and cache sizing. See [Render tuning](#render-tuning-render)

### Appearance and UI behaviour

These keys control branding, theme overrides, and interactive controls:

- **`colors`**: optional per-theme Cascading Style Sheets (CSS) colour overrides. See [Theme and colour scheme](#theme-and-colour-scheme)
- **`extraCss`**: optional raw-CSS escape hatch for advanced restyling. See [Custom CSS](#custom-css-extracss)
- **`ui`**: see [UI behaviour and PWA](#ui-behaviour-and-pwa)
- **`fileImport`**: see [Import file button](#import-file-fileimport)

### In-app content

These keys add copy and third-party notices to the generated app:

- **`popup`**: optional notice dialog shown over the app on load. See [Popup notice](#popup-notice-popup)
- **`help`**: optional Help dialog content. Use `sections` for a single pane or `tabs` for a tabbed guide. Omit it for a generic default. See [Help content](#help-content-help)
- **`notices`**: see [Notice badges](#notice-badges-notices)
- **`licenses`**: optional list of extra third-party software/license notices. ScadPub appends them to the built-in open-source attributions in the ⓘ panel. See [Open-source notices](#open-source-notices-licenses)
- **`strings`**: optional per-deployment overrides of the built-in UI text. See [Localization](#localization-strings)

Missing `source`, `assets`, design, `logo`, or design-`icon`/`image` paths fail the build with a clear error. An **unknown top-level key** also fails the build. A whole-key typo like `"popups"` or `"fontfallback"` fails rather than being silently ignored. Add a `"$schema"` key for editor tooling if you want; it is allowed.

## SVG asset trust model

ScadPub builds a static site from **your own** OpenSCAD designs and config
(`source`, `assets`, `logo`, `icon`, `iconMaskable`, `screenshots`, design
`icon`/`doc`, `extraCss`, bundled fonts, …). Every one of those paths is
**trusted operator input** — the same trust you already extend to any script
or dependency you add to your own build. `gen-schema` is not a sandbox: it
does not, and is not intended to, defend the app against a *malicious*
`.scad`/`.svg`/`.json` file in your own `source` or config tree.

If you want to host designs or assets supplied by people you don't trust as
much as your own build (e.g. user-submitted `.scad` files), that is **out of
scope for ScadPub as shipped** and needs its own isolation boundary in front
of it — for example, a review/moderation step before a file ever reaches
`source`, or building/serving untrusted designs from a separate, sandboxed
deployment (different origin, no shared cookies/storage) rather than mixing
them into a trusted operator's site. The in-browser OpenSCAD-WASM sandbox
protects the *renderer* from a hostile `.scad` file (it can't reach the
network or the filesystem outside its mount); it says nothing about assets
that are served as-is and rendered by the *browser* — see below.

**What this means concretely for SVGs.** `gen-schema` copies two different
kinds of SVG into the served output, and treats them differently:

- **Render-input SVGs** — files reached via `assets` or a design's
  `use`/`include` graph, copied byte-for-byte into `public/scad/` because
  OpenSCAD's `import()`/`surface()` reads them as path/geometry data. These
  are never modified by the build: rewriting bytes here risks silently
  changing what gets rendered. They're safe in that role (import/surface read
  geometry, not markup), but they are also served as a plain static file at a
  guessable `/scad/...` URL. A browser that's ever navigated to that URL
  *directly* (as opposed to used inside the app's `<img>`/`<use>`/canvas
  context) would load the SVG as an active HTML-like document and could
  execute a `<script>` it contains, in the app's own origin. This is why
  `public/_headers` locks down `/scad/*` with a restrictive
  `Content-Security-Policy` and `X-Content-Type-Options: nosniff` (see the
  comment there) — defense-in-depth against exactly that direct-navigation
  case, without touching the geometry.
- **Browser-facing SVGs** — the app `logo`, the PWA `icon`, and each design's
  picker `icon` — are only ever displayed, never read as geometry. `gen-schema`
  runs these through a minimal sanitizer
  (`scripts/lib/svg-sanitize.mjs`) before writing them: it strips
  `<script>`/`<foreignObject>` elements, `on*` event-handler attributes, and
  any `href`/`xlink:href` carrying a URI scheme (`javascript:`, `data:`,
  `http(s):`, …). This is regex-based, not a full XML sanitizer — it is a
  second layer on top of the operator-trust boundary above, not a substitute
  for it, and it does not attempt to sanitize `iconMaskable` source pixels or
  anything under `public/scad/` (see above).

**Deployment-target caveat.** `public/_headers` is the Cloudflare Pages /
Netlify custom-headers convention. **GitHub Pages serves no custom response
headers at all** and silently ignores `_headers` — if you deploy there, the
CSP/`nosniff` layer described above does not apply, and the SVG sanitization
above is your only defense-in-depth layer for `logo`/`icon` assets (render-
input SVGs under `/scad/` get none). This is one more reason the trust model
above is load-bearing: on GitHub Pages, treat everything under `source` and
every config-referenced path as fully trusted, full stop.

## Title and logo

These keys control the browser title and the brand shown in the app header:

- **`title`**: browser tab title and header text
- **`logo`**: path relative to the config file. The app shows it in the header instead of the title text. The `title` is still used for `document.title` and the logo's `alt`. Provide per-theme variants:

  ```jsonc
  { "logo": { "light": "branding/logo-light.svg", "dark": "branding/logo-dark.svg" } }
  ```

  A single string applies to both themes. In the object form, a missing side falls back to the other.

## Theme and colour scheme

A consumer project can recolour the whole app from its config with the optional **`colors`** block. No fork or CSS edit is required:

```jsonc
{
  "colors": {
    "dark":  { "accent": "#ff7849", "accent-solid": "#e8551f", "viewer-model": "#ff7849" },
    "light": { "accent": "#b8430f", "accent-solid": "#c2410c" }
  }
}
```

- Each key is a CSS token from the table below, **without** the leading `--`.
- Each value is a plain CSS value. Colour tokens accept `#rrggbb`, `rgb()/rgba()`, `hsl()/hsla()`, or a named colour. Design tokens take their own units, such as a length for `radius` or a `box-shadow` for `elevation`. Values containing `;`, `{`, or `}` are rejected so a config cannot break the generated stylesheet.
- `light` and `dark` are independent. Omit either to leave that theme at its default, and omit any token to keep its built-in value.
- An unknown token name fails the build (it's almost always a typo).

`gen-schema` validates the block and records it in `designs.json`. `vite.config.ts` emits it as a `<style>` override at build time, so there is no runtime cost or flash. The 3D viewer reads its colours from the same CSS variables, so `viewer-*` overrides apply automatically.

> **Accessibility:** ScadPub ships AA-compliant palettes. If you override colours,
> re-verify contrast (`npm run smoke`, 0 serious/critical axe-core violations).

The full set of tokens (defined in [`src/index.css`](../src/index.css)):

```css
:root { /* dark is the default */
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

Use `extraCss` when the `colors` token map does not cover your spacing, fonts, border radius, or logo sizing needs. It points to a stylesheet, relative to the config file, that ships verbatim and loads **after** the app's own styles.

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

`gen-schema` copies the file into the served tree under the gitignored, auto-wiped `public/scad/` directory and records its URL. `vite.config.ts` injects a `<link>` after the bundled CSS. Because it loads last, your rules win on source order without specificity hacks.

> **This is an unsupported, advanced escape hatch. Use `colors` first.** Unlike the token map, `extraCss` targets internal class names (`.param-panel`, `.param-group`, `.action-cluster`, …). Those are **not a stable API**: a future refactor can rename or restructure them and silently break your overrides. It is also **outside the accessibility guarantees**: you can hide focus rings, break contrast, or disturb layout. If you use it, pin the ScadPub version you build against and re-run `npm run smoke` after changes. Prefer `colors` for anything it can express.

Load order, last wins: app bundle CSS -> `colors` `<style>` -> `extraCss` `<link>`.

## Import file (`fileImport`)

Designs sometimes need a file the app cannot bundle, such as a license-restricted font, an SVG to `import()`, or a `surface()` data file. Setting `fileImport` turns on the **Files** tab. You can supply those files at runtime, entirely client-side. Nothing is uploaded to a server.

The tab itself is schema-driven: it shows a **font card** when the active design has any `@font` parameter, and an **SVG/graphics card** when it has any `@svg` parameter (see [Annotations](annotations.md)) — each with its own fixed, project-agnostic copy and file-picker filter, so a design that doesn't use one never sees copy about it. If the design's selected font isn't currently loaded, the font card leads with that instead of its usual blurb. A generic **Other files** card is always present underneath for anything else a design references by a plain filename (e.g. a `surface()` data file).

```jsonc
{
  // Shorthand: enable with defaults (the "Other files" card accepts any file type).
  "fileImport": true

  // …or an options object — every field scopes to the "Other files" card only
  // (the font/SVG cards' own copy and filters aren't configurable):
  "fileImport": {
    "accept": ".dat",            // optional: "Other files" file-picker filter (omit to accept any file)
    "label": "Import file",      // optional: "Other files" button label (default "Import file")
    "note": "…",                 // optional: "Other files" help text (Markdown)
    "maxBytes": 5242880          // optional: reject uploads larger than this (bytes), enforced on every card
  }
}
```

When **`maxBytes`** is set, an upload larger than the cap is rejected with a friendly toast (showing the file's size and the limit) and is never stored; omit it for no cap.

`note` is rendered as a small Markdown subset: paragraphs, `- ` bullet lists, `**bold**`, `*emphasis*`, `` `code` ``, and `[links](url)`. It uses the same renderer as help and popup content.

### How uploads reach OpenSCAD

ScadPub chooses the mounting behavior from the file extension, so one button covers both cases:

- **Fonts** (`.ttf`/`.otf`/`.ttc`) are mounted where the renderer's fontconfig can find them, so `text(font = "…")` can use them. They're matched by their **embedded family name**, not the filename, so a renamed file still resolves.
- **Any other file** is mounted at the render filesystem **root**, so a design can reference it by name, e.g. `import("logo.svg")` or `surface("data.dat")`. The reference must match the uploaded file's name (use `note` to tell users which name to use).

Uploaded files persist in IndexedDB and are re-applied on the next visit; the panel lists what's currently loaded, with a **Clear** button to remove them all. Importing or clearing files drops the render cache (in-memory and persistent) so no stale geometry is served. Omit `fileImport` (or set it to `null`/`false`) and no import button is shown.

## Fonts (`fonts`, `fontFallback`)

`fonts` lists the font files the renderer bundles and mounts. Each entry is either a basename already in `public/fonts/` or a path into `source` to copy in. ScadPub reads each embedded family and style name at build time, so the app knows the authoritative available set and can name each face the way you know it.

A string or enum dropdown parameter annotated `// @font` renders as a **font dropdown**. See [Font selectors](annotations.md#font-selectors--font). The dropdown lists every face the renderer can use, including bundled fonts and imported fonts. Friendly names come from the font file, such as "Liberation Sans Bold", never the raw Fontconfig `Family:style=Style` string.

Imported faces are labelled, and the menu includes an **Import font…** action at the bottom. Faces the design suggests, or the current value names, stay visible when they are not loaded. They appear in a "Needs a font file" group. While the selected family is not loaded, the control shows an inline hint with **Import font…** and a one-click **Use \<available family\>** fallback.

```jsonc
{
  // Bundle the fallback face too. fontFallback must name a family you bundle.
  "fonts": ["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf", "LiberationMono-Regular.ttf"],
  "fontFallback": "Liberation Mono"  // optional, see below
}
```

**`fontFallback`** is optional and pins a deterministic last-resort family in the generated `fonts.conf`. Without it, Fontconfig can pick an imported font as the global default for any unmatched family. That makes OpenSCAD's own substitution unpredictable. Set `fontFallback` to a **bundled** family that you **don't** offer as a selectable lettering choice, such as a monospace face. Any absent family falls back to it. Omit it for the default behavior with no fallback rule.

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

- **`heavyMs`**: when a live auto-render pass takes longer than this, auto-render pauses for that design and you render on demand with **Render now**. Designs flagged `"heavy": true` start paused regardless. Raise it for a fast machine, lower it to pause sooner.
- **`cache`**: sizes the runner's two-tier render cache. `maxEntries` and `maxBytes` bound the in-memory L1 cache. `maxEntryBytes` caps the largest single render worth caching. `persistent` toggles the IndexedDB L2 store. Set it to `false` to render fresh each session or for privacy-sensitive deployments.

## Popup notice (`popup`)

Show a one-off notice dialog over the app on load. Use it for a welcome message, a usage caveat, a docs link, or a required font/license link. It is a build-time setting; all copy is config-driven, so the app stays project-agnostic. Omit `popup` and nothing is shown.

```jsonc
{
  "popup": {
    "header": "Welcome to Tag Studio",          // required: dialog title
    "body": "Configure a nameplate and export a 3MF.\n\nSee the [print guide](https://example.com/guide) for material tips.",  // required
    "mode": "once"                               // optional: "always" | "once" | "dismissible" (default "once")
  }
}
```

- **`header`**: the dialog title
- **`body`**: the message, in the same Markdown subset used elsewhere. Links open in a new tab
- **`mode`**: popup frequency:
  - **`always`**: shown on every visit. No opt-out
  - **`once`** (default): shown on the first visit only. Dismissing it with **OK**, the close button, Escape, or outside click remembers it so it will not return
  - **`dismissible`**: shown on every visit until you tick **Don't show this again**. Closing without ticking the box shows it again next time

The remembered state is namespaced by the configurator's `id` and keyed by the popup's content, so changing the `header`/`body`/`mode` in a later deploy re-shows the notice to returning users. It's purely informational and doesn't affect renders, so it never invalidates the geometry cache.

## UI behaviour and PWA

### UI options

The optional `ui` object is validated as a unit, and defaults apply when it is absent. None of these fields affect geometry, so they never invalidate the render cache.

- **`panelSide`**: `"left"` by default, or `"right"`. Controls which edge the desktop parameter panel docks against
- **`panelDefault`**: `"open"` by default, or `"collapsed"`. Sets the first-load desktop panel state. The later browser choice persists
- **`outputDefault`**: `"closed"` by default, or `"open"`. Controls whether the OpenSCAD output console starts open
- **`install`**: `"auto"` by default, or `"off"`. When `"off"`, no PWA install affordance appears, even on browsers that support it
- **`showVarName`**: `false` by default, or `true`. Shows the underlying OpenSCAD variable name beside each parameter label. Hidden by default because it is developer detail; set `true` for a technical audience. Every parameter row always carries a `data-param="<var>"` attribute for smoke tests and `extraCss`
- **`measure`**: `true` by default, or `false`. Controls the viewer measure toggle, the ruler button that draws the W x D x H overlay and shows the measurements/`@info` panel. Set `false` to hide the button entirely
- **`viewPicker`**: `true` by default, or `false`. Controls the cube button whose menu snaps the camera to standard angles. Set `false` to hide it
- **`reset`**: `true` by default, or `false`. Controls the "reset view" button. Mouse/touch orbit and zoom still work regardless
- **`zoom`**: `false` by default, or `true`. Controls the zoom in/out buttons. Mouse-wheel and pinch zoom already work, so the buttons are off by default
- **`fullscreen`**: `true` by default, or `false`. Controls the fullscreen toggle. The button only appears in a browser tab whose browser supports the Fullscreen API. It never appears in an installed PWA, which already has its own window
- **`presetsLabel`**: string, default `"Presets"`. Labels the Presets tab/section, desktop panel tab, and presets popover title
- **`parametersLabel`**: string, default `"Customize"`. Labels the parameters tab/section, desktop parameter panel, and collapsed panel reopen button
- **`gallery`**: `false` by default, or `true`. Replaces the top-bar design switcher's dropdown Select with `DesignPickerDialog`, a card-grid dialog showing each design's `image` (falling back to `icon`, then a letter glyph) plus its label and description. Only takes effect with more than one design. A search box appears once there are more than six designs, or — adaptively, at any count — once the card grid actually overflows the dialog's scroll area at the current viewport size (e.g. a short or landscape window). See [Per-design `image`](#design-sources) and the annotations doc's [`// @image`](annotations.md#design-metadata--description--icon--image--doc)
- **`checklist`**: `true` by default, or `false`. Whether the getting-started checklist (a small dismissible "Choose a design / Review settings / Preview / Export" card) may show at all. It's only ever shown in guided experience regardless of this flag — set `false` to suppress it there too
- **`strictSteps`**: `false` by default, or `true`. A stepped design (one with at least one [`// @step`](annotations.md#guided-steps--step) section) that leaves an *essential* section (one with at least one non-`@advanced` parameter) without a step normally only gets a `gen-schema` build **warning**. Set `true` to promote that warning to a build **error**. Never affects geometry
- **`quickStart`**: `true` by default, or `false`. Whether a stepped design (one declaring at least one [`// @step`](annotations.md#guided-steps--step) section) shows the QuickStart step navigation in place of the classic scrolling form — declaring steps at all is the opt-in, so this is only worth setting `false` to keep the classic form for a design whose steps aren't ready yet. QuickStart only ever replaces the form in guided experience's essentials settings view; standard experience, All settings, and an active search query always show the classic form regardless. Never affects geometry
- **`experience`**: seeds the client-side guided/standard experience. See [Experience mode (`ui.experience`)](#experience-mode-uiexperience)
- **`afterExport`**: turns on the inline after-export success panel. Absent by default (no panel). See [After-export panel (`ui.afterExport`)](#after-export-panel-uiafterexport)

### Experience mode (`ui.experience`)

The optional `ui.experience` object seeds the client-side "experience mode" and "settings view" states that `src/lib/useExperience.ts` exposes to the UI: guided experience shows a reduced essentials-only settings view, a one-time mobile sheet-handle hint, the getting-started checklist (`ui.checklist` above), and a one-time viewer gesture hint. None of these fields affect geometry, so `ui.experience` never invalidates the render cache.

```jsonc
{
  "ui": {
    "experience": {
      "default": "guided",           // "guided" | "standard"; default "standard"
      "settingsView": "essentials",  // "essentials" | "all"; defaults from `default`
      "mobileInitialSheet": "peek"   // "peek" | "half"; default "peek"
    }
  }
}
```

- **`default`**: the experience mode a **first-ever** visit starts in. `"guided"` surfaces a curated, reduced control set; `"standard"` (the default) shows the classic full panel showing every parameter.
- **`settingsView`**: the settings view a first-ever visit starts on. `"essentials"` shows only parameters that aren't marked [`@advanced`](annotations.md#essential-and-advanced-settings--advanced--essential); `"all"` shows every parameter. When omitted, it's derived from `default`: `"guided"` implies `"essentials"`, `"standard"` implies `"all"`.
- **`mobileInitialSheet`**: which snap position the mobile bottom sheet opens to on first load — `"peek"` (the default, mostly closed) or `"half"` (half-open).

Each field only seeds the **first-ever** client state. The moment a visitor changes either the experience mode or the settings view, that choice is persisted (namespaced local storage, like every other ScadPub preference) and wins on every later visit — ahead of these config defaults. `default` and `settingsView` are independent settings with independent persisted keys; changing one client-side never touches the other's stored value or its config default.

### After-export panel (`ui.afterExport`)

The optional `ui.afterExport` object turns on a compact, non-modal panel (`src/components/ExportSuccess.tsx`) that appears above the floating action cluster right after a successful model export. Absent entirely (the default) -> no panel is ever shown, on any export. Every field inside it is also optional:

```jsonc
{
  "ui": {
    "afterExport": {
      "title": "Model downloaded",     // optional; defaults to outcome-led i18n wording
      "body": "Slice it and print.",   // optional; defaults to export.nextSteps
      "helpTab": "Printing"            // optional; must name an existing help.tabs[].label
    }
  }
}
```

- **`title`**: overrides the panel's headline. Left unset, the app picks it from what actually happened — a real browser download reads `export.downloaded`; handing the file to the native share sheet reads the more modest `export.readyToShare` (the Web Share API only confirms the OS handed the file to the chosen app, not that anything happened there, so the wording never overclaims a completed share)
- **`body`**: overrides the panel's one-line next step. Defaults to `export.nextSteps`
- **`helpTab`**: when set, the panel shows a "Printing guide" action that opens Help scrolled straight to the tab with this exact label (`HelpModal`'s `initialTab`, matched by [`help.tabs[].label`](#help-content-help)). **Validated at build time**: `gen-schema` fails the build if no tab in this config's `help` carries that label. Omit to hide the action

The panel is dismissible (an X, and it auto-hides itself — longer on the very first export a browser ever makes, quieter after that) and never appears while a native share sheet is open — it's only ever shown once the export's share-or-download outcome has actually settled. On a build where `ui.afterExport` is configured, it also takes over the export flow's one-time "install this app" nudge entirely (the two never stack on the same export); leave `ui.afterExport` unset to keep the install nudge as the export's only follow-up.

### PWA manifest

`gen-schema` writes `public/manifest.webmanifest`. It always includes a `launch_handler` so an already-open install is reused rather than re-launched. When the optional `@resvg/resvg-js` rasterizer is installed, `gen-schema` also rasterizes the `icon` SVG to PNGs and generates per-device iOS launch images. Without it, the PNGs fall back to the SVG and the iOS splash images are skipped.

These keys feed the manifest:

- **`themeColorLight`**: light-scheme `<meta name="theme-color">`, default `"#ffffff"`. The dark value comes from `themeColor`
- **`categories`**: optional array of [manifest categories](https://developer.mozilla.org/docs/Web/Manifest/categories)
- **`iconMaskable`**: optional separate SVG for the maskable icon. Defaults to `icon`
- **`screenshots`**: optional `[{ src, sizes, form_factor, label?, platform? }]` for the richer Android install UI. `form_factor` is `"wide"` or `"narrow"`. `label` is the accessible caption. `platform` targets a store listing. `label` and `platform` are passed through to the manifest when present
- **`shortcuts`**: optional `[{ name, short_name?, url, icons? }]` app shortcuts for Android long-press and desktop jump lists. `icons`, an array of `{ src, sizes?, type? }`, is passed through when supplied. If omitted and the config has more than one design, ScadPub derives a shortcut per design

## Notice badges (`notices`)

The collapsible **OpenSCAD output** panel below the preview can show count badges for non-fatal messages your designs emit. A design surfaces a message by `echo`-ing a string in the convention `"<context>: <marker>: <message>"`, where `<marker>` is any word your design chooses. There is nothing special about any particular marker.

For example:

```scad
echo("tag: alert: the label text is tall and may overflow the plate");
echo("tag: note: the label is engraved into the plate rather than raised");
```

`notices` is the build-time list of marker categories to recognise. Each matched echo becomes a friendly message in the console's **Notices** tab (with the marker stripped: *"tag: the label text is tall and may overflow the plate"*) and increments a coloured count badge on that tab.

```jsonc
{
  "notices": [
    { "marker": "alert", "label": "alerts", "labelOne": "alert", "color": "#e0a458" },
    { "marker": "note",  "label": "notes",  "labelOne": "note",  "color": "#86a9ff" }
  ]
}
```

- **`marker`**: required. The design-defined word, matched as `: <marker>:` inside an echo, case-insensitive. The first configured category that matches a line claims it
- **`label`**: optional badge noun, such as `"alerts"`. Defaults to the `marker`
- **`labelOne`**: optional singular form of `label`, such as `"alert"`. Used wherever a live count renders alongside the label (the count badge's accessible name, the Notices tab, the consolidated attention chip's notice rows) whenever the count is exactly 1 — `label` alone can't pluralize itself, so without this a single pending notice reads as "1 alerts". Omit to keep `label` regardless of count
- **`color`**: optional badge fill, as a plain CSS colour. For `#rgb`/`#rrggbb`, the badge text auto-switches between black and white to stay legible. Other colour forms keep the default badge text, so their contrast is your responsibility. Omit to use the default accent badge styling
- **`attention`**: optional boolean, default `false`. Flags this category as a production-readiness concern rather than a routine, passive notice: a pending notice in a flagged category surfaces the Customize tab's attention chip and a small indicator on the Export button — not just the Output bell's badge. Reach for this on messages that mean the exported model may not match what the controls show (a warning worth acting on before printing), not on cosmetic/informational notes

Omit `notices`, or set it to `[]`, and no marker categories are recognised. Design echoes appear only in the raw log. The bundled example config (`scadpub.config.json`) opts in with `alert` and `note` categories (neither flagged `attention` — they're demo notices, not real readiness gaps). The example `tag` design echoes them in specific, parameter-driven situations so you can see the badges appear.

> **Hardcoded, not configurable:** OpenSCAD's own `WARNING:` lines surface as warning messages, and `assert()` failures (`ERROR: Assertion …`) surface as a message **and** an `asserts` count badge. These work regardless of `notices`.

## Localization (`strings`)

ScadPub's own UI chrome (buttons, banners, loading/failure copy — everything
that isn't your design's parameter labels) is picked from a bundled text
catalogue selected by [`lang`](#app-identity-and-pwa): `"de"` and BCP-47 tags
whose primary subtag is `"de"` (e.g. `"de-AT"`) get the German catalogue;
everything else falls back to English. `strings` lets a deployment override
individual entries — to fix a word choice, retarget copy for a specific
audience, or add a language the app doesn't bundle yet (in which case
`strings` is the *entire* translation, since there's no matching bundle to
fall back into except English) — without forking the app:

```jsonc
{
  "lang": "de",
  "strings": {
    "action.share": "Weitergeben"
  }
}
```

Each key is looked up ahead of the active bundle and the English bundle, so an
override always wins. The full set of valid keys — and their current English
text, which doubles as the fallback for every unset key/locale — lives in
[`src/locales/en.json`](../src/locales/en.json); `src/locales/de.json` is the
bundled German catalogue. A `strings` key that isn't in `en.json` fails the
build (with a "did you mean" suggestion for a likely typo).

Two conventions to know when writing overrides:

- **Plural forms** are separate key variants with a CLDR category suffix, e.g. `"foo.count#one"` / `"foo.count#other"`. Override the specific variant(s) you want to change, not a bare `"foo.count"` key
- **Placeholders** are `{name}` tokens interpolated at render time, e.g. `"export.formatNote"` is `"{format} · for slicers and print services"`. Keep every placeholder from the original string in your override — the app doesn't validate this, so a dropped placeholder silently loses that value

## Help content (`help`)

The **Help** dialog (the **?** button) is generated from `help`. Omit it for a generic, project-agnostic default; supply it to document your own designs. `body` (and `intro`) use the same Markdown subset as everywhere else: `**bold**`, `` `code` ``, `[text](url)`, blank-line paragraphs, and `- ` bullets.

An optional **`title`** sets the dialog heading (default `"How to use this configurator"`).

### Single-pane help

Use `sections` for a flat list of help sections:

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

### Tabbed help

Use `tabs` to group the guide into multiple panes. A tab strip appears, and each tab has a `label`, an optional `intro`, and its own `sections`:

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
- If you supply **both** top-level `sections` and `tabs`, the top-level sections become a leading **Overview** tab. Adding `tabs` to an existing single-pane help never drops the original content. To control every label yourself, put all content inside `tabs` and leave top-level `sections` out.

## Open-source notices (`licenses`)

The **ⓘ** button lists the third-party components ScadPub itself bundles, including OpenSCAD-WASM, React, three.js, and Liberation fonts. If your deployment bundles **additional** software, add its notice here. Examples include an extra `.scad` library, a custom font, or a vendored script. Entries are **appended** to the built-in list; ScadPub's own attributions are never removed.

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
- Provide `sourceUrl` for copyleft components, such as GPL components, so the corresponding-source requirement is met. Provide `text` to reproduce a permissive license inline.
- A malformed entry fails the build with a clear message.
