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
 *  whatever state an earlier mobile check left behind. */
export async function withMobileContext(browser, fn) {
  const context = await browser.newContext(MOBILE_CONTEXT_OPTIONS);
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

/**
 * Switch to the design with the given picker label and kick off its render.
 * Branches on which design switcher the build shipped:
 *  - `ui.gallery: true` — a `.design-picker-button` opens DesignPickerDialog;
 *    click the `.design-picker-dialog__card` whose visible label (exact) text
 *    matches, not its accessible name (a card's name also includes its
 *    description, so an exact role-based match would never hit).
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
        .filter({ has: page.getByText(label, { exact: true }) });
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
 *  so it must go before driving the UI. The primary button's label is
 *  config-driven (schema.popup.button), so target the stable `.notice-ok` hook
 *  instead of a fixed "OK" text. That button also opens the design picker, so
 *  press Escape afterwards to close it and leave the UI clean. No-op when no
 *  dialog is open. */
export async function dismissWelcomePopup(page) {
  const dialog = page.getByRole("dialog");
  if (!(await dialog.count())) return;
  await dialog.locator(".notice-ok").click().catch(() => {});
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
