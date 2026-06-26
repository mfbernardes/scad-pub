# AGENTS.md

Guidance for AI coding agents working in this repository.

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

- **Single test:** `node --import ./tests/register-ts.mjs --test --test-name-pattern "<name>" "tests/<file>.test.mjs"`
- **Smoke needs Chromium:** `npx playwright install chromium` (first time).
- Pre-commit hooks run `tsc -b` and `npm test` on relevant file changes.

## Live testing requirement

After any UI or visual change:

1. Run `npm run build && npm run smoke` and confirm it passes.
2. Run `npm run vis` and attach a screenshot of the result (or the diff image if a baseline changed).
3. If colours changed, also run `npm run vis -- --update` to rewrite baselines, then share the updated screenshot.

**Never report a UI task complete without showing a screenshot.** Type-checking and unit tests verify code correctness, not visual or interactive behaviour.

## Generation pipeline

`scripts/gen-schema.mjs` (run automatically by `predev`/`prebuild`/`pretest`) drives everything:

1. Reads `scadpub.config.json` (or `$SCADPUB_CONFIG`).
2. Parses each design's OpenSCAD Customizer syntax into a typed parameter schema.
3. Copies shared `.scad` dependencies into `public/scad/`.
4. Writes `src/generated/designs.json` and generates `public/manifest.webmanifest` + `public/icon.svg`.

`src/generated/designs.json`, `public/scad/`, and `public/wasm/` are **gitignored/generated** — never edit them by hand.

## Architecture

- **`src/openscad/worker.ts`** — runs OpenSCAD-WASM off the main thread. Instantiates a fresh module per render; mounts `.scad` files into the WASM FS at source-relative paths.
- **`src/openscad/runner.ts`** — main-thread client. Latest-wins cancellation (terminates and respawns the worker on superseding render). Two-tier cache: L1 in-memory LRU + optional L2 IndexedDB.
- **`App.tsx`** — debounced auto-render, heavy-render brake (`HEAVY_RENDER_MS` ≈ 6 s), export, presets, fonts, URL state, theme. The three.js `Viewer` is lazy-loaded.

## Conventions

- **Tests import TypeScript source directly** via `tests/register-ts.mjs`. App code uses extensionless relative imports (e.g. `./scad`) for this reason.
- **Config-driven chrome.** `vite.config.ts` reads `designs.json` to inject metadata into `index.html`; the `id` field namespaces all browser storage.
- **Accessibility is a hard requirement.** WCAG 2.1 AA — the smoke test fails on any serious/critical axe-core violation. All colours are CSS custom properties in `src/index.css`.
- **OpenSCAD annotations** (parsed by `gen-schema`, invisible to the desktop Customizer): `// @showIf <expr>` (conditional visibility) and `// @collapsed` above a section header.
- The WASM is single-threaded; `dist/` is a plain static bundle — no `SharedArrayBuffer`/COOP/COEP needed.
