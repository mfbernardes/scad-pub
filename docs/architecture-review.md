<!--
meta.contentType: Conceptual
content plan: summarize the architecture review, group findings by risk, and record strengths future refactors should preserve.
-->

# Review the ScadPub architecture

A full review of the runtime app (`src/`), the build pipeline (`scripts/`, `vite.config.ts`, `public/sw.js`), and the test/continuous integration (CI) setup, as of `0cf00d1` (axe-core AA sweep). Findings are ordered by severity within each section; every claim carries a `file:line` reference against that commit.

## Current architecture state

The client/worker split is strict, the two-tier render cache degrades gracefully, and the stable-identity `AppActions` context avoids both prop-drilling and re-render churn. The source has zero `as any`, `@ts-ignore`, or `@ts-expect-error` in `src/**`, no TODO/FIXME markers, and three justified `eslint-disable`s total. The highest-value fixes are the two HTML-injection gaps in the config-to-chrome path, the silent hard-failure path in `doRender`, and the stale visual-regression mask.

## Correctness and security

### 1. `title`/`description`/`shortName` are interpolated into HTML unescaped

`vite.config.ts:70-82` injects config strings into `index.html` with raw
`.replace`:

- `%APP_TITLE%` → `<title>` text content (`index.html:39`)
- `%APP_DESCRIPTION%` → `<meta name="description" content="…">`
  (`index.html:8`)
- `%APP_APPLE_TITLE%` → `<meta name="apple-mobile-web-app-title" …>`
  (`index.html:17`)

None of the three is validated or escaped anywhere. `gen-schema.mjs:127-131`
assigns them straight from the config, while the colours two lines below get
`COLOR_VALUE_RE` (`gen-schema.mjs:143-150`) and `lang`/`dir` get
`parseLang`/`parseDir`. A `title` containing `</title><script>` or a
`description` containing `">` escapes its context. CLAUDE.md explicitly
claims *"Config values interpolated into generated SVG/HTML (chrome colours,
title, design ids) are validated/escaped first"*; for these three values
that claim is currently false. Exploitability is low (the config author is
the site operator), but the fix is one line per value: `xmlEscape` already
exists in `scripts/lib/config-parsers.mjs:45-50` and is used for the SVG
path; apply it (or a gen-schema-time validation) to the HTML path too.

### 2. The app-level `id` reaches an inline `<script>` string literal unvalidated

Design ids are charset-checked (`checkId`, `gen-schema.mjs:307-313`); the
top-level `id` is not (`gen-schema.mjs:129`, `config.id ?? "scadpub"`). It
flows into `%APP_THEME_KEY%` = `` `${id}.theme` `` (`vite.config.ts:81`) and
lands inside a **JavaScript string literal in the inline pre-paint theme
script**: `localStorage.getItem("%APP_THEME_KEY%")` (`index.html:24`). A
quote or backslash in `id` breaks (or escapes) the script. This is the most
sensitive interpolation in the pipeline and the cheapest fix: run the
existing `checkId` on the app id in `generate()`.

### 3. A thrown render failure is invisible in the app

`doRender`'s catch (`src/App.tsx:190-194`) distinguishes `SupersededError`
(correctly swallowed) from everything else, but the "everything else"
branch only resets `lastKeyRef` and the spinner. A worker crash surfaced via
`runner`'s `failInflight` (worker `onerror`/`onmessageerror`,
`runner.ts:195-203`) therefore shows **no toast and no console entry**; only
structured `r.ok === false` results get the "Render failed" toast
(`App.tsx:177-181`). The UI stops spinning with a stale model on
screen. Add an error toast (or synthesize a failure `RenderResult`) in that
branch.

Related, worth a comment rather than a change: the `SupersededError` early
return at `App.tsx:191` deliberately does **not** call `setRendering(false)`.
The superseding render owns the spinner now. That invariant (a
superseding render always follows a supersession) is load-bearing and
undocumented at the site that depends on it.

### 4. The visual-regression mask targets classes that don't exist

`scripts/screenshots.mjs:29-30` masks `.viewer, .viewer-overlay` (real) and
`.status, .log, .diagnostics`, but no element in `src/` carries `status`,
`log`, or `diagnostics` as a class. The volatile render-status hook used by
every other script is `.render-status` / `.output-console`
(`smoke.mjs:22-33`). The stale selectors mean any visible volatile text
(render timings, log lines) is *not* masked, which is a baseline-flakiness
time bomb; the first symptom will be an unexplained vis failure after a
timing change. Re-audit `MASK_CSS` against the actual class hooks CLAUDE.md
enumerates.

## Architecture and maintainability

### 5. `App.tsx` is at the god-component threshold

412 lines holding 52 hook calls (17 `useState`, 10 `useEffect`, 16
`useCallback`, 5 `useMemo`, 4 `useRef`) plus four custom hooks. It is
organized sprawl: commented, memoized, view layer already extracted to
`AppShell`. Every new feature lands here. Three extractions fall out
naturally along existing seams:

- `useRenderPipeline`: `renderKey`/`doRender`/auto-render debounce/heavy
  brake/`lastKeyRef` (`App.tsx:142-211`), the piece with the trickiest
  invariants and the one that would benefit most from focused tests;
- `useFileImports`: add/remove/clear + cache invalidation + persistence
  (`App.tsx:273-299`);
- `useAppNotices`: the three independent toast effects for stale bundle /
  SW update / offline (`App.tsx:343-371`).

`AppShell.tsx` (470 lines) is bigger but is honest layout; its bulk is two
near-identical trees (desktop `:306-359`, mobile `:365-467`) that could
share a couple of extracted sections if they start drifting.

