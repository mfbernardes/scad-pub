<!--
meta.contentType: Reference
content plan: orient a coding agent in ScadPub — the commands, the one build-time invariant everything rests on, and the gotchas that reading the source will not reveal. Detail lives in docs/.
-->

# Work in ScadPub

ScadPub renders OpenSCAD designs client-side via OpenSCAD-WASM as a static site.
[README.md](README.md) is the project overview, [docs/config.md](docs/config.md) the full
config reference, [docs/annotations.md](docs/annotations.md) the annotation vocabulary. Read
the source rather than trusting a summary here — this file covers what the source does not say
out loud.

## Commands

```bash
npm install
npm run dev        # predev fetches pinned WASM + regenerates the schema, then vite
npm test           # node:test unit suite; Node >= 22
npm run build      # prebuild gen-schema + tsc -b + vite build -> dist/
npm run smoke      # headless axe + end-to-end check of the BUILT app — build first
npm run vis        # visual regression vs tests/screenshots/ (--update to rebaseline)
npm run screens    # capture every desktop + mobile view of the BUILT app
```

- One test: `node --import ./tests/register-ts.mjs --test --test-name-pattern "<name>" tests/<file>.test.mjs`.
- Chromium for smoke/vis/screens: `npx playwright install chromium` on first run.
- `BASE_PATH=/app/ npm run build` targets a subpath (GitHub Pages sets it from a repo
  variable); `SCADPUB_CONFIG=/path/to/config.json` builds a different deployment.
- Pre-commit runs `tsc -b` and `npm test` on relevant changes.

## Everything renderable is generated at build time

`scripts/gen-schema.mjs` — run by the `predev`/`prebuild`/`pretest` hooks — reads
`scadpub.config.json`, parses each design's OpenSCAD Customizer syntax into a typed parameter
schema, copies each design's `.scad` dependency graph into `public/scad/` at its
source-relative path, and writes `src/generated/designs.json` plus the PWA assets. The app
never reads `.scad` at runtime, and the form cannot drift from the design because both come
from the same parse. `generate()` is exported so `tests/gen-schema.test.mjs` can drive it
against `tests/fixtures/*.config.json`.

What follows from that, before you edit anything:

- `src/generated/`, `public/scad/`, `public/wasm/`, the generated PWA assets
  (`manifest.webmanifest`, `icon.svg`, `icon-*.png`, `apple-splash-*.png`,
  `precache-manifest.json`) and `public/fonts/fonts.conf` are generated and gitignored. Change
  the config or the sources and re-run. `public/sw.js` and the bundled `.ttf` files are
  hand-maintained and tracked.
