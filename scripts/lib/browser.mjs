// browser.mjs — the Playwright driving shared by smoke.mjs, screenshots.mjs and
// capture-screens.mjs: Chromium launch, render-completion polling, design
// switching, welcome-popup dismissal, and the force-theme-then-reload dance.
// Everything here reads the stable literal class hooks the app keeps for the
// scripts (`.render-status`, `.command-bar__design-picker`, …) — keeping those
// selectors in one place so a hook rename is a one-file fix.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// The forced-theme storage key is namespaced by the active config's `id`
// (see src/lib/theme.ts's ns(), and vite.config.ts's %APP_THEME_KEY%); read
// it from the generated schema (like smoke.mjs does) so these scripts work
// against a custom-id config too. Falls back to the default "scadpub" id if
// the schema hasn't been generated yet.
function configId() {
  try {
    const schema = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../src/generated/designs.json", import.meta.url)), "utf-8")
    );
    return schema.id || "scadpub";
  } catch {
    return "scadpub";
  }
}

/** Launch headless Chromium, honouring the executable-path override used by
 *  environments that ship their own browser (no `playwright install`). */
export function launchChromium(options = {}) {
  return chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    ...options,
  });
}

// The mobile emulation profile every mobile-viewport smoke check needs: a
// real 390x844 context (not just a resized desktop one — several checks rely
// on `isMobile`/`hasTouch` actually being set, e.g. touch-driven sheet drags)
// at a realistic device pixel ratio.
const MOBILE_CONTEXT_OPTIONS = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};

/** Run `fn(page)` inside a fresh mobile-emulation context (390x844, DSF 2,
 *  touch), closing the context afterwards whether `fn` throws or not, and
 *  returning `fn`'s result. Each mobile smoke check used to hand-roll its own
 *  `browser.newContext({...}) / newPage() / try { ... } finally { close() }`
 *  around this exact options object — sharing it here means the emulated
 *  device only needs a one-file edit, and no call site can forget the
 *  `finally`. A fresh context per check (rather than reusing one) is
 *  deliberate: each check should start from a clean slate, not inherit
 *  whatever state an earlier mobile check left behind.
 *
 *  Round-6 (guided final wave): `overrides` shallow-merges onto
 *  MOBILE_CONTEXT_OPTIONS (e.g. `{ viewport: { width: 320, height: 700 } }`
 *  for a narrow-phone check) — every existing call site passes none, so this
 *  stays the exact 390x844/DSF-2 profile they already relied on; only a new
 *  caller that explicitly opts in sees anything different. */
export async function withMobileContext(browser, fn, overrides = {}) {
  const context = await browser.newContext({ ...MOBILE_CONTEXT_OPTIONS, ...overrides });
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}

/** The render-status live region ("Render status: 123 ms" / "… (cached)" /
 *  "… Failed (exit N)") rides on the Output bell via the sr-only
 *  `.render-status` hook. Both layouts render the bell (the inactive one is
 *  CSS-hidden but still in the DOM) with the same text — read the first match. */
export const renderStatusText = (page) =>
  page.locator(".render-status").first().textContent();

/** Wait until a render has completed: the status text carries a "N ms" figure
 *  only for a finished render. Throws on timeout — callers that tolerate a
 *  missing render (e.g. pure screenshot capture) should `.catch()` it. */
export async function waitRendered(page, { timeout = 60000 } = {}) {
  await page.waitForFunction(
    () => /\d+ ms/.test(document.querySelector(".render-status")?.textContent || ""),
    { timeout }
  );
}

// The two design-switcher UIs a build can ship (see DesignPicker.tsx /
// DesignPickerDialog.tsx / ui.gallery): the classic dropdown Select, or (with
// `ui.gallery: true`) a top-bar button that opens a card-grid dialog. Both
// live in the same wrapper element per layout, so probing for the
// gallery-mode button's hook class first and falling back to the Select
// covers either build without the caller needing to know which one it is.
const centerSel = (mobile) =>
  mobile ? ".mobile-top-bar__center" : ".command-bar__design-picker";

