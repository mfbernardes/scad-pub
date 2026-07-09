<!--
meta.contentType: Reference
content plan: give coding agents the commands, architecture map, and repository conventions they need before editing ScadPub.
-->

# Work in ScadPub

Use this guide when working with code in this repository. ScadPub renders OpenSCAD designs client-side via OpenSCAD-WASM as a static site. See [README.md](README.md) for the full project overview.

## Run repository commands

```bash
npm install
npm run dev        # predev fetches pinned WASM + regenerates schema, then vite
npm test           # node:test unit suite; requires Node >= 22
npm run build      # gen-schema (via prebuild) + tsc -b + vite build -> dist/
npm run smoke      # headless end-to-end check of the BUILT app (needs npm run build first)
npm run vis        # visual regression vs tests/screenshots/ baselines
npm run vis -- --update   # rewrite visual baselines
npm run screens    # capture every view (desktop + mobile) of the BUILT app -> screenshots/scadpub-screenshots.zip
```

- **Single test:** `node --import ./tests/register-ts.mjs --test --test-name-pattern "<name>" "tests/<file>.test.mjs"`, or point the glob at one file.
- **Smoke needs Chromium:** `npx playwright install chromium` (first time).
- **Build for a subpath:** `BASE_PATH=/app/ npm run build` (GitHub Pages uses the `BASE_PATH` repo variable).
- **Build a different config:** set `SCADPUB_CONFIG=/path/to/config.json` (read by `gen-schema.mjs`).
- Pre-commit hooks (`.pre-commit-config.yaml`) run `tsc -b` and `npm test` on relevant file changes.

## The generation pipeline (read this first)

The app never reads `.scad` files at runtime directly. Everything flows through a build step. `scripts/gen-schema.mjs` is the heart of the project. Run automatically by the `predev`/`prebuild`/`pretest` npm hooks, it:

1. Reads `scadpub.config.json` (or `$SCADPUB_CONFIG`).
2. Parses each design's OpenSCAD Customizer syntax (`SECTION_RE`/`PARAM_RE`, skipping `[Hidden]`) into a typed parameter schema.
3. Gathers each design's shared `.scad` dependencies from the config's `assets` list, or by following the `use`/`include` graph when `assets` is omitted, and copies them into `public/scad/` while preserving relative paths.
4. Writes `src/generated/designs.json` (the `Schema` in `src/openscad/types.ts`) and generates the PWA assets in `public/`: `manifest.webmanifest` (incl. `categories`, `shortcuts`, `launch_handler`), the icon (`icon.svg` plus rasterized `icon-{192,512,512-maskable,180}.png` and per-device `apple-splash-*.png` via the optional `@resvg/resvg-js`), and `precache-manifest.json` (the service-worker precache list). Config values interpolated into generated SVG/HTML (chrome colours, title, design ids) are validated/escaped first.

Because the form is generated from the same source OpenSCAD parses, the UI can never drift from the design. `generate()` is exported so `tests/gen-schema.test.mjs` drives it against `tests/fixtures/*.config.json`.

`renderHash` (in the schema) is a content hash over every render-affecting input: mounted `.scad`, bundled fonts, render features, the WASM build, and `worker.ts` itself. It is folded into the render cache key so a deploy that changes any render input automatically invalidates persisted geometry.

`src/generated/designs.json`, `public/scad/`, `public/wasm/`, the generated PWA assets (`public/manifest.webmanifest`, `public/icon.svg`, `public/icon-*.png`, `public/apple-splash-*.png`, `public/precache-manifest.json`), and `public/fonts/fonts.conf` are **gitignored / generated**. Never edit them by hand; change the config or sources and re-run. The bundled `.ttf` files under `public/fonts/` are tracked, and so is the hand-written `public/sw.js`.

## Render architecture

Two files, a strict client/worker split (`src/openscad/`):

- **`worker.ts`**: runs OpenSCAD-WASM off the main thread (`callMain` is synchronous and CPU-bound). It fetches WASM and fonts once; large, version-pinned binaries go in a versioned Cache Storage entry, `BIN_CACHE`. It fetches `.scad` sources on first use per worker (not persisted in Cache Storage), since they are small and build-volatile. It instantiates a **fresh module per render** because Emscripten exit state is not reusable. It mounts files into the WASM FS at their source-relative paths so each design's `use`/`include` resolves as in the source tree. Untrusted user-font filenames are path-stripped before mounting.
- **`runner.ts`**: main-thread client. Latest-wins behavior cancels an in-flight render by terminating and respawning the worker because `callMain` cannot be interrupted. The superseded promise rejects with `SupersededError`. The runner has a **two-tier cache**: L1 in-memory LRU in front of optional L2 IndexedDB (`stlCache.ts`), sharing one content-stable key.

