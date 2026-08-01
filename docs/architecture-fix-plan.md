<!--
meta.contentType: Conceptual
content plan: turn the July 2026 deep architecture review into an ordered, actionable fix plan; one entry per finding, grouped by criticality, each with concrete fix steps and a verification recipe.
-->

# Architecture fix plan

An ordered fix plan for every finding of the July 2026 deep review (run at `8bd800c`, "Ten UX fixes from a full desktop + mobile review"). Findings are grouped into tiers and ordered by criticality **within and across tiers**: an item earlier in this document should, all else equal, land before one later. Every claim carries a `file:line` reference against `8bd800c`; re-verify line numbers before editing, the tree moves.

Baseline at review time: 990/990 unit tests pass, `tsc -b` clean, `eslint .` silent, zero `as any`/`@ts-ignore` in `src/`. All five open items from the previous review round (unescaped HTML interpolation, unvalidated app id, silent render failure, stale vis mask, system `zip`) were confirmed fixed. This plan is what the *fresh* pass found.

Tier definitions:

- **P0** — a documented invariant that is false in a shipped build, or a bug that damages user output or repo data.
- **P1** — cache-correctness and update-flow defects: wrong or wasted work that users eventually feel.
- **P2** — build-time validation and CI gaps: ways a broken config or build goes green.
- **P3** — consistency: the same problem solved two ways, or docs/comments contradicting code.
- **P4** — complexity, dead code, and performance polish.

Each item states the problem, the fix, how to verify it, and a size (S: hours, M: a day, L: multiple days).

---

## P0 — Broken invariants and data-damaging bugs

### 1. Stop the service worker's install from fetching the lazy chunks (boot brake defeated)

**Problem.** CLAUDE.md's core performance invariant — install caches only the boot-critical shell; lazy chunks wait for `WARM` — is false in a real build. `preloadLinks()` (`vite.config.ts:175-212`) injects `<link rel="preload" as="worker">` for the render-worker chunk and `<link rel="modulepreload">` for the lazy three.js `Viewer` chunk into the built `index.html`. `sw.js:77`'s `BOOT_CRITICAL_RE = /\.(?:m?js|css)$/i` classifies both as *essential*, so install fetches them with `cache: "reload"` (bypassing the HTTP cache the page just filled), **install-fatally** (`sw.js:204-209`) — at exactly the moment the first screen owns the network. A transient failure on the Viewer chunk rejects the whole SW install. The comment at `vite.config.ts:165-173` still asserts the superseded intent ("make install-time precache cover everything a render needs"), so two plugins encode contradictory policies. `tests/swLifecycle.test.mjs:26-28`'s fixture HTML omits exactly these links, so the suite structurally cannot catch it.

**Fix.**

