# Configuration reference

`scripts/gen-schema.mjs` reads `scadpub.config.json` (override path with `SCADPUB_CONFIG`):

```jsonc
{
  "title": "ScadPub",             // page/header title
  "id": "scadpub",                // namespaces browser storage (default "scadpub")
  "shortName": "ScadPub",         // PWA short_name (default: title)
  "description": "Configure …",   // page <meta> + PWA description
  "icon": "branding/icon.svg",    // PWA/favicon icon
  "themeColor": "#1f2229",        // browser-chrome / PWA colour
  "backgroundColor": "#15171c",   // PWA splash background
  "colors": {                     // optional per-theme colour-scheme overrides
    "dark":  { "accent": "#ff7849", "viewer-model": "#ff7849" },
    "light": { "accent": "#b8430f" }
  },
  "extraCss": "theme.css",        // optional raw-CSS escape hatch (advanced)
  "logo": "logo.svg",             // header logo (omit for text title)
  "source": "examples",           // directory of .scad designs (relative to this file)
  "assets": ["lib"],              // files/dirs to bundle verbatim, preserving paths
  "features": ["textmetrics"],    // OpenSCAD --enable flags for every render
  "fonts": ["LiberationSans-Regular.ttf"],  // fonts mounted from public/fonts/
  "fontPrompt": { "url": "…", "label": "…" },  // optional external-font prompt
  "help": { "sections": [ { "title": "…", "body": "…" } ] },  // optional Help content (single pane or tabs)
  "licenses": [ { "name": "…", "license": "…", … } ],  // optional extra open-source notices (appended)
  "designs": [
    { "id": "tag", "label": "Tag", "heavy": false }
  ]   // omit to auto-discover *.scad in source; presets auto-detected as <id>.json
}
```

- **`source`** — directory of Customizer-style `.scad` designs, relative to this config file. Defaults to `"."`.
- **`assets`** — files/directories to copy verbatim. If omitted, `gen-schema` follows each design's `use`/`include` graph.
- **`features`** — applied to all designs as `--enable=<feature>`.
- **`id`** — namespaces localStorage, IndexedDB, and preset cache. Defaults to `"scadpub"`.
- **`description`** / **`shortName`** / **`icon`** / **`themeColor`** / **`backgroundColor`** — `<meta>` and PWA manifest fields. `gen-schema` generates `public/manifest.webmanifest` and `public/icon.svg`.
- **`colors`** — optional per-theme CSS colour overrides; see [Theme & colour scheme](#theme--colour-scheme).
- **`extraCss`** — optional raw-CSS escape hatch for advanced restyling; see [Custom CSS](#custom-css-extracss).
- **`fontPrompt`** — see [External font prompt](#external-font-prompt-fontprompt).
- **`help`** — `{ intro?, sections?: [{ title, body }], tabs?: [{ label, intro?, sections }] }` where `body` is a Markdown subset (`**bold**`, `` `code` ``, `[text](url)`, blank-line paragraphs, `- ` bullets). Use `sections` for a single pane, or `tabs` for a tabbed guide (many tabs supported). Omit for a generic default. See [Help content](#help-content-help).
- **`licenses`** — optional list of extra third-party software/license notices, **appended** to the app's built-in open-source attributions in the ⓘ panel (the built-ins are never removed). See [Open-source notices](#open-source-notices-licenses).
- **`designs`** — explicit list with id, label, optional `file`. Omit to auto-discover. Set `"heavy": true` to start a design in manual-render mode.
- Missing `source`, `assets`, design, or `logo` paths fail the build with a clear error.
- **Bundled presets** are auto-detected: a `<design>.json` file beside `<design>.scad` is bundled automatically and appears read-only under "Bundled" in the dropdown.

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
- Each value is any plain CSS colour (`#rrggbb`, `rgb()/rgba()`, `hsl()/hsla()`, a
  named colour). Values containing `;`/`{`/`}` are rejected so a config can't break
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
     --code-bg, --overlay, --viewer-bg/-grid/-grid-2, --viewer-model */
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
| `--accent` | accent text/icons: group headers, carets, advisory icon, spinner |
| `--accent-solid` | filled accent surfaces: primary button, badges |
| `--on-accent` | text on `--accent-solid` (usually white) |
| `--focus` | keyboard focus ring |
| `--link` | hyperlinks |
| `--warn` | warning text/icons |
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
> the token map, `extraCss` targets internal class names (`.sidebar`,
> `.param-group`, `.preview-actions .primary`, …). Those are **not a stable API**:
> a future refactor can rename or restructure them and silently break your
> overrides. It is also **outside the accessibility guarantees** — you can hide
> focus rings, break contrast, or disturb layout. If you use it, pin the ScadPub
> version you build against and re-run `npm run smoke` (0 serious/critical
> axe-core violations) after changes. Prefer `colors` for anything it can express.

Load order, last wins: app bundle CSS → `colors` `<style>` → `extraCss` `<link>`.

## External font prompt (`fontPrompt`)

```jsonc
{
  "fontPrompt": {
    "url": "https://example.org/MyFont.ttf",  // required: download link
    "label": "My profile font",               // optional: friendly name
    "family": "My Font Family",               // optional: TTF internal family name
    "heading": "Profile font",                // optional: preset-panel group heading (default "Font")
    "linkText": "Get My Font",                // optional: download-link text (default "Get {label}")
    "note": "…"                               // optional: download-link tooltip
  }
}
```

When set and the user has no font stored, a startup modal explains the font requirement, links to the download, and allows immediate TTF upload. The same link and an **Import font…** button appear in the preset panel. Uploaded fonts persist in IndexedDB. A "Don't remind me again" button suppresses the startup modal permanently. Omit `fontPrompt` and neither the modal nor the font group is shown.

## Help content (`help`)

The **Help** dialog (the **?** button) is generated from `help`. Omit it for a generic, project-agnostic default; supply it to document your own designs. `body` (and `intro`) use the same Markdown subset as everywhere else: `**bold**`, `` `code` ``, `[text](url)`, blank-line paragraphs, and `- ` bullets.

**Single pane** — a flat list of sections (the original form):

```jsonc
{
  "help": {
    "intro": "Configure a design and export an STL.",   // optional, shown at the top
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