### 6. ~150 lines of copy-pasted Playwright driving across three scripts

`smoke.mjs`, `screenshots.mjs`, and `capture-screens.mjs` share only
`serve-dist.mjs`; everything else is triplicated:

- identical `chromium.launch({ executablePath: … })` blocks
  (`smoke.mjs:84-86`, `screenshots.mjs:92-94`, `capture-screens.mjs:199-201`);
- `waitRendered` re-implemented three times around the same
  `/\d+ ms/` poll (`smoke.mjs:45-51`, `capture-screens.mjs:32-40`, inlined
  at `screenshots.mjs:49`);
- `selectDesign` twice (`smoke.mjs:59-79`, `capture-screens.mjs:47-60`);
- welcome-popup dismissal three times, theme-forcing dance twice.

A `scripts/lib/browser.mjs` (launch, waitRendered, selectDesign,
dismissPopup, forceTheme) removes the duplication and, more importantly,
makes finding 4's selector drift a one-place fix.

### 7. Monolithic orchestrator functions

The helpers were factored to `scripts/lib/` (good), but `generate()` in
`gen-schema.mjs` is still one ~450-line function (`:99-545`) doing config
parsing, three copy passes, PWA orchestration, and two manifest writes
inline; `smoke.mjs`'s `main()` is ~410 linear lines of inline checks
(`:81-494`). Neither is buggy, but both are past the size where a failed
assertion takes extra work to localize. Splitting `generate()` at its own banner
comments (identity → fonts → designs → PWA → precache) and `smoke.mjs` into
per-section check functions would pay for itself on the next change.

### 8. `capture-screens.mjs` shells out to a system `zip`

`capture-screens.mjs:223` uses `execFileSync("zip", …)`. The repo's own
tooling principle is pure-Node/cross-platform (`fetch-wasm.mjs:8`, "no
bash/curl/unzip needed"), and Windows has no `zip`. `fflate` is already a
dependency (used to *unzip* in `fetch-wasm.mjs`) and can write the archive.

## Testing and CI

### 9. Coverage is pure-logic-deep, boundary-shallow

The logic layer is well covered (19 `src/lib`+`src/openscad` modules plus a
1,064-line `gen-schema` suite). Not covered by anything faster than the
single-config smoke run: `worker.ts` (the WASM driver; `renderArgs.ts`
exists precisely because its helpers were unreachable from `npm test`,
`renderArgs.test.mjs:1-4`), every React component, and every hook. That's a
defensible trade-off for a UI this size, but `worker.ts`'s pure parts
(mount-path computation, orphaned-define scan already in `scad.ts`) should
keep migrating out to testable modules as they grow.

### 10. CI gaps

`.github/workflows/ci.yml` runs typecheck + unit + smoke, but:

- **`npm run vis` never runs in CI**: visual regressions aren't gated
  anywhere. The baselines are environment-pinned, so the honest options are
  a dedicated pinned runner/container for vis, or accepting (and
  documenting) that vis is local-only.
- **No lint step exists**: there is no ESLint config in the repo at all;
  quality rides on `tsc` and conventions.
- Playwright Chromium is reinstalled on every run (`ci.yml:24-25` caches npm
  only). This is cacheable for a minute or two per build.
- Two divergent deploy paths: CI deploys GitHub Pages (`ci.yml:52-71`) while
  `package.json:15,21` deploys via `wrangler`. Intentional, but worth one
  README sentence so a contributor knows which one is authoritative.

## Smaller follow-ups

- **Dead code**: `detentHeight` is exported from `BottomSheet.tsx:28-37`
  with no importer anywhere in `src/` or `tests/`; the `onPeekHeightChange`
  prop (`BottomSheet.tsx:52,126-128`) is never passed by the sole caller.
- **Duplication**: `exportModel` and `savePng` share the
  share-file/fallback-download/announce shape (`App.tsx:241-271`),
  extractable; the `try { localStorage… } catch {}` idiom recurs across
  `App.tsx`, `ParamPanel.tsx`, `presets.ts`, `urlState.ts`. A tiny
  `safeStorage` helper would DRY it; `BottomSheet.tsx` computes detent
  geometry twice (`:23-24` vs `:28-37`).
- **Perf watch item**: `fileSignature` re-hashes every uploaded byte on each
  `userFiles` change (`runner.ts:66-80`). Fine for SVG/font-sized imports;
  if large imports ever land, hash once at import time and store the digest.
- **Version pin nuance**: the WASM sha256 is only enforced when the version
  equals the pin. An `OPENSCAD_VERSION` env override skips the integrity
  check (`fetch-wasm.mjs:60`). Reasonable, but worth knowing.

## Strengths worth preserving

Recorded so a future refactor doesn't accidentally regress them:

- **Latest-wins render cancellation**: terminate-and-respawn, staleness
  guards on both the worker handle and the async L2 lookup
  (`runner.ts:247-265,285`).
- **Best-effort L2 everywhere**: every IndexedDB op degrades to L1-only,
  including a quota-retry (`stlCache.ts:100-185`).
- **The stable `AppActions` context** (`appActions.ts:41-77`): ref-backed
  wrappers so consumers memo cleanly yet always call the latest closure.
- **The skew guard** dropping orphaned defines when a stale client renders
  against a newer bundle (`worker.ts:211-216`, `scad.ts:79-86`).
- **Fail-fast generation**: unknown config keys throw with the valid-key
  list (`gen-schema.mjs:115-121`), and the eval-free `@showIf` evaluator
  fails open with a comment explaining why (`visibility.ts:46-53`).
