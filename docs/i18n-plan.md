# Internationalization (i18n) plan

Status: **proposal / not implemented**. This document is the detailed plan for making
ScadPub localizable — both the app chrome ScadPub ships and the author-supplied content a
deployment configures. It is grounded in a full inventory of the current text surface
(file references below are as of this writing).

---

## 1. Goals and non-goals

**Goals**

1. All app-chrome strings (buttons, toasts, status text, aria-labels, dialogs, default
   help) come from a per-locale message catalog; adding a UI language is additive work
   that never touches component code.
2. Author-supplied content (config `title`/`help`/`popup`/labels, OpenSCAD parameter
   labels/sections/enum labels) can be provided per locale by a deployment, with
   graceful fallback to the base language.
3. Locale-correct number formatting (decimal separator, grouping) and pluralization.
4. Locale is detected from the browser, persistable by the user, applied before first
   paint (`<html lang>`), and — when more than one locale is configured — switchable in
   the UI.
5. The default (English-only) deployment keeps working with **zero config changes** and
   near-zero bundle/runtime cost.
6. Tests stop pinning literal English strings; a pseudo-locale run catches regressions
   (missed strings, layout overflow) in CI.

**Non-goals (explicitly out of scope, documented as limitations)**

- Translating OpenSCAD **output** (`ECHO:`, `WARNING:`, assertion text) — that text is
  produced by OpenSCAD-WASM and by the designs themselves.
- Translating **preset names**. Bundled preset names round-trip with the desktop
  OpenSCAD Customizer (`parameterSets` JSON) and are embedded in selection-identity keys
  (`bundled:<design>:<name>`, `src/components/PresetPicker.tsx`, `src/lib/presets.ts`);
  they stay canonical.
- Translating third-party **license texts** and copyright lines (`src/lib/licenses.ts`
  `MIT_BODY`, copyright strings) — legal texts stay verbatim; only ScadPub's own
  descriptive `note` sentences and the modal chrome are localized.
- Localizing error messages surfaced from libraries (e.g. the WebGL/three.js message
  shown by `ErrorBoundary.tsx:42`) — the translated lead sentence stays, the raw message
  is appended as-is.
- Localized **units**: model dimensions are millimetres by design (OpenSCAD units);
  we localize the number formatting, not the unit system.

---

## 2. Where we are today (inventory summary)

A full sweep found the following. This section is the factual baseline the phases below
are sized against.

### 2.1 App chrome (hardcoded English, needs a catalog)

Roughly **180–200 distinct literals across ~28 files**. Densest spots:

- `src/App.tsx` — ~20 strings; all sonner toasts and screen-reader announcements
  (render-failure, heavy-render brake, install nudge, offline notice, update/reload,
  share/export/save confirmations). Heavy interpolation, e.g.
  ``` `Large model (${r.ms} ms) — auto-render paused. Click "Render now" after edits.` ```
- `src/lib/defaultHelp.ts` — the entire fallback user guide (~9 sections of Markdown
  prose). The single biggest translatable block.
- `src/components/PresetPicker.tsx` — ~14 strings (section headers, save/delete/import/
  export affordances, conditional tooltips).
- `src/lib/renderStatus.ts` — the 8 render-status texts (`"Rendering…"`, `` `${ms} ms
  (cached)` ``, `` `Failed (exit ${exitCode})` ``…) built in lib code and surfaced in the
  status pill / sr-only live region.
- `src/lib/licenses.ts` — per-component `note` sentences and modal intro.
- A long tail of labels and aria-labels: `ThemeToggle`, `BarActions`, `ViewerHUD`,
  `ViewPicker`, `views.ts` (view names), `ParamForm` (font hints, empty states),
  `ParamPanel`, `ParamSearch`, `FileBar` (incl. `formatSize` byte units), `SheetTabs`,
  `PanelFooter`, `ResetButton` (confirmation dialog), `OutputConsole`, `OutputToggle`
  (composed aria-label with the only manual plural: `` `${n} notice${n===1?"":"s"}` ``),
  `StaleBanner`, `ViewerStage`, `BottomSheet`, `HelpModal`, `LicensesModal`,
  `PopupModal` ("OK", "Don't show this again"), `Modal`/`ui/dialog.tsx` (sr-only
  "Close"), `ui/spinner.tsx` ("Loading"), `ErrorBoundary`, `DesignPicker`,
  `AppShell` (skip link), `DimensionInfo` ("Yes"/"No", `Dimensions` headline),
  `CountBadges`/`diagnostics.ts` (hardcoded `"asserts"` badge noun).

Good existing patterns to preserve: logic keys are already separated from display
strings in `views.ts` (`id` vs `label`), tab `value` vs label maps, and
`renderStatus.ts` (`state` key vs `text`).

### 2.2 Author-supplied content (config + OpenSCAD source, needs a locale overlay)

- **Config text fields** (`scadpub.config.json` → `scripts/gen-schema.mjs` →
  `src/generated/designs.json`): `title`, `shortName`, `description`, `popup.header/
  body`, the whole `help` tree (tabs/sections/intros), `designs[].label`/`group`,
  `notices[].label`, `ui.presetsLabel`/`parametersLabel`, `fileImport.label`/`note`,
  `licenses[].note`, PWA `shortcuts[].name/short_name`, `categories`.