- **Building against an external config copies that config's fonts into `public/fonts/`
  transiently, not permanently.** `.ttf` is tracked rather than ignored there, but
  `.gen-manifest.json` records the copy, and the *next* build against this checkout's own
  config removes it again (`reconcileGenerated`, `scripts/lib/destinations.mjs`) — no manual
  cleanup needed. The real exposure is the window between those two builds: an untracked font
  sits in a tracked directory, so a `git add -A` in that window commits another deployment's
  font. Don't commit during that window; if you want the font gone immediately, rebuild against
  this checkout's own config rather than hand-deleting it. `gen-schema` also warns at the
  moment of the copy when the risk is real (see `bundleFonts`'s `isRiskyExternalFontCopy`).
- `renderHash` covers every render-affecting input (mounted `.scad`, bundled fonts, render
  features, `render.format`, the design id→file routing map, the WASM build, `worker.ts` itself
  — see `scripts/lib/hash.mjs`'s `computeRenderHash`) and is folded into the render cache key,
  so a deploy that changes a render input invalidates persisted geometry. `scadpubVersion` is
  display-only and deliberately *outside* `renderHash`; `scripts/lib/version.mjs` resolves it
  with `git describe` against ScadPub's own checkout — not the cwd — so a fork, submodule or
  sibling build still names ScadPub. `$SCADPUB_VERSION` overrides it for git-less trees, and
  resolving to nothing is not a build failure.
- **`src/openscad/types.ts` is in that hashed closure.** `scripts/lib/worker-deps.mjs` walks
  `worker.ts`'s local import graph to feed `computeRenderHash`, and `types.ts` is transitively
  imported from there, so any change to it — comments included — changes `renderHash` and
  evicts every deployment's persisted render cache. That's a real but affordable cost, not a
  reason to avoid the file forever: batch `types.ts` edits deliberately (e.g. alongside another
  change that already bumps `renderHash`) rather than trickling them in one comment at a time.
- The licenses modal takes every version from build data (`componentVersions`, `wasmVersion`,
  `scadpubVersion`), never a literal. A new bundled component needs an entry in
  `src/lib/licenses.ts`; an npm package also needs its name in `BUNDLED_PACKAGES`, since
  `scripts/lib/dep-versions.mjs` reads versions from `node_modules` rather than importing them
  (which would drag three.js into the eager chunk).

## Render path

`src/openscad/worker.ts` runs OpenSCAD-WASM off the main thread — `callMain` is synchronous
and CPU-bound — and instantiates a **fresh module per render**, because Emscripten exit state
is not reusable. It mounts sources at their source-relative paths so each design's
`use`/`include` resolves as in the source tree, path-strips untrusted user-font filenames, and
keeps the large version-pinned binaries in a versioned Cache Storage entry (`BIN_CACHE`) while
re-fetching the small, build-volatile `.scad` sources per worker.

`runner.ts` is the main-thread client. `callMain` cannot be interrupted, so latest-wins
cancellation terminates and respawns the worker and the superseded promise rejects with
`SupersededError`. Results share an L1 in-memory LRU over an optional L2 IndexedDB
(`stlCache.ts`) on one content-stable key.

The WASM is single-threaded: no `SharedArrayBuffer`, no COOP/COEP. `dist/` is a plain static
bundle; serve `.wasm` as `application/wasm`.

## App structure

State lives in `App.tsx` — export, presets, fonts, URL state, theme, PWA notices — with render
orchestration (debounced auto-render, the heavy-render brake: renders past `HEAVY_RENDER_MS`
auto-pause live updates, and `heavy` designs start manual) factored into `useRenderPipeline`.
`AppShell.tsx` composes that state into layout: which breakpoint's tree mounts (the docked
`ParamPanel` or the mobile `BottomSheet`; only the active layout mounts a `Viewer`, lazy-loaded
to keep three.js out of the initial chunk), plus three extracted hooks for the logic that isn't
layout — `useReadinessModel` (production-readiness derivation and the Review dialog),
`useOutputConsole` (the Output console's open/auto-open state), and `useSheetPolicy` (the mobile
sheet's first-visit policy).

Action callbacks reach the panels through the `AppActions` context (`src/lib/appActions.ts`)
instead of prop drilling; the provider's value is ref-backed and stable, so a consumer never
re-renders when a callback's identity changes yet always invokes `App`'s latest
implementation. Data and genuinely local glue (the PNG snapshot handler that needs the viewer
ref) still flow as props. `src/lib/readiness.ts` derives the state `StatusStrip` surfaces as a
pill in the export dock, above the Download button, and that `ReviewDialog` explains; Download
routes through that dialog rather than exporting anything short of `ready`. The pill mounts for
`failed` on both layouts but for `attention` on desktop only — mobile leaves that state to the
amber dot `ActionButtons` already puts on Download, rather than spending a stacked row over the
model to say it twice.

## Conventions

- **TypeScript 7 and 6 are installed side by side via npm aliases.** TS 7.0 is the native (Go)
  compiler and ships no programmatic API until 7.1, so anything that imports from `typescript`
  — typescript-eslint, peer range still `<6.1.0` — cannot run against it. `package.json`
  therefore carries `"@typescript/native": "npm:typescript@^7"` (the `tsc` that build and
  pre-commit use) and `"typescript": "npm:@typescript/typescript6@^6"` (the 6.x API lint
  resolves, plus a `tsc6` binary). Do not "fix" this back to a plain `typescript` dependency; a
  straight bump to 7.x breaks `npm run lint`. Revisit when typescript-eslint supports the 7.x
  API.
- **Tests import TypeScript source directly.** `tests/register-ts.mjs` + `ts-resolve.mjs`
  register a loader hook that resolves extensionless relative imports (`./scad`) to `.ts` under
  Node's built-in type-stripping. That is why app code writes extensionless imports and why
  `node:test` runs with no bundler.
- **UI is shadcn/ui (Radix + Tailwind v4).** Compose the primitives in `src/components/ui/`
  rather than hand-rolling controls; genuinely bespoke pieces like `BottomSheet` and the
  resizable `ParamPanel` stay custom. Imports use the `@/` alias, wired in `vite.config.ts`,
  `tsconfig.json` and `tests/ts-resolve.mjs`.
- **Decoration goes on components as Tailwind utilities**, using the bridged tokens rather than
  raw palette values so config `colors` overrides keep working. `src/index.css` keeps only
  structural CSS, in a `components` layer below `utilities`, with an `@theme inline` block
  bridging the shadcn `--color-*` tokens onto the existing AA palette.
- **Keep the script hook classes** — `.status-pill`, `.param-group`, `.file-manager__name`,
  `.output-console__close`, `.brand-logo` and friends. No stylesheet rule targets them; the
  smoke/vis/capture scripts and the `extraCss` escape hatch do.
- **UI text goes through the i18n catalogue.** ScadPub's chrome copy lives in
  `src/locales/en.json` and is read via `t()`/`tn()` in `src/lib/i18n.ts`, so a deployment can
  override any key through the config's `strings` block (validated at build time). Add the key
  to the catalogue before referencing it; `tests/i18nCoverage.test.mjs` also fails on a
  catalogue key nothing in `src/` uses. It is a subset, not a translation layer — older panels
  still carry plain English.
- **Font availability is decided in the app, not in OpenSCAD.** `gen-schema` reads each bundled
  font's family and face from its `name` table and flags font params `isFont`; those render as
  `FontSelect`, which unions bundled with imported fonts and preserves stored value strings so
  merely listing never dirties a value. Not-loaded suggestions stay selectable in a marked
  group with an in-dropdown Import action. `fontFallback` pins a weak last-resort family in
  `fonts.conf` so an imported font cannot become Fontconfig's global default.
- **The config `id` namespaces all browser storage** (localStorage, IndexedDB, preset cache) so
  several deployments coexist on one origin. `vite.config.ts` reads `designs.json` to inject
  title, description, per-scheme `theme-color`, the Apple web-app title and the splash `<link>`s
  into `index.html`, and exposes `__APP_ID__`/`__APP_THEME_COLOR__` as compile-time constants.
- **Annotations** — `// @showIf`, `// @collapsed`, `// @advanced`, `// @font`, `// @info`,
  `// @label "<text>"`, `// @svg`, `// @filledBy`, `// @editOnModel`, `// @review "<label>"`,
  the file-level `// @description`/`@icon`/`@image`/`@doc`/`@reviewNote "<text>"`, and the runtime-only
  `echo("@info", …)` / `echo("@review", …)` — are parsed by `gen-schema` and invisible to desktop
  OpenSCAD. [docs/annotations.md](docs/annotations.md) is the reference; a new one lands in the
  parser and that doc together.

## Verify UI work by looking at it

Type-checks and unit tests say nothing about visual behaviour. After any visual or interactive
change, run `npm run build && npm run smoke`, then `npm run vis`, and attach a screenshot or
diff image before calling the task done.

Accessibility is a hard requirement: WCAG 2.1 AA, and smoke fails on any serious or critical
axe-core violation. Colours are CSS custom properties in `src/index.css` — `--accent` and
`--accent-solid` are separate because one colour rarely passes AA both as small text and as a
button fill. After a colour change, run `npm run vis -- --update` and `npm run smoke`.
