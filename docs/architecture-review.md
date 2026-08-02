<!--
meta.contentType: Conceptual
content plan: record the July 2026 deep architecture review, and give every historical finding ID a stable, resolvable definition so the ~180 cross-references in code comments keep meaning something.
-->

# Review the ScadPub architecture

Reviews of the runtime app (`src/`), the build pipeline (`scripts/`,
`vite.config.ts`, `public/sw.js`), and the test/CI setup. The most recent full
pass ran at `8bd800c` (July 2026).

This document has two jobs:

1. Record what the current pass found, in outline.
2. Be the **stable definition of every finding ID**. Roughly 180 comments
   across the tree cite codes like `M10`, `H3` or `L1` as shorthand for an
   invariant. That is genuinely useful — every `M10` site describes one
   mechanism, and the grouping is the point — but it only works if the codes
   resolve. The appendix below is what makes them resolve. **A future review
   appends to it; it never renumbers.**

## Current state

At `8bd800c`: 990/990 unit tests pass, `tsc -b` is clean, `eslint .` is silent,
and `src/` holds zero `as any`/`@ts-ignore`/`@ts-expect-error`. All five open
items from the previous round — unescaped HTML interpolation, an unvalidated app
id, a silent render failure, a stale visual-regression mask, and a shell-out to
system `zip` — are fixed, and are recorded as resolved in the appendix.

The client/worker split is strict, the two-tier render cache degrades
gracefully, and the stable-identity `AppActions` context avoids both
prop-drilling and re-render churn.

## What the July 2026 pass found

Grouped as the fix plan groups them; see that document for `file:line`
references, fix steps and verification recipes.

- **Broken invariants and data-damaging bugs.** The service worker's install
  fetched the very chunks the documented boot brake exists to defer; the SVG
  layers spec was shredded by colours and ids containing its own separators;
  the SVG path scanner mis-parsed compact arc flags and then silently discarded
  every remaining segment; the viewer recorded a framing key when framing had
  bailed on a 0×0 canvas; and font reconciliation could delete a tracked file.
- **Cache and update-flow correctness.** `renderHash` hashed far more than the
  render contract, so UI-only type edits evicted every deployment's persisted
  geometry. Plus a batch of service-worker defects (a revalidation write not
  tied to its event, a `scad` path-segment collision with a subpath deploy,
  unpruned binary caches, two update-flow dead ends) and an unguarded
  hand-mirrored WASM pin.
- **Build-time validation and CI trust.** Eleven ways a broken config built
  green; eight ways the Customizer parser dropped, invented or corrupted a
  parameter; seven ways CI could pass without checking; and five verified
  evasions of the SVG sanitizer.
- **Consistency.** This document's own staleness (see below), user-facing
  strings bypassing the i18n catalogue, drifted desktop/mobile duplicates,
  accessibility inconsistencies, enum and default knowledge held in triplicate,
  and doc comments contradicting their code.
- **Complexity and polish.** A dead-code inventory, two ~1,000-line components
  to split along seams they already have, `generate()`'s 425-line body,
  `schema.ts`'s future as a fourth hand-written schema representation, viewer
  performance polish, svgPrep's coverage gaps, and a comment-hygiene pass.

The pass also found this document actively misleading: it claimed `vis` never
runs in CI, that no ESLint config existed, and that Chromium was uncached — all
three false — while presenting five fixed findings as open, and it was cited as
authoritative from `eslint.config.js` and `ci.yml`. That is what this rewrite
fixes.

## Strengths worth preserving

Recorded so a future refactor doesn't trade them away:

- The epoch/commit **render-provenance model** (`renderState.ts`) and
  latest-wins terminate-and-respawn with compiled-module handoff.
- The **two-tier render cache** on one content-stable key, with every
  IndexedDB operation degrading to L1-only rather than throwing.
- **Content-addressed binary URLs**, consistent across the worker, gen-schema
  and the service worker, and **Web-Locks download dedup** between them.
- **CSP hashes computed from built bytes**, so the policy is correct by
  construction.