- **OpenSCAD-derived text** (`scripts/lib/params.mjs`): section names come from the
  literal `/* [Section] */` header, parameter labels/help from the doc comment above
  each parameter, enum labels from `value:Label` hints (or the value itself), `@info`
  labels/units from the annotation. **These are authored prose inside `.scad` files** —
  the single biggest structural constraint; see §4.3.
- **Runtime author text**: `echo("@info", label, unit, value)` rows and notice echoes —
  author-language by definition; not app-localizable.

### 2.3 Platform / infrastructure gaps

- `index.html:2` hardcodes `<html lang="en">`; nothing sets `dir`.
- The PWA manifest hardcodes `lang: "en"`, `dir: "ltr"`
  (`scripts/lib/pwa-assets.mjs`); the generated icon SVG embeds an `aria-label`.
- **No `Intl.*`, no `toLocaleString`, no `navigator.language` anywhere.** All numbers
  use `toFixed` with a hardcoded `.` separator (`src/components/dimensions.ts`,
  `DimensionInfo.tsx`, `FileBar.tsx` byte sizes, `renderStatus.ts` timings).
- Locale-naive casing/sorting: parameter search lowercases with plain `toLowerCase()`
  (`ParamForm.tsx`), user preset names are displayed in default code-unit `.sort()`
  order (`presets.ts:105`).
- CSS uses physical properties (`left`/`right`, `border-right`, `padding-left`, …)
  throughout `src/index.css`; a partial mirroring mechanism exists (`ui.panelSide` →
  `.panel-right` / `.param-panel--right`), but RTL is not free.
- Bundled fonts (Liberation) are Latin-only. This constrains **OpenSCAD `text()`
  rendering** for non-Latin design text; UI text uses system fonts and is unaffected.
- The build pipeline emits exactly **one** `designs.json`, one `manifest.webmanifest`,
  one `precache-manifest.json` — no locale dimension.

### 2.4 Tests and scripts that pin English

- `scripts/smoke.mjs` and `scripts/capture-screens.mjs` use ~30 literal English
  role-name/text selectors (`getByRole("button", { name: "Reset to defaults" })`,
  `aria-label^="Open output console"`, tab names "Presets"/"Parameters"/"Files", …).
- `scripts/screenshots.mjs` + `tests/screenshots/{light,dark}.png` bake English text
  into the visual baselines.
- The unit suite asserts on fixture **data** (config strings), which is fine.
- The sr-only render-status line (`Render status: ${text}`) is a script contract.

---

## 3. Core architecture decisions

### 3.1 Two audiences, two mechanisms

This is the load-bearing decision. ScadPub text has two owners with different
lifecycles, and one i18n mechanism cannot serve both:

| | App chrome | Author content |
|---|---|---|
| Owner | ScadPub repo | the deployment (config + `.scad`) |
| Examples | "Render now", toasts, aria-labels, default help | design labels, help tabs, popup, parameter labels |
| Mechanism | **TypeScript message catalogs** in `src/i18n/` (§3.2) | **per-locale config overlay + `.scad` translation sidecars** resolved by `gen-schema` (§4.3) |
| Fallback | English catalog | the base config / source language |

The app already has three ad-hoc author-facing string overrides (`ui.presetsLabel`,
`ui.parametersLabel`, `fileImport.label`). The author-content mechanism **absorbs**
this pattern (those keys keep working as the base-locale value) instead of multiplying
one-off override keys.

### 3.2 App-chrome catalog: typed TS modules, no i18n library

**Recommendation: no dependency.** Build a small typed catalog in `src/i18n/`:

```ts
// src/i18n/messages/en.ts — the reference catalog and the Messages type source
export const en = {
  renderNow: "Render now",
  resetDialogTitle: "Reset to defaults?",
  resetDialogBody: (designLabel: string) =>
    `This discards your current parameter changes for “${designLabel}”.`,
  noticeCount: (n: number) => plural(n, { one: `${n} notice`, other: `${n} notices` }),
  renderMs: (ms: number, cached: boolean) =>
    cached ? `${fmtInt(ms)} ms (cached)` : `${fmtInt(ms)} ms`,
  // …
} as const;
export type Messages = { readonly [K in keyof typeof en]: (typeof en)[K] };
```

```ts
// src/i18n/messages/de.ts
import type { Messages } from "./en";
export const de: Messages = { /* tsc fails the build on any missing/mistyped key */ };
```

- Every message is either a plain string or a **typed function** — interpolation and
  argument order are ordinary TypeScript, no ICU parser, no runtime format-string
  engine, and full compile-time completeness checking (`tsc -b` already gates commits
  via the pre-commit hook).
- A tiny runtime (`src/i18n/index.ts`): current-locale state, a `useMessages()` hook
  (context) returning the active catalog object, `plural()` built on
  `Intl.PluralRules`, and number helpers built on `Intl.NumberFormat` (§3.5).
