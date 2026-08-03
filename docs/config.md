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
  "pwa": {
    "icon": "branding/icon.svg",    // PWA/favicon icon
    "themeColor": "#1f2229"         // browser-chrome / PWA colour (both themes; or { light, dark })
  },
  "source": "examples",           // directory of .scad designs (relative to this file)
  "designs": [
    { "id": "tag", "label": "Tag", "heavy": false }
  ],                              // omit to auto-discover *.scad in source; presets auto-detected as <id>.json
  "assets": ["lib"],              // files/dirs to bundle verbatim, preserving paths
  "render": {
    "features": ["textmetrics"],    // OpenSCAD --enable flags for every render
    "format": "3mf"                 // export/preview format: "3mf" (colour) or "stl"; default "3mf"
  },
  "viewer": { "style": "plain" }, // viewer presentation, framing, and controls — see Viewer
  "fileImport": true              // optional Files dialog (manages imported fonts/SVGs)
}
```

## Top-level keys

The top-level keys map to app identity, design discovery, rendering, appearance, and in-app content.

### App identity and PWA

These keys set the document chrome and, through the `pwa` block, the Progressive Web App (PWA) manifest:

- **`title`** / **`logo`**: see [Title and logo](#title-and-logo)
- **`id`**: namespaces localStorage, IndexedDB, and preset cache. Defaults to `"scadpub"`
- **`description`**: `<meta>` description and PWA manifest description
- **`lang`** / **`dir`**: document and manifest language (a BCP-47 tag, default `"en"`) and text direction (`"ltr"` by default, `"rtl"`, or `"auto"`). ScadPub emits them onto `<html lang dir>` and into the manifest
- **`pwa`**: manifest-only fields (`shortName`, `icon`, `iconMaskable`, `themeColor`, `backgroundColor`, `categories`, `screenshots`, `shortcuts`, `install`), see [PWA manifest (`pwa`)](#pwa-manifest-pwa). `gen-schema` generates `public/manifest.webmanifest` and `public/icon.svg` from it

### Design sources

These keys tell `gen-schema` which `.scad` files and assets to bundle:

- **`source`**: directory of Customizer-style `.scad` designs, relative to this config file. Defaults to `"."`
- **`designs`**: explicit list with id, label, and optional `file`. Omit it to auto-discover designs. Set `"heavy": true` to start a design in manual-render mode
- **`defaultDesign`**: optional design `id` shown on a visit that carries no `#d=` deep link. A saved session or hash still wins. Must name a configured design; defaults to the first
- **`assets`**: files or directories to copy verbatim. If omitted, `gen-schema` follows each design’s `use`/`include` graph
- **Bundled presets** are auto-detected: a `<design>.json` file beside `<design>.scad` is bundled automatically and appears read-only under “Bundled” in the preset picker.

A `designs[]` entry’s own keys get the same unknown-key check as the top level: an unrecognised key fails the build, naming the offending design’s `id` and listing the keys an entry accepts. (A missing or malformed `id` is itself checked first, so that failure is reported on its own rather than as a confusing unknown-key error.)

