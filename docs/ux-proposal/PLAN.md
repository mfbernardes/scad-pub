# ScadPub UX & PWA redesign — implementation plan

Status: **plan only — no implementation in this document.** It turns the proposal
in [`README.md`](./README.md) into a phased, file-level build plan with config
additions, acceptance criteria, and tests. Decisions already locked with the
owner are marked ✅; open decisions are flagged **DECIDE**.

## Locked decisions
- ✅ Full-bleed 3D canvas; **docked** parameter panel on desktop, **persistent
  bottom sheet** on mobile (Maps spirit, docked body).
- ✅ Dock side configurable (`ui.panelSide`, default `left`).
- ✅ Default desktop panel state configurable (`ui.panelDefault`, default `open`).
- ✅ Large preset counts → searchable **preset picker** (not a chip row).
- ✅ OpenSCAD advisories → compact **`⚠ N` badge** by the status pill; full list +
  raw log in an **Output console** drawer, **closed by default**.
- ✅ File import + list → a **Files** group (desktop) / **Files** tab (mobile).
- ✅ Light + dark **theme revamp**, driven by the existing token system, using
  **rounded rectangles — not pills/ovals** (modest, consistent corner radii).
- ✅ **Install** affordance **demoted** — not a standing top-bar button. Shown only
  when actually installable; lives in the overflow menu + a one-time post-export
  toast; hidden when already installed / on unsupported browsers / after dismissal.
- ✅ PWA icons are **rasterized to PNG at build time** from the source SVG.
- ✅ Do all of it as **one PR / one branch** (phases are build order, not separate
  PRs); PWA quick wins (Phase 0) come first as they're independent and low-risk.

---

## How a change flows through this codebase (orientation)
Any new config key touches **four** places, in order:
1. **`scadpub.config.json`** — author-facing input.
2. **`scripts/gen-schema.mjs`** — parse + validate the key, fold it into the emitted
   `schema` object (and into `renderHash` only if it affects geometry — UI flags do
   not).
3. **`src/openscad/types.ts`** — add the field to the `Schema` interface.
4. **`src/lib/schema.ts`** — `validateSchema` runtime guard for the field.

Theme tokens are special: **any** `--token` can already be overridden per-theme via
the config `colors.{light,dark}` map (`src/lib/configCss.ts`), so "make the revamp
configurable" means *defining new default tokens in `src/index.css`* — they become
overridable for free. HTML `<head>` is injected by the `configHtml` plugin in
`vite.config.ts` (string `.replace` of `%APP_*%` placeholders). The PWA manifest +
icon are written by `gen-schema.mjs` (~L797–835).

---

## Config additions (full surface)

```jsonc
{
  "ui": {
    "panelSide": "left",        // "left" | "right"  — desktop dock edge
    "panelDefault": "open",     // "open" | "collapsed" — first-load desktop state
    "outputDefault": "closed",  // "closed" | "open"  — OpenSCAD output console
    "install": "auto"           // "auto" | "off" — offer PWA install affordance
  },
  // theme revamp tokens are just colors overrides (already supported):
  "colors": {
    "dark":  { "radius": "16px", "glass-bg": "rgba(31,34,41,.82)" },
    "light": { "radius": "18px", "glass-bg": "rgba(255,255,255,.78)" }
  },
  // richer manifest inputs (Phase 0):
  "shortName": "ScadPub",
  "categories": ["productivity", "graphics", "utilities"],
  "icon": "brand/icon.svg",                 // existing — the source SVG
  "iconMaskable": "brand/icon-maskable.svg", // optional override; defaults to `icon`
  "screenshots": [                   // optional, for Android rich install UI
    { "src": "brand/shot-wide.png",   "sizes": "1280x800", "form_factor": "wide"   },
    { "src": "brand/shot-narrow.png", "sizes": "390x844",  "form_factor": "narrow" }
  ]
}
```