- Non-React lib code (`renderStatus.ts`, `diagnostics.ts`, `licenses.ts`,
  `defaultHelp.ts`) takes the catalog **as a parameter** (or reads a module-level
  `getMessages()`), keeping those modules testable in node:test without React.

Why not a library: the string count is small (~200), the project is deliberately
dependency-lean (hand-written `sw.js`, hand-rolled Markdown subset), unit tests import
TS directly through Node's type-stripping loader (`tests/register-ts.mjs`) — so
macro-based solutions (Lingui) are out, and i18next/react-intl would add ~30–50 kB plus
a JSON-catalog indirection that loses the compile-time completeness check. If the
project later needs extraction tooling or TMS integration, the typed-catalog shape maps
mechanically onto ICU JSON, so this is not a one-way door.

**Loading:** `en` is imported statically (it is the fallback and the default). Every
other catalog is loaded with a dynamic `import()` so Vite splits it into its own chunk;
switching locale lazy-loads one small chunk. The service worker precache list picks the
chunks up automatically (they land in `dist/assets/` like any other chunk).

### 3.3 Locale model and resolution

- **Supported locales are a build-time list** owned by the config:
  `"locales": { "default": "en", "supported": ["en", "de"] }` (omit the key entirely →
  `{ default: "en", supported: ["en"] }`, current behaviour). `gen-schema` validates
  that every supported locale has an app-chrome catalog and records the block in
  `designs.json`.
- **Resolution order** (first hit wins):
  1. persisted user choice — `localStorage[ns("locale")]` (namespaced via
     `src/lib/appId.ts`, exactly like `theme.ts` does with `ns("theme")`);
  2. `navigator.languages` matched against `supported` (exact tag, then primary
     subtag: `de-AT` → `de`);
  3. the config `default`.
- **Pre-paint application:** mirror the theme mechanism. `index.html`'s inline script
  (which already reads `%APP_THEME_KEY%` before paint) also reads a new
  `%APP_LOCALE_KEY%`, runs the same resolution, and sets `document.documentElement.lang`
  (and `dir`, §7) before first paint — no flash of wrong language. `vite.config.ts`
  injects the key and a compile-time `__APP_LOCALES__` constant next to the existing
  `__APP_ID__`/`__APP_THEME_COLOR__` defines.
- **UI switcher:** a small selector (in the `BarActions` overflow area, next to the
  theme toggle) rendered **only when `supported.length > 1`** — the default deployment
  sees no new chrome. Changing locale persists the choice, swaps catalogs, updates
  `<html lang>`, and re-renders; it must **not** invalidate the render cache (§8).
- **URL:** locale is deliberately **not** encoded in the share-link hash. `urlState.ts`
  carries only design/param/preset identity and stays locale-safe. (A `#l=` param can be
  added later if link-level locale pinning is ever wanted; nothing in this plan blocks
  it.)

### 3.4 Single build, runtime switching (not per-locale builds)

A per-locale-build model (loop `generate()` per locale, one `dist/` each) was
considered and rejected as the primary mechanism: it multiplies deploys, breaks the
single-origin PWA story (one manifest, one service-worker scope, shared caches), and
makes shared URLs locale-bound. Instead: **one build, one origin, runtime switching**,
with these consequences:

- `designs.json` grows a locale dimension for author content (§4.3) — small overlay
  objects, not N full copies.
- The **PWA manifest stays single-locale** (the config `default` locale drives
  `lang`, `dir`, `name`, `description`, `shortcuts[].name`). This is a real platform
  limitation (a manifest has one `lang`); documented as such. A deployment that wants a
  fully localized install experience per language can still run per-locale builds under
  distinct base paths — the pipeline keeps that possible (`generate()` already takes
  all I/O paths as parameters) but it is not the supported default.

### 3.5 Numbers, plurals, casing, sorting

- **Numbers:** one helper module (`src/i18n/format.ts`) wrapping cached
  `Intl.NumberFormat` instances: `fmtMm(n)` (1 fraction digit — replaces the `toFixed(1)`
  in `src/components/dimensions.ts` and `DimensionInfo.tsx`), `fmtInt(n)` (render
  timings), `fmtBytes(n)` (replaces `FileBar.formatSize`, keeping B/KB/MB thresholds but
  localizing the number; unit words come from the catalog). HTML `<input type="number">`
  fields keep machine format — the browser localizes them natively; we never parse
  localized numbers.
- **Plurals:** `plural(n, forms)` on `Intl.PluralRules`; kills the
  `` `notice${n===1?"":"s"}` `` pattern (`OutputToggle.tsx`) and scales to languages
  with more than two forms.
- **Casing:** parameter search switches to `toLocaleLowerCase(locale)`
  (`ParamForm.tsx` query + haystack — fixes Turkish-i class bugs). Font-family
  normalization (`fonts.ts:33`) is an **identifier** comparison, not display text — it
  stays locale-independent (`toLowerCase()`), with a comment saying so.
