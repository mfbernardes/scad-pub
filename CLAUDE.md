<!--
meta.contentType: Reference
content plan: orient a coding agent in ScadPub. The commands, the one build-time invariant everything rests on, and the gotchas that reading the source will not reveal. Detail lives in docs/.
-->

# Work in ScadPub

ScadPub renders OpenSCAD designs client-side via OpenSCAD-WASM as a static site.
[README.md](README.md) is the project overview, [docs/config.md](docs/config.md) the full
config reference, [docs/annotations.md](docs/annotations.md) the annotation vocabulary.
Three subsystem pages hold the long-form rationale the source only points at:
[docs/config-pipeline.md](docs/config-pipeline.md) (`CONFIG_SPEC`, the `designs.json`
validator, generated-file reconciliation), [docs/viewer.md](docs/viewer.md) (camera fit and
the studio lighting rig) and
[docs/security-headers.md](docs/security-headers.md) (the CSP, directive by directive). Read
the source rather than trusting a summary here: this file covers what the source does not say
out loud.

## Comments and replies earn their space

Default to neither, and add one when it carries something the reader cannot get from the code:
why a workaround exists, which invariant a line protects, the issue or spec behind a magic
number. A comment restating the next line, a `// --- Section ---` banner, a step-by-step
narration of a function, or a note about what you changed is noise: don’t write it, and
delete it when you find it. Explanation longer than a couple of sentences belongs in `docs/`
or in this file, not inline. JSDoc stays on exported helpers whose signature isn’t
self-evident; user-facing copy stays in `src/locales/en.json`.

Same discipline in what you say back: what changed, what you verified, what still needs a
decision. A few sentences plus the screenshot. No preamble, no restatement of the request, no
file-by-file tour of the diff. Length is not thoroughness.

## Commands

```bash
npm install
npm run dev        # predev fetches pinned WASM + regenerates the schema, then vite
npm test           # node:test unit suite; Node >= 22.18
npm run build      # prebuild gen-schema + tsc -b + vite build -> dist/
npm run smoke      # headless axe + end-to-end check of the BUILT app — build first
npm run vis        # visual regression vs tests/screenshots/ (--update to rebaseline)
npm run check:studio # builds a viewer.style "studio" variant and measures its lighting
npm run check:svg  # serves each sanitized SVG to Chromium; asserts it makes no request
npm run check:dist # asserts the BUILT artifact carries its sw.js version + CSP block
npm run check:scad # drives the pinned OpenSCAD WASM to pin the language facts the parser assumes
npm run i18n:status # design-translation sidecar coverage/drift report; -- --strict for CI, -- --stamp to record freshness
npm run e2e:svg    # end-to-end run of the in-app SVG wizard against the BUILT app
npm run screens    # capture every desktop + mobile view of the BUILT app
```

- One test: `node --import ./tests/register-ts.mjs --test --test-name-pattern "<name>" tests/<file>.test.mjs`.
- Chromium for smoke/vis/screens: `npx playwright install chromium` on first run.
- `BASE_PATH=/app/ npm run build` targets a subpath (GitHub Pages sets it from a repo
  variable); `SCADPUB_CONFIG=/path/to/config.json` builds a different deployment.
- Pre-commit runs `tsc -b` and `npm test` on relevant changes.

## Everything renderable is generated at build time

