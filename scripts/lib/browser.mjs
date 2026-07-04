// browser.mjs — the Playwright driving shared by smoke.mjs, screenshots.mjs and
// capture-screens.mjs: Chromium launch, render-completion polling, design
// switching, welcome-popup dismissal, and the force-theme-then-reload dance.
// Everything here reads the stable literal class hooks the app keeps for the
// scripts (`.render-status`, `.command-bar__design-picker`, …) — keeping those
// selectors in one place so a hook rename is a one-file fix.
import { chromium } from "playwright";

/** Launch headless Chromium, honouring the executable-path override used by
 *  environments that ship their own browser (no `playwright install`). */
export function launchChromium(options = {}) {
  return chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    ...options,
  });
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

/**
 * Switch to the design with the given picker label and kick off its render.
 * The picker is a shadcn/ui (Radix) Select with no native <option> elements, so
 * we click the trigger then the option by its visible text. Single-design
 * configs have no picker — the click is skipped. Pass `label: undefined` to
 * skip the picker entirely and just nudge the current design to render.
 * Does not wait for completion — follow with waitRendered().
 */
export async function selectDesign(page, label, { mobile = false } = {}) {
  if (label !== undefined) {
    const sel = mobile
      ? '.mobile-top-bar__center [data-slot="select-trigger"]'
      : '.command-bar__design-picker [data-slot="select-trigger"]';
    const trigger = page.locator(sel);
    if (await trigger.count()) {
      await trigger.click();
      await page.getByRole("option", { name: label, exact: true }).click();
      // Clear the cached "ok" state so a following waitRendered can't pass on
      // the previous design's render.
      await page
        .waitForFunction(
          () => !/\d+ ms/.test(document.querySelector(".render-status")?.textContent || ""),
          { timeout: 5000 }
        )
        .catch(() => {});
    }
  }
  // Every design renders once on first view; if a "Render now" button is present
  // (auto-render off + pending changes), click it to be safe.
  const renderBtn = page.getByRole("button", { name: /update now/i }).first();
  if (await renderBtn.count()) await renderBtn.click().catch(() => {});
}

/** Dismiss the config-driven welcome popup (schema.popup) if it is showing.
 *  It overlays the app behind a modal backdrop that intercepts pointer events,
 *  so it must go before driving the UI. No-op when no dialog is open. */
export async function dismissWelcomePopup(page) {
  const dialog = page.getByRole("dialog");
  if (!(await dialog.count())) return;
  await dialog.getByRole("button", { name: /^OK$/ }).click().catch(() => {});
  await dialog.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
}

/** Navigate to `base` with the given theme forced. Load once to establish the
 *  origin (localStorage isn't available on about:blank), set the persisted
 *  theme, then reload so it applies before first paint. The storage key is
 *  `${config.id}.theme`; these scripts drive the default "scadpub" config. */
export async function gotoWithTheme(page, base, theme) {
  await page.goto(base, { waitUntil: "load" });
  await page.evaluate((t) => localStorage.setItem("scadpub.theme", t), theme);
  await page.reload({ waitUntil: "load" });
}