- **Sorting:** displayed lists sort with a cached `Intl.Collator(locale)` — user preset
  names (`presets.ts:105`). Internal sorts used for cache signatures must stay
  byte-stable: the file-signature sort (`runner.ts:70`) currently uses default-locale
  `localeCompare` and must switch to plain code-unit comparison so a locale can never
  perturb a cache key (the defines sort at `runner.ts:88` is already code-unit).
- **Dates:** none exist in the app today; if any appear, `Intl.DateTimeFormat` only.

---

## 4. The plan, phase by phase

Each phase is independently shippable and leaves the default English deployment
pixel-identical (until the phase says otherwise). Sizes: S ≈ ≤1 day, M ≈ 2–4 days,
L ≈ 1–2 weeks.

### Phase 0 — Groundwork and guardrails (S)

1. Add `src/i18n/` skeleton: `en.ts` (empty-ish), `index.ts` (locale state +
   `useMessages()` + `plural()`), `format.ts` (Intl helpers), and unit tests
   (`tests/i18n.test.mjs`) covering resolution order, fallback, plural categories, and
   number formatting under a non-English locale.
2. Add a **pseudo-locale** (`en-XA` style: `"Réñdér ñów ∙∙∙∙"` — accented, ~35% longer,
   bracketed) generated mechanically from `en.ts` at build time. It is the tripwire for
   the whole migration: any visible untranslated string, truncation, or overflowing
   layout shows up immediately. Gate it behind `supported` containing `"en-XA"` in a
   test config so production configs never see it.
3. Make the smoke/capture scripts locale-proof **before** strings move (§6):
   - add stable hooks: `data-state` on the render-status pill (values from the existing
     `RenderState` keys) so scripts stop matching `/\d+ ms/` and `/Failed/` text;
   - route the scripts' role-name selectors through a single shared
     `scripts/lib/ui-strings.mjs` that imports the values from the `en` catalog (the
     scripts already run node ≥ 22, so they can import the TS catalog through the same
     loader the unit tests use, or a tiny generated JSON). One source of truth; when a
     string changes, the script follows.

**Acceptance:** `npm test` green; `npm run build && npm run smoke && npm run vis`
unchanged; zero user-visible change.

### Phase 1 — Extract all app-chrome strings (L, mechanical, parallelizable)

Move every literal from §2.1 into `en.ts` and consume via `useMessages()` /
catalog-parameter. Suggested reviewable slices:

1. **lib strings first** (they define the API shape for non-React consumers):
   `renderStatus.ts`, `diagnostics.ts` (the hardcoded `"asserts"` badge noun),
   `licenses.ts` (`note` sentences + modal intro; license bodies stay verbatim),
   `defaultHelp.ts` (becomes a per-locale module: `src/i18n/help/en.ts`, lazy-loaded
   with the catalog chunk since it is pure prose).
2. **Toast/announcement hub**: `App.tsx`.
3. **Panels and pickers**: `PresetPicker`, `ParamForm` (font hints, empty states),
   `ParamPanel`, `ParamSearch`, `FileBar` (+ `fmtBytes`), `PanelFooter`, `SheetTabs`,
   `ResetButton`, `DesignPicker`, `AppShell`.
4. **Viewer and status**: `ViewerHUD`, `ViewPicker`, `views.ts` labels (ids untouched),
   `ViewerStage`, `StaleBanner`, `OutputConsole`, `OutputToggle` (plural via
   `plural()`), `DimensionInfo` ("Yes"/"No", headline, `fmtMm`), `dimensions.ts`
   (`fmtMm`), `CountBadges`.
5. **Modals and bars**: `HelpModal`, `LicensesModal`, `PopupModal`, `Modal`/`ui/dialog`
   (sr-only "Close"), `ui/spinner`, `BarActions`, `ThemeToggle`, `ErrorBoundary`,
   `BottomSheet`, `IconButton` call-sites.

Rules for the extraction:

- **Never split a sentence across keys**; interpolations become typed function
  messages. Composed aria-labels (e.g. `OutputToggle`) become single functions taking
  all inputs.
- Keys are stable, semantic, and flat (`resetDialogTitle`, not `components.reset.dialog.title`).
- Logic keys stay untouched: `RenderState` values, tab `value`s, view `id`s, the
  `@info`/`@showIf` markers, preset composite IDs, notice `marker` matching.
- Keep every inert CSS class hook (`.status-pill`, `.param-group`,
  `.file-manager__name`, …) — they are test/`extraCss` API, not text.

**Acceptance:** grep gate — a small lint script (run in CI and pre-commit) that flags
string literals in JSX text/label/aria positions outside `src/i18n/` and
`src/components/ui/` internals; pseudo-locale smoke pass shows **no** plain-English
chrome; default-locale `npm run vis` still byte-identical (English catalog output is
character-identical to the removed literals).

### Phase 2 — Locale plumbing and switching (M)

1. Config `locales` block (§3.3) parsed/validated in `scripts/lib/config-parsers.mjs`,
   recorded in `designs.json`; `__APP_LOCALES__` + `%APP_LOCALE_KEY%` injection in
   `vite.config.ts`; pre-paint `<html lang>` script in `index.html` (and drop the
   hardcoded `lang="en"`).
