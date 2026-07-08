<!--
meta.contentType: Landing
content plan: summarize what ScadPub does, show how to run it, list the main capabilities, and point maintainers to the configuration and annotation references.
-->

# ScadPub

**[Live demo](https://mfbernardes.github.io/scad-pub/)**

> AI-assisted engineering: this project used heavy AI assistance. It started as a personal tool and is public in case it helps another OpenSCAD workflow. Treat it as a starting point, not a finished product.

ScadPub renders a fixed set of OpenSCAD models client-side via OpenSCAD-WASM and serves them as a static website. You configure Customizer parameters, preview the result in 3D, and export a colour-bearing 3MF or a PNG. No server. No data upload. All storage is in the browser.

A JSON config file supplies the designs, branding, and help text. Nothing project-specific is compiled in.

## Run the app locally

Install dependencies and start the Vite development server:

```bash
npm install
npm run dev   # predev fetches the pinned OpenSCAD WASM and regenerates the schema
```

## What ScadPub includes

ScadPub packages the configurator, renderer, offline shell, and export flow into one static bundle:

- **3D preview** via three.js (OpenSCAD full/manifold render), showing per-object colour; mouse/touch orbit and zoom; colour-bearing 3MF and PNG export.
- **Viewer controls**: map-style overlay buttons appear after a successful render. Deployments can hide the view picker, reset view, dimensions toggle, zoom buttons, or fullscreen toggle. Mouse/touch orbit and zoom work regardless. See [docs/config.md](docs/config.md#ui-behaviour-and-pwa).
- **Dimensions overlay**: the ruler button draws W x D x H callouts around the model and opens a measurements panel. The panel starts with the bounding box, then lists any parameter values a design marks `// @info`. See [docs/annotations.md](docs/annotations.md).
- **Parameter form** generated from OpenSCAD Customizer syntax; never drifts from the design.
- **Conditional parameters**: `// @showIf <expr>` hides irrelevant controls. See [docs/annotations.md](docs/annotations.md).
- **Collapsible groups**: `// @collapsed` above a section header starts it folded. See [docs/annotations.md](docs/annotations.md).
- **Presets**: a picker has **Ready-made** and **Saved by you** sections. Save the current parameters as a named preset. Bundled presets use OpenSCAD's `parameterSets` JSON format, so they round-trip with the desktop Customizer.
- **Responsive UI**: the desktop layout uses a full-bleed 3D canvas with a docked, resizable parameter panel. The mobile layout uses the same canvas with a persistent, detented bottom sheet. The theme switch and render-status indicator sit in the top bar on both layouts.
- **Theme tokens**: shadcn/ui, Radix primitives, and Tailwind v4 sit on AA-tuned colour tokens. Deployments can override colours, radii, and fonts from the config.
- **Progressive Web App (PWA)**: the app is installable and works offline after the first visit. At install, the service worker precaches the shell and runtime assets and warms the renderer's own binary cache. The install affordance appears only when the browser offers it, plus a one-time post-export hint. See [docs/config.md](docs/config.md#ui-behaviour-and-pwa).
- **Persistent user files**: uploaded fonts, Scalable Vector Graphics (SVG) files, and other referenced files are stored in IndexedDB and re-applied on next visit.
- **Light/dark theme**: follows the operating system by default, toggles from the top bar, and persists.
- **Accessibility**: Web Content Accessibility Guidelines (WCAG) 2.1 AA coverage includes keyboard-trapped modals, visible focus rings, live regions, `rem`-based font size, forced-colors support, and 320 px reflow. The axe-core smoke test fails on any serious or critical violation.
- **Notices & log**: OpenSCAD `echo` notices, warnings, and `assert` failures appear in a **Messages** console opened from the top-bar bell. The bell shows a count badge while notices are pending. See [docs/config.md](docs/config.md#notice-badges-notices).
- **Share & export**: design, non-default parameters, and selected preset are encoded in the URL hash. Devices that support the Web Share API use the native share sheet. Other devices copy a link or download a colour-bearing 3MF or PNG.
- **Live preview with brake**: the preview re-renders after a debounce. Designs flagged `heavy` start in manual mode. Any render slower than ~6 s pauses live updates for that design.
- **Import file**: optional `fileImport` config adds an upload button for non-bundled files. Fonts are mounted for OpenSCAD, and SVG/data files can be referenced with `import()` or `surface()`. See [docs/config.md](docs/config.md#import-file-fileimport).
- **Help**: the `?` button shows a config-driven user guide with one or more tabs. See [docs/config.md](docs/config.md#help-content-help).
- **Open-source notice**: the ⓘ button lists bundled third-party components with licenses and source links. A deployment can append its own notices via config. See [docs/config.md](docs/config.md#open-source-notices-licenses).

## Repository layout

```text
examples/           self-contained example design (default source)
  tag.scad          embossed text (font) + an extruded SVG emblem
  emblem.svg        default emblem the tag imports (swap via "Import file")
  tag.json          bundled presets for tag.scad
public/
  wasm/             OpenSCAD WASM (fetched, gitignored): scripts/fetch-wasm.mjs
  fonts/            Liberation TTFs (tracked); fonts.conf (generated, gitignored)
  scad/             designs copied for the renderer (generated, gitignored)
  sw.js             service worker (precaches the shell + runtime assets)
  manifest.webmanifest, icon*.svg/png, apple-splash-*.png, precache-manifest.json  (generated, gitignored)
src/
  openscad/
    worker.ts       runs OpenSCAD off the main thread
    runner.ts       main-thread client (latest-wins; cancels superseded renders)
    types.ts        worker protocol + parameter schema types
  components/       AppShell (responsive layout), CommandBar, ParamPanel, BottomSheet,
                    Viewer (three.js), ParamForm, PresetPicker, OutputConsole, modals;
                    ui/: shadcn primitives (Radix + Tailwind)
  lib/              value formatting, presets, URL state, validation, PWA/share hooks
  generated/        designs.json (from scripts/gen-schema.mjs, gitignored)
  App.tsx           orchestration: debounced auto-render, export, presets
scripts/
  gen-schema.mjs    parse Customizer params → schema + copy sources + PWA manifest/icons
  fetch-wasm.mjs    download the pinned OpenSCAD WASM snapshot (auto-run by predev/prebuild)
  smoke.mjs         headless end-to-end check of the built app
tests/              node:test unit suite + fixtures + visual baselines
scadpub.config.json the config: title, branding, designs, help
.github/workflows/ci.yml  unit tests + build + headless smoke; uploads dist
```

The OpenSCAD WASM is version-pinned in `scripts/fetch-wasm.mjs` (`OPENSCAD_VERSION`) and checksum-verified.

## Configure deployments

The configuration docs cover build-time options and OpenSCAD comment annotations:

See **[docs/config.md](docs/config.md)** for the full `scadpub.config.json` reference, including theme tokens, title/logo variants, and the file-import button.

See **[docs/annotations.md](docs/annotations.md)** for the `@showIf` and `@collapsed` OpenSCAD annotations.

## Develop locally

Use these commands while changing the app or build pipeline:

```bash
npm install
npm run dev      # predev fetches the WASM (first run only) and regenerates the schema
npm test         # unit tests (requires Node ≥ 22)
```

Build and headless smoke test (end-to-end render, design switch, font upload, preset apply, `@showIf` visibility, share link, 3MF/PNG export, axe-core):

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

## Publish the static bundle

The build output (`dist/`) is a plain static bundle. No special headers are required.

Two deploy targets are supported. Continuous integration (CI) deploys to **GitHub Pages** on every push to `main`; that is the authoritative public-site path. `npm run deploy` publishes the same bundle to **Cloudflare** via `wrangler` for manual deployments.

```bash
npm run build                 # serves at "/"
BASE_PATH=/app/ npm run build # if served under a subpath
```

Serve `.wasm` files with `Content-Type: application/wasm`.

## Known limits

These limits come from the bundled assets and the client-side OpenSCAD runtime:

- Only the Liberation font set is bundled. Designs requiring other fonts may render differently with the fallback.
- Imported files are referenced by name; a design's `import("x.svg")` must match the uploaded file's name. Fonts are matched by family via fontconfig, so their filename doesn't matter.
- The in-browser preview uses the same pinned OpenSCAD version as the native CLI but is not byte-identical in all cases.
- No live OpenCSG preview; auto-render is debounced. Large text at fine facets is slower and uses more memory.

## License details

ScadPub source code: **MIT** (see [LICENSE](LICENSE)).

Bundled third-party components include React, three.js, and the shadcn/ui stack. Most use MIT-compatible licenses. OpenSCAD-WASM is GPL-2.0-or-later; ScadPub invokes it as a separate WebAssembly module, so its GPL applies only to that component. See [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) for the full list and the in-app ⓘ panel for the core attributions.

The `.scad` files you bundle are input data to OpenSCAD, not a derivative of it.