1. Decide the policy: keep the brake (the documented, measured position). Preload links exist for parallel *page* fetch and deterministic offline coverage — the latter is `warmSupplementary`'s job, not install's.
2. In `addHtmlAssets` (`sw.js:79-86`), classify by *link kind*, not extension: parse `<script src>` and `<link rel="stylesheet">` as essential; `rel="modulepreload"` and `rel="preload"` as extra. The current attribute-only regex has no tag context, so switch to matching whole tags (the function already receives the raw HTML).
3. Rewrite the `preloadLinks` comment (`vite.config.ts:165-173`): purpose 1 (parallel fetch) stands; purpose 2 becomes "the links let `warmSupplementary` discover the worker chunk, which Vite's asset-manifest does not list".
4. Extend `tests/swLifecycle.test.mjs`'s `INDEX_HTML` with both link forms and assert: install fetches entry + CSS + entry JS only; the preload-linked chunks appear in the *warm* pass.
5. Re-measure a cold, throttled first visit (CLAUDE.md's own instruction) before and after, and confirm install no longer double-downloads the Viewer chunk.

**Verify.** New lifecycle assertions above; `npm run build && npm run smoke`; DevTools network trace on a cold visit shows the Viewer chunk fetched once.

**Size.** M.

### 2. Make the SVG layers spec robust to colours and ids containing `,` / `:`

**Problem.** A region fill `parseColor` cannot parse is passed through verbatim by `displayColor` (`src/lib/svgPrep/colors.ts:107`) and written into the comma/colon-separated layers spec (`regions.ts:86`). `parseLayerSpec` (`regions.ts:70`) then shreds it: `fill="rgba(255,0,0,0.5)"` produces junk entries (`left:"rgba(255"`, `0:"0"`, …) that flow into the wizard's per-region height matching and the consuming design. Nothing rejects `,` or `:` in a colour or region id, and `fixInkscapeIds` (`fixes.ts:27`) copies Inkscape labels ("Ground floor, walls") into ids unvalidated — spaces make invalid XML IDs OpenSCAD's `id=` selection won't match; commas split the spec. `displayColor` also lowercases arbitrary paint tokens, breaking case-sensitive `url(#Gradient)` references (`groupByColor.ts:153-156`).

**Fix.**

1. In `displayColor`, resolve every parseable colour to name/hex as today; for *unparseable* tokens return a sanitised slug (strip `,:` and whitespace, preserve case for `url(#…)`) or fall back to a deterministic `cRRGGBB` slug via `slugForColor` — never raw text into the spec.
2. Teach `parseColor` the common functional forms (`rgb()`, `rgba()`, `hsl()` at minimum) so real-world fills stop hitting the fallback at all.
3. In `fixInkscapeIds`, validate the label as an NCName before adopting it: replace invalid characters (spaces, `,`, `:`) with `_`, dedupe through the existing collision guard (`fixes.ts:23`), and record the rename in the fixes list the wizard shows.
4. Add a guard in `formatLayerSpec`/`formatLayers`: assert no id or colour contains `,` or `:`; throw a wizard-visible error rather than emit a corrupt spec.

**Verify.** Unit tests: `rgba()`/`hsl()` fills round-trip through derive → format → parse; an Inkscape label with a space and a comma produces a valid id and an intact spec; `url(#MyGradient)` keeps its case. Run `scripts/e2e-svg-wizard.mjs` against a fixture using `rgba()` fills.

**Size.** M.

### 3. Fix compact arc-flag parsing in the SVG path scanner

**Problem.** `PATH_TOKEN_RE` (`src/lib/svgPrep/geometry.ts:10`) has no notion of the arc grammar, where the two flags may be written unseparated (`a5 5 0 0110 0` — routine svgo/Illustrator output). The `A` branch (`geometry.ts:93-99`) consumes the wrong tokens, produces `NaN`, and the guard at `geometry.ts:103` **`break`s, silently discarding every remaining segment of the path**. Consequences: wrong `contentBbox`, spurious `undersized`/missed `content-outside-viewbox` findings, and backgrounds that escape detection. Related: the NaN scan is `pts.some(...)` over all accumulated points on *every* command — O(n²) on the main thread with a 2 MB upload allowed.

**Fix.**

1. Tokenise arcs properly: after the `rx ry rot` triple, read the two flags as single characters (`[01]`), splitting a merged token like `0110` into `0`, `1`, `10`.
2. On a genuinely malformed segment, skip *that segment* (resync at the next command letter) instead of `break`ing the whole path.
3. Replace the quadratic `pts.some` with a per-point check at push time.

**Verify.** New direct unit tests for `pathPoints` — currently **none exist** — covering every command letter, relative/absolute, implicit repetition, and compact arc flags; a fixture SVG with compact flags produces the same bbox as its space-separated equivalent.

**Size.** S–M.

### 4. Don't commit the framing key when framing bailed on a 0×0 canvas

**Problem.** `applyFraming` returns early when the canvas measures 0×0 (`src/components/Viewer.tsx:466-472`), but the caller sets `framedKeyRef.current = frameKey` unconditionally (`Viewer.tsx:1216-1218`). Every later render for the same design+preset skips framing, and `refitView` early-returns on the null fit state (`Viewer.tsx:524`) — a model that first arrives while the canvas is unmeasured stays at the mount-time camera until a design or preset change. The StrictMode remount variant (`Viewer.tsx:965-1000`: cleanup doesn't reset `framedKeyRef`/`fitStateRef`/`modelRef`) makes dev framing differ from prod.

**Fix.**

1. Make `applyFraming`/`frameView` return whether framing actually happened; only commit `framedKeyRef` on success.
2. On failure, leave the key uncommitted so the ResizeObserver path (`Viewer.tsx:955`) retries the moment the canvas gets real dimensions (add the retry there: if `fitStateRef` is null and a model exists, call `frameView`).
3. In the setup effect's cleanup, reset `framedKeyRef` and `fitStateRef` alongside the scene refs so a StrictMode/Fast-Refresh remount reframes.

**Verify.** Manual: load a design in a background tab (0×0 canvas), focus it — model frames. StrictMode dev run frames identically to prod build. `npm run vis` unchanged.

**Size.** S.

### 5. Never let `reconcileGenerated` delete a tracked font

**Problem.** `bundleFonts` keys the destination on `basename(entry)` (`scripts/gen-schema.mjs:272`) and records it in `.gen-manifest.json` (`:280`). A config listing `myfonts/LiberationSans-Regular.ttf` records `public/fonts/LiberationSans-Regular.ttf` — a **tracked** file — and the next build against a config without that entry `rmSync`s it (`scripts/lib/destinations.mjs:83-95`), deleting tracked repo content. The module comment's safety guarantee (`destinations.mjs:19-23`, "a tracked bundled .ttf was never in that manifest") holds only when no config font shadows a tracked basename.

**Fix.**

1. Before recording a font copy in the manifest, check whether the destination is tracked (`git ls-files --error-unmatch`, or cheaper: a build-time snapshot of `public/fonts/*.ttf` taken before any copy) and **refuse the copy with a clear error** naming the collision — a config font shadowing a bundled font is a real conflict, not something to silently overwrite.
2. As a belt-and-braces measure, `reconcileGenerated` should skip (and warn about) any manifest entry whose current bytes differ from what the manifest recorded at copy time — record a digest per copy.

**Verify.** New `gen-schema.test.mjs` case: a fixture config bundling a font whose basename matches a tracked `public/fonts` file fails the build with the collision error; a normal external-config build/reconcile round-trip still cleans up its own copies.

**Size.** S–M.

---

## P1 — Cache and update-flow correctness

### 6. Shrink the renderHash closure to the actual render contract

**Problem.** `worker-deps.mjs` hashes worker.ts's whole local import closure. `src/openscad/types.ts` (697 lines, mostly UI-only types — `ViewerConfig`, `UiConfig`, `PopupNotice`, `HelpContent`, `SoftwareLicense`) changed in **25 commits this year**; each byte change evicted every deployment's persisted geometry. The codebase already contorts around it (`src/lib/schema.ts:10-17` hosts prose "HERE rather than in types.ts"). Separately, `src/lib/numberDraft.ts` is in the closure only because `src/lib/scad.ts:4` imports `clampNumber`; the rest of that module is ParamForm UI logic. CLAUDE.md warns about types.ts but not numberDraft.ts — the file a contributor is *more* likely to touch casually. `progressThrottle.ts` (progress cadence only) is the same class.

**Fix.**

1. Create `src/openscad/protocol.ts` holding exactly what the worker imports: `ModelFormat`, `RenderRequest`, `RenderResult`, `WorkerProgress`, `WorkerModuleMessage`, `WorkerCommand`, plus the minimal `Design`/`Schema` slices the worker reads (`id`, `file`, `designs`, `assets`, `fonts`, `features`, `format`, `binAssets`, `wasmVersion`). Keep `types.ts` as the app-facing home, re-exporting the protocol types so no app import site changes.
2. Point `worker.ts` (and its closure: `renderArgs.ts`, `scad.ts`) at `protocol.ts` only.
3. Move `clampNumber` into `scad.ts` (or a new `src/lib/clamp.ts` imported by both), taking `numberDraft.ts` out of the closure. Leave `progressThrottle.ts` in (it is genuinely worker code) but note it in CLAUDE.md.
4. **Batch all of this into one commit** — it is itself a global cache eviction, so ride it together, and fold in any pending types.ts edits.
5. Update CLAUDE.md's "types.ts is in that hashed closure" section: the invariant becomes "only `src/openscad/protocol.ts` and the worker's own helpers are hashed; keep UI types out of `src/openscad/`."
6. Extend `tests/worker-deps.test.mjs` to assert the closure is exactly the expected file set, so an accidental re-widening fails a test instead of silently taxing every deploy.

**Verify.** `node scripts/gen-schema.mjs` twice, once before and after an edit to a UI-only type's doc comment: `renderHash` must not move. The worker-deps closure test pins the file list. Full `npm test && npm run build && npm run smoke`.

**Size.** M.

### 7. Service-worker fixes: SWR write lifetime, base-path collision, bin-cache pruning, update-flow edges

**Problem / fix, one per bullet.**

- **SWR revalidation write not tied to the event** (`public/sw.js:395`): the `cache.put` promise is discarded; `event.waitUntil` awaits only the fetch. Chain the put into the promise `waitUntil` receives, as the navigation (`:360`) and volatile (`:379`) paths already do; add the missing waitUntil assertion for this path to `swLifecycle.test.mjs` (it covers the other two at `:317-345`).
- **`isVolatileSource` matches any path segment `scad`** (`sw.js:60-62`): a deployment at `BASE_PATH=/scad/` makes *every* asset network-first. Match `scad` as a segment **relative to `SCOPE_PATH`**, not anywhere in the pathname. Add a lifecycle test with a colliding scope.
- **`asset-manifest.json` volatility** (`sw.js:88-103` vs `:53-55`): the stated rule ("a manifest that drives the SW's own asset list is volatile") is applied to `precache-manifest.json` only. Either treat both as volatile or narrow the comment to say why the asymmetry is safe.
- **Bin-cache pruning has one owner** (`src/openscad/binCache.ts` pruned only by `worker.ts:52-56`): a visitor who installs and warms without rendering accumulates up to N stale versioned bin caches. Run `staleBinaryCaches` cleanup from the SW's `activate` (it already knows the current version via `precache-manifest.json`) as well as from the worker.
- **`applyUpdate` dead-ends on a redundant waiting worker** (`src/lib/swUpdate.ts:270-275`): after posting `SKIP_WAITING`, arm a timeout (a few seconds) that falls back to `forceUpdate`'s reload path if no `controllerchange` arrives.
- **`updatefound` listener never removed** (`swUpdate.ts:242-248`): keep the handler in a ref and remove it in the effect cleanup alongside `controllerchange`.
- **`isAppEntry` exact-equality** (`sw.js:44-46`): also match `<scope>index.html` so that navigation refreshes `SHELL_KEY`.

**Verify.** Extended `swLifecycle.test.mjs` (waitUntil on the SWR path, `/scad/` scope, activate-time bin pruning) and `swUpdate.test.mjs` (timeout fallback, listener removal). `npm run build && npm run smoke`.

**Size.** M.

### 8. Guard the hand-mirrored WASM version pin

**Problem.** `binCache.ts:19`'s `DEFAULT_WASM_VERSION = "2026.06.12"` mirrors `scripts/wasm-version.mjs:10`'s `PINNED_WASM_VERSION` by convention ("bump both together"); `tests/binCache.test.mjs:24` asserts the literal, so bumping the pin alone leaves the fallback stale and no test fails.

**Fix.** Make the test import `PINNED_WASM_VERSION` from `scripts/wasm-version.mjs` and assert `binCacheName()` embeds it. (The app module can't import from `scripts/` at runtime; the *test* can, which is all the guard needs.)

**Verify.** Temporarily bump `wasm-version.mjs` only: the test must fail.

**Size.** S.

---

## P2 — Build-time validation and CI trust

### 9. Close gen-schema's validation gaps

**Problem / fix, one per bullet (all in `scripts/gen-schema.mjs` unless noted).**

- **Top-level scalars unvalidated** (`:172-181`): `title`/`description`/`source`/`extraCss` reach the pipeline with no type check; a non-string surfaces as a raw `TypeError` in vite-config. Apply the existing `CONFIG_SPEC` descriptors (`config-spec.mjs:336-348`) to the top level via `applyGroupSpec` (they are currently inert), so every failure is a `gen-schema:` error naming the key.
- **Wrongly-typed `designs`/`assets` silently ignored** (`:443`, `:1150`): `Array.isArray(x) && x.length` falls through to auto-discovery. Distinguish "absent" (auto-discover) from "present but not a non-empty array" (fail with the key name) — the one place the fail-fast convention is inverted.
- **`help` validated only in the browser** (`:786-792`): `resolveHelp` returns a non-object verbatim; `"help": 42` builds green and fails in `src/lib/schema.ts:333` at runtime. Validate the shape at build time like every other block.
- **Precache manifest omits `designs[].image` and `presetImages`** (`:864-869`): add both URL sets to the loop so offline gallery/preset-card deployments keep their artwork.
- **`render.fontFallback` bundled-family rule unenforced** (`scripts/lib/fonts.mjs:18-25`, documented at `docs/config.md:430`): after `bundleFonts` computes `FONT_FAMILIES` (`:316-347`), cross-check the fallback family against it and fail on a miss — the exact failure class the adjacent font-file check already prevents.
- **`extOf` destination containment** (`:144-147, 534`): constrain the extension to `/^\.[A-Za-z0-9]+$/` before splicing it into a destination filename, so a crafted `@icon` path can never write outside the staged tree even with a valid source resolution.
- **Non-`.scad` design file parses itself as presets** (`:509, :585`): require `d.file` to end in `.scad` (case-insensitively, or normalise), and wrap the preset `JSON.parse` in a try/catch that names the file.
- **`pwa.screenshots` entries dereferenced unguarded** (`scripts/lib/pwa-assets.mjs:296-312`): apply the same null/type guard the sibling `shortcuts` path has (`:364`).
- **`checkId` accepts `.` and `..`** (`:133-139`): reject dot-only ids; the regex guards an inline `<script>` string literal.
- **`vite.config.ts:33-42`'s `readSchema()` catch-all**: a missing/corrupt `designs.json` silently builds with `__APP_ID__ = "scadpub"` and `__APP_FORMAT__ = "3mf"`. In `command === "build"`, fail loudly when the file is missing; keep the lenient path for dev-server edge cases only.

**Verify.** One new `tests/fixtures/*.config.json` + `gen-schema.test.mjs` case per bullet (the suite's existing pattern); `npm test`.

**Size.** M–L (mechanical, but each bullet needs a fixture).

### 10. Harden the Customizer parser (`scripts/lib/params.mjs`)

**Problem / fix, one per bullet.**

- **A trailing non-hint comment drops the parameter entirely** (`:22-23`): `wall = 2; // in mm` matches neither `PARAM_RE` nor a doc line, so the parameter silently vanishes. Extend `PARAM_RE` to accept (and discard) a trailing free-text comment, keeping the `// [hint]` form special.
- **No block-comment or scope tracking**: assignments inside `/* … */` or module/function bodies become parameters. Track block-comment state line-by-line and a brace-depth counter; only depth-0, non-comment assignments are Customizer parameters (matching desktop OpenSCAD).
- **Quote-unaware splitting**: enum hints split on `,` (`:343-361`) and `@showIf` on `||`/`&&` (`:133-166`) break on quoted values (`["a,b", "c"]`, `mode=="a||b"`). Split with a small quote-aware scanner (one helper, reused by both).
- **String defaults matched greedily, never unescaped** (`:374, :393`): `"a" + "b"` becomes a literal; `"a\"b"` keeps the backslash. Use a non-greedy match with escape handling and unescape the result.
- **Duplicate parameter names accepted silently** (`:589`): fail the build naming the line numbers — two controls writing one OpenSCAD variable is never intended.
- **`@advanced` before the first section header silently ignored** (`:506-509` vs the claim at `:32-33`): either honour it (handle it above the `section === null` guard like `COLLAPSE_RE`) or make the doc comment state the limitation and emit a build error for the dead placement.
- **`KNOWN_ANNOTATIONS` omits `collapsed`** (`:113`): the unknown-annotation error can reject `@collapsed extra` while listing `@collapsed` as valid. Add it, and make the malformed-`@collapsed` case produce its own message.
- **Structure**: split the 280-line loop (`:400-683`) into `matchFileMeta(line, meta)` (the six section-independent matchers at `:458-494`) and `parseAnnotation(content, lineNo)` (the ordered dispatch at `:598-674`, where order is load-bearing — keep the order, name it), leaving the loop with pending-state application only.

**Verify.** The taktildots repo is the real-world corpus: after each parser change, run `SCADPUB_CONFIG=<taktildots>/scadpub.config.json node scripts/gen-schema.mjs` and diff the emitted `designs.json` against the previous output — only intended differences. Plus one `gen-schema.test.mjs` case per bullet.

**Size.** L.

### 11. Make CI unable to go green without checking

**Problem / fix, one per bullet.**

- **`npm run vis` passes unconditionally when baselines are missing** (`scripts/screenshots.mjs:72-76`): auto-writing a missing baseline and returning `true` means deleting `tests/screenshots/*.png` disables the gate. Keep auto-write for local `--update` runs; in CI (env `CI=1`) a missing baseline is a failure.
- **`closeBundle` plugins swallow all errors** (`vite.config.ts:150-159, 204-209, 242-258`): `sw-version` can ship an unversioned `sw.js` (updates never detected) and `security-headers` can drop the entire CSP block, exit 0. Narrow each `catch` to the genuinely-expected ENOENT case and rethrow the rest; then add a post-build assertion step (a small script, run in CI after `npm run build`) that `dist/sw.js` no longer contains `__SW_VERSION__` and `dist/_headers` contains the app CSP block.
- **Pre-commit filter gaps** (`.pre-commit-config.yaml:19, 27, 34`): `\.(ts|tsx|mjs)$` excludes `public/sw.js` (hand-maintained per CLAUDE.md) and `_headers`. Add `js` to the eslint/tests filters and a `files:` entry so `_headers` changes run `securityHeaders.test.mjs`.
- **No `concurrency:` group on the Pages deploy** (`.github/workflows/ci.yml:107-126`): add the standard `concurrency: { group: pages, cancel-in-progress: false }`.
- **The wrangler/Cloudflare path is never exercised** (`package.json:22`, `wrangler.jsonc:8-10` declares `assets` with no `directory`): either add a CI dry-run (`wrangler deploy --dry-run` or `wrangler versions upload --dry-run`) or delete the path and document GitHub Pages as the only deployment; a half-configured deploy target that CI can't redden is worse than either.
- **The ~10 MB WASM re-downloads every CI run** (`ci.yml:54-55`): cache `public/wasm` keyed on `scripts/wasm-version.mjs`'s pin.
- **`scripts/e2e-svg-wizard.mjs` is orphaned**: wire it into CI after smoke (it needs the same built app), or fold its checks into `smoke.mjs`.

**Verify.** Deliberately break each guard locally (delete a baseline, corrupt `__SW_VERSION__` substitution, remove the `_headers` block) and confirm CI-mode commands fail.

**Size.** M.

### 12. Fix the SVG sanitizer's evasions and name the wizard's trust class

**Problem.** `scripts/lib/svg-sanitize.mjs` misses: unquoted event handlers (`onload=alert(1)` — `EVENT_ATTR_RE` requires quotes, `:53`), `/`-separated attributes (`<rect/onload=…>`), named-entity scheme obfuscation (`&Tab;`, `&NewLine;` — `deobfuscateScheme` handles numeric + `&colon;` only), non-`xlink` prefixes on `href` (while `SCRIPT_RE` deliberately allows any prefix), and SMIL attribute animation (`<animate attributeName="href" values="javascript:…">`). `<style>` is untouched. Meanwhile the runtime wizard path does **zero** sanitization and doesn't say so: `IGNORED_TAGS` (`src/lib/svgPrep/dom.ts:24-33`) lists `foreignObject` but not `script`/`style`/`animate`; user SVGs are stored verbatim in IndexedDB and mounted into the WASM FS. Verified not exploitable today (they never reach the DOM), but the trust model in `docs/config.md:168-215` enumerates only two SVG classes — the wizard's genuinely untrusted third class isn't in it.

**Fix.**

1. Close the five verified evasions in `svg-sanitize.mjs` (each has a one-line test vector in the review), and strip `<style>` blocks or at least their `@import`/`url()` externals.
2. In the wizard pipeline, add `script`, `style`, and the SMIL animation elements to the *reported* set — a `check` finding ("this drawing carries active content; it will be ignored by OpenSCAD") and strip them in `applyFixes`. That makes the runtime path safe-by-construction if a preview feature ever lands.
3. Add the third SVG class (user-supplied, wizard-prepared, WASM-only) to `docs/config.md`'s trust model with the invariant "never rendered in the DOM"; grep-guard it with a comment at the single place that could violate it (`useFileImports.ts`).

**Verify.** `tests/svgSanitize.test.mjs` gains the five evasion vectors; `tests/svgPrep.test.mjs` asserts script/style stripping and the new finding code.

**Size.** M.

---

## P3 — Consistency

### 13. Repair the review cross-reference system and regenerate the review doc

**Problem.** ~180 comments across 18+ files cite finding IDs — `M1`, `M10`, `H3`, `H4`, "see docs/architecture-review.md H1/M15/L1" — that resolve to nothing: the committed `docs/architecture-review.md` numbers findings 1–10 and contains no such codes. The doc itself is stale and actively misleads: it claims vis never runs in CI, that no ESLint config exists, that Chromium is uncached (`docs/architecture-review.md:150-165` — all three false per `ci.yml:45-91`), and presents five fixed findings as open; it is cited as authoritative from `eslint.config.js:44,72` and `ci.yml:46-47`.

**Fix.**

1. Rewrite `docs/architecture-review.md` from the July 2026 review (this plan's source), and give it a **stable finding-ID appendix** mapping every historical code (`H1-H6`, `M1-M16`, `L1-L2`) to a short statement of the invariant it named plus its resolution. The IDs in code comments then resolve again, and future reviews append rather than rewrite.
2. Alternatively (cheaper, lossier): sweep the ~180 references and replace each "see M10" with the invariant stated inline. Prefer the appendix — the comments' cross-file grouping (all `M10` sites describe one mechanism) is genuinely useful.
3. Either way, fix the specific false claims and the "smoke.mjs's main() is ~410 lines" statement (it is ~50).

**Verify.** `grep -rE '\b[HML][0-9]+\b' src scripts public tests` — every hit resolves against the appendix. Markdownlint clean.

**Size.** M.

### 14. Route the remaining user-facing strings through the i18n catalogue

**Problem.** The `strings` config override is validated and coverage-tested, but the strings users most need overridden bypass it: the render hard-failure toast and the auto-pause announcement (`src/lib/useRenderPipeline.ts:254, 268` — while `:245` in the same function *is* catalogued), SW update/offline/stale notices (`useAppNotices.ts:28-49`), the install hint and copy-failure (`App.tsx:448, 529`), file add/remove/clear (`useFileImports.ts:51, 66, 76`), the hardcoded `"asserts"` badge noun (`diagnostics.ts:164`), and the mobile sheet's `aria-label` (`BottomSheet.tsx:501` hardcodes what `ParamPanel.tsx:224` translates — a deployment overriding `settings.title` changes one layout only).

**Fix.** Add the keys to `src/locales/en.json`, replace the literals with `t()`/`tn()`. The i18nCoverage test enforces both directions automatically. Scope: these ~12 strings, not a full sweep — CLAUDE.md's "subset, not a translation layer" stance stands; the criterion is "core flows a white-label deployment cannot ship without overriding".

**Verify.** `npm test` (i18nCoverage), plus a fixture config with `strings` overriding the new keys renders them (covered by the existing strings test pattern).

**Size.** S–M.

### 15. Extract the drifted desktop/mobile duplicates

**Problem.** Verified drift, not theoretical: the design-doc button (`CommandBar.tsx:95-103` vs `AppShell.tsx:775-783` — same action, drifted classes), the single-design fallback label (two type scales, `CommandBar.tsx:90-93` vs `AppShell.tsx:770-772`), the verbatim `DesignPicker` invocation (`CommandBar.tsx:82-88` vs `AppShell.tsx:761-768`), and `useDebounce(search, 150)` duplicated in both trees (`ParamPanel.tsx:124`, `SheetTabs.tsx:113`) so a breakpoint flip mid-typing restarts the debounce. `MenuRow` is used two ways — `BarActions` passes `icon=`, `ViewerHUD` passes icons as children — so icons render on opposite sides (`MenuRow.tsx:61-63`), exactly the drift the component exists to prevent.

**Fix.** Extract a `DesignGuideButton` and a `DesignTitle` (the `ActionDock` precedent, `AppShell.tsx:106`); hoist the debounced search value into `usePanelState` next to the raw value; make `MenuRow`'s `icon` prop the only icon path (convert `ViewerHUD`'s six rows) and note it in the component doc. Also update the two stale "both layout trees mount at once" comments (`BarActions.tsx:4-5`, `DesignPicker.tsx:26-28`) — see item 18.

**Verify.** `npm run build && npm run smoke && npm run vis` (pixel-level: the label/button unification will need one deliberate `vis -- --update` with before/after screenshots attached).

**Size.** M.

### 16. Accessibility consistency fixes

**Problem / fix, one per bullet.**

- **"Skip to parameters" lands on a non-focusable target**: `#params` (`ParamPanel.tsx:205, 223`) and `#params-mobile` (`AppShell.tsx:867`) lack `tabIndex={-1}` — the sibling `#main-content` documents this exact defect (`AppShell.tsx:938-944`). Add `tabIndex={-1}` to both.
- **`BottomSheet` is a modal announced as `role="complementary"`** (`BottomSheet.tsx:501`): it traps focus, scrims, and `inert`s the background (`AppShell.tsx:364-369`). Use `role="dialog"` + `aria-modal="true"` while modal (expanded), keeping `complementary` for the peek state if the roles are switched dynamically; verify with axe.
- **Two Escape handlers disagree** (`BottomSheet.tsx:362-363` sets peek, `:442-445` sets half; both fire, and `handleDetentChange` runs twice): delete the handle-level handler; the document-level trap owns Escape.
- **Selected-card pattern**: `PresetPicker.tsx:401` uses `aria-pressed`, `DesignPicker.tsx:98` uses `aria-current` for visually identical grids. Pick one (`aria-pressed` for toggles, `aria-current` for navigation — these are both "current selection", so `aria-current`) and align; fix the `DesignGallery.tsx` phantom-file reference in `PresetPicker.tsx:53-55`.
- **Coarse-pointer autofocus guard** exists in `Modal.tsx:37-39` and `DesignPicker.tsx:186-188` but not `ReviewDialog.tsx:118` or `ConfirmDialog.tsx:39`: route both through the `Modal` shell or copy the guard with a pointer to it.
- **`DesignPicker`'s gallery trigger bypasses `DialogTrigger`** (`DesignPicker.tsx:175-183`), so close-focus restoration relies on the FocusScope fallback: wrap the button in `DialogTrigger asChild`.
- **`aria-valuenow` frozen during panel drag** (`ParamPanel.tsx:236` vs the keyboard path `:247-248`): update the attribute imperatively in the same rAF that writes `style.width`.
- **Reduced motion three ways** (`ParamForm.tsx:518-519`, `haptics.ts:8` hand-roll `matchMedia`; everyone else uses `motion-reduce:`): add a `prefersReducedMotion()` helper to `lib/matchMedia.ts` and use it in both.

**Verify.** `npm run build && npm run smoke` — smoke fails on serious/critical axe violations, and the skip-link/dialog changes are exactly what it exercises. Manual screen-reader spot check on the sheet.

**Size.** M.

### 17. Single-source the duplicated enum/default knowledge

**Problem.** Enum lists exist in triplicate — `config-spec.mjs`, `config-parsers.mjs:197, 211` (`TEXT_DIRECTIONS`, `FORMATS`, re-declared in the file that imports `CONFIG_SPEC`), and `src/lib/schema.ts:42-44` — and `tests/config-spec.test.mjs:128-137` cross-checks only the spec↔schema pair. `CONFIG_SPEC`'s top-level defaults are declared but never applied (re-hardcoded at `gen-schema.mjs:173-180`, `config-parsers.mjs:188, 201`). PWA theme-colour defaults exist in four places (`config-parsers.mjs:388`, `config-spec.mjs:202-205` prose, `vite.config.ts:57-58, 285`).

**Fix.** Make `config-parsers.mjs` import its enums from `CONFIG_SPEC` (deleting its local copies and the dead `LANG_RE`/`TEXT_DIRECTIONS` exports); extend `ENUM_CROSS_CHECKS` to cover every pair that must stay hand-mirrored (schema.ts must, per its own comment — it can't import build scripts at runtime, but the *test* can check both). Wire `applyGroupSpec` to the top level (item 9 does this) so the spec defaults become live. Export `PWA_THEME_COLOR_DEFAULTS` and have vite.config read them from `designs.json` (it already reads `themeColor`/`themeColorLight` — drop the re-hardcoded literals).

**Verify.** Existing config-spec drift tests plus the extended cross-checks; `npm test`.

**Size.** S–M.

### 18. Fix stale doc comments that contradict code

**Problem.** In a repo that explicitly optimizes for trustworthy comments, these mislead:

- Three files claim `render.fontFallback` "lands as the schema's flat `fontFallback` field" — no such field exists; it feeds `fonts.conf` only (`src/lib/schema.ts:20-21`, `scripts/gen-schema.mjs:901-902`, `scripts/lib/config-spec.mjs:399`).
- `types.ts`'s `Schema.fileImport` doc (`:656-663`) describes a generic "Import file" button that the `FileImport` interface doc in the same file (`:373-378`) explicitly says doesn't exist. The interface doc is current; fix the Schema field doc.
- `smoke.mjs:104-111` explains a picker fallback removed by `checkPopupMode`, and `:125`'s `&& schema.designs.length > 1` is dead — delete both (the branch and the comment), matching `src/lib/popup.ts:35`.
- `App.tsx:296-298`'s "Reuses handleDesignChange's own … reset" — `applyExternalState` duplicates the logic, it doesn't call it; reword (or actually reuse).
- `Viewer.tsx:324-326`'s comment describes a `showGridRef` that no longer exists.
- `types.ts:483` "Rule this commit establishes" — commit-relative language; restate timelessly.
- `gen-schema.mjs:94-102`: two stacked explanations of the moved `KNOWN_TOP_LEVEL_KEYS`; keep one.
- `destinations.mjs:19-23`'s unconditional deletion-safety guarantee — item 5 makes it true again; until then, caveat it.
- CLAUDE.md's "the config `id` namespaces **all** browser storage": add the deliberate exception (`openscad-wasm-bin-*` is origin-shared by design, `binCache.ts:9-12`) so nobody "fixes" it.
- The `all_stroke.svg` fixture comment vs `check.ts:94-96`/`background.ts:2-4`: two contradictory models of how OpenSCAD imports stroke-only shapes — determine the real behaviour with a desktop OpenSCAD import and fix the losing side.

**Fix.** One sweep commit, no behaviour changes except the dead smoke branch.

**Verify.** `npm test`; grep each fixed phrase is gone.

**Size.** S.

---

## P4 — Complexity, dead code, performance polish

### 19. Delete the dead code inventory

All verified importer-less or unreachable at `8bd800c`:

- `PresetPicker`'s entire non-`inline` branch: the popover wrapper (`PresetPicker.tsx:554-569`), `onClose` prop and its two call sites (`:105, :176, :184`), `presetsLabel` (`:125`), the `max-h-72` branch (`:373`), and the file header describing the dead path (`:1-3`). Both mounts are `inline` (`ParamPanel.tsx:274-284`, `SheetTabs.tsx:182-193`).
- `DesignPicker`'s `active` prop and `lastSignal` guard (`DesignPicker.tsx:158-169`, always `true` at both call sites post-M7) plus its `eslint-disable`.
- `SectionNavigator`'s `compact` prop and branches (`SectionNavigator.tsx:29-30, 49-53, 58`); `StaleBanner`'s `className` (`StaleBanner.tsx:18, 21, 33`).
- Un-imported exports: `EXPORT_ATTENTION_HINT_ID` (`ActionButtons.tsx:26`), `MIN_SECTIONS_FOR_NAV` (`SectionNavigator.tsx:22`), `groupDesigns` (`DesignPicker.tsx:40`), `HALF_VH_RATIO` (`BottomSheet.tsx:31`) — de-export (keep local where used).
- `config-parsers.mjs`'s `LANG_RE`/`TEXT_DIRECTIONS` exports (subsumed by item 17).
- svgPrep's ~24 importer-less exports from `index.ts:6-47` — de-export what only the module uses; keep `analyze`/`deriveLayers` exported for tests but mark them so.
- `groupByColor.ts:132`'s never-false conjunct and `geometry.ts:100-102`'s unreachable branch — delete with a one-line note where non-obvious.

**Verify.** `tsc -b`, `eslint .` (no-unused now bites), `npm test`, `npm run build && npm run smoke`.

**Size.** S–M.

### 20. Split `Viewer.tsx` and `AppShell.tsx` along their existing seams

**Problem.** `Viewer.tsx` (1,247 lines) holds ~6 jobs in one `forwardRef`; `AppShell.tsx` (1,021 lines, 27 props, the repo's churn leader at 47 commits this year) accumulates every new feature; `ParamPanel` (25 props) and `SheetTabs` (22) forward ~14 identical pass-throughs.

**Fix.**

1. Viewer: extract `attachModelPicking(canvasEl, {cam, modelRef, editableRef, onPickRef})` (`:819-871`) and `buildStudioRig(renderer, scene)` (`:718-803` + the PMREM authoring `:255-291`) — each touches a disjoint ref set, ~250 lines out. Split the `[stl]` effect body (`:1065-1224`) into named dispose/parse/position, measure/report, re-bake/re-frame steps.
2. AppShell: extract `useViewerToggles(schema, isMobile)` (`:271-305, 478-481`), the CSS-custom-property publishers (`:522-561`), and `useAssetAvailability(schema, userFiles)` (`:410-440`) — the pattern `useReadinessModel`/`useOutputConsole`/`useSheetPolicy` already established.
3. Bundle `presetProps` and `formProps` in AppShell (the existing `stageProps`/`hudProps` technique, `:601-664`) to collapse the ParamPanel/SheetTabs signatures.
4. ParamForm: name the per-row body (`:591-646`) as `ParamRow`.

**Verify.** Behaviour-preserving refactors: `npm test`, `npm run build && npm run smoke`, `npm run vis` byte-identical (no `--update` needed).

**Size.** L. Do it in the listed order, one commit each.

### 21. Finish the scripts deduplication and split `generate()`

**Fix.**

1. `generate()` (`gen-schema.mjs:927-1351`, 425 lines): extract `resolveProseFields`, `parseConfigBlocks` (hoisting the `EN_CATALOG_PATH` read out of the per-call path, `:1095`), `checkAfterExportHelpTab`, `assembleSchema`, and `commitOutputs` — the phase table in the review names exact line ranges. `buildDesigns`' preset-image block (`:583-636`) is the second split. While there: make the commit-point comment (`:1292-1319`) honest about the `commitPwaBatch` window, or actually stage PWA writes into the same pre-commit temp tree.
2. Scripts seams: one `bootstrap()` in `scripts/lib/browser.mjs` for the server+launch+base dance (currently ×4), one shared `check()` counter (×3), converge the divergent `waitRendered`/`selectDesign` wrappers (document the intended semantics, don't keep three), and make `capture-screens.mjs`/`e2e-svg-wizard.mjs` use `browser.mjs`'s `openDialog`/`waitDialogClosed`.
3. `smoke.mjs`: separate the four context-owning checks from the 30 shared-page checks so the shared-page family can't leak state across checks.

**Verify.** `npm run build && npm run smoke && npm run vis && npm run screens` all green with identical output.

**Size.** M–L.

### 22. Decide `schema.ts`'s future

**Problem.** `src/lib/schema.ts` (377 lines) is the fourth hand-written representation of the schema shape (with `types.ts`, `config-spec.mjs`, gen-schema's emission). Every new field touches 4–6 places.

**Fix (decision needed).** Options, in preference order: (a) generate the runtime validator from `CONFIG_SPEC` + a small schema-side spec at build time (gen-schema already emits `scadpub.config.schema.json`; the same machinery can emit a designs.json checker); (b) shrink the hand validator to load-bearing invariants only (designs non-empty, params well-formed, enums valid) and let TypeScript + the build own the rest — the generator and app share one repo and one build, so full structural re-validation is defence against a drift class the tests already guard; (c) status quo, accepting the 4× write amplification. Don't decide silently: record the choice in the file header.

**Size.** M (option b) / L (option a).

### 23. Viewer performance polish

**Fix, one per bullet.**

- Gate the dimension-overlay rebuild (`Viewer.tsx:1185`) and the studio contact-shadow re-bake (`:1202`) on the model's bounds/theme actually changing — `modelSizeRef` is already available at `:1184`; the common "same dimensions, different text" tweak then skips three canvas-texture uploads and three render-target passes.
- Throttle the editable-hover raycast (`:858-867`): cache `getBoundingClientRect()` (invalidate on resize/scroll) and skip raycasts within ~30 ms of the last one. Consider `three-mesh-bvh` only if profiling still shows cost.
- Add the missing `cancelAnimationFrame` cleanup for the section-jump rAF (`ParamForm.tsx:516-522`).
- Dispose the PMREM `WebGLRenderTarget` (keep the texture) in `studioEnvironment` (`:285-290, 993`), and dispose `blurPlane`'s replaced initial material (`contactShadow.ts:138, 186`).
- Note in `disposeObject` (`:1238-1247`) that texture maps are not walked — safe for current loaders, unsafe to reuse for textured ones.

**Verify.** `npm run vis` unchanged; a manual profile of repeated param edits with ruler + studio on shows the texture uploads/shadow passes gone.

**Size.** S–M.

### 24. svgPrep coverage and API surface

**Fix.**

1. Direct unit tests for `geometry.ts` (none exist): every path command, both flag syntaxes, `contentBbox`, `gFormat` (including the `1e+7` output — decide if exponent output is acceptable and pin it).
2. Positive assertions for the never-asserted `check` codes (`open-paths`, `region-is-label`, `undersized`, `regions-available`), the `background.ts` branches (`%` units, transformed-context skip, lone-tile guard, polygon, `COVER_FRAC` boundary), `fixes.ts` specificity rules, `groupByColor` pruning/refusal branches, `Region.mixed`/`explicit`, and `parseSvg`'s error paths (the wizard's only terminal error state).
3. Fix the wizard back/re-fix bug (`SvgWizard.tsx:133-140`): keep the pristine parse (`parsed.before` already exists) and re-run `prepareSvg` from it, preserving a user-edited layers string across navigation.
4. Reconcile `regions-available` (`check.ts:166, 187-194`) with `deriveRegions` (`regions.ts:152-171`) — advertise only ids that derivation can actually emit — and add a finding for shapes outside every region (`index.ts:149-153` currently lets them vanish silently).
5. Unify the duplicated internals: one `inkAttr` (`dom.ts:113` vs `regions.ts:104`), one ancestor-transform walk (×3), one "≥2 regions else blank" predicate (×3), one Inkscape layer scan (×2).
6. Move `MAX_RELIABLE_REGIONS` enforcement into `check` (a real finding) so non-wizard consumers get the caution (`index.ts:58` vs `SvgWizard.tsx:296`).
7. Decide whether `fixViewBoxOrigin`'s wrapper-group approach is worth blinding three later checks (`fixes.ts:44-48` → `check.ts:222`, `background.ts:146-147`): rewriting child coordinates (or adjusting the checks to look through the known wrapper) restores the post-fix re-check's meaning; at minimum keep `<title>`/`<desc>`/`<metadata>` outside the wrapper.

**Verify.** `npm test`; e2e wizard script (wired into CI per item 11).

**Size.** L.

### 25. Comment hygiene pass

**Problem.** 9,482 comment lines vs 19,309 code lines (0.49 overall; `types.ts` 2.25, `framing.ts` 0.96, `gen-schema.mjs` 0.71). Much is load-bearing invariant documentation worth keeping; a measurable slice is change-history narration CLAUDE.md itself bans ("Rule this commit establishes", "used to fall back", "this used to call", "removed") plus the dead review IDs (item 13).

**Fix.** After item 13 lands (so IDs resolve), one sweep: delete pure history narration, keep invariants, move multi-paragraph rationale that exceeds "a couple of sentences" into `docs/` per CLAUDE.md's own rule. Do **not** thin `worker.ts`/`runner.ts`/`renderState.ts` — their comments are the render pipeline's specification. Skip `src/openscad/` entirely unless batched with item 6 (comment edits there evict caches until the split lands).

**Verify.** Ratio drops; no invariant statement lost (reviewer judgement, not tooling).

**Size.** M.

---

## Sequencing notes

- **Item 6 (renderHash split) is a global cache eviction** — batch it with any other `src/openscad/` edits (items 18's types.ts fixes, 25's comment pass there) into one commit.
- **Items 1 and 7 both touch `sw.js` and its lifecycle tests** — land 1 first (it changes install classification), then 7's smaller fixes rebase cleanly.
- **Item 9's top-level `applyGroupSpec` wiring is a prerequisite for item 17's** default single-sourcing.
- **Item 13 (review-ID appendix) before item 25 (comment sweep)** — otherwise the sweep deletes references the appendix would have resolved.
- **Item 10 (parser) is the highest-regression-risk item**: gate every change on the taktildots corpus diff described there.
- Visual changes (items 15, 16) each need `npm run build && npm run smoke`, `npm run vis`, and a screenshot in the PR per CLAUDE.md.

## Strengths this plan must not regress

Recorded so no fix above trades them away: the epoch/commit render-provenance model (`renderState.ts`) and latest-wins terminate-and-respawn with compiled-module handoff; the two-tier render cache on one content-stable key; content-addressed binary URLs consistent across worker, gen-schema, and the SW; Web-Locks download dedup between SW and worker; CSP hashes computed from built bytes (correct by construction); the ref-backed stable `AppActions` context; storage namespacing (with the deliberate shared-bin-cache exception); fail-fast generation with named-key errors; and the 990-test suite including the VM-executed service-worker lifecycle tests.