2. Runtime: locale context provider in `App.tsx`, persisted choice via `ns("locale")`,
   `navigator.languages` matching, dynamic catalog import with an inline-`en` fallback
   while the chunk loads (never block first paint on a catalog fetch).
3. Locale switcher UI in the top-bar overflow (only when >1 supported locale);
   announce the change politely (existing live-region pattern in `App.tsx`).
4. `document.title` and meta description: title stays config-driven (author content —
   per-locale value from §4.3 when present).
5. Second real catalog to prove the pipe end-to-end (suggest `de` or `pt-BR` — the
   maintainer can seed it; machine-translate + review is acceptable for v1).

**Acceptance:** switching locale updates every visible string without reload, persists
across reloads, works offline (catalog chunk precached), and never re-renders geometry
(render cache untouched). axe-core still 0 serious/critical (the `lang` attribute now
being correct actually *fixes* a latent WCAG 3.1.1 issue for non-English deployments).

### Phase 3 — Author-content localization (L)

The mechanism is a **per-locale overlay**, resolved at build time by `gen-schema`, so
the runtime only ever merges small objects:

1. **Config overlay.** A new top-level config key:

   ```jsonc
   {
     "locales": {
       "default": "en",
       "supported": ["en", "de"],
       "overrides": {
         "de": {                       // sparse mirror of the localizable fields
           "title": "ScadPub",
           "description": "…",
           "popup": { "header": "…", "body": "…" },
           "help": { /* same shape as help */ },
           "ui": { "presetsLabel": "Voreinstellungen", "parametersLabel": "Parameter" },
           "fileImport": { "label": "Datei importieren", "note": "…" },
           "notices": [ { "marker": "alert", "label": "Warnungen" } ],   // matched by marker
           "designs": [ { "id": "tag", "label": "Anhänger", "group": "…" } ]  // matched by id
         }
       }
     }
   }
   ```

   `gen-schema` validates each override against the same field parsers as the base
   (reusing `config-parsers.mjs`), matches list entries by their **identity key**
   (`designs[].id`, `notices[].marker`, `shortcuts[].url`) never by position, and fails
   the build on unknown fields/ids — same "typos fail the build" philosophy as `colors`.
   An override may also live in a separate file
   (`"overrides": { "de": "i18n/de.config.json" }`) to keep the main config readable.

2. **OpenSCAD parameter-label sidecars.** Parameter/section/enum labels come from
   `.scad` comments and cannot be config fields without drift. Add per-design sidecar
   translation files (`<design>.i18n.<locale>.json`) next to the design, keyed by
   **stable identifiers** only, validated against the parsed schema at build time, and
   merged as display-only overlays. This is the structurally deepest part of the plan
   and is specified in full in **Appendix A**.

3. **Schema shape and runtime merge.** `designs.json` gains
   `"i18n": { "<locale>": { config-overlay…, designs: { "<id>": sidecar-overlay… } } }`.
   `src/lib/schema.ts` validates it; a small `localizeSchema(schema, locale)` selector
   produces the merged view the app consumes (memoized per locale; `en`/base costs
   nothing). Components keep reading the same fields — the merge happens in one place.
4. **Fallback semantics:** any missing override field falls back to the base value,
   per-field (a half-translated deployment degrades to mixed language, never to blank).