// Clear the cached "ok" render-status text so a following waitRendered()
// can't pass on the previous design's stale render.
async function clearRenderStatus(page) {
  await page
    .waitForFunction(
      () => !/\d+ ms/.test(document.querySelector(".render-status")?.textContent || ""),
      { timeout: 5000 }
    )
    .catch(() => {});
}

// A card's own visible label text (DesignCard.tsx) picks up a sr-only
// " — Current"/" — Selected" suffix on the CURRENTLY-active/highlighted card
// (unconditionally — even in the classic, non-welcome dialog), so a plain
// `{ exact: true }` text match never hits that one card. Anchoring the match
// at the start of the text, on a word boundary, hits both the plain label
// ("Tag") and the suffixed one ("Tag — Current") without risking a false
// match against some other card whose label merely CONTAINS this one's text.
function exactLabelText(label) {
  return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
}

/**
 * Switch to the design with the given picker label and kick off its render.
 * Branches on which design switcher the build shipped:
 *  - `ui.gallery: true` — a `.design-picker-button` opens DesignPickerDialog;
 *    click the `.design-picker-dialog__card` whose visible label matches
 *    (see exactLabelText above), not its accessible name (a card's name also
 *    includes its description, so an exact role-based match would never hit).
 *  - otherwise — the classic shadcn/ui (Radix) Select, with no native
 *    <option> elements: click the trigger, then the option by its visible text.
 * Single-design configs have no switcher at all — the click is skipped either
 * way. Pass `label: undefined` to skip design-switching entirely and just
 * nudge the current design to render. Does not wait for completion — follow
 * with waitRendered().
 */
export async function selectDesign(page, label, { mobile = false } = {}) {
  if (label !== undefined) {
    const center = page.locator(centerSel(mobile));
    const galleryButton = center.locator(".design-picker-button");
    if (await galleryButton.count()) {
      await galleryButton.click();
      const card = page
        .locator(".design-picker-dialog__card")
        .filter({ has: page.getByText(exactLabelText(label)) });
      await card.first().click();
      await clearRenderStatus(page);
    } else {
      const trigger = center.locator('[data-slot="select-trigger"]');
      if (await trigger.count()) {
        await trigger.click();
        await page.getByRole("option", { name: label, exact: true }).click();
        await clearRenderStatus(page);
      }
    }
  }
  // Every design renders once on first view; if a "Render now" button is present
  // (auto-render off + pending changes), click it to be safe.
  const renderBtn = page.getByRole("button", { name: /update now/i }).first();
  if (await renderBtn.count()) await renderBtn.click().catch(() => {});
}

/** Dismiss the config-driven welcome popup (schema.popup) if it is showing.
 *  It overlays the app behind a modal backdrop that intercepts pointer events,
 *  so it must go before driving the UI. Two possible surfaces, branched on
 *  which markup is actually present: the classic notice modal (PopupModal,
 *  primary button hook `.notice-ok`) or — `popup.mode: "picker"` plus
 *  `ui.gallery` and more than one design (see src/lib/popup.ts's
 *  resolvePopupSurface) — "tabs" workflow's welcome design-picker dialog
 *  (DesignPickerDialog's `welcome` variant), dismissed via its own
 *  `.design-picker-dialog__start` ("Start with {design}") footer button.
 *  Guided workflow (round-5 Wave 2, item 1) shows the SAME UnifiedSelector-
 *  Dialog every later selection uses instead — no separate confirm button,
 *  picking a card applies immediately (see UnifiedSelectorWelcome's own
 *  doc) — so there this clicks the already-current design's own card
 *  (`aria-current="true"`, the Designs group's default landing tab),
 *  mirroring "Start with {design}"'s own default of confirming whatever was
 *  already highlighted rather than switching to some other design. Either
 *  button also opens the design picker in the classic-modal case, so press
 *  Escape afterwards to close it and leave the UI clean. No-op when no
 *  dialog is open. */
