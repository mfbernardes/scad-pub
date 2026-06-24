# ScadPub

**[Live demo](https://mfbernardes.github.io/scad-pub/)**

> **AI-assisted engineering.** This project was built with heavy AI assistance. It scratches a specific personal itch and was made generic and public in case it's useful to others. It comes with no guarantees of any kind — use it as a starting point, not a finished product.

ScadPub renders a fixed set of OpenSCAD models client-side via OpenSCAD-WASM and serves them as a static website. Users configure Customizer parameters, preview the result in 3D, and export STL or PNG. No server. No data upload. All storage is in the browser.

A JSON config file supplies the designs, branding, and help text. Nothing project-specific is compiled in.

## Quick start

```bash
npm install
./scripts/fetch-wasm.sh   # downloads the pinned OpenSCAD WASM into public/wasm/
npm run dev               # predev regenerates the schema from the configured source
```

## Features

- **3D preview** via three.js (F6 render); STL and PNG export.
- **Parameter form** generated from OpenSCAD Customizer syntax; never drifts from the design.
- **Conditional parameters** — `// @showIf <expr>` in a parameter's doc block hides its control when irrelevant. See [Conditional parameters](#conditional-parameters--showif).
- **Collapsible groups** — `// @collapsed` above a `/* [Section] */` header starts it folded. See [Collapsible groups](#collapsible-groups--collapsed).
- **Presets** — save/load in the browser; bundled read-only presets per design; import/export OpenSCAD `parameterSets` JSON compatible with `openscad -p file.json -P "Set"`.
- **PWA** — installable, usable offline after first visit. An in-app toast prompts the user to reload when a new deploy is ready.
- **Persistent fonts** — uploaded TTF/OTF fonts are stored in IndexedDB and re-applied on next visit.
- **Light/dark theme** — follows OS by default; toggled in the header; persisted. CSS custom properties control all colours; see [Theme & colour scheme](#theme--colour-scheme).
- **Accessibility** — WCAG 2.1 AA: keyboard-trapped modals, visible focus rings, live regions for render/export/preset events, `rem`-based font size, forced-colors support, 320 px reflow. axe-core smoke test fails on any serious/critical violation.
- **Advisories** — `echo` output and OpenSCAD warnings are shown below the preview.
- **Shareable URLs** — design, non-default parameters, and selected preset are encoded in the URL hash. A "Copy link" button puts the URL on the clipboard. State is also restored on plain reload.
- **Auto-render with brake** — re-renders after a debounce. Designs flagged `heavy` start in manual mode. Any render slower than ~6 s auto-pauses live updates.
- **External font prompt** — optional `fontPrompt` config shows a startup dialog and preset-panel link to upload a non-bundled font. See [External font prompt](#external-font-prompt-fontprompt).
- **Open-source notice** — ⓘ button lists bundled third-party components with licenses and source links (`src/lib/licenses.ts`).

## Repository layout

```
examples/           self-contained example design (default source)
  tag.scad          no library/font dependencies
  tag.json          bundled presets for tag.scad
public/
  wasm/             OpenSCAD WASM (fetched, gitignored) — scripts/fetch-wasm.sh
  fonts/            Liberation TTFs + fonts.conf
  scad/             designs copied for the renderer (generated, gitignored)
  manifest.webmanifest, sw.js, icon.svg
src/
  openscad/
    worker.ts       runs OpenSCAD off the main thread
    runner.ts       main-thread client (latest-wins; cancels superseded renders)
    types.ts        worker protocol + parameter schema types
  components/       Viewer (three.js), ParamForm, PresetBar, modals
  lib/              value formatting, presets, URL state, validation
  generated/        designs.json (from scripts/gen-schema.mjs, gitignored)
  App.tsx           orchestration: debounced auto-render, export, presets
scripts/
  gen-schema.mjs    parse Customizer params → schema + copy sources
  fetch-wasm.sh     download the pinned OpenSCAD WASM snapshot
  smoke.mjs         headless end-to-end check of the built app
tests/              node:test unit suite + fixtures + visual baselines
scadpub.config.json the config: title, branding, designs, help
.github/workflows/ci.yml  unit tests + build + headless smoke; uploads dist
```

The OpenSCAD WASM is version-pinned in `scripts/fetch-wasm.sh` (`OPENSCAD_VERSION`) and checksum-verified. It ships Manifold and textmetrics, is single-threaded, and requires no `SharedArrayBuffer`, COOP, or COEP headers.

## Configuring what's bundled

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

Config fields:

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

### Title & logo

- **`title`** — browser tab title and header text.
- **`logo`** — path relative to the config file; shown in the header instead of the title text. The `title` is still used for `document.title` and the logo's `alt`. Provide per-theme variants:

  ```jsonc
  { "logo": { "light": "branding/logo-light.svg", "dark": "branding/logo-dark.svg" } }
  ```

  A single string applies to both themes. In the object form, a missing side falls back to the other.

### Theme & colour scheme

All colours are CSS custom properties in [`src/index.css`](src/index.css):

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

### External font prompt (`fontPrompt`)

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

### Conditional parameters (`// @showIf`)

Add `// @showIf <expr>` anywhere in a parameter's doc comment block:

```scad
/* [Arrow] */
arrow = "none"; // [none, left, right, up, down]

// Arrow style. Ignored when arrow is "none".
// @showIf arrow != none
arrow_style = "solid"; // [solid:Solid arrow, outline:Open (outline) arrow]
```

`gen-schema.mjs` extracts the annotation (it never appears in the label or tooltip). OpenSCAD and the desktop Customizer treat it as an ordinary comment.

Expression syntax:

| Form | True when |
|---|---|
| `name` | `name` is truthy |
| `!name` | `name` is falsy |
| `name == value` | `name` equals `value` |
| `name != value` | `name` differs from `value` |

`value` is a bare word, quoted string, number, or `true`/`false`. Combine with `&&` and `||` (OR of ANDs). A malformed expression fails safe — the control stays visible.

Visibility is UI-only: hidden parameters are still sent to OpenSCAD, their values are retained, and their DOM nodes are removed.

### Collapsible groups (`// @collapsed`)

Put `// @collapsed` directly above a section header to start it folded:

```scad
// @collapsed
/* [Mounting] */
mounting = "none"; // [none, screw, countersunk]
```

OpenSCAD and the desktop Customizer ignore it. Collapsed parameters remain in the DOM and are still sent to OpenSCAD.

## Develop

```bash
npm install
./scripts/fetch-wasm.sh
npm run dev
```

Unit tests (requires Node ≥ 22):

```bash
npm test
```

Build and headless smoke test (end-to-end render, design switch, font upload, preset apply, `@showIf` visibility, share link, STL/PNG export, axe-core):

```bash
npm run build
npx playwright install chromium   # first time only
npm run smoke
```

Visual regression against baselines in `tests/screenshots/`:

```bash
npm run vis            # compare
npm run vis -- --update  # rewrite baselines
```

Baselines are environment-pinned; regenerate after intentional UI changes or OS/renderer switches. Visual regression is not in CI by default.

CI (`.github/workflows/ci.yml`) runs unit tests, build, and smoke test on every push/PR and uploads `dist` as an artifact.

## Publish

The build output (`dist/`) is a plain static bundle. No special headers are required.

```bash
npm run build                 # serves at "/"
BASE_PATH=/app/ npm run build # if served under a subpath
```

Serve `.wasm` files with `Content-Type: application/wasm`.

## Limitations

- Only the Liberation font set is bundled. Designs requiring other fonts may render differently with the fallback.
- `fontPrompt` links to an external download rather than fetching it directly; browsers block cross-origin fetches from sites that do not send `Access-Control-Allow-Origin`.
- The in-browser preview uses the same pinned OpenSCAD version as the native CLI but is not byte-identical in all cases.
- No live OpenCSG preview; auto-render is debounced. Large text at fine facets is slower and uses more memory.

## License

ScadPub source code: **MIT** (see [LICENSE](LICENSE)).

Bundled third-party components: React and three.js (MIT), Liberation fonts (OFL-1.1), OpenSCAD-WASM (GPL-2.0-or-later). ScadPub invokes OpenSCAD-WASM as a separate WebAssembly module; its GPL applies only to that component. See [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) and the in-app **ⓘ** panel (`src/lib/licenses.ts`).

The `.scad` files you bundle are input data to OpenSCAD, not a derivative of it. Review the individual licenses linked above for the details relevant to your use case.
