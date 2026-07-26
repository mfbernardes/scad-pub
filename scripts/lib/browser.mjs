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
 * Two picker shapes exist (DesignPicker.tsx): the default shadcn/ui (Radix)
 * Select — no native <option> elements, so we click the trigger then the option
 * by its visible text — and, under `ui.gallery`, a card dialog whose cards
 * carry a stable `data-design="<id>"` hook. Pass the design's `id` so the
 * gallery path can target its card (it falls back to matching the card's
 * visible label). Single-design configs have no picker — the click is skipped.
 * Pass `label: undefined` to skip the picker entirely and just nudge the
 * current design to render.
 * Does not wait for completion — follow with waitRendered().
 */
export async function selectDesign(page, label, { mobile = false, id } = {}) {
  if (label !== undefined) {
    const bar = mobile ? ".mobile-top-bar__center" : ".command-bar__design-picker";
    const trigger = page.locator(`${bar} [data-slot="select-trigger"]`);
    // `ui.gallery` swaps the Select for a button that opens the card dialog.
    const galleryTrigger = page.locator(`${bar} button[aria-label="Choose a design"]`);
    let switched = false;
    if (await trigger.count()) {
      await trigger.click();
      await page.getByRole("option", { name: label, exact: true }).click();
      switched = true;
    } else if (await galleryTrigger.count()) {
      await galleryTrigger.first().click();
      const gallery = page.locator(".design-gallery").last();
      await gallery.waitFor({ state: "visible", timeout: 3000 });
      const card = id
        ? gallery.locator(`[data-design="${id}"]`)
        : gallery.locator("[data-design]").filter({ has: page.getByText(label, { exact: true }) });
      await card.first().click();
      await gallery.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
      switched = true;
    }
    if (switched) {
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
 *  so it must go before driving the UI. The primary button's label is
 *  config-driven (schema.popup.button), so target the stable `.notice-ok` hook
 *  instead of a fixed "OK" text. That button also opens the design picker, so
 *  press Escape afterwards to close it and leave the UI clean.
 *  `mode: "picker"` draws the design gallery and NO primary button (see
 *  PopupModal.tsx) — there Escape is the dismissal (it remembers, same as
 *  picking a card), so don't wait on a `.notice-ok` that will never exist.
 *  No-op when no dialog is open. */
export async function dismissWelcomePopup(page) {
  const dialog = page.getByRole("dialog");
  if (!(await dialog.count())) return;
  if (await dialog.locator(".notice-ok").count()) {
    await dialog.locator(".notice-ok").click().catch(() => {});
    await dialog.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  }
  // Closes the picker-mode popup, and the design picker the primary CTA opens.
  await page.keyboard.press("Escape").catch(() => {});
  await dialog.first().waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
}

// Shared timeout for openDialog/waitDialogClosed below — every hand-rolled
// dialog-visibility wait across smoke.mjs used 3000ms except two 2000ms
// outliers (still passable via the `timeout` option), so this is the one
// place that constant lives now.
const DIALOG_TIMEOUT = 3000;

/** Wait for a `role="dialog"` with the given accessible name to become
 *  visible, then return its locator (so a caller can keep interacting with
 *  it — e.g. `.locator(...)`/`.getByRole(...)` for a footer button — without
 *  a second `page.getByRole("dialog", { name })` lookup). Throws on timeout,
 *  same as `waitRendered` above — callers that only want to know WHETHER it
 *  opened should `.catch()` it. */
export async function openDialog(page, name, { timeout = DIALOG_TIMEOUT } = {}) {
  const dialog = page.getByRole("dialog", { name });
  await dialog.waitFor({ state: "visible", timeout });
  return dialog;
}

/** Wait for a `role="dialog"` with the given accessible name to be gone. It
 *  only WAITS — dismissing the dialog is the caller's job.
 *  Playwright's "hidden" wait state matches both a fully unmounted dialog and
 *  one that's merely display:none/zero-size, covering every close pattern
 *  the app uses (a Dialog that unmounts vs. one that just hides) with a
 *  single helper. Throws on timeout — callers that tolerate a dialog staying
 *  open (a best-effort cleanup step) should `.catch()` it. */
export async function waitDialogClosed(page, name, { timeout = DIALOG_TIMEOUT } = {}) {
  await page.getByRole("dialog", { name }).waitFor({ state: "hidden", timeout });
}

/** Navigate to `base` with the given theme forced. Load once to establish the
 *  origin (localStorage isn't available on about:blank), set the persisted
 *  theme, then reload so it applies before first paint. The storage key is
 *  `${config.id}.theme`, read from the generated schema so this also works
 *  against a custom-id config (default id "scadpub" behaves as before). */
export async function gotoWithTheme(page, base, theme) {
  await page.goto(base, { waitUntil: "load" });
  const key = `${configId()}.theme`;
  await page.evaluate(({ key, t }) => localStorage.setItem(key, t), { key, t: theme });
  await page.reload({ waitUntil: "load" });
}
