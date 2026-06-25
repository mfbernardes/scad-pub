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
4. Writes `src/generated/designs.json` (the `Schema` in `src/openscad/types.ts`) and generates `public/manifest.webmanifest` + `public/icon.svg`.

Because the form is generated from the same source OpenSCAD parses, the UI can never drift from the design. `generate()` is exported so `tests/gen-schema.test.mjs` drives it against `tests/fixtures/*.config.json`.

`renderHash` (in the schema) is a content hash over every render-affecting input — mounted `.scad`, bundled fonts, render features, the WASM build, and `worker.ts` itself. It's folded into the render cache key so a deploy that changes any render input automatically invalidates persisted geometry.

`src/generated/designs.json` and `public/scad/` and `public/wasm/` are **gitignored / generated** — never edit them by hand; change the config or sources and re-run.

## Render architecture

Two files, a strict client/worker split (`src/openscad/`):

- **`worker.ts`** — runs OpenSCAD-WASM off the main thread (`callMain` is synchronous and CPU-bound). Fetches WASM, asset `.scad`, and fonts once (binaries go in a versioned Cache Storage entry, `BIN_CACHE`), then instantiates a **fresh module per render** (Emscripten exit state isn't reusable). Mounts files into the WASM FS at their source-relative paths so each design's `use`/`include` resolves as in the source tree. Untrusted user-font filenames are path-stripped before mounting.
- **`runner.ts`** — main-thread client. **Latest-wins:** because `callMain` can't be interrupted, a superseding render cancels the in-flight one by terminating and respawning the worker (the superseded promise rejects with `SupersededError`). Has a **two-tier cache**: L1 in-memory LRU in front of optional L2 IndexedDB (`stlCache.ts`), sharing one content-stable key (design + sorted defines + font signature + version).

`App.tsx` orchestrates: debounced auto-render, the "heavy render" brake (renders slower than `HEAVY_RENDER_MS` ≈ 6 s auto-pause live updates; designs flagged `heavy` start in manual mode), export, presets, fonts, URL state, and theme. The three.js `Viewer` is lazy-loaded to keep it out of the initial JS chunk.

## Conventions

- **Tests import TypeScript source directly.** `tests/register-ts.mjs` + `ts-resolve.mjs` register a Node loader hook that resolves the app's extensionless relative imports (e.g. `./scad`) to `.ts` and uses Node's built-in type-stripping. This is why app code uses extensionless relative imports and why `node:test` runs without a bundler.
- **Config-driven chrome.** `vite.config.ts` reads `designs.json` to inject title/description/theme-color into `index.html` and exposes `__APP_ID__`/`__APP_THEME_COLOR__` as compile-time constants. The `id` field namespaces all browser storage (localStorage, IndexedDB, preset cache) so multiple configs can coexist on one origin.
- **Accessibility is a hard requirement.** WCAG 2.1 AA; the smoke test fails on any serious/critical axe-core violation. All colours are CSS custom properties in `src/index.css` (separate `--accent` vs `--accent-solid` because one colour rarely passes AA both as small text and as a button fill). After colour changes, run `npm run vis -- --update` and `npm run smoke`.
- **OpenSCAD annotations** parsed by `gen-schema`, invisible to OpenSCAD/desktop Customizer: `// @showIf <expr>` (conditional control visibility — UI-only, hidden params are still sent to OpenSCAD; see `src/lib/visibility.ts`) and `// @collapsed` above a `/* [Section] */` header (starts the group folded).
- The WASM is single-threaded and needs no `SharedArrayBuffer`/COOP/COEP — `dist/` is a plain static bundle (serve `.wasm` as `application/wasm`).