export async function dismissWelcomePopup(page) {
  const dialog = page.getByRole("dialog");
  if (!(await dialog.count())) return;
  const start = dialog.locator(".design-picker-dialog__start");
  const currentCard = dialog.locator('.unified-selector [aria-current="true"]');
  if (await start.count()) {
    await start.click().catch(() => {});
  } else if (await currentCard.count()) {
    await currentCard.first().click().catch(() => {});
  } else {
    await dialog.locator(".notice-ok").click().catch(() => {});
  }
  await dialog.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
}

/** Dismiss every first-visit surface, not just the welcome popup: the popup
 *  itself, then (future-proofing — these are no-ops until later milestones
 *  add them) a getting-started dismiss button if present, then a stray
 *  Escape to close anything left open. Scripts should call this instead of
 *  dismissWelcomePopup directly so a new first-visit surface only needs
 *  wiring up here, not at every call site. */
export async function settleFirstVisit(page) {
  await dismissWelcomePopup(page);
  const dismiss = page.locator(".getting-started__dismiss");
  if (await dismiss.count()) await dismiss.first().click().catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
}

// Waits for every in-flight CSS transition/animation on the page to actually
// finish — a Radix dialog's fade/zoom entrance, a tab underline, a theme
// swap, … — before an axe-core sweep reads *computed* colour. Sampling mid-
// animation (e.g. a dialog still fading its content in from opacity 0) yields
// an intermediate, non-deterministic colour and a spurious (flaky, timing-
// dependent) color-contrast violation. A fixed sleep was flaky on its own —
// the animation can outlast a short one on a slower/loaded CI runner — so
// this polls the real Web Animations API state instead of guessing a
// duration. Shared by every axe pass below (runAxe() and checkAxe()'s own
// loop) so EVERY dialog-open (or other animated-transition) scan gets the
// same determinism, not just the ones that happened to need it first.
export async function settleAnimations(page) {
  await page.waitForTimeout(50); // let a just-started transition register first
  await page
    .waitForFunction(
      () => document.getAnimations().every((a) => a.playState !== "running"),
      null,
      { timeout: 3000 }
    )
    .catch(() => {});
}

// A standalone axe-core sweep (WCAG 2.1 AA, serious/critical only), reusable
// outside the dedicated checkAxe() pass below — used by checkSettingsView to
// confirm both the essentials and All settings states of the Customize tab
// are accessible, not just the default state checkAxe() happens to catch.
export async function runAxe(page, check, label) {
  await page.addScriptTag({
    path: fileURLToPath(new URL("../../node_modules/axe-core/axe.min.js", import.meta.url)),
  });
  await settleAnimations(page);
  const axeRes = await page.evaluate(async () =>
    window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
    })
  );
  const serious = axeRes.violations.filter((v) => ["serious", "critical"].includes(v.impact));
  for (const v of serious)
    console.log(`  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s)) -> ${v.nodes.map((n) => n.target.join(" ")).join("; ")}`);
  check(serious.length === 0, `axe (${label}): ${serious.length} serious/critical violation(s)`);
}

/** Navigate to `base` with the given theme forced. Load once to establish the
 *  origin (localStorage isn't available on about:blank), set the persisted
 *  theme, then reload so it applies before first paint. The storage key is
 *  `${config.id}.theme`, read from the generated schema so this also works
 *  against a custom-id config (default id "scadpub" behaves as before).
 *  `seedFlags` (default none) writes app-id-namespaced localStorage keys as
 *  "1" before the reload, e.g. to pre-mark a once-flag "seen" so later
 *  milestones' vis baselines don't have to fight a first-visit surface. */
export async function gotoWithTheme(page, base, theme, { seedFlags = [] } = {}) {
  await page.goto(base, { waitUntil: "load" });
  const id = configId();
  const key = `${id}.theme`;
  await page.evaluate(
    ({ key, t, id, flags }) => {
      localStorage.setItem(key, t);
      for (const flag of flags) localStorage.setItem(`${id}.${flag}`, "1");
    },
    { key, t: theme, id, flags: seedFlags }
  );
  await page.reload({ waitUntil: "load" });
}
