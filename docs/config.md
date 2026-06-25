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
  "logo": "logo.svg",             // header logo (omit for text title)
  "source": "examples",           // directory of .scad designs (relative to this file)
  "assets": ["lib"],              // files/dirs to bundle verbatim, preserving paths
  "features": ["textmetrics"],    // OpenSCAD --enable flags for every render
  "fonts": ["LiberationSans-Regular.ttf"],  // fonts mounted from public/fonts/
  "fontPrompt": { "url": "…", "label": "…" },  // optional external-font prompt
  "help": { "sections": [ { "title": "…", "body": "…" } ] },  // optional Help content
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
- **`fontPrompt`** — see [External font prompt](#external-font-prompt-fontprompt).
- **`help`** — `{ intro?, sections: [{ title, body }] }` where `body` is a Markdown subset (`**bold**`, `` `code` ``, `[text](url)`, blank-line paragraphs, `- ` bullets). Omit for a generic default.
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

All colours are CSS custom properties in [`src/index.css`](../src/index.css):

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