`scripts/gen-schema.mjs` (run by the `predev`/`prebuild`/`pretest` hooks) reads
`scadpub.config.json`, parses each design’s OpenSCAD Customizer syntax into a typed parameter
schema, copies each design’s `.scad` dependency graph into `public/scad/` at its
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
- **Building against an external config copies that config’s fonts into `public/fonts/`
  transiently, not permanently.** `.ttf` is tracked rather than ignored there, but
  `.gen-manifest.json` records the copy, and the *next* build against this checkout’s own
  config removes it again (`reconcileGenerated`, `scripts/lib/destinations.mjs`) — no manual
  cleanup needed. The real exposure is the window between those two builds: an untracked font
  sits in a tracked directory, so a `git add -A` in that window commits another deployment’s
  font. Don’t commit during that window; if you want the font gone immediately, rebuild against
  this checkout’s own config rather than hand-deleting it. `gen-schema` also warns at the
  moment of the copy when the risk is real (see `bundleFonts`'s `isRiskyExternalFontCopy`).
- `renderHash` covers every render-affecting input (mounted `.scad`, bundled fonts, render
  features, `render.format`, the design id→file routing map, the WASM build, `worker.ts` itself
  — see `scripts/lib/hash.mjs`'s `computeRenderHash`) and is folded into the render cache key,
  so a deploy that changes a render input invalidates persisted geometry. `scadpubVersion` is
  display-only and deliberately *outside* `renderHash`; `scripts/lib/version.mjs` resolves it
  with `git describe` against ScadPub’s own checkout — not the cwd — so a fork, submodule or
  sibling build still names ScadPub. `$SCADPUB_VERSION` overrides it for git-less trees, and
  resolving to nothing is not a build failure.
- **Only `src/openscad/`’s own worker files are in that hashed closure — keep UI types out of
  it.** `scripts/lib/worker-deps.mjs` walks `worker.ts`’s local import graph to feed
  `computeRenderHash`, so any change to a file in that graph — comments included — changes
  `renderHash` and evicts every deployment’s persisted render cache. The closure is
  `worker.ts`, `protocol.ts`, `renderArgs.ts`, `binCache.ts`, `progressThrottle.ts`,
  `retryableOnce.ts`, `orphanedDefines.ts` and `lib/assetUrl.ts`, and
  `tests/worker-deps.test.mjs` pins it as an exact set so it cannot re-widen by accident.
  `protocol.ts` holds the worker’s message shapes alone; `types.ts` re-exports them and is the
  app-facing home for everything else (it changed 25 times in a year for viewer/help/licence
  fields that cannot affect a triangle, and each one used to evict every cache). Likewise
  `orphanedDefines.ts` sits apart from `lib/scad.ts`, whose other exports need the full `Param`
  union. When you do have to touch a hashed file, batch the edits deliberately rather than
  trickling them in one comment at a time.
- The licenses modal takes every version from build data (`componentVersions`, `wasmVersion`,
  `scadpubVersion`), never a literal. A new bundled component needs an entry in
  `src/lib/licenses.ts`; an npm package also needs its name in `BUNDLED_PACKAGES`, since
  `scripts/lib/dep-versions.mjs` reads versions from `node_modules` rather than importing them
  (which would drag three.js into the eager chunk).

## Render path

`src/openscad/worker.ts` runs OpenSCAD-WASM off the main thread: `callMain` is synchronous
and CPU-bound, and instantiates a **fresh module per render**, because Emscripten exit state
is not reusable. It mounts sources at their source-relative paths so each design’s
`use`/`include` resolves as in the source tree, path-strips untrusted user-font filenames, and
keeps the large version-pinned binaries in a versioned Cache Storage entry (`BIN_CACHE`) while
re-fetching the small, build-volatile `.scad` sources per worker.

`runner.ts` is the main-thread client. `callMain` cannot be interrupted, so latest-wins
cancellation terminates and respawns the worker and the superseded promise rejects with
`SupersededError`. Results share an L1 in-memory LRU over an optional L2 IndexedDB
(`stlCache.ts`) on one content-stable key.

The WASM is single-threaded: no `SharedArrayBuffer`, no COOP/COEP. `dist/` is a plain static
bundle; serve `.wasm` as `application/wasm`.

**Nothing heavy is downloaded while the first screen still needs the network.** Two boot
brakes exist for that, and both are easy to undo by accident. `useRenderPipeline`'s `holdBoot`
constructs no runner at all while a design chooser is the first screen: spawning it there
starts the ~11 MB bootstrap fetch against the chooser’s own thumbnails, which measurably
starved them. `App` derives it from `popup.ts`'s `isDesignChooser`, which is now just
`mode === "picker"`, because `gen-schema`'s `checkPopupMode` refuses to build a `picker` config
with fewer than two designs; that mode used to fall back to a plain notice, and consumers
disagreeing about which it was cost two bugs. `shouldShowPopup` skips the chooser
when the URL hash already names a design, so a shared link is never gated at all. And `public/sw.js` install caches only the
boot-critical shell; the lazy chunks, artwork, sources and the binary warm-up wait for the
page’s `WARM` message, sent at the first uncontended moment `swUpdate.ts`'s `warmDelayMs`
recognises: installed/standalone (no delay: offline completeness is why someone installs), the
tab going hidden, or the render worker reporting `ready`. Anything that moves that work back
into mount or install re-creates the stall: measure a cold, throttled first visit before
believing otherwise.

## App structure

State lives in `App.tsx` (export, presets, fonts, URL state, theme, PWA notices) with render
orchestration (debounced auto-render, the heavy-render brake: renders past `HEAVY_RENDER_MS`
auto-pause live updates, and `heavy` designs start manual) factored into `useRenderPipeline`.
`AppShell.tsx` composes that state into layout: which breakpoint’s tree mounts (the docked
`ParamPanel` or the mobile `BottomSheet`; only the active layout mounts a `Viewer`, lazy-loaded
to keep three.js out of the initial chunk), plus three extracted hooks for the logic that isn’t
layout. `useReadinessModel` (production-readiness derivation and the Review dialog),
`useOutputConsole` (the Output console’s open/auto-open state), and `useSheetPolicy` (the mobile
sheet’s first-visit policy).

Action callbacks reach the panels through the `AppActions` context (`src/lib/appActions.ts`)
instead of prop drilling; the provider’s value is ref-backed and stable, so a consumer never
re-renders when a callback’s identity changes yet always invokes `App`'s latest
implementation. Data and genuinely local glue (the PNG snapshot handler that needs the viewer
ref) still flow as props. `src/lib/readiness.ts` derives the state `StatusStrip` surfaces as a
pill in the export dock, above the Download button, and that `ReviewDialog` explains; Download
routes through that dialog rather than exporting anything short of `ready`. The pill mounts on
both layouts, and on mobile it reappears a second place: `SheetTabs` reuses it inside the
bottom sheet itself for the Full detent, where the export dock (and its copy of the pill) is
hidden along with the rest of the floating chrome, see AppShell's `sheetAttentionPill`.
`ActionButtons` used to put an amber marker on Download so mobile could skip the pill and save a
stacked row over the model; that marker is gone, because a small in-button graphic has to earn
its contrast against a fill each deployment chooses (this repo's own dark palette put the pair
at 2.66:1, under 1.4.11's 3:1) and can only say "amber", never what is wrong.

## Conventions

- **TypeScript 7 and 6 are installed side by side via npm aliases.** TS 7.0 is the native (Go)
  compiler and ships no programmatic API until 7.1, so anything that imports from `typescript`
   (typescript-eslint, peer range still `<6.1.0`) cannot run against it. `package.json`
  therefore carries `"@typescript/native": "npm:typescript@^7"` (the `tsc` that build and
  pre-commit use) and `"typescript": "npm:@typescript/typescript6@^6"` (the 6.x API lint
  resolves, plus a `tsc6` binary). Do not “fix” this back to a plain `typescript` dependency; a
  straight bump to 7.x breaks `npm run lint`. Revisit when typescript-eslint supports the 7.x
  API.
- **Node 22.18 is the floor, and `engines` says so.** Type stripping is unflagged
  only from 22.18.0: below it, importing a `.ts` file fails with
  `ERR_UNKNOWN_FILE_EXTENSION`. The test suite has always needed it (see the next
  bullet), and the BUILD needs it too now that `gen-schema.mjs` and
  `scripts/lib/read-schema.mjs` import `src/lib/schema.ts` directly rather than
  paraphrasing its contract. The old floor of plain 22 understated it on both
  counts.
- **Tests import TypeScript source directly.** `tests/register-ts.mjs` + `ts-resolve.mjs`
  register a loader hook that resolves extensionless relative imports (`./scad`) to `.ts` under
  Node’s built-in type-stripping. That is why app code writes extensionless imports and why
  `node:test` runs with no bundler.
- **UI is shadcn/ui (Radix + Tailwind v4).** Compose the primitives in `src/components/ui/`
  rather than hand-rolling controls; genuinely bespoke pieces like `BottomSheet` and the
  resizable `ParamPanel` stay custom. Imports use the `@/` alias, wired in `vite.config.ts`,
  `tsconfig.json` and `tests/ts-resolve.mjs`.
- **Decoration goes on components as Tailwind utilities**, using the bridged tokens rather than
  raw palette values so config `colors` overrides keep working. `src/index.css` keeps only
  structural CSS, in a `components` layer below `utilities`, with an `@theme inline` block
  bridging the shadcn `--color-*` tokens onto the existing AA palette.
- **Keep the script hook classes**: `.status-pill`, `.param-group`, `.file-manager__name`,
  `.output-console__close`, `.brand-logo` and friends. No stylesheet rule targets them; the
  smoke/vis/capture scripts and the `extraCss` escape hatch do.
- **UI text goes through the i18n catalogue.** ScadPub’s chrome copy lives in
  `src/locales/<tag>.json` (`en` is source of truth; the shipped locales are
  `src/lib/localeRegistry.ts`'s `LOCALES`; parity and coverage tests enforce matching key sets
  across all of them — that parity check IS the chrome catalogue's freshness guarantee, no
  separate audit tool needed) and is read via `t()`/`tn()`, with runtime language switching
  through `src/lib/localeStore.ts`'s `useLocale()`. Rules the reviews already cite: (1) no
  module-scope `t()`/`tn()` — a guard test enforces it; (2) indirection tables store *keys*,
  resolved at render (`views.ts`); (3) every text-rendering component subscribes via
  `useLocale()`; (4) memoized derivations of translated text take the locale tag as a dep; (5)
  design-supplied text is translated via per-design `.strings.<tag>.json` sidecars
  ([docs/config.md#design-translations](docs/config.md#design-translations)), never
  annotations, never in `renderHash`; German copy follows the glossary and style rules in
  [docs/german-style.md](docs/german-style.md). `npm run i18n:status` audits that coverage (and, with a
  tracked `<design>.strings.stamps.json`, content drift since a translation was made) per
  design × locale — informational by default, `--strict` for CI. `svgPrep`'s engine
  (`src/lib/svgPrep/`) stays i18n-free on purpose (its Node tests assert on structured
  `{code, vars}` findings/changes/errors, not prose) and `src/lib/svgPrepText.ts` is the sole
  place that resolves a code to catalogue text. Config-authored prose (popup, notices, help,
  design labels/groups) is leaf-localizable — `string | Record<tag, string>` — optionally
  moved out of `scadpub.config.json` entirely into per-locale text files via the opt-in
  `text` key (`scripts/lib/config-text.mjs`, folded back into those same leaves before
  anything else runs, so nothing past that pre-pass — including this file's own
  `configI18n.ts` projection — changes) — and MUST be
  projected through `src/lib/configI18n.ts`'s `lx`/`lxOpt`/`lxHelp`/`lxNotice`/`lxDesignEntry`
  before it reaches JSX; the raw vs. `Resolved*` type split in `types.ts` makes an unprojected
  value a compile error. Machine-readable output stays locale-invariant on purpose — SVG
  region/geometry numbers, `-D` render args, identity strings, `<input>` values, render-status
  digits, `echo("@review", …)` values — each marked with a one-line comment where it appears.
  Documented exclusions: `main.tsx`'s root error fallback (dependency-free English — the locale
  machinery may be what broke) and the PWA manifest / `<title>`/`<meta>` (fixed at the build's
  configured language; see docs/config.md's "Localizing config text").
- **Font availability is decided in the app, not in OpenSCAD.** `gen-schema` reads each bundled
  font’s family and face from its `name` table and flags font params `isFont`; those render as
  `FontSelect`, which unions bundled with imported fonts and preserves stored value strings so
  merely listing never dirties a value. Not-loaded suggestions stay selectable in a marked
  group with an in-dropdown Import action. `fontFallback` pins a weak last-resort family in
  `fonts.conf` so an imported font cannot become Fontconfig’s global default.
- **The config `id` namespaces all browser storage** (localStorage, IndexedDB, preset cache) so
  several deployments coexist on one origin — with one deliberate exception:
  the binary cache (`openscad-wasm-bin-*`, `binCache.ts`) is origin-shared on
  purpose, because the WASM binary is identical across deployments and one
  shared copy saves every other deployment a ~10 MB download. Don’t “fix” it.
  `vite.config.ts` reads `designs.json` to inject
  title, description, per-scheme `theme-color`, the Apple web-app title and the splash `<link>`s
  into `index.html`, and exposes `__APP_ID__`/`__APP_THEME_COLOR__` as compile-time constants.
- **Annotations**: `// @showIf`, `// @collapsed`, `// @advanced`, `// @font`, `// @info`,
  `// @label "<text>"`, `// @svg`, `// @filledBy`, `// @editOnModel`, `// @review "<label>"`,
  the file-level `// @description`/`@icon`/`@image`/`@doc`/`@reviewNote "<text>"`, and the runtime-only
  `echo("@info", …)` / `echo("@review", …)`. Are parsed by `gen-schema` and invisible to desktop
  OpenSCAD. [docs/annotations.md](docs/annotations.md) is the reference; a new one lands in the
  parser and that doc together.

**The studio viewer style is only exercised by `npm run check:studio`.** This
repo's own config builds `plain`, and `npm run vis` masks the viewer, so the
ordinary gates say nothing about `viewerRig.ts` — an environment map that was
disposed before first use once shipped through all of them. That script builds a
studio variant and asserts the 5th-percentile luminance of the model, which is
the shadow side the environment lifts (~96 lit, ~28 unlit); mean brightness does
not separate the two, because the key and fill lights dominate it. Touch the
lighting rig and run it.

## Verify UI work by looking at it

Type-checks and unit tests say nothing about visual behaviour. After any visual or interactive
change, run `npm run build && npm run smoke`, then `npm run vis`, and attach a screenshot or
diff image before calling the task done.

Accessibility is a hard requirement: WCAG 2.1 AA, and smoke fails on any serious or critical
axe-core violation. Colours are CSS custom properties in `src/index.css`: `--accent` and
`--accent-solid` are separate because one colour rarely passes AA both as small text and as a
button fill. After a colour change, run `npm run vis -- --update` and `npm run smoke`.