5. **Docs:** extend `docs/config.md` (locales block, overlay reference) and
   `docs/annotations.md` (sidecar format); note that `@info` **echo** rows and notice
   echo text are author-runtime strings a design must localize itself if desired (e.g.
   by a `lang` parameter — out of ScadPub's scope).

**Acceptance:** fixture-driven unit tests in `tests/gen-schema.test.mjs` style
(overlay merge, identity-key matching, unknown-key build failure, fallback); a
localized example (`examples/tag.i18n.*.json` + config override) exercised by a smoke
variant; `renderHash` provably unchanged by any overlay-only edit (§8).

### Phase 4 — PWA and generated-asset text (S)

1. Manifest `lang`/`dir` come from the config `locales.default` (drop the hardcoded
   `"en"`/`"ltr"` in `scripts/lib/pwa-assets.mjs`); `name`/`description`/`shortcuts`
   use that locale's overlay values.
2. Default icon SVG `aria-label` uses the default-locale title (it already flows from
   `TITLE`; just ensure the localized value is what flows).
3. Document the single-manifest limitation and the per-locale-build escape hatch
   (§3.4) in `docs/config.md`.

### Phase 5 — RTL readiness (M–L, ship when the first RTL locale is requested)

Deliberately last: it has real CSS cost and no user until an RTL catalog exists.

1. Convert `src/index.css` physical properties to logical ones (`inset-inline-*`,
   `padding-inline-*`, `border-inline-*`, `margin-inline-*`); audit Tailwind utilities
   in components for `left-*/right-*/pl-*/pr-*` → `start/end` equivalents. The existing
   `.panel-right`/`panelSide` mirroring keeps working as an independent, orthogonal
   flip (its semantics become "inline-end dock").
2. Set `dir` on `<html>` from the locale (pre-paint script, same place as `lang`);
   locale table in `src/i18n/` records direction per tag.
3. Audit direction-sensitive glyphs/compositions: the `×` dimension separator is fine;
   arrows/chevrons in `ViewPicker`/`BottomSheet` need `dir`-aware flips; the 3D viewer
   HUD overlay positions follow the logical-property conversion.
4. Add an RTL pseudo-locale (`en-XB`, mirrored) smoke pass + one RTL visual baseline.

---

## 5. Config compatibility and migration for deployments

- **No breaking changes.** Every existing config remains valid: no `locales` key means
  single-locale behaviour identical to today. `ui.presetsLabel`, `ui.parametersLabel`,
  `fileImport.label`, `help`, `popup` keep their exact meaning as the **base-locale**
  values; overlays localize on top of them.
- The base locale of author content is whatever language the config/`.scad` are written
  in — ScadPub does not assume it is English. `locales.default` labels it correctly for
  `<html lang>` and the manifest (a French-only deployment sets
  `{ "default": "fr", "supported": ["fr"] }` and gets correct `lang` with zero
  translation work — a real improvement over today's hardcoded `en`).

## 6. Testing and CI strategy

1. **Catalog completeness is a compile error** (typed catalogs, §3.2) — no runtime
   missing-key states to test for, no key-extraction tooling to run.
2. **Unit**: i18n resolution/fallback/plural/format tests; gen-schema overlay tests;
   `localizeSchema` merge tests. All run under the existing node:test + TS-loader
   setup.
3. **Smoke**: default-locale run as today, plus a pseudo-locale (`en-XA`) run against a
   test config — asserts no untranslated chrome (pseudo-locale wraps strings in
   markers the script greps for) and re-runs the axe pass (catches `lang` mismatches
   and any overflow-induced violations). Selectors come from the shared catalog-backed
   `ui-strings.mjs` (Phase 0), so smoke is locale-parameterizable by construction.
4. **Visual**: default-locale baselines unchanged; one additional baseline pair for the
   pseudo-locale is deliberately **not** kept (its strings churn with every catalog
   edit) — layout regressions are covered by the smoke overflow checks and the RTL
   baseline added in Phase 5.
5. **Lint gate**: the Phase 1 literal-string linter runs in CI and pre-commit to keep
   the surface closed after migration.

## 7. Risks, constraints, and open questions

| # | Risk / constraint | Mitigation |
|---|---|---|
| 1 | **Render-cache poisoning by locale.** `renderHash` covers render-affecting inputs; locale must never be one. | Overlays/sidecars are never mounted into the WASM FS and are excluded from `renderHash` inputs by construction; add a regression test: overlay-only change ⇒ identical `renderHash`. Internal sort for cache keys moves off `localeCompare` (§3.5). |
| 2 | **Longer strings break layout** (German ~+30%, pseudo-locale worse). | Pseudo-locale smoke from Phase 0; the resizable panel/bottom-sheet layouts already tolerate reflow; fix overflows as found. |
| 3 | **Test brittleness during migration.** | Phase 0 lands the shared selector module and `data-state` hooks *before* any string moves. |
| 4 | **Author content drifts from translations** (a renamed param orphans its sidecar entry). | Sidecar validation fails the build on unknown identifiers — same philosophy as unknown `colors` tokens. |
| 5 | **Preset names / notice echoes / `@info` echoes stay author-language.** | Documented limitation (§1 non-goals); notice **labels** are localizable, echo **text** is not. |
| 6 | **Manifest is single-locale.** | Platform limitation; default-locale manifest + documented per-locale-build escape hatch (§3.4). |
| 7 | **Non-Latin `text()` rendering needs fonts.** | Not blocked by chrome i18n; document that deployments targeting non-Latin design text must bundle covering fonts via `config.fonts` (`docs/config.md` fonts section). |
| 8 | **Markdown subset and translated prose.** The hand-rolled renderer (`Markdown.tsx`) processes translated help/popup bodies. | No change needed — it is syntax-, not language-sensitive; include one non-Latin fixture in its tests. |

Open questions to settle before Phase 2/3 (owner: maintainer):

1. **First real locale** to seed (drives who reviews translations); suggest `pt-BR`
   given the maintainer, or `de` for the layout-stress value.
2. Should the locale switcher be exposed even for author-content-less locales (chrome
   translated, help falls back)? Proposed: yes, with per-field fallback (§4.3.4) — a
   mixed page beats hiding the option.
3. Whether `defaultHelp` per-locale prose ships for every catalog locale from day one,
   or falls back to English until translated (proposed: fall back; it is overridable
   content anyway).

## 8. Execution order and sizing summary

| Phase | Scope | Size | User-visible change |
|---|---|---|---|
| 0 | i18n skeleton, pseudo-locale, test de-brittling | S | none |
| 1 | Extract ~200 chrome strings into typed catalogs | L | none (byte-identical English) |
| 2 | Locale detection/persistence/switcher, `<html lang>`, 2nd catalog | M | switcher appears for multi-locale configs |
| 3 | Config overlay + `.scad` sidecars + schema merge + docs | L | localized deployments possible |
| 4 | Manifest/PWA locale correctness | S | correct `lang`/`dir` metadata |
| 5 | RTL (logical properties, `dir`, mirrored pseudo-locale) | M–L | RTL locales possible |

Phases 0→1→2 are strictly ordered; 3 and 4 can proceed in parallel after 2; 5 is
demand-driven. After Phase 2 the project can honestly claim i18n support; after Phase 3
a deployment can ship a fully localized configurator.

---

## Appendix A — `.scad` localization in detail

This appendix specifies the sidecar mechanism from Phase 3 step 2. It is grounded in
the actual parser (`scripts/lib/params.mjs`) and the example design
(`examples/tag.scad`).

### A.1 What text a `.scad` file contributes, and what is localizable

`gen-schema` parses **only the design's own file** for parameters (the `use`/`include`
graph is followed for *mounting*, not for Customizer parsing — same as OpenSCAD's own
Customizer). So sidecars exist per design; shared `.scad` libraries never need one.

| Source construct | Parser | Schema field | Shown where | Localizable? |
|---|---|---|---|---|
| `/* [Text] */` section header | `SECTION_RE` (`params.mjs:8`) | `sections[]`, `param.section` | group headers (`ParamForm`) | **Yes** — display only; the source string stays the identity key |
| Doc comment, first sentence | `firstSentence()` (`params.mjs:33`) | `param.description` | control label; `@info` fallback label; search | **Yes** |
| Doc comment, full block | (`params.mjs:160-162`) | `param.help` | help popover; search | **Yes** |
| Enum hint labels — `// [a:Label]`, quoted or bare lists | `parseEnumHint()` (`params.mjs:53`) | `choices[].label` | dropdown options; `DimensionInfo` enum display | **Yes** |
| Enum hint **values** | same | `choices[].value` | `-D` defines sent to OpenSCAD; `@showIf` comparisons; preset values | **Never** |
| Parameter identifier | `PARAM_RE` (`params.mjs:14`) | `param.name` | monospace var-name (`ui.showVarName`); defines; URL state | **Never** |
| `// @info Label \| unit` | `INFO_RE` (`params.mjs:26`) | `param.info.label` / `.unit` | measurements panel (`DimensionInfo`) | **Yes** (label); unit overridable but usually universal (`mm`) |
| `// @showIf expr` | `SHOWIF_RE` | `param.showIf` | visibility logic | **Never** (references names/values) |
| String-parameter **defaults** (e.g. `label = "ScadPub"`) | `inferParam()` | `param.default` | rendered **geometry** | **Deferred** — see A.6 |
| `echo("tag: alert: …")`, `assert()` messages, `echo("@info", …)` labels | runtime output | notices / log / measurements | output console, `DimensionInfo` | **No** — runtime author text, see A.7 |

### A.2 Why sidecar files (alternatives considered and rejected)

- **Per-locale `.scad` copies** — forks geometry; every bug fix must be applied N
  times; drift is guaranteed. Rejected outright.
- **Inline annotations** (`// @label[de] Breite des Anhängers.`) — invisible to
  OpenSCAD, and they keep text next to source, but: every new locale touches every
  design file, doc blocks balloon (a 6-locale design triples in comment volume),
  translators must edit code files they don't otherwise understand, and the desktop
  Customizer shows the annotation soup in no case anyway. Rejected.
- **English-text keys** (gettext-style: key = the base string) — rewording a doc
  comment silently orphans every translation of it. Identifier keys plus strict build
  validation make the same event a **loud build error** instead. Rejected.

The `.scad` file stays the single source of truth for the base language and for all
geometry; a translation can never fork behaviour. Desktop OpenSCAD users always see
the source language — annotations and sidecars are both invisible to it.

### A.3 Sidecar format and discovery

`<design-stem>.i18n.<locale>.json`, discovered next to `<design>.scad` exactly like
bundled presets (`<stem>.json`) are today — the `.i18n.` infix keeps the two
namespaces distinct (preset auto-detection matches `<stem>.json` only; add a test
pinning that `tag.i18n.de.json` is never picked up as a preset).

All fields optional and sparse; keys are canonical identifiers from the parse:

```jsonc
// examples/tag.i18n.pt-BR.json
{
  "sections": {
    "Tag": "Etiqueta",
    "Text": "Texto",
    "Emblem (SVG)": "Emblema (SVG)",
    "Hanging hole": "Furo de pendurar",
    "Quality": "Qualidade"
  },
  "params": {
    "width":      { "description": "Largura da etiqueta (mm)." },
    "label":      { "description": "Texto a gravar na etiqueta.",
                    "help": "Texto a gravar na etiqueta. Deixe vazio para nenhum." },
    "text_size":  { "description": "Altura da fonte (mm)." },
    "engrave_text": { "description": "Entalhar o texto na placa em vez de elevá-lo." }
  },
  "choices": {
    // param name → { enum VALUE → translated label }; values never change
    "font": { "Liberation Sans:style=Bold": "Liberation Sans (negrito)" }
  },
  "info": {
    "text_size":     { "label": "Altura do texto" },   // unit inherits "mm"
    "hole_diameter": { "label": "Diâmetro do furo" }
  }
}
```

Two format details that matter:

- **`description` and `help` are separate fields.** The base language derives the
  label by splitting the doc block with a Latin-punctuation sentence heuristic
  (`firstSentence()`, `params.mjs:33-36` — `.!?` followed by whitespace and a capital).
  That regex is never applied to translations; the translator supplies both fields
  explicitly, so languages without Latin sentence punctuation (or capitalization) are
  unaffected.
- **Section keys are the verbatim source header text** (e.g. `"Emblem (SVG)"`), since
  the header *is* the section's identity in the schema (`param.section`,
  `collapsedSections`). Renaming a section in the `.scad` is a schema change and
  correctly breaks the sidecar at build time.