A design’s picker sub-label, thumbnail icon, gallery card art, and user-doc all come from the design’s **own `.scad` file** (`// @description`, `// @icon`, `// @image`, `// @doc` (see [annotations.md](annotations.md#design-metadata--description--icon--image--doc))) never from the config. There is no `designs[]` field for any of them: a design’s own metadata lives in the design, full stop.

Each `designs[]` entry also accepts an optional **`group`** field: a header string the picker clusters designs under:

```jsonc
{
  "designs": [
    { "id": "signage", "label": "Flexible sign", "group": "Around the building" },
    { "id": "elevator", "label": "Elevator button", "group": "Around the building" },
    { "id": "nameplate", "label": "Nameplate", "group": "Labels & everyday" }
  ]
}
```

- **`group`**: an optional string. Designs sharing the same `group` value cluster under a header showing that string (a `<SelectGroup>`/`<SelectLabel>` pair in the compact dropdown, an `<h3>` section heading in the `ui.gallery` card grid (`src/components/DesignPicker.tsx`)) and the value is also matched by the gallery’s search box, alongside `label`/`description`. Clustering follows `designs` array order and merges only **consecutive** entries: a run starts where a `group` value first appears and keeps absorbing later designs only while they repeat that exact value back-to-back; a design with a different (or absent) `group` breaks the run, so reusing the same group string further down the array (with something else in between) opens a second, separately headed section rather than joining the first. Omit `group`, or set it `null`, and that design renders in a headerless run; a config where no design sets `group` renders as a flat list with no headers at all

A curated review summary’s row labels and its note also come only from the design’s own `.scad` file: a parameter’s own `// @review "<label>"` comment and the design’s file-level `// @reviewNote "<text>"` (see [annotations.md](annotations.md#curated-review-label--review)). There is no config-level `review` field: no way to override a parameter’s label or the note from the config, and no way to add a label to a parameter the design didn’t annotate. A row’s value can still be overridden by an `echo("@review", param, value)` from the design itself (see [`echo("@review", …)`](annotations.md#curated-review-override-echoreview-)) when the printed model doesn’t literally match the stored parameter value (e.g. an uppercasing transform).

Each `designs[]` entry also accepts an optional **`presets`** object: currently only an **`images`** field, bundled-preset thumbnails, in either of two forms:

```jsonc
{
  "designs": [
    {
      "id": "tag",
      "label": "Tag",
      "presets": {
        "images": {
          "Large tag": "examples/tag-preset-large.png",
          "No hole": "examples/tag-preset-nohole.png"
        }
      }
    }
  ]
}
```

- `presets.`**`images`** (map form): an object mapping a **bundled preset’s exact name** (as it appears as a key inside that design’s sibling `<design>.json` parameterSets file, see “Bundled presets” above) to an image path, relative to the config file. Every key must match a real bundled preset name: a stale or misspelled name fails the build, and a design with no bundled presets at all can’t configure `presets.images` either. Images may be SVG, PNG, or WebP.

`presets.images` also accepts a plain **string** (a config-relative **directory**) as the escape from hand-listing every preset’s image path, which restates a mechanically-derivable mapping in a second file:

```jsonc
{
  "designs": [
    { "id": "tag", "label": "Tag", "presets": { "images": "branding/presets/tag" } }
  ]
}
```

In the directory form, each bundled preset’s image is looked up by **slugifying its name**: lowercase, “×” becomes “x”, every run of characters outside `[a-z0-9]` collapses to a single “-”, leading/trailing “-” stripped, and a name that slugs the same as an earlier one gets a numeric suffix (“-2”, “-3”, …) in preset order, and trying `.svg`, `.png`, then `.webp` in that directory. This is the exact rule a maintainer’s own thumbnail-rendering script can implement independently and still agree with `gen-schema` on every filename; `scripts/lib/preset-slug.mjs` is the one implementation both this doc and the build itself describe.

Preset images are **optional per preset** in both forms: in the in-app preset picker a bundled preset that has a configured image renders as a card (thumbnail + title, matching the visual design picker’s card treatment), while a bundled preset without one renders as a compact list row. The same row style the “Saved by you” section uses. Under the single “Ready-made” heading the imaged presets show first as a card grid, then the imageless ones as list rows. A design with no `presets.images` at all keeps the plain compact list exactly. A preset’s display name is split into an optional leading **overline** (`"Category | Title"`) and an optional trailing **badge** (`"Title (Language)"`) for the card, see `src/lib/presetCard.ts`; the stored preset name itself is never changed, only how it’s parsed for display.

In the directory form specifically, a preset with no matching file in the directory is exactly as fine as an unlisted key in the map form, but the directory itself must exist, or the build fails with a clear error (an existing-but-wrong directory, e.g. every preset name misspelled relative to its filenames, would otherwise silently yield zero images). `gen-schema`'s build log reports how many of the design’s bundled presets matched an image, so that failure mode is visible even though it isn’t a build error:

```text
gen-schema: design 'tag' presets.images: 2/3 preset(s) matched an image in 'branding/presets/tag'
```

The map form remains the escape hatch for a preset whose name and image file genuinely don’t correspond mechanically.

### Rendering

The `render` object gathers everything that affects render arguments, bundled fonts, and cache behavior. Two genuinely different kinds of field live in it, and that distinction matters for `renderHash`: the content hash folded into the persisted render-cache key:

- `render.features` / `render.format` / `render.fonts` / `render.fontFallback` (**`features`**/**`format`**/**`fonts`**/**`fontFallback`**): real render inputs. An OpenSCAD `--enable` flag, the export format, and the bundled glyph outlines all change the rendered bytes. Changing any of them **invalidates every persisted render** (`renderHash` moves)
- `render.heavyMs` / `render.cache` (**`heavyMs`**/**`cache`**): build-time tuning only. The heavy-render auto-pause threshold and the runner’s cache sizing. Neither affects geometry, so neither is part of `renderHash`

See [Render tuning (`render`)](#render-tuning-render) for the full field reference, and [Fonts](#fonts-renderfonts-renderfontfallback) for `render.fonts`/`render.fontFallback` specifically.

- **`viewer`**: the 3D viewer’s presentation, framing, and per-control visibility, all fixed at build time and none of it affecting the exported file or the render cache. See [Viewer](#viewer-viewer)

### Appearance and UI behaviour

These keys control branding, theme overrides, and interactive controls:

- **`colors`**: optional per-theme Cascading Style Sheets (CSS) colour overrides. See [Theme and colour scheme](#theme-and-colour-scheme)
- **`extraCss`**: optional raw-CSS escape hatch for advanced restyling. See [Custom CSS](#custom-css-extracss)
- **`ui`**: see [UI behaviour and PWA](#ui-behaviour-and-pwa)
- **`fileImport`**: see [file import](#import-file-fileimport)
- **`strings`**: optional per-deployment overrides of the built-in UI text. See [Text overrides (`strings`)](#text-overrides-strings)

### In-app content

These keys add copy and third-party notices to the generated app:

- **`popup`**: optional notice dialog shown over the app on load. See [Popup notice](#popup-notice-popup)
- **`help`**: optional Help dialog content. Use `sections` for a single pane or `tabs` for a tabbed guide. Omit it for a generic default. See [Help content](#help-content-help)
- **`notices`**: see [Notice badges](#notice-badges-notices)
- **`licenses`**: optional list of extra third-party software/license notices. ScadPub appends them to the built-in open-source attributions in the ⓘ panel. See [Open-source notices](#open-source-notices-licenses)

Missing `source`, `assets`, design, `logo`, or design-`icon` paths fail the build with a clear error. An **unknown top-level key** also fails the build. A whole-key typo like `"popups"` or `"fontfallback"` fails rather than being silently ignored. Add a `"$schema"` key for editor tooling if you want; it is allowed.

This schema is not backward compatible with ScadPub’s previous config shape: an outdated key (e.g. a top-level `restOnGrid`, `features`, or `icon`) fails the build with the same unknown-key error above, listing the currently valid keys.

## Where paths resolve from

Config paths are not all relative to the same thing. `gen-schema` resolves each one against whichever of three bases fits its role:

| Base | Keys resolved against it |
| --- | --- |
| The **config file’s own directory** | `source`, `logo`, `pwa.icon`, `pwa.iconMaskable`, `extraCss`, `designs[].presets.images` (the map form’s values, or the directory itself in the string form), `popup.bodyFile`, `fileImport.noteFile`, `licenses[].textFile`, `help.file`, `help.tabs[].file` |
| **`source`** (itself config-relative, see above) | `assets`, each `fonts` entry, `designs[].file` |
| **The design’s own `.scad` file** | the `// @icon`, `// @image`, and `// @doc` annotations |

A path resolved against the design’s own file must additionally stay inside `source`: `gen-schema`'s `checkContained` check rejects a `// @icon`/`// @image`/`// @doc` (or a `use`/`include` target, or a symlink resolving outside it) that escapes upward with a build-time error. A config-relative path (`logo`, `pwa.icon`, …) is not checked against `source` at all: the config author who controls the config file’s directory is assumed to also control what it points at.

## SVG asset trust model

ScadPub builds a static site from **your own** OpenSCAD designs and config
(`source`, `assets`, `logo`, `icon`, `iconMaskable`, `screenshots`, design
`icon`/`doc`, `extraCss`, bundled fonts, …). Every one of those paths is
**trusted operator input**: the same trust you already extend to any script
or dependency you add to your own build. `gen-schema` is not a sandbox: it
does not, and is not intended to, defend the app against a *malicious*
`.scad`/`.svg`/`.json` file in your own `source` or config tree.

If you want to host designs or assets supplied by people you don’t trust as
much as your own build (e.g. user-submitted `.scad` files), that is **out of
scope for ScadPub as shipped** and needs its own isolation boundary in front
of it, for example, a review/moderation step before a file ever reaches
`source`, or building/serving untrusted designs from a separate, sandboxed
deployment (different origin, no shared cookies/storage) rather than mixing
them into a trusted operator’s site. The in-browser OpenSCAD-WASM sandbox
protects the *renderer* from a hostile `.scad` file (it can’t reach the
network or the filesystem outside its mount); it says nothing about assets
that are served as-is and rendered by the *browser*, see below.

**What this means concretely for SVGs.** Three kinds of SVG reach ScadPub, and
each is treated differently:

- **Render-input SVGs**: files reached via `assets` or a design’s
  `use`/`include` graph, copied byte-for-byte into `public/scad/` because
  OpenSCAD’s `import()`/`surface()` reads them as path/geometry data. These
  are never modified by the build: rewriting bytes here risks silently
  changing what gets rendered. They’re safe in that role (import/surface read
  geometry, not markup), but they are also served as a plain static file at a
  guessable `/scad/...` URL. A browser that’s ever navigated to that URL
  *directly* (as opposed to used inside the app’s `<img>`/`<use>`/canvas
  context) would load the SVG as an active HTML-like document and could
  execute a `<script>` it contains, in the app’s own origin. This is why
  `public/_headers` locks down `/scad/*` with a restrictive
  `Content-Security-Policy` and `X-Content-Type-Options: nosniff` (see the
  comment there). Defense-in-depth against exactly that direct-navigation
  case, without touching the geometry.
- **Browser-facing SVGs**. The app `logo`, the PWA `icon`, and each design’s
  picker `icon`. Are only ever displayed, never read as geometry. `gen-schema`
  runs these through a sanitizer (`scripts/lib/svg-sanitize.mjs`) before writing
  them. It **parses the document** (`@xmldom/xmldom`, a build-time dependency the
  project already carried) rather than pattern-matching markup, and it is built
  out of three **allowlists** — because every denylist here proved open-ended:

  - **The document itself**: the root must be `<svg>` in the SVG namespace, and
    must declare that namespace. A document that isn’t one fails the build,
    naming the file. Leaving it to the element rule instead emptied the
    document rather than refusing it, and what shipped was a rootless file.
  - **Elements**: only SVG-namespace elements an icon is made of (structure,
    shapes, text, painting, filter primitives, `<title>`/`<desc>`). Everything
    else goes, including every HTML element — SVG 2 permits them, and
    `<html:video src>`, `<html:video poster>`, `<html:img src>` and
    `<html:iframe src>` all fetch. `<image>` is excluded too: its only job is to
    reference a raster, and the reference rule below allows nothing it could
    point at.
  - **References**: an `href` (in any namespace) or a CSS `url()` is kept only
    when it is a same-document `#fragment`. Deciding whether a value is
    *external* instead would mean reproducing, in the browser’s own order, the
    normalisations it applies before reading a URL — XML character references,
    then CSS escapes, then backslash-to-slash — and a scrub that has to
    out-normalise a browser is wrong until proven otherwise. `xml:base` is
    removed as well, so a fragment cannot be rebased onto another document.
  - **CSS**: a `<style>` block or a CSS-valued attribute survives only if what
    remains, after `@import` and foreign `url()` are removed, is literal values
    and functions that cannot reference anything (colours, maths, transforms).

  It also removes what can execute — `<script>`, `<foreignObject>`, the SMIL
  animation elements, `on*` handlers — and any `<?xml-stylesheet?>` processing
  instruction.

  **What this costs.** The CSS rule is strict, and deliberately so: a **quoted
  string** or an **at-rule** drops the whole block. `font-family: "My Font"` and
  `@media print { … }` are casualties, because `image-set("…" 1x)` carries a URL
  as a bare quoted string and there is no way to tell the two apart without a
  per-property value grammar (LightningCSS, which this repo already has, does not
  surface that one either). A `data:` URI is the other casualty. Relative
  references cost nothing: each of these files is copied on its own into a flat
  served directory under a generated name, so a reference to a sibling already
  resolved to a file that was never copied.

  It also removes `ping` from an SVG `<a>`: SVG 2 delegates it to HTML’s
  hyperlink auditing, and activating such a link really does send every URL
  listed. The `<a>` itself and its artwork stay — a same-document link is fine.

  The claim that nothing fetches is checked on **network traffic**, not on
  strings: `npm run check:svg` serves each sanitized result to Chromium as a
  standalone document and asserts no request leaves the page, with each vector
  paired against its unsanitized control so “no request” cannot pass by the
  browser simply not implementing the construct.

  Nothing is silent — **`gen-schema` warns, naming the file and what it
  removed**, whenever the sanitizer changes anything, and a file it changes
  nothing in is passed through byte-for-byte, never re-serialised.

  One more consequence: an SVG that is **not well-formed XML fails the build**,
  naming the file. XML is draconian, so a browser asked to render it as
  `image/svg+xml` would refuse it too — the build is simply the first place that
  says so.

  This remains a second layer on top of the operator-trust boundary above, not a
  substitute for it, and it does not touch `iconMaskable` source pixels or
  anything under `public/scad/` (see above).
- **User-supplied drawings**: a file a *visitor* drops onto an `// @svg` field,
  prepared by the in-app wizard (`src/lib/svgPrep`). This is the only SVG class
  ScadPub does **not** trust: it comes from whoever is using the site, not from
  the operator. It never touches the build. The invariant that makes it safe is
  that **a wizard-prepared SVG is never rendered in the DOM** — it is stored in
  IndexedDB and mounted into the OpenSCAD-WASM filesystem, where markup is read
  as geometry and nothing else. The wizard additionally reports (`active-content`)
  and strips `<script>`, the SMIL animation elements, and a stylesheet’s
  external references, so the runtime path stays safe by construction rather
  than by circumstance. If you ever add a preview that puts one of these
  drawings into the page, that invariant is what you are breaking, and this
  class needs real sanitization first.

**Deployment-target caveat.** `public/_headers` is the Cloudflare Pages /
Netlify custom-headers convention. **GitHub Pages serves no custom response
headers at all** and silently ignores `_headers`: if you deploy there, the
CSP/`nosniff` layer described above does not apply, and the SVG sanitization
above is your only defense-in-depth layer for `logo`/`icon` assets (render-
input SVGs under `/scad/` get none). This is one more reason the trust model
above is load-bearing: on GitHub Pages, treat everything under `source` and
every config-referenced path as fully trusted, full stop.

The same absence covers the app document itself, not only the SVG paths
above. At build time, `vite.config.ts`'s `securityHeaders` plugin appends a
further `/*` block to `dist/_headers`: a `Content-Security-Policy` scoped to
the app (`script-src` allow-lists only `'self'`, `'wasm-unsafe-eval'` for
OpenSCAD-WASM, and a sha256 hash of the built inline theme script), plus
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer` and a `Permissions-Policy` denying camera/
microphone/geolocation (see `src/lib/securityHeaders.mjs` for the policy and
its rationale). On Cloudflare Pages / Netlify this is real protection:
`frame-ancestors 'none'` and `X-Frame-Options: DENY` in particular are what
stop the export flow from being framed for clickjacking. **On GitHub Pages,
neither the SVG containment headers nor this app-document CSP/frame
protection ever reaches the browser**. Both live only in `_headers`, which
that host ignores outright. There is no equivalent on GitHub Pages; if
clickjacking or CSP protection matters for your deployment, use a host that
honours `_headers`.

## Title and logo

These keys control the browser title and the brand shown in the app header:

- **`title`**: browser tab title and header text
- **`logo`**: path relative to the config file. The app shows it in the header instead of the title text. The `title` is still used for `document.title` and the logo’s `alt`. Provide per-theme variants:

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
- An unknown token name fails the build (it’s almost always a typo).

`gen-schema` validates the block and records it in `designs.json`. `vite.config.ts` emits it as a `<style>` override at build time, so there is no runtime cost or flash. The 3D viewer reads its colours from the same CSS variables, so `viewer-*` overrides apply automatically.

> **Accessibility:** ScadPub ships AA-compliant palettes. If you override colours,
> re-verify contrast (`npm run smoke`, 0 serious/critical axe-core violations).

The full set of tokens (defined in [`src/index.css`](../src/index.css)):

```css
:root { /* dark is the default */
  --accent: #86a9ff;
  --accent-solid: #2f55ff;
  --on-accent: #ffffff;
  /* --bg, --panel, --panel-2, --line, --line-strong, --text, --muted, --focus,
     --link, --warn, --warn-bg, --warn-solid, --success, --success-bg,
     --danger-solid, --code-bg, --overlay, --glass-bg, --glass-border,
     --hud-border, --elevation, --radius, --radius-sm,
     --viewer-bg/-grid/-grid-2, --viewer-model/-dim */
}
:root[data-theme="light"] {
  --accent: #1d4ed8;
  --accent-solid: #1f3df5;
  /* … */
}
```

| Token | Controls |
| ------- | ---------- |
| `--bg` / `--panel` / `--panel-2` | app, panel, and inset backgrounds |
| `--line` | decorative borders and dividers |
| `--line-strong` | borders on interactive controls (input, select, checkbox, switch, slider): darker than `--line` so the control's boundary clears WCAG 1.4.11's 3:1 against `--panel` |
| `--text` / `--muted` | primary and secondary text |
| `--accent` | accent text/icons: group headers, carets, notice icon, spinner |
| `--accent-solid` | filled accent surfaces: primary button, badges |
| `--on-accent` | text on `--accent-solid` (usually white) |
| `--focus` | keyboard focus ring |
| `--link` | hyperlinks |
| `--warn` | warning text/icons |
| `--warn-bg` | tint behind a warning card |
| `--warn-solid` | filled warning surfaces (the `warn` badge variant): `--warn` is tuned as text on a panel, not as a fill under black text |
| `--success` | success text/icons |
| `--success-bg` | tint behind a success card |
| `--danger-solid` | filled destructive surfaces (destructive button/badge variants): `--danger` is tuned as text on a panel, not as a fill under white text |
| `--code-bg` | code and log backgrounds (output console, inline code) |
| `--overlay` | modal/dialog scrim backdrop |
| `--glass-bg` / `--glass-border` | translucent “glass” surfaces: command bar, sheets, viewer HUD |
| `--hud-border` | the viewer HUD's glass buttons, which float directly over `--viewer-bg` rather than a chrome band: a border tuned against that background specifically, since `--glass-border` reads too faint there |
| `--elevation` | drop shadow on raised surfaces (a `box-shadow`, not a colour) |
| `--radius` / `--radius-sm` | corner radius, base and small (a length, not a colour) |
| `--font-sans` / `--font-display` | UI font stacks: body text / the display voice (brand, headings, tabs, buttons). Unquoted family names only (e.g. `Georgia, serif`); set them under `dark` (the `:root` block) to apply to both themes |
| `--viewer-bg` / `--viewer-grid` / `--viewer-grid-2` | 3D preview background and grid (the grid renders only while the viewer’s grid toggle is on — seeded by [`viewer.grid`](#viewer-viewer), then the visitor’s own choice) |
| `--viewer-model` | rendered model material colour |
| `--viewer-dim` | dimension-overlay colour: the W x D x H measurement lines/labels the viewer’s measure tool draws (seeded by [`viewer.controls.measure`](#viewer-viewer)) |

`--accent` and `--accent-solid` are separate tokens because the same colour rarely passes WCAG AA both as small text on `--panel` and as a filled button background.

After changing colours, regenerate baselines and re-verify contrast:

```bash
npm run vis -- --update   # regenerate visual-regression baselines
npm run smoke             # axe-core run; 0 serious/critical = AA holds
```

## Custom CSS (`extraCss`)

Use `extraCss` when the `colors` token map does not cover your spacing, fonts, border radius, or logo sizing needs. It points to a stylesheet, relative to the config file, that ships verbatim and loads **after** the app’s own styles.

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

## Text overrides (`strings`)

ScadPub’s own chrome text (the readiness pill, the Review dialog, attention cards, the export dock, the output console and the share/export toasts) is generated from a small built-in catalogue (`src/locales/en.json`), resolved through `src/lib/i18n.ts`'s `t()`/`tn()`. The optional `strings` config key lets a deployment override any of those keys without a fork:

```jsonc
{
  "strings": {
    "action.export": "Download for printing",
    "review.title": "Check before you print"
  }
}
```

- Each key must already exist in `src/locales/en.json`: an unknown key (typically a typo) fails the build, pointing you at that catalogue. There is no way to *add* a brand-new key this way, only override an existing one.
- Each value is a plain string. Where the built-in text interpolates a variable (`{count}`, `{format}`, …), keep the same `{name}` placeholder(s) in your override: an override that drops a placeholder renders literal text where the value would have gone.
- A pluralized key is **two** catalogue keys, suffixed `#one` and `#other` (English’s only two [CLDR](https://cldr.unicode.org/index/cldr-spec/plural-rules) plural categories). E.g. `review.issueCount#one` (“{count} issue to review”) and `review.issueCount#other` (“{count} issues to review”). Override both together if you override either, so a count of exactly 1 doesn’t fall back to the built-in English text while every other count uses yours.
- This surface is intentionally a **subset** of ScadPub’s UI, not a full translation layer: it covers the surfaces `t()`/`tn()` have been wired into so far (see `src/locales/en.json` for the exhaustive key list). Older/legacy panels (the parameter form, the Presets tab, the Files dialog’s own body copy, the Help modal chrome, …) are not yet routed through this catalogue and stay plain English regardless of `strings`.
- `strings` never affects geometry, so it’s absent from `renderHash`.

## Import file (`fileImport`)

Designs sometimes need a file the app cannot bundle, such as a license-restricted font or an SVG to `import()`. Setting `fileImport` adds a **Files** action to the toolbar (an icon in the desktop command bar’s action cluster, a row in the mobile “⋮” menu) that opens the **Files dialog**: the manager for files imported at runtime, entirely client-side, with nothing uploaded to a server. Only fonts and SVGs have an import route (see [How uploads reach OpenSCAD](#how-uploads-reach-openscad)); a `surface()`/`import()` data file that no `@font`/`@svg` parameter points at has no import affordance and must ship as a bundled [asset](#design-sources) instead.

Importing is **contextual**: it happens at the control that needs the file, not through a generic button:

- A **font** parameter (`// @font`) imports through the font dropdown’s **Import font…** action (and an inline import hint when a chosen font isn’t loaded).
- An **SVG** parameter (`// @svg`) imports through its **Prepare SVG…** drop zone. If the value later names a drawing that isn’t present (e.g. an imported SVG the user removed), the control shows an actionable “not imported” hint.

The **Files dialog is a manager**, not an importer: it lists what those controls have imported (name, type, size), removes a single file via its row, and clears all. With nothing imported it shows an empty state pointing back at the controls.

```jsonc
{
  // Shorthand: enable with defaults.
  "fileImport": true

  // …or an options object:
  "fileImport": {
    "note": "…"   // optional: guidance shown at the top of the Files dialog (Markdown)
  }
}
```

`fileImport` gates whether the **Files** action exists at all: omit it (or set it to `null`/`false`) and no Files action is shown. Its optional **`note`** renders as guidance at the top of the Files dialog, in a small Markdown subset: paragraphs, `- ` bullet lists, `**bold**`, `` `code` ``, and `[links](url)`. It uses the same renderer as help and popup content. Alternatively set **`noteFile`**: a config-relative Markdown file whose contents become `note` at build time, read and inlined the same way as `popup.bodyFile` (see [Popup notice](#popup-notice-popup)); setting both `note` and `noteFile` fails the build.

`fileImport` has no `accept`, `label`, or `maxBytes` fields: each contextual control (the font dropdown, the SVG drop zone) applies its own picker filter and size guard, so there is no generic import button left for those to configure. A config that still sets one fails the ordinary unknown-key check.

### How uploads reach OpenSCAD

ScadPub chooses the mounting behavior from the file extension:

- **Fonts** (`.ttf`/`.otf`/`.ttc`) are mounted where the renderer’s fontconfig can find them, so `text(font = "…")` can use them. They’re matched by their **embedded family name**, not the filename, so a renamed file still resolves.
- An **imported SVG** (`.svg`) is mounted at the render filesystem **root**, so a design references it by name, e.g. `import("logo.svg")`. The reference must match the imported file’s name.

> **Only fonts and SVGs can be imported**, because import is contextual: a `@font` parameter offers the font route and a `@svg` parameter offers the SVG route. A file a design reads through a bare `surface()`/`import()` with **no** such parameter pointing at it has no import route in the UI; ship it as a bundled [`asset`](#design-sources) instead. (Any imported file is still mounted at the render root, so the mounting itself is generic: it’s the *import* affordance that is font-/SVG-only.)

Imported files persist in IndexedDB and are re-applied on the next visit; the Files dialog lists what’s currently loaded, with a **Clear all** button to remove them. Importing, removing, or clearing files drops the render cache (in-memory and persistent) so no stale geometry is served.

## Fonts (`render.fonts`, `render.fontFallback`)

`render.fonts` lists the font files the renderer bundles and mounts. Each entry is either a basename already in `public/fonts/` or a path into `source` to copy in. ScadPub reads each embedded family and style name at build time, so the app knows the authoritative available set and can name each face the way you know it. Bundled fonts are genuine render inputs (the glyph outlines drive `text()` geometry) so `render.fonts` and `render.fontFallback` are folded into `renderHash`: swapping a font invalidates persisted renders automatically.

A string or enum dropdown parameter annotated `// @font` renders as a **font dropdown**. See [Font selectors](annotations.md#font-selectors--font). The dropdown lists every face the renderer can use, including bundled fonts and imported fonts. Friendly names come from the font file, such as “Liberation Sans Bold”, never the raw Fontconfig `Family:style=Style` string.

Imported faces are labelled, and the menu includes an **Import font…** action at the bottom. Faces the design suggests, or the current value names, stay visible when they are not loaded. They appear in a “Needs a font file” group. While the selected family is not loaded, the control shows an inline hint with **Import font…** and a one-click **Use \<available family\>** fallback.

```jsonc
{
  "render": {
    // Bundle the fallback face too. fontFallback must name a family you bundle.
    "fonts": ["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf", "LiberationMono-Regular.ttf"],
    "fontFallback": "Liberation Mono"  // optional, see below
  }
}
```

`render.`**`fontFallback`** is optional and pins a deterministic last-resort family in the generated `fonts.conf`. Without it, Fontconfig can pick an imported font as the global default for any unmatched family. That makes OpenSCAD’s own substitution unpredictable. Set `render.fontFallback` to a **bundled** family that you **don’t** offer as a selectable lettering choice, such as a monospace face. Any absent family falls back to it. Omit it for the default behavior with no fallback rule.

## Render tuning (`render`)

`render` is a build-time object with two halves that behave differently with respect to `renderHash` (the content hash folded into the persisted render-cache key):

- **Render inputs** (`features`, `format`, `fonts`, `fontFallback`) documented in [Rendering](#rendering), [Fonts](#fonts-renderfonts-renderfontfallback), and the representative config’s `format` line. These genuinely change the rendered bytes, so they’re folded into `renderHash`: changing any of them invalidates every persisted render.
- **Tuning-only fields** (`heavyMs`, `cache`) covered below. Every field here is optional; the app keeps its built-in default for any you omit. Neither affects geometry, so neither is part of `renderHash` (changing them doesn’t invalidate cached renders).

```jsonc
{
  "render": {
    "features": ["textmetrics"],  // OpenSCAD --enable flags for every render (renderHash input)
    "format": "3mf",               // export/preview format: "3mf" (colour) or "stl"; default "3mf" (renderHash input)
    "fonts": ["LiberationSans-Regular.ttf"],  // bundled font files (renderHash input)
    "fontFallback": "Liberation Mono",         // optional last-resort family (renderHash input)

    "heavyMs": 6000,       // auto-pause threshold (ms); default ≈ 6000 — NOT a renderHash input
    "cache": {              // NOT a renderHash input
      "maxEntries": 16,    // in-memory (L1) slot count; default 16
      "maxBytes": 67108864,    // in-memory (L1) total budget; default derived from device memory
      "maxEntryBytes": 33554432,  // largest single render that may be cached
      "persistent": true   // persist renders to IndexedDB (L2); default on where available
    }
  }
}
```

- **`heavyMs`**: when a live auto-render pass takes longer than this, auto-render pauses for that design and you render on demand with **Render now**. Designs flagged `"heavy": true` start paused regardless. Raise it for a fast machine, lower it to pause sooner.
- **`cache`**: sizes the runner’s two-tier render cache. `maxEntries` and `maxBytes` bound the in-memory L1 cache. `maxEntryBytes` caps the largest single render worth caching. `persistent` toggles the IndexedDB L2 store. Set it to `false` to render fresh each session or for privacy-sensitive deployments.

## Viewer (`viewer`)

An optional build-time object gathering every display-only concern the 3D viewer owns:
presentation, framing, and per-control visibility. None of it affects the exported bytes or
the render cache, so `viewer` is absent from `renderHash`.

```jsonc
{
  "viewer": {
    "style": "plain",       // "plain" (default) is the classic CAD preview; "studio" is a product-shot look
    "restOnGrid": false,     // rest the model's base on the z=0 grid instead of centring in Z; default false
    "grid": "off",           // seeds the reference-grid toggle's first-ever value; default "off"
    "controls": {
      "measure": true,       // the ruler/measure toggle; default true
      "viewPicker": true,    // the camera-angle cube button; default true
      "reset": true,         // the "reset view" button; default true
      "zoom": false,         // explicit zoom in/out buttons; default false
      "fullscreen": true     // the fullscreen toggle (browser tabs only); default true
    }
  }
}
```

- **`style`**: picks the look. `"plain"` (the default) is the classic CAD preview with the flat light rig. `"studio"` lights the model with an image-based studio environment, tone mapping, and a soft contact shadow under the model: a product-shot treatment that emphasises materials and relief. A `"studio"` deployment usually wants `"viewer": { "grid": "off" }` so the model reads as a product against a clean backdrop rather than as a CAD part
- **`restOnGrid`**: how the viewer frames a loaded model. `false` (the default) centres the model on the origin in all three axes, as it always has. `true` centres it in X/Y but rests its base on the `z=0` grid plane, which suits designs modelled with their base on `z=0` (as OpenSCAD designs typically are) where centring in Z would sink them half-way through the grid
- **`grid`**: `"off"` by default, or `"on"`. Seeds whether the viewer starts with its reference grid drawn. Unlike `controls` below, this is **not** a control-visibility flag: the grid toggle is always offered regardless of this value. It only seeds that toggle’s first-ever value; a visitor’s own later choice is remembered in the browser and wins on every subsequent visit. That’s exactly why it sits directly on `viewer` rather than inside `controls`
- **`controls`**: visibility of the individual viewer HUD controls. Every field is optional and independent; none hides the 3D canvas itself, only the named control. The HUD presents itself differently by layout: a column of buttons floating over the canvas on desktop, a single **View options** button opening a popover on mobile, where a standing column would cover a third of the screen, but these flags mean the same thing in both: a control set `false` is absent from the column *and* from the popover. Each field below is described by its desktop button, which is the form it takes when there is room for one:
  - **`measure`**: `true` by default, or `false`. Controls the viewer measure toggle, the ruler button that draws the W x D x H overlay and shows the measurements/`@info` panel. Set `false` to hide the button entirely
  - **`viewPicker`**: `true` by default, or `false`. Controls the cube button whose menu snaps the camera to standard angles. Set `false` to hide it
  - **`reset`**: `true` by default, or `false`. Controls the “reset view” button. Mouse/touch orbit and zoom still work regardless
  - **`zoom`**: `false` by default, or `true`. Controls the zoom in/out buttons. Mouse-wheel and pinch zoom already work, so the buttons are off by default
  - **`fullscreen`**: `true` by default, or `false`. Controls the fullscreen toggle. The button only appears in a browser tab whose browser supports the Fullscreen API. It never appears in an installed PWA, which already has its own window

## Popup notice (`popup`)

Show a one-off notice dialog over the app on load. Use it for a welcome message, a usage caveat, a docs link, or a required font/license link. It is a build-time setting; all copy is config-driven, so the app stays project-agnostic. Omit `popup` and nothing is shown.

```jsonc
{
  "popup": {
    "header": "Welcome to Tag Studio",          // required: dialog title
    "body": "Configure a nameplate and export a 3MF.\n\nSee the [print guide](https://example.com/guide) for material tips.",  // required
    "mode": "once",                              // optional: "always" | "once" | "dismissible" | "picker"
    "button": "Got it",                          // optional: overrides the default "OK" label
    "footnote": "Everything runs in your browser. Nothing is uploaded."  // optional
  }
}
```

- **`header`**: the dialog title
- **`body`**: the message, in the same Markdown subset used elsewhere. Links open in a new tab. Alternatively set **`bodyFile`**: a config-relative path to a Markdown file whose contents become `body` at build time. Setting both `body` and `bodyFile` fails the build, naming both. Unlike `designs[].doc` (fetched by the browser on demand), this file’s content is read at build time and inlined into the generated schema: the browser never makes a separate request for it
- **`mode`**: popup frequency:
  - **`always`**: shown on every visit. No opt-out
  - **`once`** (default): shown on the first visit only. Dismissing it with **OK**, the close button, Escape, or outside click remembers it so it will not return
  - **`dismissible`**: shown on every visit until you tick **Don’t show this again**. Closing without ticking the box shows it again next time
  - **`picker`**: the popup IS the design chooser (the visual gallery, as the app’s first screen) rather than a notice over the app. Intended for `ui.gallery: true` deployments. It needs **at least two designs** to choose between: `picker` with fewer fails the build, pointing at `"once"` for a plain notice, because a chooser with nothing to choose is a mistake in the config rather than a request for something else. Skipped when the URL hash already names a design (a shared link, or an installed app’s `#d=<id>` shortcut) since the choice it asks for has already been made; skipping isn’t remembered, so a later visit to the bare URL still gets the gallery. While it is on screen the render path stays parked, so its thumbnails have the connection to themselves
- **`button`**: an optional label for the primary button, overriding the default `"OK"`. Must be a non-empty string when set. Has no effect in `picker` mode, that mode’s primary action is picking a design from the gallery, not clicking a button
- **`footnote`**: an optional short line of plain text (not Markdown), shown small and muted at the bottom of the dialog in every mode, including `picker`. For a standing disclosure that doesn’t belong in the main `body` message, such as a privacy note

The remembered state is namespaced by the configurator’s `id` and keyed by the popup’s content, so changing the `header`/`body`/`mode` in a later deploy re-shows the notice to returning users. It’s purely informational and doesn’t affect renders, so it never invalidates the geometry cache.

## UI behaviour and PWA

### UI options

The optional `ui` object is validated as a unit, and defaults apply when it is absent. None of these fields affect geometry, so they never invalidate the render cache. The viewer’s own presentation, framing, and per-control visibility (`style`, `restOnGrid`, `grid`, `controls.*`) live under [`viewer`](#viewer-viewer), not here.

- **`panelSide`**: `"left"` by default, or `"right"`. Controls which edge the desktop parameter panel docks against
- **`panelDefault`**: `"open"` by default, or `"collapsed"`. Sets the first-load desktop panel state. The later browser choice persists
- **`outputDefault`**: `"closed"` by default, or `"open"`. Controls whether the OpenSCAD output console starts open
- **`showVarName`**: `false` by default, or `true`. Shows the underlying OpenSCAD variable name beside each parameter label. Hidden by default because it is developer detail; set `true` for a technical audience. Every parameter row always carries a `data-param="<var>"` attribute for smoke tests and `extraCss`
- **`saveImage`**: no config-level default. Absent, like `true`, leaves the “Save image (PNG)” action shown (the app itself only hides it on an explicit `false`); there’s no other observable difference between omitting the key and setting it `true`. Controls the action in the secondary-action surfaces (the desktop command bar and the mobile ⋮ overflow menu). Set `false` to hide the Save-image action entirely
- **`gallery`**: `false` by default. Replaces the compact design dropdown with a searchable card grid using each design’s `image`, then `icon`, then a letter fallback
- **`essentials`**: `false` by default. Starts with `// @advanced` parameters hidden behind **Show all settings**
- **`afterExport`**: turns on the inline after-export success panel. Absent by default (no panel). See [After-export panel (`ui.afterExport`)](#after-export-panel-uiafterexport)

The Presets tab, the parameters (“Customize”) tab, and the desktop panel’s own labels are plain chrome text (the `strings` catalogue’s `"presets.title"` (default `"Presets"`) and `"settings.title"` (default `"Customize"`)) since that’s all they ever were; see [Text overrides (`strings`)](#text-overrides-strings).

### After-export panel (`ui.afterExport`)

The optional `ui.afterExport` field turns on a compact, non-modal panel (`src/components/ExportSuccess.tsx`) that appears above the floating export dock right after a successful model export. Absent, `null`, or `false` → no panel is ever shown, on any export. Set it to `true` for the panel with its defaults, or an options object for the one thing worth configuring: the same `true`-or-options-object shape as [`fileImport`](#import-file-fileimport):

```jsonc
{
  "ui": {
    // Shorthand: enable with defaults.
    "afterExport": true

    // …or an options object:
    "afterExport": {
      "helpTab": "Printing"   // optional; must name an existing help.tabs[].label
    }
  }
}
```

- **`helpTab`**: when set, the panel shows an “Open printing help” action that opens Help scrolled straight to the tab with this exact label (`HelpModal`'s `initialTab`, matched by [`help.tabs[].label`](#help-content-help)). **Validated at build time**: `gen-schema` fails the build if no tab in this config’s `help` carries that label. Omit to hide the action

The panel’s headline and body always come from the `strings` catalogue (`"exportSuccess.title"`, default “Your file is on its way”; `"exportSuccess.body"`, default a generic next-step line): override them there, the same way as any other chrome text, rather than through a second field on `afterExport`.

The panel is dismissible (an ✕) and auto-hides itself after a few seconds; it never appears while a native share sheet is open: it’s only ever shown once the export’s share-or-download outcome has actually settled, and it replaces the export flow’s one-time “install this app” toast on any deployment that configures it (the two never stack on the same export).

### PWA manifest (`pwa`)

The optional `pwa` object gathers every manifest-only, icon-rasterizer-only field: install metadata, icons, and theming that feed `public/manifest.webmanifest` and the generated icon set. Nothing in it affects geometry, so none of it is part of `renderHash`.

`gen-schema` writes `public/manifest.webmanifest`. It always includes a `launch_handler` so an already-open install is reused rather than re-launched. When the optional `@resvg/resvg-js` rasterizer is installed, `gen-schema` also rasterizes the `icon` SVG to PNGs and generates per-device iOS launch images. Without it, the PNGs fall back to the SVG and the iOS splash images are skipped.

```jsonc
{
  "pwa": {
    "shortName": "Widget",           // optional; defaults to "title"
    "icon": "branding/icon.svg",     // PWA/favicon icon, relative to the config file
    "iconMaskable": "branding/icon-maskable.svg",  // optional; defaults to "icon"
    "themeColor": {                  // a string (both themes), or { light, dark }
      "light": "#ffffff",             // default "#ffffff"
      "dark": "#1f2229"                // default "#1f2229"
    },
    "backgroundColor": "#15171c",    // PWA manifest background colour; default "#15171c"
    "categories": ["utilities"],     // optional manifest categories
    "screenshots": [ /* … */ ],       // optional, see below
    "shortcuts": [ /* … */ ],          // optional, see below
    "install": "auto"                 // "auto" (default) or "off"
  }
}
```

- **`shortName`**: short PWA name. Optional; defaults to `title`
- **`icon`**: PWA/favicon icon, a path relative to the config file
- **`iconMaskable`**: optional separate SVG for the maskable icon. Defaults to `icon`
- **`themeColor`**: browser-chrome / PWA colour, **per theme**. Same shape as [`logo`](#title-and-logo): a plain string sets both themes, or supply an object with either/both of `light`/`dark`. Unlike `logo`, an omitted side does **not** fall back to the other: `light` and `dark` each default independently (`"#ffffff"` / `"#1f2229"`), since they’re genuinely different colours rather than one asset shared across themes. `light` feeds `<meta name="theme-color">` in the light scheme; `dark` feeds the PWA manifest’s `theme_color` and the default icon’s fill when no `icon` is configured
- **`backgroundColor`**: PWA manifest background colour, default `"#15171c"`
- **`categories`**: optional array of [manifest categories](https://developer.mozilla.org/docs/Web/Manifest/categories)
- **`screenshots`**: optional `[{ src, sizes, form_factor, label?, platform? }]` for the richer Android install UI. `form_factor` is `"wide"` or `"narrow"`. `label` is the accessible caption. `platform` targets a store listing. `label` and `platform` are passed through to the manifest when present
- **`shortcuts`**: optional `[{ name, short_name?, url, icons? }]` app shortcuts for Android long-press and desktop jump lists. `icons`, an array of `{ src, sizes?, type? }`, is passed through when supplied. If omitted and the config has more than one design, ScadPub derives a shortcut per design
- **`install`**: `"auto"` by default, or `"off"`. When `"off"`, no PWA install affordance appears, even on browsers that support it

## Notice badges (`notices`)

The collapsible **OpenSCAD output** panel below the preview can show count badges for non-fatal messages your designs emit. A design surfaces a message by `echo`-ing a string in the convention `"<context>: <marker>: <message>"`, where `<marker>` is any word your design chooses. There is nothing special about any particular marker.

For example:

```scad
echo("tag: alert: the label text is tall and may overflow the plate");
echo("tag: note: the label is engraved into the plate rather than raised");
```

`notices` is the build-time list of marker categories to recognise. Each matched echo becomes a friendly message in the console’s **Notices** tab (with the marker stripped: *“tag: the label text is tall and may overflow the plate”*) and increments a coloured count badge on that tab.

```jsonc
{
  "notices": [
    { "marker": "alert", "label": { "one": "alert", "other": "alerts" }, "color": "#e0a458" },
    { "marker": "note",  "label": { "one": "note",  "other": "notes"  }, "color": "#86a9ff" }
  ]
}
```

- **`marker`**: required. The design-defined word, matched as `: <marker>:` inside an echo, case-insensitive. The first configured category that matches a line claims it
- **`label`**: optional badge noun. Either a plain string used regardless of count (e.g. `"alerts"`), or an object with `other` (the plural/default form, required within the object) and an optional `one` (the singular form, falling back to `other` when omitted): the singular/plural is picked with the same [CLDR](https://cldr.unicode.org/index/cldr-spec/plural-rules) `Intl.PluralRules` logic `strings`' pluralized keys use (`#one`/`#other`), so a single pending notice never reads as “1 alerts”. Defaults to the `marker` (used for both forms) when omitted entirely. A config using the old `label`/`labelOne` pair fails the build with a pointer at this shape
- **`color`**: optional badge fill, as a plain CSS colour. For `#rgb`/`#rrggbb`, the badge text auto-switches between black and white to stay legible. Other colour forms keep the default badge text, so their contrast is your responsibility. Omit to use the default accent badge styling
- **`attention`**: optional boolean, default `false`. Attention notices join OpenSCAD warnings, assertions, and missing fonts in the pre-download review dialog; **Download anyway** remains available
- **`subsumedByFont`**: optional boolean, default `false`. Only meaningful alongside `attention: true`. Marks a category whose notices are a *symptom* of a missing font rather than their own separate issue, for example a design that warns about text overflowing once a substitute family was used. While a font the design asked for isn’t loaded, and it is unambiguous which font parameter that is (the design has one font parameter, or exactly one fell back), this category’s pending notices are folded into the font item instead of being listed again beside it. With no font missing, they count exactly as normal

Omit `notices`, or set it to `[]`, and no marker categories are recognised. Design echoes appear only in the raw log. The bundled example config (`scadpub.config.json`) opts in with `alert` and `note` categories. The example `tag` design echoes them in specific, parameter-driven situations so you can see the badges appear.

> **Hardcoded, not configurable:** OpenSCAD’s own `WARNING:` lines surface as warning messages, and `assert()` failures (`ERROR: Assertion …`) surface as a message **and** an `asserts` count badge. These work regardless of `notices`.

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
- A top-level `intro` renders once above the tab strip; a per-tab `intro` renders above that tab’s sections.
- If you supply **both** top-level `sections` and `tabs`, the top-level sections become a leading **Overview** tab. Adding `tabs` to an existing single-pane help never drops the original content. To control every label yourself, put all content inside `tabs` and leave top-level `sections` out.

### Sourcing help from Markdown files

Writing `sections` (and `intro`) inline means twenty-five `{title, body}` fragments joined by `\n\n` inside one JSON string: unreviewable in a diff, and unlintable by tools like markdownlint. As an alternative, set **`file`** (a config-relative path to a Markdown file) on the single-pane `help` object itself, or on any individual `tabs[]` entry. `gen-schema` splits that file’s content at build time: everything before the first `##` heading becomes that pane’s `intro`; each `##` heading after that starts a section, using the heading text as `title` and everything up to the next `##` heading (or the end of the file) as `body`. This maps exactly onto the `{title, body}` shape above, so a whole tab becomes one readable `.md` file instead of a handful of JSON fragments.

A pane with `file` may not also set `sections` or `intro` directly: either combination fails the build, naming both keys. A bare `#` heading (or `###` and deeper) does not start a new section: use `#` for the file’s own title if you want one (it stays as ordinary text inside `intro`), and `###` for structure within a section’s own body.

```jsonc
{
  "help": {
    "tabs": [
      { "label": "Getting started", "file": "docs/help-getting-started.md" },
      { "label": "Printing tips", "sections": [ /* … */ ] }
    ]
  }
}
```

```markdown
<!-- docs/help-getting-started.md -->
The basics.

## Pick a design

Use the **Design** dropdown…

## Adjust parameters

The left panel lists…
```

The Markdown file’s content is read once, at build time, and inlined into the generated schema exactly as if it had been written as `intro`/`sections` inline, unlike `designs[].doc` (fetched by the browser on demand, see [Design sources](#design-sources)), a help-tab Markdown file never reaches the browser as its own request. It is pure prose and cannot affect geometry, so `help` (`file`-sourced or not) stays out of `renderHash` exactly as before.

## Open-source notices (`licenses`)

The **ⓘ** button lists the third-party components ScadPub itself bundles, including OpenSCAD-WASM, React, three.js, and Liberation fonts. If your deployment bundles **additional** software, add its notice here. Examples include an extra `.scad` library, a custom font, or a vendored script. Entries are **merged** into the built-in list by name; ScadPub’s own attributions are never removed.

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
- Provide `sourceUrl` for copyleft components, such as GPL components, so the corresponding-source requirement is met. Provide `text` to reproduce a permissive license inline, or **`textFile`**, a config-relative path whose contents become `text` at build time (the full OFL/GPL/etc. text lives in its own file instead of a `\n`-joined JSON string). Setting both `text` and `textFile` fails the build.
- A malformed entry fails the build with a clear message.

### Merging with the built-ins

A config entry whose `name` matches a built-in’s (compared trimmed and case-insensitively) is not appended as a second, duplicate-looking attribution. It is **merged** into that built-in entry, because the same component can legitimately be bundled twice for two different reasons (e.g. ScadPub bundles a typeface for its own interface chrome, while a deployment separately bundles the same typeface as a render font for its designs). Merging that case into one entry is exactly what makes the “never removed” guarantee meaningful: a config can’t accidentally shadow or duplicate a built-in it happens to name.

The merge rule:

- ScadPub’s own `license`, `copyright`, `url`, `licenseUrl`, and bundled `text` always win. A config can never override or remove them: that’s what “ScadPub’s own attributions are never removed” means in practice.
- `version`, `sourceUrl`, and `text` fill in from the config **only** where the built-in doesn’t already have one.
- `note` is the one field both sides legitimately contribute, so both are kept: the built-in’s note and the config’s note are combined into a single line, not replaced.
- If a config entry shares a built-in’s `name` but declares a **different `license` or `copyright`**, it is treated as a different component that happens to share a name, not the same one: it is kept as its own separate entry instead of being merged, so two disagreeing legal facts are never blended into one attribution.

Built-ins always keep their built-in display order; a config entry that doesn’t merge (a new name, or a same-name/different-license mismatch) is appended after them, in the order it appears in `licenses[]`.

### Where the built-in versions come from

Every version shown in that modal is resolved at build time and carried in the generated schema. None is a literal in the source, so an attribution can’t claim a version the app doesn’t ship. There is no config key for any of them.

| Entry | Version source | Schema field |
| --- | --- | --- |
| ScadPub | `git describe` of the building checkout (see below) | `scadpubVersion` |
| OpenSCAD (WebAssembly build) | `PINNED_WASM_VERSION` in `scripts/wasm-version.mjs`, or `$OPENSCAD_VERSION` — the snapshot actually fetched | `wasmVersion` |
| three.js, React & React-DOM, Atkinson Hyperlegible | the installed version in the `node_modules` the build bundles from (`scripts/lib/dep-versions.mjs`) | `componentVersions` |

The npm versions are read from disk rather than imported from the packages themselves: `import { REVISION } from "three"` would pull three.js into the modal’s eager chunk (the modal is statically imported) and undo the viewer’s lazy-load split. A package that can’t be resolved is left out and its entry shows no version.

Adding a bundled component means adding its attribution in `src/lib/licenses.ts` and, if it’s an npm package, its name to `BUNDLED_PACKAGES` in `scripts/lib/dep-versions.mjs`. Unit tests check that the two agree with `package.json` and with what’s installed.

### ScadPub’s own version stamp

ScadPub’s entry carries the version of ScadPub the site was built with, so a deployed configurator identifies the infrastructure behind it. It is resolved by `scripts/lib/version.mjs` and written to the schema as `scadpubVersion`.

It is read from the git metadata of **the ScadPub checkout that runs the build** (`git -C <scadpub dir> describe --tags --always --dirty`) not from the current working directory. A consumer project therefore gets the right answer whether it forks ScadPub, adds it as a submodule, or builds it from a sibling checkout with its own `SCADPUB_CONFIG`.

| Checkout state | Stamp |
| --- | --- |
| On a tagged commit | `v1.4.0` |
| Past the latest tag | `v1.4.0-3-gab12cd6` |
| No tags reachable (a shallow CI clone) | `ab12cd6` |
| Uncommitted changes | `…-dirty` suffix |
| No git metadata at all | none — the modal shows no version line |

Two notes for CI and packaging:

- **Fetch tags.** `actions/checkout` defaults to a depth-1 clone with no tags, which yields the bare-commit form. Set `fetch-depth: 0` (as `.github/workflows/ci.yml` does) for the tag form.
- **`SCADPUB_VERSION` overrides everything.** Set it when the build tree has no git metadata (a release tarball, a `docker COPY` of the sources) or when ScadPub is vendored as plain files into a repo whose tags describe the consumer’s app rather than ScadPub:

  ```bash
  SCADPUB_VERSION=v1.4.0 npm run build
  ```

The stamp and `componentVersions` are display-only. Both are deliberately kept out of `renderHash`, so a new commit or a dependency bump doesn’t invalidate persisted render geometry.
