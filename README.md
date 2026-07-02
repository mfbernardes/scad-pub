# ScadPub

**[Live demo](https://mfbernardes.github.io/scad-pub/)**

> **AI-assisted engineering.** This project was built with heavy AI assistance. It scratches a specific personal itch and was made generic and public in case it's useful to others. It comes with no guarantees of any kind — use it as a starting point, not a finished product.

ScadPub renders a fixed set of OpenSCAD models client-side via OpenSCAD-WASM and serves them as a static website. Users configure Customizer parameters, preview the result in 3D, and export a colour-bearing 3MF or a PNG. No server. No data upload. All storage is in the browser.

A JSON config file supplies the designs, branding, and help text. Nothing project-specific is compiled in.

## Quick start

```bash
npm install
npm run dev   # predev fetches the pinned OpenSCAD WASM and regenerates the schema
```

## Features

- **3D preview** via three.js (OpenSCAD full/manifold render), showing per-object colour; mouse/touch orbit and zoom; colour-bearing 3MF and PNG export.
- **Viewer controls** — map-style overlay buttons on the preview (a view picker for standard camera angles, reset view, a dimensions toggle, optional zoom in/out, plus a fullscreen toggle in a browser tab), shown once a render succeeds; each button can be hidden per deployment (see [docs/config.md](docs/config.md#ui-behaviour--pwa)). Mouse/touch orbit and zoom work regardless.
- **Dimensions overlay** — the ruler button draws W×D×H callouts around the model and opens a measurements panel that leads with the bounding box (W × D × H mm) and lists any parameter values a design marks `// @info`. See [docs/annotations.md](docs/annotations.md).
- **Parameter form** generated from OpenSCAD Customizer syntax; never drifts from the design.
- **Conditional parameters** — `// @showIf <expr>` hides irrelevant controls. See [docs/annotations.md](docs/annotations.md).
- **Collapsible groups** — `// @collapsed` above a section header starts it folded. See [docs/annotations.md](docs/annotations.md).
- **Presets** — a picker with **Bundled** (read-only, shipped per design) and **Yours** (saved in the browser) sections; save the current parameters as a named preset. Bundled presets use OpenSCAD's `parameterSets` JSON format, so they round-trip with the desktop Customizer.
- **Responsive UI** — full-bleed 3D canvas with a docked, resizable parameter panel on desktop and a persistent, detented bottom sheet on mobile. The theme switch and render-status indicator sit in the top bar of both layouts, so nothing is desktop-only. Built on [shadcn/ui](https://ui.shadcn.com/) (Radix primitives + Tailwind v4) over the existing AA-tuned colour tokens.
- **PWA** — installable and usable offline after the first visit: at install the service worker precaches the shell and runtime assets *and* warms the renderer's own binary cache (the ~10 MB WASM + fonts), so offline rendering works even if nothing was rendered while online. The install affordance is demoted: it appears only when the browser offers it, plus a one-time post-export hint — never a standing button. A persistent offline indicator and a reload toast (on a new deploy) keep state clear. Build-time generated icons (incl. a maskable icon and iOS launch screens) and, on Android, per-design app shortcuts. See [docs/config.md](docs/config.md#ui-behaviour--pwa).
- **Persistent user files** — uploaded fonts, SVGs and other referenced files are stored in IndexedDB and re-applied on next visit.
- **Light/dark theme** — follows OS by default; toggled from the top bar on desktop and mobile; persisted.
- **Accessibility** — WCAG 2.1 AA: keyboard-trapped modals, visible focus rings, live regions, `rem`-based font size, forced-colors support, 320 px reflow. axe-core smoke test fails on any serious/critical violation.
- **Notices & log** — OpenSCAD `echo` notices, warnings and `assert` failures are parsed into an **Output console**, opened from the **Output** button in the action row — a bell that rings and shows a count badge while notices are pending (it also auto-opens the first time a render surfaces a notice or assert). Its Notices tab lists them with per-category coloured count badges; the raw log sits one tab over. See [docs/config.md](docs/config.md#notice-badges-notices).
- **Share & export** — design, non-default parameters, and selected preset are encoded in the URL hash. On devices that support the Web Share API, the Share button and the model export hand off to the native share sheet (otherwise: copy link / download a colour-bearing 3MF or PNG).
- **Auto-render with brake** — re-renders after a debounce. Designs flagged `heavy` start in manual mode. Any render slower than ~6 s auto-pauses live updates.
- **Import file** — optional `fileImport` config adds an upload button for non-bundled files (fonts mounted for OpenSCAD; SVGs/data files referenceable in designs via `import()`/`surface()`). See [docs/config.md](docs/config.md#import-file-fileimport).
- **Help** — `?` button shows a config-driven user guide; supports many tabs, each with its own content. See [docs/config.md](docs/config.md#help-content-help).
- **Open-source notice** — ⓘ button lists bundled third-party components with licenses and source links; a deployment can append its own notices via config (built-ins are never removed). See [docs/config.md](docs/config.md#open-source-notices-licenses).

## Repository layout

```
examples/           self-contained example design (default source)
  tag.scad          embossed text (font) + an extruded SVG emblem
  emblem.svg        default emblem the tag imports (swap via "Import file")
  tag.json          bundled presets for tag.scad
public/
  wasm/             OpenSCAD WASM (fetched, gitignored) — scripts/fetch-wasm.mjs
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
                    ui/ — shadcn primitives (Radix + Tailwind)
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

## Configuration

See **[docs/config.md](docs/config.md)** for the full `scadpub.config.json` reference, including theme tokens, title/logo variants, and the file-import button.

See **[docs/annotations.md](docs/annotations.md)** for the `@showIf` and `@collapsed` OpenSCAD annotations.

## Develop

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

## Publish

The build output (`dist/`) is a plain static bundle. No special headers are required.

```bash
npm run build                 # serves at "/"
BASE_PATH=/app/ npm run build # if served under a subpath
```

Serve `.wasm` files with `Content-Type: application/wasm`.

## Limitations

- Only the Liberation font set is bundled. Designs requiring other fonts may render differently with the fallback.
- Imported files are referenced by name; a design's `import("x.svg")` must match the uploaded file's name. Fonts are matched by family via fontconfig, so their filename doesn't matter.
- The in-browser preview uses the same pinned OpenSCAD version as the native CLI but is not byte-identical in all cases.
- No live OpenCSG preview; auto-render is debounced. Large text at fine facets is slower and uses more memory.

## License

ScadPub source code: **MIT** (see [LICENSE](LICENSE)).

Bundled third-party components include React, three.js, and the shadcn/ui stack (Radix UI, lucide-react, sonner, and small Tailwind helpers) — MIT, except lucide-react (ISC) and class-variance-authority (Apache-2.0); the Liberation fonts (OFL-1.1); and OpenSCAD-WASM (GPL-2.0-or-later). ScadPub invokes OpenSCAD-WASM as a separate WebAssembly module; its GPL applies only to that component. See [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) for the full list, and the in-app **ⓘ** panel (`src/lib/licenses.ts`) for the core attributions.

The `.scad` files you bundle are input data to OpenSCAD, not a derivative of it.