`App.tsx` orchestrates debounced auto-render, the "heavy render" brake, export, presets, fonts, URL state, theme, and the PWA install/offline notices. Renders slower than `HEAVY_RENDER_MS` (about 6 s) auto-pause live updates; designs flagged `heavy` start in manual mode. `AppShell.tsx` owns the responsive layout as a pure view extraction: desktop docked `ParamPanel` or mobile `BottomSheet`. All state stays in `App.tsx`. Only the active layout mounts a `Viewer` (`useIsMobile`), which is lazy-loaded to keep three.js out of the initial JS chunk.

The action callbacks (render, export, value/preset changes, file imports, theme, …) flow through the `AppActions` context (`src/lib/appActions.ts`) instead of being drilled prop-by-prop through `AppShell`. `App` builds the bundle, `<AppActionsProvider>` wraps the shell, and the panels (`CommandBar`, `ParamPanel`, `ActionCluster`, `SheetTabs`) read what they need via `useAppActions()`. The provider hands out a **stable** context value backed by a ref, so a consumer never re-renders when a callback's identity changes yet always invokes `App`'s latest implementation. Data and genuinely local glue, such as the PNG-snapshot handler that needs the viewer ref, still flow as props.

## Follow repository conventions

- **Tests import TypeScript source directly.** `tests/register-ts.mjs` + `ts-resolve.mjs` register a Node loader hook that resolves the app's extensionless relative imports (e.g. `./scad`) to `.ts` and uses Node's built-in type-stripping. This is why app code uses extensionless relative imports and why `node:test` runs without a bundler.
- **UI is shadcn/ui (Radix + Tailwind v4).** Primitives live in `src/components/ui/`, scaffolded via `components.json`; compose those instead of hand-rolling controls. Genuinely bespoke pieces, such as `BottomSheet` and the resizable `ParamPanel`, stay custom. Imports use the `@/` alias, wired in `vite.config.ts`, `tsconfig.json`, and `tests/ts-resolve.mjs`.
- **Decoration lives on components as Tailwind utilities.** Use bridged tokens, never raw palette values, so config `colors` overrides keep working. `src/index.css` keeps only structural CSS in a `components` cascade layer below `utilities` (`@layer theme, base, components, utilities`). An `@theme inline` block bridges shadcn `--color-*` tokens onto the existing AA palette without redefining it.
- **Keep script hook classes.** Several literal class names (`.status-pill`, `.param-group`, `.file-manager__name`, `.output-console__close`, `.brand-logo`, …) are inert hooks for the smoke/vis/capture scripts and the `extraCss` escape hatch. Keep them on the elements even though no stylesheet rule targets them.
- **Config-driven chrome.** `vite.config.ts` reads `designs.json` to inject title/description, per-scheme `theme-color`, the Apple web-app title, and the generated iOS splash `<link>`s into `index.html`, and exposes `__APP_ID__`/`__APP_THEME_COLOR__` as compile-time constants. The `id` field namespaces all browser storage (localStorage, IndexedDB, preset cache) so multiple configs can coexist on one origin.
- **Always run live tests and show screenshots for UI changes.** After any visual or interactive change: run `npm run build && npm run smoke`, then `npm run vis`. Attach a screenshot or diff image before reporting the task done. Type-checking and unit tests verify code correctness, not visual behaviour.
- **Accessibility is a hard requirement.** WCAG 2.1 AA; the smoke test fails on any serious/critical axe-core violation. All colours are CSS custom properties in `src/index.css` (separate `--accent` vs `--accent-solid` because one colour rarely passes AA both as small text and as a button fill). After colour changes, run `npm run vis -- --update` and `npm run smoke`.
- **OpenSCAD annotations** are parsed by `gen-schema` and invisible to OpenSCAD/desktop Customizer. The supported annotations are `// @showIf <expr>`, `// @collapsed`, `// @font`, `// @info [Label | unit]`, `// @svg [layers=<param>]`, `// @filledBy <param>`, and file-level `// @description` / `// @icon` / `// @doc`. See [docs/annotations.md](docs/annotations.md) for behavior and examples.
- **Font availability is decided in the app, not OpenSCAD.** `gen-schema` records each bundled font's embedded family (`schema.fontFamilies`) and face (`schema.fontFaces`, `{ family, style }`), both read from the `name` table. It flags font params (string or enum) as `isFont`. `AppShell` unions bundled fonts with imported fonts from `src/lib/fonts.ts`, and every `isFont` param renders as `FontSelect`.
- **FontSelect preserves stored values.** `src/lib/fontChoices.ts` builds the grouped list while preserving stored/enum value strings so listing never dirties a value. Not-loaded design suggestions stay selectable in a marked group with an in-dropdown Import action. `ParamForm` also shows an inline import/fallback hint when the selected `font` value's family is not loaded. The optional `fontFallback` config key pins a weak last-resort family in `fonts.conf` so an imported font cannot become Fontconfig's global default.
- The WASM is single-threaded and needs no `SharedArrayBuffer`/COOP/COEP. `dist/` is a plain static bundle. Serve `.wasm` as `application/wasm`.