- The **ref-backed stable `AppActions` context**: consumers memo cleanly yet
  always invoke the latest closure.
- **Storage namespacing** by config `id`, with the deliberate shared-bin-cache
  exception.
- **Fail-fast generation**: unknown config keys throw with the valid-key list,
  and the eval-free `@showIf` evaluator fails open with a comment saying why.
- The **VM-executed service-worker lifecycle tests**: `public/sw.js` is real,
  loadable JS, so install/activate/fetch behaviour is exercised rather than
  pattern-matched.

## Appendix: finding IDs

Every code cited in the tree, with the invariant it names and its resolution.
Grep-checkable: `grep -rE '\b[HML][0-9]+\b' src scripts public tests` should
resolve every hit against this table, numeric false positives aside — SVG path
data and CSS values are full of `M6`, `L100`, `H50` and friends.

IDs are historical and **stable**. The letter records how the review that
raised a finding ranked it at the time; it is not a claim about today.

### H — high

| ID | Invariant it names | State |
| --- | --- | --- |
| `H1` | **Render provenance.** Exported output must correspond to the controls that produced it: an edit or a design switch may not leave a stale `RenderResult` exportable under the new controls. Lives in `renderState.ts`'s epoch/currentness/exportability rules, surfaced as `exportable`. | Fixed; load-bearing and unit-tested. |
| `H2` | **Shareability is honest.** A share URL is built synchronously from the live design and values — never from `location.href`, which lags the debounced write — and a local-only dependency the URL cannot carry is named explicitly rather than silently implied complete. | Fixed. |
| `H3` | **The render contract is fully hashed.** `renderHash` covers every input that can change rendered bytes: mounted sources, bundled fonts, render features, the export format, the design routing map, the WASM build, and the worker's own code closure. Binaries are content-addressed so a rebuild can never serve mismatched halves. | Fixed. The closure was **narrowed** in July 2026 to exactly the render contract, and `tests/worker-deps.test.mjs` now pins it as an exact set; see `src/openscad/protocol.ts`. |
| `H4` | **Versioned binary URLs.** Every large pinned binary carries a `?v=<digest>`, so a Cache Storage entry can never serve a previous build's bytes, and the binary cache name folds in the pinned OpenSCAD version so a bump evicts automatically. | Fixed. |
| `H5` | **Source containment.** Every path a config or design resolves — assets, presets, icons, fonts, symlink targets — must stay inside `source`; an escape fails the build. | Fixed (`checkContained`, `scripts/lib/assets.mjs`). |
| `H6` | **Generated-output collision guard.** Every planned destination is registered with a human label before any bytes move; a second writer aimed at the same path fails the build naming both owners, instead of silently overwriting. | Fixed (`scripts/lib/destinations.mjs`). |

### M — medium

