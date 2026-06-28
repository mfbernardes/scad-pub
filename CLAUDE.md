# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ScadPub renders OpenSCAD designs client-side via OpenSCAD-WASM as a static site. See [README.md](README.md) for the full project overview.

## Commands

```bash
npm install
npm run dev        # predev fetches pinned WASM + regenerates schema, then vite
npm test           # node:test unit suite — requires Node >= 22
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

The app never reads `.scad` files at runtime directly — everything flows through a build step. **`scripts/gen-schema.mjs` is the heart of the project.** Run automatically by the `predev`/`prebuild`/`pretest` npm hooks, it:

1. Reads `scadpub.config.json` (or `$SCADPUB_CONFIG`).
2. Parses each design's OpenSCAD Customizer syntax (`SECTION_RE`/`PARAM_RE`, skipping `[Hidden]`) into a typed parameter schema.
3. Gathers each design's shared `.scad` dependencies — from the config's `assets` list, or by following the `use`/`include` graph when `assets` is omitted — and copies them (preserving relative paths) into `public/scad/`.
4. Writes `src/generated/designs.json` (the `Schema` in `src/openscad/types.ts`) and generates the PWA assets in `public/`: `manifest.webmanifest` (incl. `categories`, `shortcuts`, `launch_handler`), the icon (`icon.svg` plus rasterized `icon-{192,512,512-maskable,180}.png` and per-device `apple-splash-*.png` via the optional `@resvg/resvg-js`), and `precache-manifest.json` (the service-worker precache list). Config values interpolated into generated SVG/HTML (chrome colours, title, design ids) are validated/escaped first.

Because the form is generated from the same source OpenSCAD parses, the UI can never drift from the design. `generate()` is exported so `tests/gen-schema.test.mjs` drives it against `tests/fixtures/*.config.json`.

`renderHash` (in the schema) is a content hash over every render-affecting input — mounted `.scad`, bundled fonts, render features, the WASM build, and `worker.ts` itself. It's folded into the render cache key so a deploy that changes any render input automatically invalidates persisted geometry.

`src/generated/designs.json`, `public/scad/`, `public/wasm/`, the generated PWA assets (`public/manifest.webmanifest`, `public/icon.svg`, `public/icon-*.png`, `public/apple-splash-*.png`, `public/precache-manifest.json`), and `public/fonts/fonts.conf` (templated from the optional `fontFallback` config key) are **gitignored / generated** — never edit them by hand; change the config or sources and re-run. The bundled `.ttf` files under `public/fonts/` are tracked, and so is the hand-written `public/sw.js`.

## Render architecture

Two files, a strict client/worker split (`src/openscad/`):

- **`worker.ts`** — runs OpenSCAD-WASM off the main thread (`callMain` is synchronous and CPU-bound). Fetches WASM and fonts once (large, version-pinned binaries go in a versioned Cache Storage entry, `BIN_CACHE`); `.scad` sources are fetched fresh each time (they're small and build-volatile). Instantiates a **fresh module per render** (Emscripten exit state isn't reusable). Mounts files into the WASM FS at their source-relative paths so each design's `use`/`include` resolves as in the source tree. Untrusted user-font filenames are path-stripped before mounting.
- **`runner.ts`** — main-thread client. **Latest-wins:** because `callMain` can't be interrupted, a superseding render cancels the in-flight one by terminating and respawning the worker (the superseded promise rejects with `SupersededError`). Has a **two-tier cache**: L1 in-memory LRU in front of optional L2 IndexedDB (`stlCache.ts`), sharing one content-stable key (design + sorted defines + font signature + version).

`App.tsx` orchestrates: debounced auto-render, the "heavy render" brake (renders slower than `HEAVY_RENDER_MS` ≈ 6 s auto-pause live updates; designs flagged `heavy` start in manual mode), export (native Web Share where available, else download), presets, fonts, URL state, theme, and the PWA install/offline notices. `AppShell.tsx` owns the responsive layout (desktop docked `ParamPanel` / mobile `BottomSheet`) as a pure view extraction — all state stays in `App.tsx`; only the active layout mounts a `Viewer` (`useIsMobile`), which is lazy-loaded to keep three.js out of the initial JS chunk.

The **action callbacks** (render, export, value/preset changes, file imports, theme, …) flow through the `AppActions` context (`src/lib/appActions.ts`) instead of being drilled prop-by-prop through `AppShell`: `App` builds the bundle and `<AppActionsProvider>` wraps the shell; the panels (`CommandBar`, `ParamPanel`, `ActionCluster`, `SheetTabs`) read what they need via `useAppActions()`. The provider hands out a **stable** context value backed by a ref, so a consumer never re-renders when a callback's identity changes yet always invokes `App`'s latest implementation. Data (and genuinely local glue like the PNG-snapshot handler, which needs the viewer ref) still flow as props.

## Conventions

- **Tests import TypeScript source directly.** `tests/register-ts.mjs` + `ts-resolve.mjs` register a Node loader hook that resolves the app's extensionless relative imports (e.g. `./scad`) to `.ts` and uses Node's built-in type-stripping. This is why app code uses extensionless relative imports and why `node:test` runs without a bundler.
- **UI is shadcn/ui (Radix + Tailwind v4).** Primitives live in `src/components/ui/` (scaffolded via `components.json`) — compose those instead of hand-rolling controls; genuinely bespoke pieces (e.g. `BottomSheet`, the resizable `ParamPanel`) stay custom. Imports use the `@/` alias, wired in `vite.config.ts`, `tsconfig.json`, and `tests/ts-resolve.mjs`. `src/index.css` declares explicit cascade layers (`@layer theme, base, components, legacy, utilities`) so shadcn utilities win over the pre-port `legacy` CSS while that still beats preflight; an `@theme inline` block bridges shadcn `--color-*` tokens onto the existing AA palette without redefining it.
- **Config-driven chrome.** `vite.config.ts` reads `designs.json` to inject title/description, per-scheme `theme-color`, the Apple web-app title, and the generated iOS splash `<link>`s into `index.html`, and exposes `__APP_ID__`/`__APP_THEME_COLOR__` as compile-time constants. The `id` field namespaces all browser storage (localStorage, IndexedDB, preset cache) so multiple configs can coexist on one origin.
- **Always run live tests and show screenshots for UI changes.** After any visual or interactive change: run `npm run build && npm run smoke`, then `npm run vis`. Attach a screenshot (or diff image) before reporting the task done — type-checking and unit tests verify code correctness, not visual behaviour.
- **Accessibility is a hard requirement.** WCAG 2.1 AA; the smoke test fails on any serious/critical axe-core violation. All colours are CSS custom properties in `src/index.css` (separate `--accent` vs `--accent-solid` because one colour rarely passes AA both as small text and as a button fill). After colour changes, run `npm run vis -- --update` and `npm run smoke`.
- **OpenSCAD annotations** parsed by `gen-schema`, invisible to OpenSCAD/desktop Customizer: `// @showIf <expr>` (conditional control visibility — UI-only, hidden params are still sent to OpenSCAD; see `src/lib/visibility.ts`), `// @collapsed` above a `/* [Section] */` header (starts the group folded), and `// @font` above a string parameter or a `// [..]` enum dropdown (marks it a font-family selector — explicit only, no name-based auto-detection; flagging a dropdown keeps it a dropdown for the desktop Customizer while adding the in-app availability check).
- **Font availability is decided in the app, not OpenSCAD.** `gen-schema` records each bundled font's embedded family (`schema.fontFamilies`, read from the `name` table) and flags font params (string or enum) `isFont`. `AppShell` unions those with the families of imported fonts (`src/lib/fonts.ts` parses them) and `ParamForm` shows an inline import / fallback affordance when a `font` value's family isn't loaded — instead of guessing from render output, which is unreliable in WASM. The optional `fontFallback` config key pins a weak last-resort family in `fonts.conf` so an imported font can't become Fontconfig's global default.
- The WASM is single-threaded and needs no `SharedArrayBuffer`/COOP/COEP — `dist/` is a plain static bundle (serve `.wasm` as `application/wasm`).