`ui` is a single nested object validated as a unit (defaults applied when absent),
mirroring how `viewerControls` is parsed today. None of these feed `renderHash`
(they don't change geometry).

---

## Phase 0 — PWA "feel native" quick wins (independent, ship first)
**Goal:** the installed app stops feeling like a web page. No layout change.

**Files:** `index.html`, `src/index.css`, `vite.config.ts`, `scripts/gen-schema.mjs`,
`src/openscad/types.ts`, `src/lib/schema.ts`, `public/sw.js` (precache list).

**Work:**
- `index.html`: viewport → `width=device-width, initial-scale=1, viewport-fit=cover`;
  add Apple meta (`mobile-web-app-capable`, `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style=default`, `apple-mobile-web-app-title`);
  add per-scheme `theme-color` (`media="(prefers-color-scheme: …)"`); point
  `apple-touch-icon` at a **PNG** (fallback to SVG only if no PNG configured).
- `vite.config.ts`: new `%APP_*%` placeholders for the Apple title and the two
  theme-color values; source them from the schema (derive light/dark theme-color
  from the resolved palette or new optional config).
- `src/index.css`: `overscroll-behavior:none` on `html,body`; `#root` height
  `100dvh` with `100vh` fallback; `touch-action:none` on the viewer canvas,
  `touch-action:manipulation` on controls; `env(safe-area-inset-*)` padding hooks
  on the top bar + bottom surfaces (used in later phases). **Do not** disable user
  zoom globally (WCAG 1.4.4).
- `gen-schema.mjs` manifest block: add `id` (from `ID`), `categories`, `lang`,
  `dir`, `launch_handler:{client_mode:"navigate-existing"}`, raster `icons`
  (192/512 + 512 maskable) and `screenshots` when configured.
- **Build-time icon rasterization (decided):** `gen-schema.mjs` rasterizes the
  source `icon` SVG to PNGs at build (192, 512, a 512 **maskable**, and a 180
  `apple-touch-icon`) and writes them next to the manifest. Add **`@resvg/resvg-js`**
  as a `devDependency` (pure-Rust WASM/native SVG→PNG, no headless browser, fast,
  CI-friendly). Keep emitting the SVG too (`purpose:"any"`) for engines that prefer
  it. Notes: the **maskable** PNG must be rendered with ~10% safe-zone padding (or
  use the `iconMaskable` override) so Android's circle mask doesn't clip the glyph;
  rasterize on a transparent (or `background_color`) ground; sizes/filenames feed the
  manifest `icons[]` and the `<link rel="apple-touch-icon">`.
- `sw.js` precache: include the generated PNG icons + any screenshot assets.

**Acceptance:** Lighthouse PWA "installable" + "PWA optimized" pass; no `0px`
safe-area on a notched device (manual/dimension check); pull-to-refresh no longer
reloads while dragging the model; no white letterbox in landscape on iOS;
`npm run smoke` (axe) stays clean.

**Tests:** extend `tests/gen-schema.test.mjs` for the new manifest fields (assert
shape against a fixture config); `tests/configCss.test.mjs` unchanged; add a tiny
unit asserting `index.html` contains the required meta after build (or assert in
smoke). Update `npm run vis -- --update` only if visuals shift (shouldn't in P0).

---

## Phase 1 — Theme revamp (tokens only)
**Goal:** softer, slightly more elevated light + dark, fully token-driven.

**Files:** `src/index.css` (token values + a few new tokens), `tests/screenshots/*`
(rebaseline), `docs/config.md` (document new tokens).

**Design language — squares with rounded corners, NOT pills/ovals (owner pref):**
- Use **modest, consistent corner radii** on rounded *rectangles*. Token guidance:
  `--radius` ≈ 10–12px for cards/panels/buttons/inputs, a smaller `--radius-sm` ≈
  6–8px for chips/badges. **Avoid fully-rounded `border-radius:999px` pills and oval
  shapes.** Chips, the design/preset buttons, status pill, and badges become
  **rounded rectangles**, not lozenges. The advisory count badge is a small rounded
  square, not an oval. HUD/icon buttons stay square-with-rounded-corners.
- (The proposal mockups leaned on pills for speed; the implemented UI uses
  rounded-rects per this preference. No new mockups needed — this is a token/shape
  note carried into Phases 2–5.)

**Work:**
- Introduce `--radius`, `--radius-sm`, `--glass-bg`, `--glass-border`, `--elevation`
  (+ refined surface/line values) in both `:root` blocks; refactor components to
  consume them and replace any `999px`/pill radii with `--radius`/`--radius-sm`.
- Keep every pair AA: re-verify `--accent` (text) vs `--accent-solid` (fill),
  `--muted` on each surface, focus ring ≥ 3:1.
- Because these are normal custom properties, the config `colors` map overrides
  them with **no schema change**. Document the new token names in `docs/config.md`.

**Acceptance:** `npm run smoke` axe clean in both themes; manual AA spot-check;
`npm run vis -- --update` regenerates `dark.png`/`light.png` baselines intentionally.

**Tests:** visual baselines updated; no logic tests needed. (Do P1 *before* the big
relayout so the rebaseline is a clean, reviewable diff.)

---

## Phase 2 — Desktop "Studio" relayout
**Goal:** full-bleed canvas + docked, collapsible, **resizable** panel; floating
command bar, status pill (+ advisory badge), consolidated action cluster, view HUD.

**New components (`src/components/`):**
- `AppShell.tsx` — owns the responsive layout (canvas + dock + floating chrome);
  reads `ui.panelSide` / `ui.panelDefault`.
- `CommandBar.tsx` — floating top bar: brand, design picker, presets button,
  status pill + advisory badge, theme/help/info, overflow menu (install lives here).
- `ParamPanel.tsx` — the docked card: header (collapse), preset button + Save,
  parameter **search**, `ParamForm` (existing), `FilesGroup`, footer (Reset).
- `ActionCluster.tsx` — floating bottom-center: Auto-render · Render · Export ·
  PNG · Share · Output(toggle, badged).
- `ViewerHUD.tsx` — zoom/fit/reset/fullscreen (promote existing `viewerControls`).
- `StatusPill.tsx` + `AdvisoryBadge.tsx`.

**Refactors:**
- `App.tsx`: stop owning the flex `layout`/`sidebar`/`preview` markup; delegate to
  `AppShell`. Keep all state/logic (render, presets, files, theme, URL) — this is a
  **view** refactor, not a behaviour change. The hamburger/drawer CSS is replaced by
  the shell.
- `src/index.css`: replace `.layout/.sidebar/.preview` rules with shell styles
  (full-bleed `.viewer`, `.dock`, floating `.glass` surfaces, HUD); add panel
  resize handle + collapse rail; keep all existing param/preset/modal styles.
- Panel **resize**: drag handle persists width to `localStorage` (namespaced by
  `appId`), min/max clamp; collapse persists open/closed.

**Acceptance:** identical render/export/share behaviour; panel collapses to a
full-screen canvas and restores; width persists; keyboard reachable (skip-link →
panel; Esc closes overflow); axe clean; works ≥1240/≥1600 without the model lost in
whitespace (cap/center at ultra-wide).

**Tests:** `npm run smoke` (drives render/switch/preset/export/share/`@showIf` — keep
selectors stable or update them); new unit for the panel-state persistence helper;
`vis --update` for desktop baseline.

---

## Phase 3 — Mobile bottom sheet
**Goal:** replace the left drawer with a persistent, detented editing sheet.

**New components:** `BottomSheet.tsx` (detents Peek/Half/Full; drag handle with
tap-to-cycle; keyboard Arrow Up/Down; nested-scroll handling; safe-area padding;
**non-modal** below Full, scrim only at Full), `SheetTabs.tsx`
(Parameters · Presets · Files), reuse `ParamForm`/`PresetPicker`/`FilesGroup`.

**Work:**
- `AppShell` renders `BottomSheet` below ~600–905px instead of the dock (one shared
  `ParamForm`, so desktop/mobile never drift).
- Sticky sheet footer: Render · Output · Share.
- Recenter the three.js camera as the sheet height changes so the model isn't
  hidden (Viewer gets a `setViewportInset(bottomPx)` or similar handle).
- Remove the old `menu-toggle`/`backdrop`/`sidebar-close` drawer code.

**Acceptance (a11y is a hard gate):** handle has `role="button"` + label, tap cycles
detents, Arrow keys resize, a visible collapse control exists (never handle-only),
Back/Esc collapses; canvas stays grab-rotatable at Peek/Half; no stacked sheets;
8px min target spacing; axe clean; 320px reflow holds.

**Tests:** unit for the detent state machine (snap thresholds, cycle order, keyboard);
smoke on a mobile viewport (sheet open/edit/render); `vis --update` phone baselines.

---

## Phase 4 — Presets picker (large N)
**Goal:** scale from a chip row to a searchable picker.

**New component:** `PresetPicker.tsx` — desktop popover / mobile tab body. Sections
**Recent/favourites**, **Bundled (N)**, **Yours (N)**; client-side filter by the
search box; inline delete for user presets; "Save current as…". Built on existing
`src/lib/presets.ts` (`listPresets`, `fetchBundledPresets`, `defaultsFor`).

**Work:** replace `PresetBar`/`PresetSelect` usage with the picker (keep the libs);
persist "recent/favourite" preset ids in namespaced `localStorage`; keep URL-state
preset encoding (`urlState.ts`) intact.

**Acceptance:** dozens of presets remain usable (search + sections); selecting
updates URL/share; delete removes from storage + list; bundled presets are
read-only; keyboard-navigable listbox; axe clean.

**Tests:** unit for the filter/group/recents logic; smoke "apply preset" path still
passes; small `vis` for the popover (optional).

---

## Phase 5 — Output console + advisory badge
**Goal:** one home for OpenSCAD output; a quiet always-visible signal.

**New components:** `OutputConsole.tsx` (bottom drawer; segments **Advisories** /
**Log**; closed by default per `ui.outputDefault`), `AdvisoryBadge.tsx`.

**Work:** move today's `Diagnostics` (parsed notices/warnings/asserts, driven by
`schema.notices` + `src/lib/diagnostics.ts`) and `LogPanel` (raw `result.log`) into
the console. The badge shows the warning/assert count and opens the console;
`ActionCluster`'s Output button mirrors it (badged). On mobile the sheet-footer
Output button expands the same console.

**Acceptance:** no warnings → no badge, console still reachable; warnings → badge
count matches the advisories list; raw log unchanged in content; console closed by
default; live-region announcements preserved (`role=status`); axe clean.

**Tests:** reuse existing diagnostics parsing tests; add a unit mapping a render
result → badge count + advisory rows; smoke asserts the console opens from the badge.

---

## Phase 6 — Install affordance (demoted) + offline polish
**Goal:** offer install tastefully; communicate offline/update well.

**New component/hook:** `useInstallPrompt.ts` (capture `beforeinstallprompt`, expose
`canInstall` + `promptInstall()`), `InstallMenuItem` (overflow) + a one-time
post-export `InstallToast`. iOS path: a small "Add to Home Screen" help item (no
event), shown only in iOS Safari, not standalone.

**Work:**
- Gate everything on `ui.install !== "off"`, `canInstall`, **not**
  `matchMedia('(display-mode: standalone)')` / `navigator.standalone`, and a
  "dismissed" flag in `localStorage`.
- Offline banner via `navigator.onLine` + `online`/`offline` events.
- Confirm the existing `swUpdate.ts` toast stays user-gated (it is); keep
  `forceUpdate` for the stale-bundle path.

**Acceptance:** no install UI when installed/unsupported/dismissed/`install:"off"`;
appears once post-export when installable; offline banner toggles correctly; renders
still work offline (WASM cached); axe clean.

**Tests:** unit for the `canInstall` gating truth table (installed, iOS, dismissed,
`off`); smoke remains green.

---

## Cross-cutting: accessibility checklist (applies every phase)
WCAG 2.1 AA is a hard requirement (smoke fails on serious/critical axe).
- Visible focus rings on all new controls; logical tab order; skip-link still lands
  on the parameter form.
- Bottom sheet & popovers: keyboard operable, focus-trapped when modal (Full
  detent / picker as dialog), Esc/Back to close, no drag-only affordances.
- Live regions for render status / advisories / action confirmations preserved.
- Touch targets ≥44px; 320px reflow; `prefers-reduced-motion` honored on sheet/panel
  transitions; forced-colors mode keeps badges/spinner legible.
- Floating controls over the variable 3D scene use a solid/blurred chip background
  so text never drops below AA on an arbitrary model colour.

## Cross-cutting: testing & CI
- `npm test` (node:test) for all new pure logic (detents, install gating, preset
  filtering, panel persistence, manifest shape).
- `npm run smoke` (built app + axe + the end-to-end flows) updated for new selectors;
  add a mobile-viewport pass.
- `npm run vis -- --update` rebaselined **once near the end** (after the look is
  settled) so the single PR carries one intentional, reviewable baseline diff rather
  than churning it phase to phase.
- Pre-commit hooks (`tsc -b` + `npm test`) must stay green.

## Sequencing (single PR)
Delivered as **one PR / one branch**, not a PR per phase — the phases are the build
order (and natural commit boundaries) within that branch, not separate reviews. Work
them in order: P0 → P1 → P2 → P3 → P4 → P5 → P6. The dependency that matters is
**P1 (theme/shape tokens) before P2 (desktop relayout) before P3 (mobile sheet)**,
since P2/P3 share `AppShell` and consume the P1 tokens; P4/P5/P6 layer onto the
shell. Rebaseline visuals once near the end (after the look is settled) rather than
per phase, so the final PR carries one intentional baseline diff. Update
`docs/config.md` for every new config key as you go.

## Risks & mitigations
- **Big view refactor (P2/P3)** touching `App.tsx` — mitigate by keeping it a pure
  view extraction (state/logic unchanged) and leaning on smoke to prove behaviour
  parity.
- **Icon rasterization dep** — `@resvg/resvg-js` ships prebuilt binaries for common
  platforms; verify it installs in CI. If a target lacks a prebuilt, fall back to its
  WASM build. It's a `devDependency` only (build-time), so it never reaches the app
  bundle.
- **Visual-baseline churn** — one rebaseline per phase, reviewed deliberately.
- **Sheet gesture/scroll conflicts** — isolate in `BottomSheet` with explicit
  nested-scroll handling and a unit-tested detent machine.
- **Theme-color per scheme** — if deriving two values is awkward, ship a single
  `theme_color` first and add the media-query meta as a small follow-up.

## Deferred backlog (written down for later — NOT part of this work)
Explicitly out of scope for this redesign; recorded here so it isn't lost and can be
picked up later as a separate, standalone effort:
- **Window-controls-overlay** desktop title bar (`display_override` + draggable
  `titlebar-area-*` region).
- **`file_handlers`** — open `.scad`/`.stl`/`.3mf` from the OS file manager.
- **`share_target`** — accept a shared model file (Android).
- **`shortcuts`** — long-press / jump-list quick actions.
- **iOS splash screens** — the per-resolution `apple-touch-startup-image` set.
- **Haptics** — `navigator.vibrate` on Android; the iOS 18 `<input switch>` trick.
- **Auto-rasterized screenshots** — currently author-supplied; could be generated.
