# ScadPub

**[Live demo](https://mfbernardes.github.io/scad-pub/)**

> **AI-assisted engineering.** This project was built with heavy AI assistance. It scratches a specific personal itch and was made generic and public in case it's useful to others. It comes with no guarantees of any kind — use it as a starting point, not a finished product.

ScadPub renders a fixed set of OpenSCAD models client-side via OpenSCAD-WASM and serves them as a static website. Users configure Customizer parameters, preview the result in 3D, and export STL or PNG. No server. No data upload. All storage is in the browser.

A JSON config file supplies the designs, branding, and help text. Nothing project-specific is compiled in.

## Quick start

```bash
npm install
npm run dev   # predev fetches the pinned OpenSCAD WASM and regenerates the schema
```

## Features

- **3D preview** via three.js (F6 render); STL and PNG export.
- **Parameter form** generated from OpenSCAD Customizer syntax; never drifts from the design.
- **Conditional parameters** — `// @showIf <expr>` hides irrelevant controls. See [docs/annotations.md](docs/annotations.md).
- **Collapsible groups** — `// @collapsed` above a section header starts it folded. See [docs/annotations.md](docs/annotations.md).
- **Presets** — save/load in the browser; bundled read-only presets per design; import/export OpenSCAD `parameterSets` JSON.
- **PWA** — installable, usable offline after first visit. An in-app toast prompts reload when a new deploy is ready.
- **Persistent fonts** — uploaded TTF/OTF fonts are stored in IndexedDB and re-applied on next visit.
- **Light/dark theme** — follows OS by default; toggled in the header; persisted.
- **Accessibility** — WCAG 2.1 AA: keyboard-trapped modals, visible focus rings, live regions, `rem`-based font size, forced-colors support, 320 px reflow. axe-core smoke test fails on any serious/critical violation.
- **Advisories** — `echo` output and OpenSCAD warnings are shown below the preview.
- **Shareable URLs** — design, non-default parameters, and selected preset are encoded in the URL hash.
- **Auto-render with brake** — re-renders after a debounce. Designs flagged `heavy` start in manual mode. Any render slower than ~6 s auto-pauses live updates.
- **External font prompt** — optional `fontPrompt` config shows a startup dialog for non-bundled fonts. See [docs/config.md](docs/config.md#external-font-prompt-fontprompt).
- **Help** — `?` button shows a config-driven user guide; supports many tabs, each with its own content. See [docs/config.md](docs/config.md#help-content-help).
- **Open-source notice** — ⓘ button lists bundled third-party components with licenses and source links; a deployment can append its own notices via config (built-ins are never removed). See [docs/config.md](docs/config.md#open-source-notices-licenses).

## Repository layout

```
examples/           self-contained example design (default source)
  tag.scad          no library/font dependencies
  tag.json          bundled presets for tag.scad
public/
  wasm/             OpenSCAD WASM (fetched, gitignored) — scripts/fetch-wasm.mjs
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
  fetch-wasm.mjs    download the pinned OpenSCAD WASM snapshot (auto-run by predev/prebuild)
  smoke.mjs         headless end-to-end check of the built app
tests/              node:test unit suite + fixtures + visual baselines
scadpub.config.json the config: title, branding, designs, help
.github/workflows/ci.yml  unit tests + build + headless smoke; uploads dist
```

The OpenSCAD WASM is version-pinned in `scripts/fetch-wasm.mjs` (`OPENSCAD_VERSION`) and checksum-verified.

## Configuration

See **[docs/config.md](docs/config.md)** for the full `scadpub.config.json` reference, including theme tokens, title/logo variants, and the external font prompt.

See **[docs/annotations.md](docs/annotations.md)** for the `@showIf` and `@collapsed` OpenSCAD annotations.

## Develop

```bash
npm install
npm run dev      # predev fetches the WASM (first run only) and regenerates the schema
npm test         # unit tests (requires Node ≥ 22)
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

The `.scad` files you bundle are input data to OpenSCAD, not a derivative of it.