| ID | Invariant it names | State |
| --- | --- | --- |
| `M1` | **Cache writes are best-effort.** A Cache Storage failure (quota, private browsing, a blocked origin) degrades to uncached rather than failing the render; a fatal bootstrap failure resets the worker's bootstrap state so the next render retries the whole thing. | Fixed. |
| `M2` | **Transactional service-worker install.** Install caches an atomic minimum shell and *propagates* failure, so a broken deploy never succeeds into an unusable offline fallback; and only the canonical app entry may refresh `SHELL_KEY`. | Fixed. Extended July 2026: `<scope>index.html` counts as the app entry too, and install no longer fetches preload-hinted chunks. |
| `M3` | **A scoped update escape hatch.** `forceUpdate` unregisters only *this* app's registration and deletes only its own shell caches, never every worker or cache on the origin. | Fixed. |
| `M4` | **One owner for external URL state.** A same-document `hashchange` (or a back/forward navigation) is consumed in exactly one place, so URL state and app state cannot diverge. | Fixed. |
| `M5` | **Live system-theme tracking.** In auto mode the resolved theme comes from a `useSyncExternalStore` over `matchMedia`, not a value computed once and left stale until an unrelated render. | Fixed. |
| `M6` | **Invalidation-driven rendering.** Once OrbitControls' damping has settled and nothing invalidates the scene, `renderer.render()` stops firing every animation frame. Smoke asserts it against a render counter stamped on the mount node. | Fixed. |
| `M7` | **Only one layout tree is mounted.** The desktop and mobile trees never coexist, so a DOM id is never duplicated and unscoped queries are safe. Panel state must therefore live above the breakpoint to survive a remount. | Fixed. |
| `M8` | **Generated-file lifecycle.** Files this tool wrote outside the wholesale-wiped scad tree are remembered and reconciled, so a removed config entry leaves no orphan — and nothing outside that remembered set is ever deleted. | Fixed. Hardened July 2026: a config font may not shadow a tracked bundled one, and every entry records a digest so a file changed since is never removed. |
| `M9` | **Annotation grammar is gated at build time.** `scripts/lib/params.mjs` is the primary gate: a malformed or unknown `@annotation` fails the build with file and line rather than degrading into doc prose. `src/lib/visibility.ts` mirrors the `@showIf` grammar defensively, for a legacy cached schema that bypassed it. | Fixed. Extended July 2026 with quote-aware clause splitting and `@collapsed` in the known set. |
| `M10` | **User files are untrusted.** The render worker path-strips user-supplied filenames, rejects a request whose sanitized mount paths collide, and mounts them only into the WASM filesystem. | Fixed. July 2026 documented the trust class end to end: see `docs/config.md`'s SVG trust model and `src/lib/useFileImports.ts`'s header. |
| `M11` | **Persisted cache records are bounded.** A record's log is capped independently of the STL byte budget, and the cached flag is correctness-relevant rather than informational. | Fixed. |
| `M12` | **The WASM pin is verified as a set.** The stamp and checksum cover both `openscad.wasm` and its glue, and the glue is content-addressed, so the two can never drift apart. | Fixed. July 2026 added a test that the app-side fallback pin cannot go stale against `scripts/wasm-version.mjs`. |
| `M13` | **Browser-facing SVGs are sanitized.** The logo, the PWA icon and each design's picker icon run through `scripts/lib/svg-sanitize.mjs`. Render-input SVGs deliberately do not: rewriting those bytes would change geometry. | Fixed. Five verified evasions closed July 2026. |
| `M14` | **The root error boundary is a pure state transition.** A caught render error maps to a recoverable UI state testable without a DOM. | Fixed. |
| `M15` | **First-render bookkeeping resets per design.** The initial-render latch and the heavy-render brake are reset by `resetForDesign`, so switching designs never inherits the previous one's state. | Fixed. |
| `M16` | **The mobile sheet is modal when it covers the app.** At the Full detent the sheet visually covers the mobile shell, so the background is `inert` and focus is trapped. | Fixed. Refined July 2026: while modal it is also *announced* as a dialog. |

### L — low

| ID | Invariant it names | State |
| --- | --- | --- |
| `L1` | **StrictMode is safe here.** React's dev-only double-invocation must not leak a second render worker: worker construction lives in a `useEffect` with matching cleanup, so mount → cleanup → remount disposes the first runner before constructing the second. | Fixed. Extended July 2026: the viewer's framing refs reset on teardown too, so dev frames like prod. |
| `L2` | **Lint is a hard zero.** The repo is triaged to 0 errors and 0 warnings, and CI and pre-commit both run `eslint . --max-warnings 0`. A rule kept at `warn` rather than `error` still gates; it just reads as advice in-editor. | Fixed. |

### Not finding IDs

`L1` and `L2` **also** name the render cache's two tiers throughout
`stlCache.ts` and `runner.ts` (L1 = the in-memory LRU, L2 = IndexedDB). Those
are not references to this table.

Everything else a `[HML][0-9]+` grep turns up — `M256`, `L100`, `H50`, the
`M6,6 L6,94` runs in SVG fixtures — is coincidence: path data, CSS values and
byte constants.