### A.4 Build-time processing (`gen-schema`)

For each design × each supported non-default locale:

1. Parse the `.scad` as today → canonical schema (unchanged code path).
2. If `<stem>.i18n.<locale>.json` exists, validate it **strictly** against that parse:
   an unknown section header, param name, enum value, or `info` key **fails the build**
   with the offending key and file — the same "typos fail the build" philosophy as
   unknown `colors` tokens. Values must be non-empty strings. A sidecar for a locale
   not in `locales.supported` is also an error (dead file detection).
3. Emit the validated overlay, sparse, into `designs.json` under
   `i18n.<locale>.designs.<id>` — the schema grows only what was translated.
4. **Sidecars are never copied into `public/scad/` and never mounted into the WASM
   filesystem.** `renderHash` hashes mounted `.scad`, fonts, features, the WASM build,
   and `worker.ts` — sidecars are outside all of those by construction, so a
   translation edit can never invalidate or fork the render cache. Add a regression
   test asserting `renderHash` is byte-identical across a sidecar-only change.

**Authoring workflow** — translators never hand-derive keys:

- `npm run gen -- --i18n-template <locale>` emits (or updates in place) a sidecar
  skeleton per design, prefilled with the base-language strings for every localizable
  key. The translator edits values only.
- Re-running the template after a design change **adds** new keys (prefilled with base
  strings, so they're greppable as untranslated) and, via step 2 validation, **errors**
  on orphaned ones — so a renamed parameter shows up as a loud diff + build failure in
  the same PR that renamed it, not as silent English leakage later.
- A non-fatal `--i18n-coverage` report lists untranslated keys per locale for release
  checklists.

### A.5 Runtime behaviour

- `localizeSchema(schema, locale)` (Phase 3 step 3) merges overlays per field. All
  grouping, collapse state, `@showIf` evaluation, define-passing, URL state, and preset
  application key on canonical names/values — only render-time display strings swap.
  Components are untouched; the merge happens in one place, memoized per locale.
- **Fallback is per-field**: sidecar `info.label` → sidecar `description` → base
  `info.label` → base `description` (mirroring the existing `@info` label fallback);
  an untranslated param simply shows base language.
- **Parameter search** (`ParamForm`) matches the localized `description`/`help` *and*
  the canonical `name` — so in a German UI both "Breite" and "width" find the width
  slider. Casing via `toLocaleLowerCase(locale)` per §3.5.
- The monospace variable name (`ui.showVarName`) always shows the canonical
  identifier — it is the bridge to the `.scad` source and to desktop OpenSCAD, and
  translating it would sever that.
- `DimensionInfo` shows enum values through their localized choice label; booleans use
  the catalog's Yes/No; numbers use `fmtMm`/locale formatting.

### A.6 String-parameter defaults — deliberately deferred

`label = "ScadPub"` in `tag.scad` is engraved into the exported geometry; a German
deployment might want the *default* text localized too. This is technically easy
(override `param.default` per locale; defines are part of the render-cache key, so
caching stays correct and `renderHash` is untouched) but it breaks a subtle
invariant: **share links encode only non-default values** (`urlState.ts` diffs against
defaults). With per-locale defaults, the same link opened under a different locale
reproduces **different geometry** — silently violating the "Copy link reproduces this
exact design" promise. If this feature is ever added it must stamp locale-defaulted
values into the URL explicitly. Until then, the documented pattern for deployments is:
pick a language-neutral default in the `.scad`, or ship a bundled preset per language.
(Non-Latin default text also requires bundling a covering font — risk #7.)

### A.7 Runtime author text sidecars cannot reach

Notice echoes (`echo("tag: alert: …")`), `assert()` messages, and `echo("@info", label,
unit, value)` labels are produced by OpenSCAD *at render time* — `gen-schema` never
sees their evaluated form, so no build-time overlay can translate them. Passing the
locale into the render as a `-D` define was considered and **rejected**: it would make
geometry-identical renders cache-miss per locale and lets a design fork geometry by
language. The output console is a diagnostic surface; its author text stays in the
design's language (OpenSCAD's own `WARNING:`/`ERROR:` lines are upstream English
regardless). Deployments that care should keep echo text terse and neutral. The
category **badge labels** (config `notices[].label`) are localizable via the config
overlay, and the console chrome ("Notices", "Log", empty states) via the app catalog —
so the frame around the author text is fully localized.
