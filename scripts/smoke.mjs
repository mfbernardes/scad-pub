// smoke.mjs — end-to-end check of the built app in a real browser, all in one
// process (an in-process static server for dist/ + headless Chromium). Confirms
// the default design auto-renders, every design in the config renders, and a 3MF
// + PNG export work via the UI. Design-specific checks run only when that design
// is present in the built config: the example "tag" design exercises conditional
// visibility (@showIf/@collapsed) and the OpenSCAD-output notice/assert badges;
// a "signage" design, when configured, exercises @showIf arrow_style. Finally
// runs axe-core to guard against serious/critical
// accessibility regressions. Run after `npm run build`.
//
// Structure: each `=== section ===` is a named check* function taking the shared
// context (page, check counter, schema-derived names); main() is setup, the
// ordered calls, and teardown.
import { readFile, mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { startServer } from "./serve-dist.mjs";
import {
  launchChromium,
  renderStatusText,
  waitRendered as waitRenderDone,
  selectDesign as pickDesign,
  settleFirstVisit,
  dismissWelcomePopup,
  withMobileContext,
  settleAnimations,
  runAxe,
} from "./lib/browser.mjs";

// Ensure the output console is open. It auto-opens when a render first surfaces
// a notice/assert, but a manual close (or a notice present before this point)
// means it may be shut — so click the Output bell when it's not already open.
// The bell's label is "Open messages" while closed.
async function openConsole(page) {
  if (await page.locator(".output-console").count()) return;
  // Desktop bell (the mobile top bar's twin is CSS-hidden at this viewport).
  await page.locator('.command-bar__output[aria-label^="Open messages"]').click().catch(() => {});
  await page.waitForSelector(".output-console", { timeout: 3000 }).catch(() => {});
}

// "Reset to defaults" confirms via an AlertDialog only when the params differ
// from the defaults — click the button, then the dialog's Reset if it appears.
async function resetDefaults(page) {
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  const dlg = page.getByRole("alertdialog");
  const shown = await dlg.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false);
  if (shown) await dlg.getByRole("button", { name: /^Reset$/ }).click();
}

async function waitRendered(page, label) {
  await waitRenderDone(page);
  console.log(`  ${label ?? "default"}: ${((await renderStatusText(page)) ?? "").replace(/^Render status: /, "").trim()} ✅`);
}

// Switch design and wait for the fresh render.
// Design id -> label, populated in main() from the generated schema. The picker
// is a shadcn/ui (Radix) Select, so we switch designs by clicking the trigger
// then the option whose visible text is the design's label.
const designLabels = {};

async function selectDesign(page, id) {
  await pickDesign(page, id === undefined ? undefined : designLabels[id] ?? id);
  await waitRendered(page, id);
}

// Staged offline-readiness claim (this milestone): a one-time, informational
// toast telling a visitor this configurator (or its render engine) now works
// offline — see src/lib/useAppNotices.ts and src/lib/offlineClaim.ts. Every
// smoke run is a fresh browser instance with an empty Cache Storage, so the
// first load here is always a genuine cache-miss download, and the check
// runs FIRST (before anything else touches storage/reloads the page) so it
// races nothing else in this suite. main() blocks the service worker's own
// script for the whole run (see its own comment) specifically so THIS check
// is deterministic: with no service worker to independently win the binary-
// cache race, the render worker's own bootstrap always sees the miss and
// posts progress, and (with no controlling service worker) the claim is
// always the weaker "engine offline" one — see selectOfflineClaim's doc for
// why that's the honest choice when nothing controls the page yet. The
// stronger "ready for offline use" claim (a controlling service worker AND a
// verified precache) is exercised by the pure-logic unit tests instead
// (tests/offlineClaim.test.mjs), since reproducing it here would mean
// un-blocking the service worker and accepting back the very race this
// check exists to avoid.
async function checkOfflineClaimToast({ page, check }) {
  console.log("=== offline-claim toast (staged offline readiness) ===");
  const claimToast = page.getByText(/now available offline|ready for offline use/i);
  const shown = await claimToast
    .first()
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check(shown, "a one-time offline-readiness toast appears after the first real engine download");
}

// Configurable popup (schema.popup): a welcome notice on load. It overlays
// the app behind a modal backdrop that intercepts pointer events, so dismiss
// it before driving the UI. Two surfaces (src/lib/popup.ts's
// resolvePopupSurface): the classic text PopupModal, or — `popup.mode:
// "picker"` plus `ui.gallery` and more than one design, the dogfood config's
// own setup — the welcome DesignPickerDialog: a two-step "highlight a card,
// then confirm" flow (a card click only highlights it; the footer's
// `.design-picker-dialog__start` "Start with {design}" button is what
// actually switches design and closes the dialog), plus an optional
// `.design-picker-dialog__browse` "Browse examples" action for a design that
// ships bundled presets. The dialog's accessible name is the configured
// header either way, so look it up from the schema rather than hardcoding one.
async function checkWelcomePopup({ page, check, schema, ids }) {
  console.log("=== welcome popup ===");
  if (!schema.popup) {
    console.log("  (no popup in this config — skipped)");
    return;
  }
  const galleryEnabled = !!schema.ui?.gallery && schema.designs.length > 1;
  const isWelcomePicker = schema.popup.mode === "picker" && galleryEnabled;
  const popup = page.getByRole("dialog", { name: schema.popup.header });
  check((await popup.count()) > 0, "welcome popup shown on load");
  if (/\]\(/.test(schema.popup.body ?? "")) {
    check((await popup.getByRole("link").count()) > 0, "popup body renders its link");
  }

  if (isWelcomePicker) {
    console.log("--- welcome design picker (popup.mode: \"picker\") ---");
    const cards = popup.locator(".design-picker-dialog__card");
    check((await cards.count()) === ids.length, `dialog shows one card per design (${ids.length})`);
    if (schema.popup.footnote) {
      check(
        ((await popup.locator(".design-picker-dialog__footer").textContent()) ?? "").includes(schema.popup.footnote),
        "the footer shows the configured footnote"
      );
    }
    // Round-2 review fix (8dc8cd5, item 1): the footer (footnote + Browse
    // examples + "Start with…") is a sibling of the scrollable card grid, not
    // nested inside it — a structural check, not a scroll-position one, so
    // it holds regardless of whether this build's design count actually
    // overflows the grid. That's what keeps it visible/reachable ("fixed") no
    // matter how far the grid itself is scrolled.
    check(
      await popup
        .locator(".design-picker-dialog__footer")
        .evaluate((el) => el.closest(".design-picker-dialog__grid-scroll") === null),
      "the footer sits outside the scrollable card-grid area, so it stays fixed in place while the grid scrolls"
    );

    // The card's own visible label text picks up a sr-only " — Selected"/
    // " — Current" suffix once highlighted (DesignCard.tsx), so a text-based
    // filter can't reliably target it — the stable `data-design` hook can.
    const cardFor = (id) => popup.locator(`.design-picker-dialog__card[data-design="${id}"]`);
    check(
      (await cardFor(ids[0]).getAttribute("aria-pressed")) === "true",
      "the design already loaded starts as the highlighted card"
    );

    // Highlighting a DIFFERENT card is step one of two — it must NOT close the
    // dialog or switch the loaded design yet.
    const otherId = ids.find((id) => id !== ids[0]) ?? ids[0];
    await cardFor(otherId).click();
    check((await cardFor(otherId).getAttribute("aria-pressed")) === "true", "clicking a card highlights it");
    check((await cardFor(ids[0]).getAttribute("aria-pressed")) !== "true", "highlighting a card un-highlights the previous one");
    check((await popup.count()) === 1, "the dialog stays open after merely highlighting a card");
    check(
      !(await page.evaluate(() => location.hash)).includes(`d=${otherId}`),
      "highlighting alone does not switch the loaded design"
    );
    const startBtn = popup.locator(".design-picker-dialog__start");
    check(
      ((await startBtn.textContent()) ?? "").trim() === `Start with ${designLabels[otherId] ?? otherId}`,
      "the footer's primary button tracks the highlighted card's own label"
    );

    // Re-highlight the shipped default (ids[0], which ships bundled presets in
    // the dogfood config) to exercise "Browse examples".
    await cardFor(ids[0]).click();
    const browseBtn = popup.locator(".design-picker-dialog__browse");
    check((await browseBtn.count()) === 1, "\"Browse examples\" is offered for a design that ships bundled presets");
    await browseBtn.click();
    await popup.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    check((await popup.count()) === 0, "\"Browse examples\" closes the welcome picker");
    await waitRendered(page, ids[0]);
    const presetsTabName = schema.ui?.presetsLabel || "Presets";
    check(
      (await page.getByRole("tab", { name: presetsTabName }).first().getAttribute("aria-selected")) === "true",
      "\"Browse examples\" switches to the Presets tab"
    );
    await page.getByRole("tab", { name: schema.ui?.parametersLabel || "Customize" }).first().click().catch(() => {});
  } else {
    console.log("--- classic popup (plain text modal) ---");
    // The primary button's label is config-driven (schema.popup.button), so
    // read it from the schema instead of hardcoding "OK".
    const buttonLabel = schema.popup.button ?? "OK";
    const cta = popup.getByRole("button", { name: buttonLabel, exact: true });
    check((await cta.count()) > 0, `popup shows its configured button "${buttonLabel}"`);
    const dontShow = popup.getByRole("checkbox");
    if (await dontShow.count()) await dontShow.check();
    await cta.click();
    await popup.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    check((await popup.count()) === 0, "popup dismissed");
    // The primary CTA also opens the design picker (when there's more than one
    // design) so the user's next step — choosing what to make — is obvious.
    if (schema.designs.length > 1) {
      if (galleryEnabled) {
        const dialog = page.locator(".design-picker-dialog");
        const opened = await dialog
          .first()
          .waitFor({ state: "visible", timeout: 3000 })
          .then(() => true)
          .catch(() => false);
        check(opened, "primary CTA opens the design picker dialog");
        await page.keyboard.press("Escape");
        await dialog.first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
      } else {
        const listbox = page.getByRole("listbox");
        const opened = await listbox
          .first()
          .waitFor({ state: "visible", timeout: 3000 })
          .then(() => true)
          .catch(() => false);
        check(opened, "primary CTA opens the design picker");
        await page.keyboard.press("Escape");
        await listbox.first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
      }
    }
  }
}

// Viewer gesture hint (PR8): a one-time, non-blocking chip over the viewer,
// shown only in guided experience once the first successful render has
// landed (already true here — the initial render completed in main() before
// any of these checks ran).
async function checkViewerHint({ page, check }) {
  console.log("=== viewer gesture hint ===");
  const hint = page.locator(".viewer-hint");
  check((await hint.count()) === 1, "viewer-hint shown after the first successful render (guided experience)");
  check(/rotate/i.test((await hint.textContent()) ?? ""), "viewer-hint carries the rotate/zoom gesture copy");

  // A pointerdown anywhere inside the viewer dismisses it (dispatchEvent
  // bypasses the chip's own pointer-events:none, matching a real user's
  // pointerdown landing on the canvas underneath it).
  await page.locator(".viewer-wrap").first().dispatchEvent("pointerdown");
  await hint.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  check((await hint.count()) === 0, "a pointerdown on the viewer dismisses the hint");

  await page.reload({ waitUntil: "load" });
  await waitRendered(page, "reloaded after viewer hint dismiss");
  check((await page.locator(".viewer-hint").count()) === 0, "dismissal persists across a reload");
}

// Generic file import: the Files manager shows an "Import file" button when
// the config sets `fileImport`. Uploading a file should surface it in the
// file list and persist across a reload (IndexedDB).
async function checkFileImport({ page, check, ids, schema }) {
  console.log("=== file import ===");
  // On desktop the file manager is the panel's "Files" tab (Radix unmounts the
  // inactive tab, so it must be activated — and re-activated after each reload).
  const gotoFiles = () => page.getByRole("tab", { name: "Files" }).click().catch(() => {});
  await gotoFiles();
  const importBtn = page.getByRole("button", { name: /Import file/i });
  if (await importBtn.count()) {
    check(true, "import-file button present");
    const input = page.locator('.file-manager input[type="file"]').last();
    await input.setInputFiles({
      name: "smoke-overlay.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    });
    const fileRow = page.locator(".file-manager__name", { hasText: "smoke-overlay.svg" });
    await fileRow.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
    check((await fileRow.count()) > 0, "uploaded file appears in the file list");
    await page.reload({ waitUntil: "load" });
    await waitRendered(page, ids[0]);
    await gotoFiles();
    check(
      (await page
        .locator(".file-manager__name", { hasText: "smoke-overlay.svg" })
        .count()) > 0,
      "uploaded file persists across reload"
    );
    // Clear removes the file (and the persisted copy / render cache).
    await page.getByRole("button", { name: /Clear all imported files/i }).click();
    await page
      .locator(".file-manager__name", { hasText: "smoke-overlay.svg" })
      .waitFor({ state: "detached", timeout: 3000 })
      .catch(() => {});
    // The UI row is removed synchronously, but the persisted copy is cleared
    // via a fire-and-forget IndexedDB transaction. Reloading the instant the
    // row detaches can abort that still-uncommitted transaction (page unload
    // cancels in-flight IDB txns), leaving the file on disk to be restored on
    // the next load. Wait for the persisted store to actually be empty before
    // reloading so this assertion tests the guarantee, not the race.
    const dbName = schema?.id || "scadpub";
    await page
      .waitForFunction(
        (name) =>
          new Promise((resolve) => {
            let req;
            try {
              req = indexedDB.open(name);
            } catch {
              return resolve(true); // storage unavailable — nothing persisted
            }
            req.onerror = () => resolve(true);
            req.onsuccess = () => {
              const db = req.result;
              if (!db.objectStoreNames.contains("fonts")) {
                db.close();
                return resolve(true);
              }
              const countReq = db.transaction("fonts", "readonly").objectStore("fonts").count();
              countReq.onsuccess = () => {
                db.close();
                resolve(countReq.result === 0);
              };
              countReq.onerror = () => {
                db.close();
                resolve(true);
              };
            };
          }),
        dbName,
        { timeout: 5000 }
      )
      .catch(() => {});
    await page.reload({ waitUntil: "load" });
    await waitRendered(page, ids[0]);
    await gotoFiles();
    check(
      (await page
        .locator(".file-manager__name", { hasText: "smoke-overlay.svg" })
        .count()) === 0,
      "cleared file stays cleared after reload"
    );
  } else {
    console.log("  (no fileImport in this config — skipped)");
  }
}

// Files tab task cards (PR19 item 1; collapsed from three cards to two in the
// round-2 review pass — the old standalone SVG card and generic "Other
// files" catch-all merged into one graphic card, see filesCards.ts/
// FileBar.tsx): a font card only for a design with @font params, a graphic
// card only for one with @svg params (per-design — a global fileImport.accept
// that admits SVGs does not alone conjure the card). The dogfood config's
// example designs cover every combination
// without a bespoke fixture: `tag` has both @font and @svg params
// (examples/tag.scad), `coin` has only @font, `panel` has only @svg.
async function checkFilesCards({ page, check, ids, paramsTabName, schema }) {
  if (!schema?.fileImport || !ids.includes("tag")) return;
  console.log("=== Files tab: schema-driven task cards ===");
  const gotoFiles = () => page.getByRole("tab", { name: "Files" }).click().catch(() => {});
  const gotoParams = () => page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});

  await selectDesign(page, "tag");
  await gotoFiles();
  // Round-2 review: exactly two cards now (font + graphic) — no third
  // generic "Other files" catch-all left to show alongside them.
  check((await page.locator(".file-card").count()) === 2, "tag (font + svg params) shows exactly two task cards (font + graphic)");
  check(
    (await page.getByRole("button", { name: /Import font/i }).count()) === 1,
    "font card offers its own Import action"
  );
  check(
    (await page.getByRole("button", { name: /Import SVG/i }).count()) === 1,
    "the graphic card offers its own Import action"
  );
  check(
    (await page.locator('.file-card[role="status"]').count()) === 0,
    "no card leads with the attention-styled state while the selected font is loaded"
  );
  // The "Choose bundled font" fallback action only shows once a font is
  // actually missing (checkFilesFontMissingCard exercises that state) — here,
  // with the default font loaded, only the plain Import action is offered.
  check(
    (await page.getByRole("button", { name: "Choose bundled font" }).count()) === 0,
    "\"Choose bundled font\" is not offered while the selected font is already loaded"
  );
  check(
    (await page.locator(".file-manager__privacy").count()) === 1,
    "the shared on-device privacy line is shown"
  );
  check(
    /never uploaded/i.test((await page.locator(".file-manager__privacy").textContent()) ?? ""),
    "the privacy line reads as an on-device-only assurance"
  );
  await runAxe(page, check, "Files tab (tag: font + SVG cards)");

  if (ids.includes("coin")) {
    await selectDesign(page, "coin");
    await gotoFiles();
    check(
      (await page.getByRole("button", { name: /Import font/i }).count()) === 1,
      "coin (font-only design) shows the font card"
    );
    check(
      (await page.getByRole("button", { name: /Import SVG/i }).count()) === 0,
      "coin (no @svg params) does not show the SVG card"
    );
  }

  if (ids.includes("panel")) {
    await selectDesign(page, "panel");
    await gotoFiles();
    check(
      (await page.getByRole("button", { name: /Import SVG/i }).count()) === 1,
      "panel (svg-only design) shows the SVG card"
    );
    check(
      (await page.getByRole("button", { name: /Import font/i }).count()) === 0,
      "panel (no @font params) does not show the font card"
    );
  }

  await selectDesign(page, "tag");
  await gotoParams();
}

// The Files tab's font card leads with the "not loaded" state — reusing the
// same URL-state trick as checkReadiness (a missing font family encoded
// directly into the share-link hash) so the two surfaces are proven to agree
// about what "missing" means, not just asserted to by comment.
async function checkFilesFontMissingCard({ page, check, ids, base, paramsTabName }) {
  if (!ids.includes("tag")) return;
  console.log("=== Files tab: font card leads with the missing-font state ===");
  const hash = `d=tag&v=${encodeURIComponent(JSON.stringify({ font: "No Such Font" }))}`;
  await page.goto(`${base}#${hash}`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "tag with a missing font family (Files tab card)");

  await page.getByRole("tab", { name: "Files" }).click().catch(() => {});
  const leadCard = page.locator('.file-card[role="status"]');
  await leadCard.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await leadCard.count()) === 1, "exactly one file-card leads with the attention-styled state");
  check(
    ((await leadCard.textContent()) ?? "").includes("No Such Font"),
    "the leading card names the missing family, same as the Customize tab's attention chip"
  );
  // Round-2 review fix: the font card now offers a SECOND action beside
  // Import — "Choose bundled font" (FontImportActions' renderFallback slot,
  // wired for the first time into FileBar) — reusing the exact same one-click
  // fontChoices.ts substitution AttentionItems.tsx's own "Use a bundled font"
  // already offers, so both actions sit side by side only while a fallback
  // genuinely exists for the missing param.
  check(
    (await leadCard.getByRole("button", { name: /Import font/i }).count()) === 1,
    "the leading font card still offers Import"
  );
  check(
    (await leadCard.getByRole("button", { name: "Choose bundled font" }).count()) === 1,
    "the leading font card ALSO offers \"Choose bundled font\" beside Import"
  );
  await runAxe(page, check, "Files tab with the missing-font card");

  // Restore defaults so later checks that reuse `tag` start clean.
  await page.goto(`${base}#d=tag`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "tag reloaded with defaults (Files card cleanup)");
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});
}

async function checkThemeToggle({ page, check }) {
  console.log("=== theme toggle ===");
  const bg0 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  let themeChanged = false;
  // Theme is a direct icon button in the CommandBar; select it by its label
  // (the first .icon-btn there is now the status-bearing Output bell).
  for (let i = 0; i < 3 && !themeChanged; i++) {
    await page.locator('.command-bar__right button[aria-label^="Switch to"]').first().click();
    await page.waitForTimeout(60);
    themeChanged =
      (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) !== bg0;
  }
  check(themeChanged, `theme toggle changes the palette (now ${await page.getAttribute("html", "data-theme")})`);
  // The 3D viewer's background must follow the theme too (it reads the theme's
  // CSS vars into the WebGL scene): a dark theme must not leave a light canvas.
  {
    const theme = await page.getAttribute("html", "data-theme");
    await page.waitForTimeout(80); // let the next-frame background swap land
    const luma = await page.evaluate(() => {
      const c = document.querySelector(".viewer canvas");
      if (!c) return null;
      const off = document.createElement("canvas");
      off.width = c.width;
      off.height = c.height;
      const ctx = off.getContext("2d");
      ctx.drawImage(c, 0, 0);
      const [r, g, b] = ctx.getImageData(2, 2, 1, 1).data; // a corner = background
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    });
    const ok = luma !== null && (theme === "dark" ? luma < 0.25 : luma > 0.6);
    check(ok, `viewer background follows ${theme} theme (corner luma ${luma?.toFixed(2)})`);
  }
  // If a per-theme logo is configured, it must load for the current theme.
  if (await page.locator("img.brand-logo").count()) {
    check(
      await page.$eval("img.brand-logo", (i) => i.complete && i.naturalWidth > 0),
      "header logo loaded for the current theme"
    );
  }
}

// The viewer's rendering is invalidation-driven (M6): once OrbitControls'
// damping has settled and nothing else invalidates the scene, renderer.render()
// must stop firing every animation frame. Viewer.tsx stamps a running count
// onto the mount node's dataset (data-render-count) on every actual render
// call, purely for this assertion. Sample it, wait past a few animation
// frames' worth of idle time with no input, and confirm it didn't move.
async function checkIdleRenderCount({ page, check }) {
  console.log("=== idle render count (invalidation-driven rendering) ===");
  const before = await page.$eval(".viewer", (el) => Number(el.dataset.renderCount ?? "0"));
  await page.waitForTimeout(500); // ~30 animation frames at idle, no input
  const after = await page.$eval(".viewer", (el) => Number(el.dataset.renderCount ?? "0"));
  check(
    before > 0 && after === before,
    `idle viewer issues no extra render() calls (before=${before}, after=${after})`
  );
}

async function checkAxe({ page, check }) {
  console.log("=== accessibility (axe-core) ===");
  // axe's color-contrast check reads *computed* colours. Several controls (the
  // tab chips especially) carry `transition-[color,box-shadow]`, and a theme
  // swap animates every colour token, so sampling an element mid-transition
  // yields an intermediate colour and a spurious contrast violation — settled
  // by runAxe()'s own settleAnimations() call (see its doc; the same reason
  // it's used on every other pass in this suite).
  // Palettes are per-theme (and config-overridable per theme), so a contrast
  // regression can hide in whichever theme a single sweep doesn't visit: run
  // the AA sweep in the current theme, then toggle and sweep the other. The
  // second toggle also returns the app to the theme it started the section in.
  for (let pass = 0; pass < 2; pass++) {
    const theme = await page.getAttribute("html", "data-theme");
    await runAxe(page, check, theme);
    if (pass === 0) {
      await page.locator('.command-bar__right button[aria-label^="Switch to"]').first().click();
    }
  }
}

// The card-grid DesignPickerDialog (`ui.gallery: true`, PR7): the top bar
// shows a `.design-picker-button` instead of the classic Select; it opens a
// dialog with one card per design, a click switches design + renders, the
// dialog is axe-clean while open, and ⌘K/Ctrl-K opens it from anywhere.
async function checkDesignPickerDialog({ page, check, ids, schema }) {
  if (!(schema.ui?.gallery && schema.designs.length > 1)) return;
  console.log("=== design picker dialog (ui.gallery) ===");
  const dialog = page.locator(".design-picker-dialog");
  const button = page.locator(".command-bar__design-picker .design-picker-button");
  check((await button.count()) === 1, "design-picker-button shown in the top bar (desktop)");
  await button.click();
  await dialog.waitFor({ state: "visible", timeout: 3000 });
  const cards = page.locator(".design-picker-dialog__card");
  check((await cards.count()) === ids.length, `dialog shows one card per design (${ids.length})`);

  // Round-2 review fix (8dc8cd5, item 1): the grid is now an EXACT
  // `grid-cols-2 sm:grid-cols-3` (was auto-fill/minmax(150px), which packed
  // 4 dense columns at desktop widths) — read the actual computed
  // `grid-template-columns` track count rather than inferring it from card
  // positions, so this doesn't depend on having enough cards to fill a row.
  const gridColumnCount = (loc) =>
    loc.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length);
  const grid = page.locator(".design-picker-dialog__grid").first();
  check((await gridColumnCount(grid)) === 3, "the card grid is 3 columns at the default desktop viewport width");
  await runAxe(page, check, "design picker dialog open");

  // Selecting a card (other than the current design) switches design and renders.
  const targetId = ids.find((id) => id !== ids[0]) ?? ids[0];
  const targetLabel = designLabels[targetId] ?? targetId;
  await page
    .locator(".design-picker-dialog__card")
    .filter({ has: page.getByText(targetLabel, { exact: true }) })
    .first()
    .click();
  await dialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  await waitRendered(page, targetId);
  check(
    (await page.evaluate(() => location.hash)).includes(`d=${targetId}`),
    "selecting a card switches the design"
  );
  // Back to the first design for the checks that follow.
  await selectDesign(page, ids[0]);

  console.log("=== ⌘K / Ctrl-K opens the design picker ===");
  await page.keyboard.press("Control+k");
  await dialog.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check(await dialog.isVisible().catch(() => false), "Ctrl-K opens the design picker dialog");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  check((await dialog.count()) === 0, "Escape closes the design picker dialog");

  // Adaptive search box (this milestone): below SEARCH_THRESHOLD (6), the box
  // is hidden until the card grid actually overflows the dialog's scroll area
  // — only exercisable when the build itself is under that count (the dogfood
  // config's 3 designs), since at/above it the fast path already forces the
  // box on regardless of viewport, which the earlier assertions already cover
  // implicitly via `searchVisible`'s count-rule branch.
  if (ids.length <= 6) {
    console.log("=== design picker: adaptive search (overflow, not just count) ===");
    const search = page.locator(".design-picker-dialog__search");
    await button.click();
    await dialog.waitFor({ state: "visible", timeout: 3000 });
    check(
      (await search.count()) === 0,
      `no search box for ${ids.length} designs at the default viewport (no overflow)`
    );
    const original = page.viewportSize();
    // A short viewport (same width, so the layout stays desktop) leaves the
    // dialog's max-height small enough that even a handful of cards overflow
    // its scroll area — the adaptive ResizeObserver check should reveal the
    // search box without any count-rule help.
    await page.setViewportSize({ width: original?.width ?? 1280, height: 300 });
    await search.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
    check((await search.count()) === 1, "shrinking the viewport reveals the search box once the grid overflows");

    // Round-2 review fix (8dc8cd5, item 1): the same bottom-edge scroll fade
    // HelpModal's mobile tab strip uses, mirrored for the card grid's OWN
    // scroll axis (top-to-bottom) — `data-fade-bottom` toggles on a real
    // scroll-position listener, not just this same overflow heuristic. The
    // short 300px-tall viewport above already guarantees more cards are
    // scrolled out of view below than fit, so the attribute should be set
    // immediately.
    const gridScroll = page.locator(".design-picker-dialog__grid-scroll");
    check(
      (await gridScroll.getAttribute("data-fade-bottom")) !== null,
      "the card grid's bottom-edge scroll fade is active while more cards sit below the fold"
    );
    await gridScroll.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await page
      .waitForFunction(
        () => document.querySelector(".design-picker-dialog__grid-scroll")?.getAttribute("data-fade-bottom") === null,
        { timeout: 3000 }
      )
      .catch(() => {});
    check(
      (await gridScroll.getAttribute("data-fade-bottom")) === null,
      "the fade clears once scrolled all the way to the bottom"
    );

    if (original) await page.setViewportSize(original);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  }

  // Round-2 review fix (8dc8cd5, item 1): grid-cols-2 below Tailwind's `sm`
  // breakpoint (640px) — a genuinely narrower viewport, not just a shorter
  // one (the overflow check above only varies height). 640px is well under
  // this suite's own desktop/mobile app-layout breakpoint (860px, see
  // AppShell/index.css), so the desktop CommandBar — and its
  // `.command-bar__design-picker` button — would itself disappear if resized
  // BEFORE opening the dialog; open it at the normal desktop width first
  // (same as the overflow-search check above), THEN shrink, mirroring that
  // check's own working order.
  {
    console.log("=== design picker: 2-column grid below the sm breakpoint ===");
    const original = page.viewportSize();
    await button.click();
    await dialog.waitFor({ state: "visible", timeout: 3000 });
    await page.setViewportSize({ width: 390, height: original?.height ?? 900 });
    check(
      (await gridColumnCount(page.locator(".design-picker-dialog__grid").first())) === 2,
      "the card grid is 2 columns below the 640px sm breakpoint"
    );
    if (original) await page.setViewportSize(original);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  }
}

async function checkEveryDesignRenders({ page, ids }) {
  console.log("=== every design renders ===");
  for (const id of ids) await selectDesign(page, id);
}

// Bundled presets — exercised on the first design that ships any. Desktop
// presets live in the panel's Presets tab (a button list), applied by click.
async function checkBundledPresets({ page, check, ids, presetsTabName, paramsTabName }) {
  console.log("=== bundled presets ===");
  let presetTested = false;
  const gotoPresets = () =>
    page.getByRole("tab", { name: presetsTabName }).first().click().catch(() => {});
  const gotoParams = () =>
    page.getByRole("tab", { name: paramsTabName }).first().click().catch(() => {});
  for (const id of ids) {
    await selectDesign(page, id);
    await gotoPresets();
    // Ready-made presets sit in the "Ready-made" section as a plain button list;
    // the applied one carries aria-pressed="true" (see PresetPicker.tsx).
    const bundled = page.locator('[aria-label="Ready-made presets"] .preset-picker__item');
    if (await bundled.count()) {
      // Round-2 review fix (8dc8cd5, item 2): bundled presets are grouped
      // into one section per parsed badge (groupPresetsByBadge), each with
      // its own `<h3>` heading — a badge-less run (this build's `tag`
      // presets, "Large tag"/"No hole", carry no trailing "(Language)") still
      // gets the SAME heading treatment, just reading "Ready-made" instead of
      // a language name. This confirms the grouped-heading rendering itself
      // works; a config with badged presets (unit-tested directly by
      // presetCard.test.mjs's groupPresetsByBadge cases) would show one
      // heading per badge instead of this single "Ready-made" run.
      const readyMadeHeading = page.locator("h3", { hasText: "Ready-made" });
      check((await readyMadeHeading.count()) === 1, "the bundled presets sit under a \"Ready-made\" section heading");
      const headingBox = await readyMadeHeading.boundingBox();
      const firstCardBox = await bundled.first().boundingBox();
      check(
        !!headingBox && !!firstCardBox && headingBox.y < firstCardBox.y,
        "the section heading sits above its own bundled-preset cards"
      );
      // Bundled cards are now compact horizontal rows (thumbnail left when
      // `design.presetImages` has an entry for that exact preset name, else
      // text-only). This build's config sets no `presetImages` (unit-tested
      // directly by gen-schema.test.mjs/schema.test.mjs's presetImages
      // fixtures), so every card here should gracefully render text-only —
      // confirms the "no thumb configured" branch doesn't leave a broken
      // image or empty gap behind.
      check(
        (await bundled.first().locator(".preset-picker__thumb").count()) === 0,
        "a bundled card with no configured presetImages entry renders text-only (no broken thumbnail slot)"
      );
      const name = (await bundled.first().textContent())?.trim() ?? "";
      await bundled.first().click();
      await waitRendered(page, `${id} + "${name}"`);
      // The applied preset shows as selected, and the choice is in the URL.
      check(
        (await page.locator('[aria-label="Ready-made presets"] .preset-picker__item[aria-pressed="true"]').count()) >= 1,
        `applied bundled preset "${name}"`
      );
      // persistState debounces ~300ms after the apply, so wait for the hash.
      await page
        .waitForFunction(() => /[#&]p=/.test(location.hash), undefined, { timeout: 3000 })
        .catch(() => {});
      check(
        /[#&]p=/.test(await page.evaluate(() => location.hash)),
        "selected preset is encoded in the URL"
      );
      // The choice survives a reload (restored from the URL hash).
      await page.reload({ waitUntil: "load" });
      await waitRendered(page, `${id} reloaded`);
      await gotoPresets();
      check(
        (await page.locator('[aria-label="Ready-made presets"] .preset-picker__item[aria-pressed="true"]').count()) >= 1,
        "preset auto-selected from the URL after reload"
      );
      await gotoParams();
      presetTested = true;
      break;
    }
  }
  if (!presetTested) console.log("  (no bundled presets in this config — skipped)");
}

// Preset import: an OpenSCAD parameterSets file becomes a saved preset.
async function checkPresetImport({ page, check, ids, presetsTabName, paramsTabName }) {
  console.log("=== preset import (parameterSets round-trip) ===");
  await selectDesign(page, ids[0]);
  await page.getByRole("tab", { name: presetsTabName }).first().click().catch(() => {});
  // An empty set still lists by name (values default in); enough to prove the
  // parse→save→list wiring. Round-trip coercion is covered by the unit tests.
  const setsFile = JSON.stringify({
    fileFormatVersion: "1",
    parameterSets: { "Imported Set": {} },
  });
  await page
    .locator('.preset-picker input[type="file"]')
    .first()
    .setInputFiles({ name: "presets.json", mimeType: "application/json", buffer: Buffer.from(setsFile) });
  // The import parses and saves asynchronously; wait for the item to list.
  const importedItem = page.locator(
    '[aria-label="Your saved presets"] .preset-picker__item',
    { hasText: "Imported Set" }
  );
  await importedItem.first().waitFor({ state: "attached", timeout: 3000 }).catch(() => {});
  check((await importedItem.count()) >= 1, "imported parameterSets file added a saved preset");
  await page.getByRole("tab", { name: paramsTabName }).first().click().catch(() => {});
}

// "Save as preset…" (PR19 item 2): demoted from an always-visible input row
// to a button that reveals it on demand, auto-focused; Escape or a blur while
// still empty collapses it back.
async function checkPresetSaveReveal({ page, check, ids, presetsTabName, paramsTabName }) {
  console.log("=== presets: \"Save as preset…\" reveals inline, Escape/blur-empty collapses ===");
  await selectDesign(page, ids[0]);
  await page.getByRole("tab", { name: presetsTabName }).first().click().catch(() => {});

  const trigger = page.locator(".preset-picker__save-trigger");
  await trigger.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await trigger.count()) === 1, "the 'Save as preset…' trigger button is shown");
  check((await page.locator(".preset-picker__save-row").count()) === 0, "the inline save row is collapsed by default");

  // Round-2 review fix (8dc8cd5, item 2): "Save as preset…" moved OFF a
  // permanent, always-visible bottom bar into a small ghost action beside the
  // "Saved by you" header — confirm it actually landed there (a sibling of
  // that heading, in the same small header row) rather than just checking
  // the trigger exists somewhere on the page.
  const savedByYouHeading = page.locator("h3", { hasText: "Saved by you" });
  check((await savedByYouHeading.count()) === 1, "the \"Saved by you\" section heading is shown");
  check(
    await trigger.evaluate((el, headingText) => {
      const row = el.parentElement;
      return !!row && Array.from(row.children).some((c) => c.tagName === "H3" && c.textContent?.includes(headingText));
    }, "Saved by you"),
    "the \"Save as preset…\" trigger is a sibling of the \"Saved by you\" heading, not a standalone bottom bar"
  );

  const row = page.locator(".preset-picker__save-row");

  await trigger.click();
  await row.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await row.count()) === 1, "clicking the trigger reveals the inline save row");
  check(
    await row.locator("input").evaluate((el) => el === document.activeElement),
    "the revealed input is auto-focused"
  );

  // Escape collapses back to the trigger, discarding whatever was typed.
  await row.locator("input").fill("Throwaway");
  await page.keyboard.press("Escape");
  await trigger.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await page.locator(".preset-picker__save-row").count()) === 0, "Escape collapses the reveal back to the trigger");

  // A blur while the field is still empty also collapses it.
  await trigger.click();
  await row.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  await page.keyboard.press("Tab");
  await trigger.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await page.locator(".preset-picker__save-row").count()) === 0, "blurring the still-empty input also collapses it");

  // A real save: reveal, type a name, press Enter — the row collapses and the
  // preset lists under "Saved by you".
  await trigger.click();
  await row.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  const name = "Smoke Saved Preset";
  await row.locator("input").fill(name);
  await page.keyboard.press("Enter");
  const savedItem = page.locator('[aria-label="Your saved presets"] .preset-picker__item', { hasText: name });
  await savedItem.first().waitFor({ state: "attached", timeout: 3000 }).catch(() => {});
  check((await savedItem.count()) >= 1, "Enter saves the preset and it appears under 'Saved by you'");
  check((await page.locator(".preset-picker__save-row").count()) === 0, "saving collapses the reveal back to the trigger");

  await runAxe(page, check, "Presets tab (save-as-preset reveal/collapse)");

  // Clean up: delete the smoke-created preset so it doesn't pollute later
  // checks that iterate "Saved by you" (e.g. a rerun's own checkPresetImport).
  await page
    .locator('[aria-label="Your saved presets"] li', { hasText: name })
    .getByRole("button", { name: /^Delete/i })
    .click()
    .catch(() => {});
  const deleteDlg = page.getByRole("alertdialog");
  const deleteDlgShown = await deleteDlg
    .waitFor({ state: "visible", timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  if (deleteDlgShown) await deleteDlg.getByRole("button", { name: /^Delete$/ }).click();
  await savedItem.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  await page.getByRole("tab", { name: paramsTabName }).first().click().catch(() => {});
}

// The export dock, unified across every workflow (dock-unification pass):
// exactly two direct buttons, Download and Share — no split "▾" trigger, no
// export-format dropdown menu, no "More" menu, no "Save image", no "Copy
// link" menu entry, and no visible "3MF · …" format caption. This used to
// differ by `ui.workflow` (tabs got a two-row card with a split trigger and a
// "More" menu; guided got exactly these two buttons) — the guided treatment
// is now the ONLY treatment, in every workflow, mirroring
// scripts/smoke-guided.mjs's own `checkDesktopExportFlow` assertions for the
// guided config.
async function checkExportDock({ page, check, ids }) {
  console.log("=== export dock: exactly Download + Share, no menus ===");
  await selectDesign(page, ids[0]);

  check((await page.locator(".action-export").count()) === 1, "direct Download button (no split trigger)");
  check((await page.locator(".action-export-options").count()) === 0, "no split \"▾\" trigger");
  check((await page.locator(".action-export-menu").count()) === 0, "no export format dropdown menu");
  check((await page.locator(".action-share").count()) === 1, "direct Share button");
  check((await page.locator(".action-more").count()) === 0, "no \"More\" menu (Save image/Copy link)");
  check((await page.locator(".action-more-menu").count()) === 0, "no \"More\" menu content in the DOM either");
  check(
    !(await page.locator(".action-export-format-note").isVisible().catch(() => false)),
    "no visible \"3MF · …\" format caption under Download"
  );
  check((await page.locator(".export-attention").count()) === 0, "no standing \"N issues to review\" banner over the viewer (no attention gap here)");
  check((await page.locator(".action-cluster").count()) === 1, "exactly one export dock card, a single row (Download + Share only)");
}

// Export 3MF + PNG on the first design, plus the after-export panel it drives
// (PR9): the dogfood config sets `ui.afterExport.helpTab` ("Printing"), so
// every completed export here should surface the panel.
async function checkExports({ page, check, ids, dir }) {
  await selectDesign(page, ids[0]);
  console.log("=== export 3MF ===");
  const [model] = await Promise.all([
    page.waitForEvent("download"),
    // The CTA's own label/aria-label keep evolving (currently "Download for
    // 3D printing", src/locales/*.json's action.export/action.exportAria) —
    // smoke selects the stable `.action-export` hook rather than the visible
    // text/aria-label.
    page.click(".action-export"),
  ]);
  const modelOut = join(dir, await model.suggestedFilename());
  await model.saveAs(modelOut);
  check((await stat(modelOut)).size > 0, `${await model.suggestedFilename()} (${(await stat(modelOut)).size} bytes)`);
  check(
    (await page.getByLabel(/Download for 3D printing/i).count()) >= 1,
    "the export CTA is present with its outcome-led label"
  );

  console.log("=== after-export panel ===");
  // Headless Chromium has no Web Share API target here, so exportModel falls
  // back to a plain browser download — the panel should show the
  // "downloaded" wording (src/lib/exportOutcome.ts's exportOutcomeTitleKey).
  const successPanel = page.locator(".export-success");
  await successPanel.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await successPanel.count()) === 1, "export-success panel appears after a completed 3MF export");
  check(
    /downloaded/i.test((await successPanel.textContent()) ?? ""),
    "export-success panel shows the downloaded wording for a plain browser download"
  );
  await runAxe(page, check, "export-success panel visible");

  const guideLink = successPanel.getByRole("button", { name: "Printing guide" });
  check((await guideLink.count()) === 1, 'export-success panel offers a "Printing guide" action');
  await guideLink.click();
  const helpDialog = page.getByRole("dialog");
  await helpDialog.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  const printingTab = helpDialog.getByRole("tab", { name: "Printing" });
  check(
    (await printingTab.getAttribute("aria-selected")) === "true",
    '"Printing guide" opens Help deep-linked to the Printing tab'
  );
  await page.keyboard.press("Escape");
  await helpDialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

  // Export again (the panel from the first export never got its own X) to
  // exercise the dismiss button itself.
  const [model2] = await Promise.all([
    page.waitForEvent("download"),
    page.click(".action-export"),
  ]);
  await model2.saveAs(join(dir, `redownload-${await model2.suggestedFilename()}`));
  await successPanel.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  await successPanel.locator(".export-success__dismiss").click();
  check((await successPanel.count()) === 0, "export-success panel's dismiss (X) hides it");
}

async function checkPreviewControls({ page, check }) {
  console.log("=== preview controls (share link + live preview) ===");
  check(
    (await page.locator('[aria-label="Copy share link"]').count()) >= 1,
    "copy-link button present"
  );
  // Live preview (auto-render): a shadcn/ui Switch (role=switch) in the params footer.
  const auto = page.getByRole("switch", { name: /Live preview/i }).first();
  const autoOn = async () => (await auto.getAttribute("aria-checked")) === "true";
  check(await autoOn(), "live preview on by default (non-heavy design)");
  await auto.click();
  check(!(await autoOn()), "live preview can be turned off");
  await auto.click();
}

// Viewer HUD: reference grid toggle (new in the visual-alignment pass — off
// by default, config `ui.grid`, alongside the pre-existing measure/reset/
// zoom/fullscreen controls). Toggling doesn't move the camera or touch the
// model, just the ground-plane reference; the preference persists across a
// reload (src/lib/viewerPrefs.ts).
async function checkViewerHudGrid({ page, check }) {
  console.log("=== viewer HUD: reference grid toggle ===");

  // Round-2 review fix (fa49bcb, item 2): HUD buttons are size-10 (40px) on
  // desktop, dropping to size-9 (36px, HUD_GLASS_BTN's `max-[860px]:size-9`)
  // below the 860px mobile breakpoint — Tailwind's `size-*` fixes the
  // button's actual box regardless of its (also breakpoint-varying) padding,
  // so the bounding box itself is the right thing to measure. This desktop
  // context (checkViewerHudGrid always runs at the shared default >860px
  // viewport) exercises the size-10 side; checkMobileActionBar's own per-width
  // loop (320-820px, all under the breakpoint) exercises size-9.
  const hudBtnBox = await page.locator(".viewer-hud button").first().boundingBox();
  check(
    !!hudBtnBox && Math.round(hudBtnBox.width) === 40 && Math.round(hudBtnBox.height) === 40,
    `viewer HUD buttons are size-10 (40px) on desktop (measured ${hudBtnBox?.width}x${hudBtnBox?.height})`
  );

  const gridOff = page.getByRole("button", { name: "Show reference grid" });
  check((await gridOff.count()) === 1, "grid toggle shown in the viewer HUD, off by default");
  check((await gridOff.getAttribute("aria-pressed")) === "false", "grid toggle starts unpressed (off)");

  await gridOff.click();
  const gridOn = page.getByRole("button", { name: "Hide reference grid" });
  await gridOn.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await gridOn.count()) === 1, "toggling flips the label to \"Hide reference grid\"");
  check((await gridOn.getAttribute("aria-pressed")) === "true", "grid toggle now reads pressed (on)");

  await page.reload({ waitUntil: "load" });
  await waitRendered(page, "reloaded with the grid preference on");
  const gridOnAfterReload = page.getByRole("button", { name: "Hide reference grid" });
  check((await gridOnAfterReload.count()) === 1, "the grid preference persists across a reload");

  // Restore the default (off) for the checks/screenshots that follow.
  await gridOnAfterReload.click();
  const gridRestored = page.getByRole("button", { name: "Show reference grid" });
  await gridRestored.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await gridRestored.count()) === 1, "grid toggle restored to off");
}

async function checkServiceWorker({ page, check, base }) {
  console.log("=== service worker update contract ===");
  const swText = await (await page.request.get(base + "sw.js")).text();
  check(
    /addEventListener\(\s*["']message["']/.test(swText) && /SKIP_WAITING/.test(swText),
    "sw.js activates a waiting worker on a SKIP_WAITING message"
  );
  // An install handler is fine (it precaches the app shell for offline use),
  // but it must not call skipWaiting — a new worker has to wait so the page
  // can prompt the user (see the SKIP_WAITING message handler above).
  const installHandler =
    swText.match(/addEventListener\(\s*["']install["'][\s\S]*?(?=addEventListener\(|$)/)?.[0] ?? "";
  check(
    !/skipWaiting/.test(installHandler),
    "sw.js install handler does not auto-skipWaiting (updates are user-prompted)"
  );
}

// Locate a parameter row by its stable data-param hook (present regardless
// of ui.showVarName), shared by the tag + signage checks.
const paramRow = (page, name) => page.locator(`.param[data-param="${name}"]`);

// Fill a number param's own numeric input (the box beside its slider) and
// blur to commit — shared by checkTagDesign's assert-trip flow and the PR16
// mobile Messages check, which reproduces the same trip on a mobile context.
const setNumField = async (page, name, value) => {
  const input = paramRow(page, name).locator('input[type="number"]');
  await input.fill(String(value));
  await input.blur();
};

// Click the essentials/all settings-view segmented control (CustomizeTab /
// SettingsViewToggle) — present only when the active design has at least one
// @advanced param. No-op (rather than a throw) when it's absent, so callers
// that run against a design/config without any advanced params stay safe.
async function switchSettingsView(page, view) {
  const label = view === "all" ? "All settings" : "Essential settings";
  const btn = page.locator(".settings-view-toggle").getByRole("button", { name: label, exact: true });
  if (await btn.count()) await btn.click();
}

// PR23 item 4's Review card block-level DOM order, rebuilt for the visual-
// alignment pass's layout: readiness, subtitle, summary, EITHER
// the warning card (attention) or the ready strip, then actions. Shared by
// checkQuickStart (the clean, no-attention state, where the ready strip
// shows) and checkReadiness (every optional block present, including the
// warning card) — both used to hand-roll the identical `wanted`-selector-list
// + evaluate()/map()/filter() walk and only differed in which of
// attention/ready belonged in the expected order.
const REVIEW_BLOCK_SELECTORS = [
  ".quick-start__review-readiness",
  ".quick-start__review-subtitle",
  ".quick-start__review-summary",
  ".quick-start__review-attention",
  ".quick-start__review-ready",
  ".quick-start__review-actions",
];

async function reviewBlockOrder(reviewLocator, check, { expectAttention, message }) {
  const actual = await reviewLocator.evaluate(
    (el, wanted) =>
      Array.from(el.children)
        .map((child) => wanted.find((sel) => child.matches(sel)))
        .filter(Boolean),
    REVIEW_BLOCK_SELECTORS
  );
  const expected = REVIEW_BLOCK_SELECTORS.filter((sel) =>
    expectAttention ? sel !== ".quick-start__review-ready" : sel !== ".quick-start__review-attention"
  );
  check(actual.join(" -> ") === expected.join(" -> "), `${message} (saw ${actual.join(" -> ")})`);
}

// Essentials/all settings view (the essentials/beginner milestone): the
// dogfood config's guided default (ui.experience.default) starts a FRESH
// visitor on the essentials view, which hides every @advanced param.
// Deliberately exercised on "coin", not "tag": coin has the identical
// "Quality" (facet_angle/facet_size, @advanced) section but declares no
// `@step`s at all, so `quickStartActive` is always false for it and the
// standing Essential/All toggle this test drives is ALWAYS the one showing
// (the per-stage model — see checkQuickStart below — only ever applies while
// QuickStart itself is showing; a design with no steps never reaches that
// state, so this test's own subject is unaffected by it). Using "tag" here
// would be circular: tag's own `@step`s make QuickStart the active guide the
// instant this lands on essentials, which now suppresses this very toggle
// (H1) — that replacement is what checkQuickStart exercises instead. Must
// run before any other check has touched the settingsView preference (it
// reads the still-fresh page straight after the welcome popup is dismissed),
// and deliberately ends with the choice persisted as "all" — later checks
// (bundled presets' Import/Export row, the @showIf/@collapsed checks in
// checkTagDesign) expect the full, ungated panel.
async function checkSettingsView({ page, check, ids, paramsTabName }) {
  if (!ids.includes("coin")) return;
  console.log("=== settings view (essentials/all) ===");
  await selectDesign(page, "coin");
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});

  const toggle = page.locator(".settings-view-toggle");
  check((await toggle.count()) === 1, "settings-view toggle shown for a design with @advanced params");
  check(
    (await toggle.getByRole("button", { name: "Essential settings" }).getAttribute("aria-pressed")) === "true",
    "fresh visitor starts on the Essential settings view (config ui.experience.default)"
  );

  const facet = paramRow(page, "facet_angle");
  check((await facet.count()) === 0, "essentials view: the @advanced facet_angle control isn't in the DOM at all");
  const hiddenNote = page.locator(".settings-hidden-note");
  check((await hiddenNote.count()) === 1, "hidden-settings note shown at the bottom of the form in essentials view");
  const hiddenNoteText = ((await hiddenNote.textContent()) ?? "").trim();
  check(/\b2\b/.test(hiddenNoteText), `hidden-settings note reports the right count (saw "${hiddenNoteText}")`);
  await runAxe(page, check, "essentials view, coin Customize tab");

  // A search term matching only a hidden (advanced) param surfaces the
  // "N matching settings are in All settings — Show them" note; clicking it
  // switches view and (via ParamForm's existing search-force-open behavior)
  // reveals the match.
  const search = page.locator("#param-search-input");
  await search.fill("facet");
  const searchNote = page.locator(".settings-search-note");
  await searchNote.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await searchNote.count()) === 1, "search note shown when a query matches only hidden (essentials-demoted) settings");
  await searchNote.getByRole("button", { name: "Show them" }).click();
  await facet.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check(
    (await facet.count()) > 0 && (await facet.first().isVisible()),
    "\"Show them\" switches to All settings and reveals the matching hidden setting"
  );
  check(
    (await toggle.getByRole("button", { name: "All settings" }).getAttribute("aria-pressed")) === "true",
    "toggle reflects the switch to All settings"
  );
  await search.fill("");
  await search.press("Escape").catch(() => {});
  await runAxe(page, check, "all settings view, coin Customize tab");

  // The switch persists across a reload.
  await page.reload({ waitUntil: "load" });
  await waitRendered(page, "coin reloaded (settings view)");
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});
  check(
    (await paramRow(page, "facet_angle").count()) > 0,
    "the All-settings choice is honored (persisted) after a reload"
  );
  check(
    (await page.locator(".settings-view-toggle").getByRole("button", { name: "All settings" }).getAttribute("aria-pressed")) === "true",
    "toggle still reads All settings after reload"
  );

  // The toggle itself (not just the shortcut links) switches views.
  await switchSettingsView(page, "essentials");
  check(
    (await paramRow(page, "facet_angle").count()) === 0,
    "clicking \"Essential settings\" on the toggle hides facet_angle again"
  );
  // Leave the suite in All settings — the checks that follow (bundled
  // presets' Import/Export row, checkTagDesign's @showIf/@collapsed checks)
  // expect the full, ungated panel.
  await switchSettingsView(page, "all");
}

// QuickStart step navigation (PR11; scroll mode PR15): shown instead of the
// classic scrolling form when guided + essentials + a stepped design (tag,
// via examples/tag.scad's `@step` annotations) + `ui.quickStart` (default
// true). Runs right after checkSettingsView, which conveniently leaves the
// suite on "All settings" — switch to essentials here to exercise QuickStart,
// and leave the suite back on "All settings" at the end (per
// checkSettingsView's own comment, later checks — bundled presets' Import/
// Export row, checkTagDesign's @showIf/@collapsed checks — expect the full,
// ungated panel).
//
// This desktop-context pass exercises "scroll" mode (ParamPanel's own docked
// panel + its scroll container): every step renders at once, chips are
// scroll anchors, and there's no Back/Next — see QuickStart.tsx's own
// variant doc. Mobile's unchanged "steps" mode (one step at a time,
// Back/Next) has its own pass, checkQuickStartMobile, in its own mobile
// context alongside checkResponsiveLayout.
async function checkQuickStart({ page, check, ids, paramsTabName }) {
  if (!ids.includes("tag")) return;
  console.log("=== QuickStart step navigation (desktop scroll mode) ===");
  await selectDesign(page, "tag");
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});
  await switchSettingsView(page, "essentials");

  const quickStart = page.locator(".quick-start");
  await quickStart.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await quickStart.count()) === 1, "QuickStart shown in guided + essentials for a stepped design (tag)");

  const chips = page.locator(".quick-start__step");
  check((await chips.count()) === 5, "5 chips shown (4 @step sections + Review)");
  check((await chips.nth(0).getAttribute("aria-current")) === "step", "the first step chip starts current");

  // Round-2 review fix (9a25e91): the chip restyle — a small circular number
  // badge + label joined by a thin connector, no full pill background on an
  // inactive chip. Structural check on the new class names (chip DOM shape
  // changed: `.quick-start__step-number` is a differently classed/sized
  // badge, a new `.quick-start__step-label` span wraps the text, a new
  // `.quick-start__step-connector` sits between chips).
  check(
    (await chips.first().locator(".quick-start__step-number").count()) === 1,
    "each chip has its own number badge"
  );
  check(
    (await chips.first().locator(".quick-start__step-label").count()) === 1,
    "each chip's text sits in its own label span"
  );
  const chipCount = await chips.count();
  check(
    (await page.locator(".quick-start__step-connector").count()) === chipCount - 1,
    "a thin connector sits between every pair of chips (one fewer connector than chips — none trails the last, Review, chip)"
  );
  // The Review chip drops its old leading ClipboardCheck icon glyph for the
  // same numbered-badge treatment as every other chip — confirm no leftover
  // icon element (an <svg>) sits inside it; its number badge + attention dot
  // (a plain <span>, checked elsewhere) are the only non-text children now.
  const reviewChipIcons = page.locator(".quick-start__step--review svg");
  check((await reviewChipIcons.count()) === 0, "the Review chip no longer renders a leading icon glyph");

  // Round-2 review fix (9a25e91): the chip strip is hoisted OUT of
  // `.customize-tab__scroll` entirely (into `.quick-start-strip-slot`, a
  // portal target CustomizeTab positions above the Essential/All toggle) for
  // BOTH layouts now — previously only mobile did this. It stays visible
  // while scrolling step content without needing `position: sticky`.
  const stripInScrollContainer = await page
    .locator(".quick-start__strip")
    .evaluate((el) => el.closest(".customize-tab__scroll") !== null);
  check(!stripInScrollContainer, "the chip strip lives outside .customize-tab__scroll (hoisted, not scrolled-with-content)");

  // Per-stage advanced model (harmonized with guided — see docs/config.md's
  // `ui.workflow`): the standing Essential/All toggle and the search box are
  // BOTH gone the instant QuickStart is showing (H1/H2) — replaced by each
  // stage's own quiet "Show advanced settings" toggle. tag's own `@step`s
  // (Size/Text/Emblem/Hanging hole) carry no `@advanced` params at all — its
  // only advanced params (facet_angle/facet_size) sit in the un-stepped
  // "Quality" section — so scroll mode renders no `.quick-start__advanced-
  // toggle` anywhere either (sanity, mirroring smoke-guided.mjs's own
  // "tag, no @advanced params in any step" check). The chip strip is still
  // hoisted into its own slot ahead of the step content, same as before.
  check(
    (await page.locator(".settings-view-toggle").count()) === 0,
    "the standing Essential/All toggle is gone while QuickStart is showing (H1)"
  );
  check(
    (await page.locator("#param-search-input").count()) === 0,
    "search is hidden until advanced is revealed somewhere — none of tag's own steps carry an @advanced param, so it never appears here (H2)"
  );
  check(
    (await page.locator(".quick-start__advanced-toggle").count()) === 0,
    "sanity: no stage has a \"Show advanced settings\" toggle either — tag's @advanced params are all in the un-stepped Quality section"
  );
  const stripBeforeContent = await page.evaluate(() => {
    const slot = document.querySelector(".quick-start-strip-slot");
    const content = document.querySelector(".quick-start__scroll-content");
    if (!slot || !content) return null;
    return !!(slot.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  check(
    stripBeforeContent === true,
    "DOM order is stage-chip strip -> step content (chips hoisted above the content, desktop scroll mode)"
  );

  // Scroll mode: every step's group renders simultaneously — a scrollable
  // form, not a one-step-at-a-time wizard — and there's no Back/Next.
  const groupHeadings = page.locator(".quick-start__group h3");
  check((await groupHeadings.count()) === 4, "all 4 step groups render at once (scroll mode, not a wizard)");
  const headingTexts = await groupHeadings.allTextContents();
  check(
    ["Size", "Text", "Emblem", "Hanging hole"].every((label) => headingTexts.includes(label)),
    "every step's own heading is present in the scrolled form"
  );
  check((await page.locator(".quick-start__back").count()) === 0, "no Back button in desktop scroll mode");
  check((await page.locator(".quick-start__next").count()) === 0, "no Next button in desktop scroll mode");

  await runAxe(page, check, "QuickStart visible (essentials view, tag, scroll mode)");

  // A param edit inside a step re-renders the preview — the same pipeline as
  // the classic form, just mounted through ParamRows' flat chrome. Every
  // step's own params are already in the DOM (scroll mode), so no navigation
  // is needed first — unlike steps mode, which has to walk there.
  const labelInput = paramRow(page, "label").locator('input[type="text"]');
  if (await labelInput.count()) {
    await labelInput.fill("QuickStart");
    await labelInput.blur();
    await waitRendered(page, "quickstart param edit");
  }

  // Chip click smooth-scrolls its group into view and moves focus to the
  // step heading (this suite doesn't force prefers-reduced-motion, so the
  // real scroll animation plays — see QuickStart.tsx's own reduced-motion
  // handling, covered structurally by its pure helper's unit tests instead).
  await chips.nth(2).click(); // "Emblem"
  await page
    .waitForFunction(() => document.activeElement?.tagName === "H3", { timeout: 3000 })
    .catch(() => {});
  check(
    await page.evaluate(() => document.activeElement?.textContent?.includes("Emblem") ?? false),
    "clicking a chip moves focus to that step's heading"
  );
  check((await chips.nth(2).getAttribute("aria-current")) === "step", "clicking a chip sets it current immediately");
  // The click above triggers a native smooth-scroll animation (this suite
  // doesn't force prefers-reduced-motion), which takes a few hundred ms to
  // settle — poll the heading's position instead of reading it the instant
  // focus lands (focus({preventScroll: true}) is effectively synchronous
  // with the scrollIntoView call, well before the animation finishes).
  const scrolledNearTop = await page
    .waitForFunction(
      () => {
        const el = Array.from(document.querySelectorAll(".quick-start__group h3")).find((h) =>
          (h.textContent ?? "").includes("Emblem")
        );
        const container = el?.closest(".customize-tab__scroll");
        if (!el || !container) return false;
        const r = el.getBoundingClientRect();
        const c = container.getBoundingClientRect();
        // "Near the top" (not necessarily pixel-0 — the sticky chip strip
        // and its scroll-margin sit above it): generous enough to avoid
        // flaking on exact scroll-animation easing while still catching a
        // chip click that scrolled nowhere.
        return r.top >= c.top - 40 && r.top <= c.top + 250;
      },
      { timeout: 3000, polling: 50 }
    )
    .then(() => true)
    .catch(() => false);
  check(scrolledNearTop, "the clicked step's heading actually scrolled near the top of the panel");

  // Review chip (PR18, rebuilt by the visual-alignment pass — see
  // ReviewContent in QuickStart.tsx): scrolls to the end of the form and
  // shows a readiness line, a one-line subtitle, the structured summary CARD
  // (every essential parameter's current value, then the design's own
  // `@display` rows, then the dimension/@info/computed rows —
  // reviewSummary.ts's buildReviewSummaryRows), EITHER
  // the one warning card or a "Ready for download" success strip, and finally
  // an actions row holding the Review stage's OWN primary Export button
  // (`.quick-start__review-export` — reuses the same `exportModel` action as
  // the floating dock's, not a duplicate pointer at it) plus, only when a
  // font-fallback attention item exists, an "Open font settings" link.
  await chips.last().click();
  check((await chips.last().getAttribute("aria-current")) === "step", "clicking the Review chip sets it current");
  const review = page.locator(".quick-start__review");
  check(await review.isVisible(), "the Review chip's own section actually scrolled into view");
  check(
    /Ready to download/.test((await page.locator(".quick-start__review-readiness").textContent()) ?? ""),
    "Review's readiness line reads \"Ready to download\" for the default, fully-rendered, no-attention state"
  );
  check(
    /Dimensions/.test((await page.locator(".quick-start__review-summary").textContent()) ?? ""),
    "Review's summary includes the Dimensions row (reused from DimensionInfo's own derivation)"
  );
  check(
    (await page.locator(".quick-start__review-summary > div").count()) > 1,
    "Review's summary includes more than just the Dimensions row (tag's own essential-parameter rows lead it)"
  );
  check(
    (await review.locator(".quick-start__review-export").count()) === 1 &&
      /^Download for 3D printing$/.test(((await review.locator(".quick-start__review-export").textContent()) ?? "").trim()),
    "Review's own primary Export button reuses the plain export label (no attention, nothing to \"export anyway\")"
  );
  check(
    (await review.locator(".quick-start__review-ready").count()) === 1,
    "the \"Ready for download\" success strip is shown in place of a warning card when there's nothing to review"
  );

  // PR23's block order, rebuilt (visual-alignment pass): readiness line,
  // subtitle, the summary card, EITHER the warning
  // card or the ready strip, then the actions row (export + optional font
  // link) — no separate "Font status" row anymore (a font's current family
  // already shows as an ordinary essential-parameter row; see
  // ReviewContent's own doc in QuickStart.tsx). Reads the block-level
  // markers in actual DOM order rather than asserting on any one in isolation.
  await reviewBlockOrder(review, check, {
    expectAttention: false,
    message: "Review card blocks render readiness -> subtitle -> summary -> ready strip -> actions",
  });
  // The summary card's own dt sequence now LEADS with every essential
  // parameter's current value (reviewSummary.ts's essentialParamRows), not
  // the Dimensions headline — that (plus any @info rows) comes later, from
  // buildReviewRows. Confirm Dimensions is present, past the essential rows,
  // rather than asserting it leads (PR23's own restructure).
  const reviewDtOrder = await page.locator(".quick-start__review-summary dt").allTextContents();
  const dimensionsIndex = reviewDtOrder.indexOf("Dimensions");
  check(
    dimensionsIndex > 0 && reviewDtOrder.length > dimensionsIndex + 1,
    `the summary's own dt sequence leads with essential-parameter rows, then Dimensions, then @info rows (saw: ${reviewDtOrder.join(", ")})`
  );

  check(
    (await review.locator(".quick-start__review-front-view").count()) === 0,
    "tabs-mode Review has no \"Front view\" button either"
  );

  await runAxe(page, check, "QuickStart Review stage visible (essentials view, tag, scroll mode)");

  // Per-stage model note: the OLD "All settings escape" (click the standing
  // toggle to drop into the classic form) and "search interplay" (type a
  // query to bypass QuickStart, via the always-present search box) checks
  // that used to live here are gone — both needed a UI affordance (the
  // standing toggle, or a reachable search box) that H1/H2 deliberately
  // removed the instant QuickStart is showing. tag's own `@step`s carry no
  // `@advanced` param at all (see the sanity check above), so — exactly
  // mirroring guided workflow's own pre-existing, already-shipped behavior
  // for this same design (smoke-guided.mjs's own "no @advanced params in any
  // step" checks) — there is now no in-app path to reveal either one for
  // THIS design without an external trigger (e.g. `focusOnParam`, exercised
  // elsewhere via the attention chip's "Go to setting"/the friendly-error
  // card's "Review hidden settings"). The underlying bypass mechanism itself
  // (`showQuickStart = quickStartActive && !q`) is untouched source — only
  // the UI's ability to populate `q`/`stageAdvanced` for tag specifically
  // changed — but this smoke suite has no other stepped design on hand to
  // re-exercise it through the UI; see checkQuickStart's own report note.

  // Sanity: with no reachable advanced toggle anywhere, QuickStart simply
  // stays put — reloading changes nothing about which mode is showing.
  check((await page.locator(".quick-start").count()) === 1, "QuickStart is still the active guide (nothing above changed settingsView)");

  // Leave the suite in All settings, on "tag", for the checks that follow
  // (bundled presets' Import/Export row, checkTagDesign's own @showIf/
  // @collapsed checks expect the full, ungated panel, on tag specifically).
  // settingsView is a single, design-independent preference, and tag's own
  // standing toggle is unreachable while QuickStart is showing (H1), so flip
  // it via a design with no `@step`s (coin) instead — exactly like
  // checkSettingsView does — then switch back to tag so the rest of this
  // check's own state (which design is selected) is otherwise unchanged.
  await selectDesign(page, "coin");
  await switchSettingsView(page, "all");
  await selectDesign(page, "tag");
}

// QuickStart step navigation, mobile (PR15): the bottom sheet keeps today's
// one-step-at-a-time "steps" variant unchanged (Back/Next, one step's
// ParamRows mounted at a time) — desktop's own scroll-mode assertions live in
// checkQuickStart above. Needs its own real mobile viewport/context, same
// reasoning as checkResponsiveLayout's own doc (the shared `page` above is
// desktop-sized) — a fresh context so this doesn't inherit any state the
// desktop pass above left behind.
async function checkQuickStartMobile({ browser, base, check, ids, paramsTabName }) {
  if (!ids.includes("tag")) return;
  console.log("=== QuickStart step navigation (mobile steps mode) ===");
  await withMobileContext(browser, async (page) => {
    await page.goto(base, { waitUntil: "load" });
    await settleFirstVisit(page);
    await waitRenderDone(page).catch(() => {});

    // The dogfood config's default landing (tag, guided, essentials) already
    // makes QuickStart the active guide, and guided+half policy starts the
    // sheet at Half (see checkResponsiveLayout) — Parameters is reachable
    // without raising the sheet first.
    await page.getByRole("tab", { name: paramsTabName }).first().click();
    await page.waitForSelector(".quick-start", { timeout: 5000 }).catch(() => {});

    const quickStart = page.locator(".quick-start");
    check((await quickStart.count()) === 1, "QuickStart shown on mobile too (guided + essentials + stepped design)");

    const chips = page.locator(".quick-start__step");
    check((await chips.count()) === 5, "5 chips shown on mobile (4 @step sections + Review)");

    // Per-stage advanced model, harmonized with guided (see checkQuickStart's
    // own matching comment, desktop scroll mode): the standing Essential/All
    // toggle and the search box are both gone the instant QuickStart shows,
    // on mobile too — replaced by each stage's own quiet "Show advanced
    // settings" toggle. tag's own `@step`s carry no `@advanced` param at all
    // (its only advanced params sit in the un-stepped "Quality" section), so
    // none of them render one here either — sanity, mirroring smoke-
    // guided.mjs's own "tag, no @advanced params in any step" check, which
    // already covered this exact fact for mobile steps mode under guided.
    check(
      (await page.locator(".settings-view-toggle").count()) === 0,
      "the standing Essential/All toggle is gone while QuickStart is showing (H1, mobile)"
    );
    check(
      (await page.locator("#param-search-input").count()) === 0,
      "search is hidden until advanced is revealed somewhere — no step here has one (H2, mobile)"
    );
    check(
      (await page.locator(".quick-start__advanced-toggle").count()) === 0,
      "sanity: no stage has a \"Show advanced settings\" toggle either — tag's @advanced params are all in the un-stepped Quality section"
    );
    const stripBeforeContent = await page.evaluate(() => {
      const slot = document.querySelector(".quick-start-strip-slot");
      const content = document.querySelector(".quick-start__content");
      if (!slot || !content) return null;
      return !!(slot.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    check(
      stripBeforeContent === true,
      "DOM order is stage-chip strip -> step content on mobile too (steps mode)"
    );

    // Mobile stays one-step-at-a-time: scroll mode's simultaneous-group
    // markup never mounts here, and Back/Next still drive navigation.
    check((await page.locator(".quick-start__group").count()) === 0, "mobile never renders scroll mode's step-group markup");
    check((await page.locator(".quick-start__content").count()) === 1, "mobile renders exactly one step's content at a time");
    const nextBtn = page.locator(".quick-start__next");
    check((await nextBtn.count()) === 1, "Next button present on mobile");

    check((await chips.nth(0).getAttribute("aria-current")) === "step", "the first step chip starts current on mobile");
    check((await paramRow(page, "width").count()) > 0, "the current (first, \"Size\") step's own params are shown");
    check((await paramRow(page, "label").count()) === 0, "a later step's (\"Text\") params are NOT shown until navigated to");

    // Round-2 review fix: no disabled Back button on the very first step —
    // it's omitted entirely (a disabled control with nothing to explain why
    // is worse than none) — and the lone forward action names the
    // destination up front: "Next: <next step label>" instead of a bare
    // "Next". Both regress to smoke's OLD 1489/9a25e91 assumption of a
    // permanent, always-present (if disabled) Back button, which no longer
    // holds on step 1.
    check((await page.locator(".quick-start__back").count()) === 0, "no Back button at all on the very first step (mobile)");
    check(
      /Next: Text/.test((await nextBtn.textContent()) ?? ""),
      "the first step's lone Next button names the destination: \"Next: Text\""
    );

    await nextBtn.click(); // Size -> Text
    check((await chips.nth(1).getAttribute("aria-current")) === "step", "Next advances to the second step on mobile");
    check((await paramRow(page, "label").count()) > 0, "the Text step's own param appears once current");
    check((await paramRow(page, "width").count()) === 0, "the previous step's param is no longer shown (one step at a time)");
    // Back reappears from the second step on: only the very first step omits it.
    check((await page.locator(".quick-start__back").count()) === 1, "Back button present once past the first step (mobile)");
    check(
      (await nextBtn.textContent()) === "Next",
      "the second step's Next button reads the bare \"Next\" (Back is alongside it, no destination naming needed)"
    );

    // Chip jump still works directly too (free navigation, not a wizard).
    await chips.nth(0).click();
    check((await chips.nth(0).getAttribute("aria-current")) === "step", "clicking a chip jumps directly to it on mobile");
    check((await paramRow(page, "width").count()) > 0, "jumping back via chip shows that step's params again");

    await runAxe(page, check, "QuickStart visible on mobile (steps mode)");

    // Walk forward through every real step via Next to the terminal Review
    // stage (PR18): the LAST real step's Next button reads "Next: Review"
    // (was "Next: Export"), and clicking it actually lands on the Review
    // stage's own content — the same stage scroll mode shows all at once,
    // here reached one step at a time like every other mobile step.
    await chips.nth(0).click(); // back to Size, a known starting point
    for (let i = 0; i < 3; i++) await nextBtn.click(); // Size -> Text -> Emblem -> Hanging hole
    check(
      /Next: Review/.test((await nextBtn.textContent()) ?? ""),
      "the last real step's Next button reads \"Next: Review\""
    );
    await nextBtn.click(); // Hanging hole -> Review
    check((await page.locator(".quick-start__review").count()) === 1, "\"Next: Review\" walks to the Review step on mobile");
    check((await page.locator(".quick-start__back").count()) === 1, "Back is still reachable from the Review step");
    check((await page.locator(".quick-start__next").count()) === 0, "no Next button once the Review step is current");
    check(
      /Ready to download/.test((await page.locator(".quick-start__review-readiness").textContent()) ?? ""),
      "mobile Review stage shows the same readiness line as desktop"
    );

    await runAxe(page, check, "QuickStart Review stage visible on mobile (steps mode)");
  });
}

// @showIf + @collapsed — exercised on the example "tag" design when present.
// Param rows are located by their stable data-param hook, which exists
// regardless of ui.showVarName, so this block runs in every config.
async function checkTagDesign({ page, check, ids, paramsTabName }) {
  if (!ids.includes("tag")) return;
  console.log("=== conditional visibility (@showIf, tag) ===");
  await selectDesign(page, "tag");
  // A bundled preset may still be selected from the earlier presets check —
  // while one is selected, the preset-diff strip's restore action reverts to
  // the PRESET rather than the design's defaults (see PresetDiffBar), which
  // would break the deterministic "Reset to defaults" flow below. Clear the
  // selection via a fresh reload before driving the rest of this design.
  await page.evaluate(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    params.delete("p");
    history.replaceState(null, "", "#" + params.toString());
  });
  await page.reload({ waitUntil: "load" });
  await waitRendered(page, "tag reloaded");
  // Back to the Customize tab (the file-import test left the panel on Files).
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});
  // "Quality" (facet_angle/facet_size) is @advanced — the config's guided
  // default starts in the essentials view, which hides it entirely. Switch to
  // All settings so the @showIf/@collapsed checks below see it at all; the
  // essentials-view behavior itself is covered by checkSettingsView.
  await switchSettingsView(page, "all");

  // @collapsed: the "Quality" group starts folded; its params are hidden
  // until the group header is opened.
  const quality = page.locator("details.param-group", {
    has: page.locator("summary", { hasText: "Quality" }),
  });
  check((await quality.count()) === 1, "Quality group is collapsible");
  const facet = paramRow(page, "facet_angle");
  check(!(await facet.isVisible()), "collapsed @collapsed group hides its params");
  await quality.locator("summary").click();
  check(await facet.isVisible(), "opening the group reveals its params");

  // Boolean params are switches now — toggle by click, read aria-checked.
  const holeSwitch = paramRow(page, "hole").getByRole("switch");
  if ((await holeSwitch.getAttribute("aria-checked")) !== "true")
    await holeSwitch.click(); // ensure on (an applied preset may have turned it off)
  const hd = paramRow(page, "hole_diameter");
  await hd.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  check((await hd.count()) > 0, "hole_diameter shown when hole on");
  await holeSwitch.click();
  await hd.first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  check((await hd.count()) === 0, "hole_diameter hidden when hole off");

  console.log("=== notice + assert badges on the OpenSCAD output panel (tag) ===");
  // Start from known defaults (also re-checks `hole` toggled off above).
  await resetDefaults(page);
  await waitRendered(page, "tag");

  // Wait for a DOM predicate (returns false on timeout instead of throwing)
  // — a param edit only re-renders after a debounce, and the status text can
  // still read "N ms" from the previous render, so we wait on the result.
  const waitFor = async (fn) => {
    try {
      await page.waitForFunction(fn, { timeout: 30000 });
      return true;
    } catch {
      return false;
    }
  };

  // Engraving the label trips the design's `note` category (a config-driven
  // notice). The console auto-opens on the first notice; open it explicitly
  // in case it was already showing earlier notices (no badge in the top bar).
  await paramRow(page, "engrave_text").getByRole("switch").click();
  await openConsole(page);
  check(
    await waitFor(() =>
      /engraved/.test(document.querySelector(".output-console")?.textContent || "")
    ),
    "the engrave note is surfaced as a diagnostic"
  );
  // Close the console again
  await page.click('.output-console__close').catch(() => {});

  // Making the engraving deeper than the plate trips a hard assert(): the
  // render fails and the hardcoded "asserts" badge appears.
  const setNum = (name, value) => setNumField(page, name, value);
  // Quality (facet_angle/facet_size) is @advanced and untouched (still at its
  // defaults) — switch back to the essentials view so the friendly-error
  // checks below exercise the real "nothing hidden differs from defaults"
  // case, not the trivially-empty "all settings" case (hiddenAdvancedDiff is
  // always [] in "all" — see paramFilter.ts). This (re-)mounts QuickStart
  // fresh (tag is a stepped design), starting on its first step ("Size",
  // which holds `thickness`). Desktop scroll mode (PR15) already mounts
  // every step's params at once, so `text_depth` (the "Text" step) exists
  // regardless — click its chip anyway, both to exercise chip navigation
  // here too and to keep this check meaningful if a future variant reverts
  // to mounting only the current step's ParamRows.
  await switchSettingsView(page, "essentials");
  await setNum("thickness", 1);
  if (await page.locator(".quick-start").count())
    await page.locator(".quick-start__step").filter({ hasText: "Text" }).first().click();
  await setNum("text_depth", 2);
  check(
    await waitFor(() =>
      /Failed/.test(document.querySelector(".render-status")?.textContent || "")
    ),
    "the failed assert render reports a render failure"
  );
  // The console surfaces the assert as an "asserts" count badge in its header.
  await openConsole(page);
  check(
    await waitFor(() => document.querySelector(".badge-assert") !== null),
    "an assert failure raises an asserts badge"
  );

  console.log("=== friendly render-failure summary (tag) ===");
  check(
    (await page.locator(".friendly-error").count()) === 1,
    "the friendly error card is shown in Notices on a failed render"
  );
  const friendlyText = await page.locator(".friendly-error").innerText();
  check(
    friendlyText.includes(
      "engraved text is deeper than the plate is thick; reduce text depth or thicken the plate"
    ),
    "the friendly error's body is the assert's authored message, verbatim and unquoted"
  );
  // A successful tag render preceded this failure, so the pipeline retains
  // it: the reassurance line must be present AND true — the viewer keeps the
  // last good geometry (dimmed) instead of clearing to an empty canvas.
  check(
    friendlyText.includes("Your last working preview is still shown"),
    "the reassurance line is shown (a previous successful render is retained)"
  );
  check(
    (await page.locator(".viewer-wrap .opacity-55").count()) > 0,
    "the retained last-good geometry is displayed dimmed while the latest render failed"
  );
  check(
    (await page.locator(".friendly-error").getByRole("button", { name: "Review hidden settings" }).count()) === 0,
    "Quality (advanced, still default) means no hidden setting differs, so 'Review hidden settings' is not offered"
  );
  await page.locator(".friendly-error").getByText("Show raw output").click();
  const technicalText = await page.locator(".friendly-error details").innerText();
  check(
    /Assertion '.*' failed/.test(technicalText),
    "the raw-output disclosure reveals the raw assertion line"
  );
  await runAxe(page, check, "Notices tab: friendly-error card visible");

  // Restore a clean, rendering state for the checks that follow — and confirm
  // the canvas recovers: the render succeeds again, the friendly card clears,
  // and the retained-geometry dimming lifts.
  await resetDefaults(page);
  await waitRendered(page, "tag");
  check(
    await waitFor(() => document.querySelector(".friendly-error") === null),
    "the friendly error card clears once a render succeeds again"
  );
  check(
    (await page.locator(".viewer-wrap .opacity-55").count()) === 0,
    "the dimmed retained-geometry treatment lifts after recovery"
  );
}

// Production-readiness attention surfacing (PR13; consolidated PR22;
// rebuilt again by the visual-alignment pass): a design can render
// successfully while its selected font family isn't loaded — Fontconfig
// silently substitutes a fallback, and dimensions/spacing can shift, yet
// nothing about the render itself failed. "Rendered" and "ready to ship" are
// different claims (src/lib/readiness.ts); this exercises the whole path:
// AttentionItems.tsx's ONE
// warning-card treatment reused in its three surfaces (ParamRows' contextual
// `.font-missing` card right under the control, the Notices tab's
// `.console-attention`, and the Review stage's `.quick-start__review-
// attention` — the top-of-panel attention chip this used to also appear in
// is gone entirely, see CustomizeTab.tsx's own doc), Download's own small
// amber attention dot + sr-only hint (dock-unification pass — replacing the
// tabs-mode-only standing `.export-attention` banner this used to check;
// every workflow now carries the same dot + hint ActionButtons.tsx always
// rendered for guided workflow), and the Review stage's rebuilt actions row
// (no separate "Font status" row
// anymore — a font's current family already shows as an ordinary
// essential-parameter row in the summary). Runs against the desktop `page`
// (scroll mode, PR15): every step's ParamRows is already mounted, so "the
// jump" is really a scroll+focus of the font control itself rather than a
// step swap — QuickStart still moves `aria-current` to "Text" alongside it
// (see QuickStart.tsx's focusParam effect), which the assertions below still
// check for.
async function checkReadiness({ page, check, ids, base, paramsTabName }) {
  if (!ids.includes("tag")) return;
  console.log("=== production readiness: font-fallback attention ===");

  // A URL hash directly encodes the missing-font override — see
  // src/lib/urlState.ts's "d=/v=/p=" encoding (`v` is a JSON diff-from-
  // defaults object). Navigating to a URL differing only by its hash is a
  // same-document navigation (App.tsx's own `hashchange` listener applies
  // it via applyExternalState) rather than a fresh module load, which would
  // leave session-only state (paramInteracted etc., carried over from
  // earlier checks in this suite) stale — so `goto` then an explicit
  // `reload` to force a genuine fresh mount that re-derives EVERYTHING
  // (including those session flags) from this hash, same as a visitor
  // opening the link fresh. Every first-visit once-flag it could trip
  // (welcome popup dismissal) was already persisted by earlier checks in
  // this suite, so nothing blocks driving the UI here. Only `font` differs
  // from the design's shipped defaults, so
  // the "1 alert + 1 note" the tag design fires out of the box (see its own
  // "Configurator notices" comment) is present here too — reused below for
  // the singular-badge check (item 5).
  const hash = `d=tag&v=${encodeURIComponent(JSON.stringify({ font: "No Such Font" }))}`;
  await page.goto(`${base}#${hash}`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "tag with a missing font family");

  // The contextual warning card (visual-alignment pass — AttentionItems.tsx,
  // reused verbatim in three places): right under the font control itself,
  // via ParamRows' `.font-missing` synthetic single-item card. Replaces the
  // old top-of-panel attention chip entirely (CustomizeTab.tsx: "the
  // top-of-panel attention chip that used to live here is gone"). Scroll
  // mode mounts every step's ParamRows at once, so the Text step's own font
  // control (and its card) already exist without navigating there first.
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});
  const fontMissingCard = page.locator(".font-missing");
  await fontMissingCard.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await fontMissingCard.count()) === 1, "exactly one contextual font-missing card shown, right under the control");
  check(
    ((await fontMissingCard.textContent()) ?? "").includes("No Such Font"),
    "the contextual card names the missing family"
  );
  check(
    (await fontMissingCard.getByRole("button", { name: /Import font/i }).count()) === 1,
    "the contextual card offers \"Import font\""
  );
  check(
    (await fontMissingCard.getByRole("button", { name: "Use a bundled font" }).count()) === 1,
    "the contextual card ALSO offers \"Use a bundled font\" since a bundled family is available"
  );
  check(
    (await fontMissingCard.getByRole("button", { name: "Go to setting" }).count()) === 0,
    "the contextual card omits \"Go to setting\" — the visitor is already at the control"
  );

  // The export dock's attention signal (dock-unification pass): no standing
  // "N issues to review" banner over the viewer anymore, in ANY workflow —
  // Download's own small amber dot + a sr-only hint (wired via
  // aria-describedby) carry it instead, the same treatment guided workflow
  // always used (see ActionButtons.tsx's own doc). Export stays enabled and
  // uninterrupted throughout — it's a caution, never a block, in tabs mode.
  const exportBtn = page.locator(".action-export");
  check((await page.locator(".export-attention").count()) === 0, "no standing \"N issues to review\" banner over the viewer");
  check(await exportBtn.isEnabled(), "export stays enabled despite the unresolved issue");
  check(
    (await exportBtn.getAttribute("aria-describedby")) === "export-attention-hint",
    "Download is described by the sr-only attention hint for assistive tech"
  );
  const attentionDot = exportBtn.locator(".action-export__attention");
  check((await attentionDot.count()) === 1, "Download shows its small amber attention dot");
  const attentionHint = page.locator("#export-attention-hint");
  check((await attentionHint.count()) === 1, "the sr-only attention hint element exists (what aria-describedby resolves to)");
  check(
    ((await attentionHint.textContent()) ?? "").trim() === "1 issue to review before download",
    "the sr-only hint reads the plain \"N issue(s) to review before download\" count, no per-item text"
  );

  await runAxe(page, check, "Customize tab with the font-missing card visible");

  // Notices tab: the same gap leads as a friendly card, above the raw rows
  // (PR22 item 4) — a visitor who opens Messages directly still gets the
  // readable summary, not just parsed log lines. Also where the singular-
  // labelOne badge (item 5) is reliably drivable: the shipped tag defaults
  // fire exactly one alert and one note (see the hash comment above). Unlike
  // the contextual card, Messages isn't anchored near any control, so this
  // is the one AttentionItems instance that DOES offer "Go to setting"
  // (AttentionItems.tsx's own doc) — exercised below.
  await openConsole(page);
  const consoleAttention = page.locator(".console-attention");
  await consoleAttention.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await consoleAttention.count()) === 1, "the Notices tab shows one friendly attention card block");
  check(
    ((await consoleAttention.textContent()) ?? "").includes("No Such Font"),
    "the friendly attention card names the missing family, same as the contextual card"
  );
  check(
    (await consoleAttention.getByRole("button", { name: "Use a bundled font" }).count()) === 1,
    "the friendly attention card offers \"Use a bundled font\" too"
  );
  check(
    (await consoleAttention.getByRole("button", { name: "Go to setting" }).count()) === 1,
    "the friendly attention card (only, of the three AttentionItems instances) offers \"Go to setting\", since Messages isn't anchored near the control"
  );
  const attentionBox = await consoleAttention.boundingBox();
  const rawRowsBox = await page.locator(".output-console ul, .output-console p").first().boundingBox();
  check(
    !!attentionBox && !!rawRowsBox && attentionBox.y <= rawRowsBox.y,
    "the friendly attention card leads the raw notices rows, not the other way around"
  );
  check(
    (await page.locator('.output-console [aria-label="1 alert"]').count()) === 1,
    "the alert count badge's accessible name uses the singular labelOne (\"1 alert\", not \"1 alerts\")"
  );
  check(
    (await page.locator('.output-console [aria-label="1 note"]').count()) === 1,
    "the note count badge's accessible name uses the singular labelOne (\"1 note\", not \"1 notes\") too"
  );
  await runAxe(page, check, "Notices tab with the friendly attention card visible");

  // "Go to setting": tag mounts QuickStart on its first ("Size") step by
  // default on a fresh design view — the font control lives on "Text", a
  // DIFFERENT step — so this also exercises QuickStart's own step-jump
  // composition, not just a scroll on an already-visible control.
  await consoleAttention.getByRole("button", { name: "Go to setting" }).click();
  await page
    .waitForFunction(() => document.activeElement?.classList.contains("font-select"), { timeout: 3000 })
    .catch(() => {});
  check(
    await page.evaluate(() => document.activeElement?.classList.contains("font-select")),
    "\"Go to setting\" switches to the Text step and focuses the font control"
  );
  check(
    ((await page.locator(".quick-start__step--current").textContent()) ?? "").includes("Text"),
    "QuickStart's current step actually switched to Text"
  );
  // AppShell closes Messages as part of that jump (the same "go to setting"
  // signal the friendly-error card's own action uses) — confirm nothing is
  // left stacked over the panel.
  check((await page.locator(".output-console").count()) === 0, "\"Go to setting\" also closes Messages");

  // The Review stage (rebuilt by the visual-alignment pass) surfaces the
  // same gap a third time: its own readiness line and warning card — no
  // separate "Font status" row anymore (a font's current family already
  // shows as an ordinary essential-parameter row in the summary; see
  // ReviewContent's own doc in QuickStart.tsx) — plus a single "Open font
  // settings" link in the actions row (replacing any per-item "Go to
  // setting" there, which would just duplicate it — see the fix alongside
  // this rewrite). Scroll mode mounts every step's group at once (including
  // the trailing Review section), so these are already in the DOM regardless
  // of which chip is "current" — no navigation needed.
  check(
    /Needs attention/.test((await page.locator(".quick-start__review-readiness").textContent()) ?? ""),
    "Review's readiness line reads \"Needs attention\" while the font fallback is unresolved"
  );
  check(
    (await page.locator(".quick-start__review-font").count()) === 0,
    "there is no separate \"Font status\" row anymore — the font shows as an ordinary essential-parameter row in the summary"
  );
  const reviewAttentionCard = page.locator(".quick-start__review-attention");
  check(
    ((await reviewAttentionCard.textContent()) ?? "").includes("No Such Font"),
    "Review's own warning card names the missing family too"
  );
  check(
    (await reviewAttentionCard.getByRole("button", { name: "Go to setting" }).count()) === 0,
    "Review's warning card omits a per-item \"Go to setting\" — the actions row's own link covers it once"
  );
  const openFontSettingsLink = page.locator(".quick-start__review-open-setting");
  check((await openFontSettingsLink.count()) === 1, "Review's actions row offers a single \"Open font settings\" link");
  check(
    (await page.locator(".quick-start__review-ready").count()) === 0,
    "the \"Ready for download\" strip is NOT shown while there's something to review"
  );
  check(
    ((await page.locator(".quick-start__review-export").textContent()) ?? "").trim() === "Download anyway",
    "Review's own primary Export button reads \"Download anyway\" while attention items exist"
  );

  // PR23 item 4, the attention-present variant: confirm the full block order
  // with every optional block actually present (the warning card in place of
  // the ready strip this time).
  await reviewBlockOrder(page.locator(".quick-start__review").first(), check, {
    expectAttention: true,
    message:
      "with every optional block present, Review still renders readiness -> subtitle -> summary -> warning card -> actions",
  });

  // "Open font settings" (the actions-row link): a one-click jump back to
  // the font control, mirroring "Go to setting" above but from the Review
  // stage's own single link instead of Messages'.
  await openFontSettingsLink.click();
  await page
    .waitForFunction(() => document.activeElement?.classList.contains("font-select"), { timeout: 3000 })
    .catch(() => {});
  check(
    await page.evaluate(() => document.activeElement?.classList.contains("font-select")),
    "\"Open font settings\" focuses the font control"
  );

  // "Use a bundled font" (a one-click fix, not just a pointer — resolves the
  // issue in place, no manual dropdown needed) — via the contextual card,
  // right under the now-focused font control.
  await fontMissingCard.getByRole("button", { name: "Use a bundled font" }).click();
  await waitRendered(page, "tag with a bundled font restored via \"Use a bundled font\"");
  check((await page.locator(".font-missing").count()) === 0, "the contextual card clears once a loaded family is selected");
  check((await page.locator(".action-export__attention").count()) === 0, "Download's amber attention dot clears too");
  check(
    (await page.locator(".action-export").getAttribute("aria-describedby")) === null,
    "Download's aria-describedby clears once there's nothing to describe"
  );
  check(
    /Ready to download/.test((await page.locator(".quick-start__review-readiness").textContent()) ?? ""),
    "Review's readiness line returns to \"Ready to download\" once the font is restored"
  );
  check(
    (await page.locator(".quick-start__review-ready").count()) === 1,
    "the \"Ready for download\" strip returns once the font is resolved"
  );
  check(
    ((await page.locator(".quick-start__review-export").textContent()) ?? "").trim() === "Download for 3D printing",
    "Review's own primary Export button drops \"Download anyway\" back to the plain label once resolved"
  );
}

// @showIf arrow_style — exercised on a "signage" design when present. (No
// notice expectation here: a well-tuned config renders its defaults
// advisory-free; the notice/assert badge machinery is covered by "tag".)
// Params are located by their stable `data-param` hook, which exists
// regardless of ui.showVarName.
async function checkSignageDesign({ page, check, ids }) {
  if (!ids.includes("signage")) return;
  console.log("=== signage: @showIf arrow_style ===");
  await selectDesign(page, "signage");
  // arrow_style is relevant only once an arrow is chosen (`@showIf arrow != none`);
  // the signage default is arrow = "none", so it starts hidden.
  const arrowStyle = paramRow(page, "arrow_style");
  check((await arrowStyle.count()) === 0, "arrow_style hidden when arrow = none");
  // Enums are Radix Selects: open the row's trigger, then click the option.
  // Match exactly — several arrow options contain "right" (Up-right, Turn
  // right…), so a substring match would be ambiguous.
  await paramRow(page, "arrow").locator('[data-slot="select-trigger"]').click();
  await page.getByRole("option", { name: "Right", exact: true }).click();
  await arrowStyle.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  check((await arrowStyle.count()) > 0, "arrow_style shown when arrow = right");
  await waitRendered(page, "arrow");
}

// M7 + M16 (docs/architecture-review.md) + PR4 (guided mobile sheet policy):
// responsive layout mounting and mobile bottom-sheet focus behavior. These
// need a real mobile-sized viewport/context (the default page above is
// desktop-sized), so this opens its own context rather than reusing `page`.
// Covers:
//  - M7: exactly one interactive layout (ParamForm) is in the DOM at a given
//    breakpoint, and a breakpoint change preserves active tab, search text,
//    search focus, and (on the way back) the sheet's detent.
//  - M16: at Peek/Half the mobile background stays keyboard-reachable
//    (not `inert`); at Full it's `inert` and focus is trapped inside the
//    sheet — Tab never lands on a covered background control — with Escape
//    collapsing back out and focus returning to the sheet.
//  - PR4: the dogfood config sets guided experience + `mobileInitialSheet:
//    "half"` (scadpub.config.json), so a fresh mobile visit lands the sheet
//    at Half (not the long-standing Peek default) with a one-time
//    "Drag up for all settings" hint on the handle — dismissed by the first
//    detent change and never shown again (once-flag), even across a reload.
async function checkResponsiveLayout({ browser, base, check, paramsTabName }) {
  console.log("=== responsive layout: single mounted tree + state across a breakpoint change (M7) ===");
  await withMobileContext(browser, async (page) => {
    await page.goto(base, { waitUntil: "load" });
    await settleFirstVisit(page);
    await waitRenderDone(page).catch(() => {});

    // Only the active (mobile) layout is in the DOM — the desktop tree isn't
    // mounted at all.
    check(
      (await page.locator(".app-shell__mobile").count()) === 1 &&
        (await page.locator(".app-shell__desktop").count()) === 0,
      "mobile viewport mounts only the mobile layout tree"
    );

    // PR4: guided experience + mobileInitialSheet "half" (the dogfood config)
    // lands a fresh visit's sheet at Half, not Peek, with the one-time handle
    // hint showing.
    check((await page.locator(".bottom-sheet--half").count()) === 1, "guided+half policy starts the sheet at half");
    check((await page.locator(".sheet-hint").count()) === 1, "one-time sheet hint shows on first load");

    // Switch to the Parameters tab (the sheet is already at Half via the
    // policy above, so no handle tap is needed to raise it here). The design
    // may land on Presets (bundled presets), so ParamForm only mounts once
    // Parameters is active — Radix Tabs unmounts inactive tab content.
    await page.getByRole("tab", { name: paramsTabName }).first().click();
    await page.waitForSelector(".param-form", { timeout: 3000 });
    check((await page.locator(".param-form").count()) === 1, "exactly one ParamForm is mounted");

    // This check's own subject is state survival (search value + focus, tab,
    // sheet detent) across a breakpoint change — orthogonal to QuickStart.
    // The default landing design (tag) has QuickStart as its active guide
    // (guided + essentials + `@step`s), which now hides the search box until
    // a stage's advanced is revealed (H2) — none of tag's own steps have
    // one (see checkQuickStart's own note), so it isn't reachable here.
    // Switch to "coin" (no `@step`s, so QuickStart never engages) first,
    // purely so the search box this check actually cares about is present —
    // unrelated to what's being tested below.
    await selectDesign(page, "coin");
    await page.getByRole("tab", { name: paramsTabName }).first().click().catch(() => {});
    await page.waitForSelector(".param-form", { timeout: 3000 });

    // Type into the search box and leave it focused. AppShell's own "focus a
    // text-entry control while the sheet is at Half" effect (keeps the
    // on-screen keyboard from covering the field the visitor just tapped)
    // fires on this very click/focus, raising the sheet from Half to Full —
    // a real, intentional behavior this check has to account for below,
    // not fight.
    const mobileSearch = page.locator("#param-search-input");
    await mobileSearch.click();
    await mobileSearch.fill("thick");
    check(
      await page.evaluate((id) => document.activeElement?.id === id, "param-search-input"),
      "search input holds focus before the breakpoint change"
    );
    check(
      (await page.locator(".bottom-sheet--full").count()) === 1,
      "sanity: focusing the search field raised the sheet from Half to Full (its own focus-while-at-half effect)"
    );

    // Flip the breakpoint (a real device rotation crossing 860px would fire
    // the same matchMedia change useIsMobile listens for).
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector(".app-shell__desktop", { timeout: 3000 });
    check(
      (await page.locator(".app-shell__mobile").count()) === 0 &&
        (await page.locator(".param-form").count()) === 1,
      "switching to desktop remounts to a single layout tree"
    );
    check(
      (await page.locator("#param-search-input").inputValue()) === "thick",
      "search query survives the breakpoint change"
    );
    check(
      (await page.getByRole("tab", { name: paramsTabName }).first().getAttribute("aria-selected")) === "true",
      "active tab survives the breakpoint change"
    );
    // Poll rather than snapshot: the restore lands in a layout effect after
    // the desktop tree commits, and other mount-time focus (Radix tabs) can
    // hold the active element for a frame or two first. A bounded wait is
    // what a user experiences; a one-shot read here was a long-lived flake.
    const focusRestored = await page
      .waitForFunction((id) => document.activeElement?.id === id, "param-search-input", { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    check(focusRestored, "search focus is restored after the breakpoint change");

    // Back to mobile: the sheet detent set above (Full, via the focus effect
    // just confirmed — not Half) must not have reset to Peek just because
    // the layout remounted.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForSelector(".app-shell__mobile", { timeout: 3000 });
    check(
      (await page.locator(".bottom-sheet--full").count()) === 1,
      "sheet detent survives a round-trip breakpoint change"
    );

    console.log("=== mobile bottom sheet: focus at peek/half/full (M16) ===");
    // Peek/Half: non-modal — the background (top bar etc.) is not inert and
    // stays keyboard-reachable. Currently at Half (set above); cycle the
    // handle taps (cycleDetent order is peek -> half -> full -> peek) back to
    // Peek deterministically.
    for (let i = 0; i < 3 && !(await page.locator(".bottom-sheet--peek").count()); i++) {
      await page.locator(".sheet-handle").click();
      await page.waitForTimeout(50);
    }
    check((await page.locator(".bottom-sheet--peek").count()) === 1, "sheet returned to peek");
    // PR4: the loop above changed detents at least once (half -> full and/or
    // full -> peek) — the one-time hint must be dismissed by now.
    check((await page.locator(".sheet-hint").count()) === 0, "sheet hint is dismissed after a detent change");
    check(
      !(await page.locator(".app-shell__mobile-background").getAttribute("inert").catch(() => null)),
      "background is not inert at peek"
    );
    const outputBell = page.locator(".mobile-top-bar__output");
    await outputBell.focus();
    check(
      await page.evaluate(() => document.activeElement?.classList.contains("mobile-top-bar__output")),
      "a background control is keyboard-focusable at peek"
    );

    await page.locator(".sheet-handle").click(); // peek -> half
    await page.waitForSelector(".bottom-sheet--half", { timeout: 3000 });
    check(
      !(await page.locator(".app-shell__mobile-background").getAttribute("inert").catch(() => null)),
      "background is not inert at half"
    );

    // Full: modal — background goes inert, and Tab must never escape the sheet.
    await page.locator(".sheet-handle").click(); // half -> full
    await page.waitForSelector(".bottom-sheet--full", { timeout: 3000 });
    check(
      (await page.locator(".app-shell__mobile-background").getAttribute("inert")) === "",
      "background is inert at full"
    );
    check(
      await page.evaluate(() => {
        const sheet = document.querySelector(".bottom-sheet");
        const el = document.activeElement;
        return !!sheet && !!el && (sheet.contains(el) || el.classList.contains("sheet-scrim"));
      }),
      "focus moves into the sheet on entering full"
    );
    // Tab repeatedly (well past the sheet's focusable count) and confirm
    // focus never lands in the inert background or on <body>.
    let escaped = false;
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      escaped = await page.evaluate(() => {
        const sheet = document.querySelector(".bottom-sheet");
        const bg = document.querySelector(".app-shell__mobile-background");
        const el = document.activeElement;
        if (!el || el === document.body) return true;
        if (bg?.contains(el)) return true;
        return !(sheet?.contains(el) || el.classList.contains("sheet-scrim"));
      });
      if (escaped) break;
    }
    check(!escaped, "Tab never escapes the sheet (or lands on <body>) while full is modal");

    // Escape collapses the modal detent and un-inerts the background.
    await page.keyboard.press("Escape");
    await page.waitForSelector(".bottom-sheet--half", { timeout: 3000 });
    check(
      !(await page.locator(".app-shell__mobile-background").getAttribute("inert").catch(() => null)),
      "Escape collapses full and un-inerts the background"
    );

    // PR4: the hint's once-flag is a persisted (localStorage) preference —
    // reloading must not re-arm it, even though the guided+half policy still
    // lands the sheet at Half every time (it isn't itself persisted).
    await page.reload({ waitUntil: "load" });
    await settleFirstVisit(page);
    await waitRenderDone(page).catch(() => {});
    check(
      (await page.locator(".bottom-sheet--half").count()) === 1,
      "guided+half policy still starts the sheet at half after reload"
    );
    check(
      (await page.locator(".sheet-hint").count()) === 0,
      "sheet hint does not return after reload (once-flag)"
    );
  });
}

// PR16: mobile Messages is a full-height MODAL DIALOG, not a second bottom
// surface stacked over the persistent sheet (see AppShell.tsx's own doc on
// openOutput / the mobile JSX for the full rationale). Covers:
//  - opening via the bell mounts exactly one surface: the reused
//    <OutputConsole> lives INSIDE the dialog, and the sheet is hidden from
//    assistive tech (Radix's own hideOthers) while it's up — never two
//    stacked bottom surfaces.
//  - closing (the console's own `.output-console__close`, or Escape) leaves
//    the sheet's detent exactly where it was — nothing was ever moved by
//    opening it, so there's nothing to "restore".
//  - the bell still opens it (the toggle's close branch is exercised by the
//    desktop checks elsewhere in this suite — see openConsole/closeOutput —
//    since on mobile the bell sits UNDER the now-opaque dialog and can't be
//    clicked at all while it's open, same as every other modal in the app).
//  - the pre-existing auto-open-on-first-warning effect (AppShell's
//    hasProblem) still fires on mobile, still doesn't touch the sheet's
//    detent, and the one deliberate exception — stepping Full down to Half
//    so this dialog's focus trap doesn't stack under the sheet's own Full-
//    detent trap — actually holds a keyboard user inside a single trap.
//  - axe with the console open on mobile.
async function checkMobileOutputConsole({ browser, base, check, ids, paramsTabName }) {
  console.log("=== mobile Messages: one bottom surface at a time (PR16) ===");
  await withMobileContext(browser, async (page) => {
    const sheetInert = () =>
      page.evaluate(() => {
        let el = document.querySelector(".bottom-sheet");
        while (el) {
          if (el.getAttribute("aria-hidden") === "true") return true;
          el = el.parentElement;
        }
        return false;
      });
    await page.goto(base, { waitUntil: "load" });
    await settleFirstVisit(page);
    await waitRenderDone(page).catch(() => {});

    check((await page.locator(".output-console").count()) === 0, "Messages starts closed");
    // Guided+half policy (see checkResponsiveLayout) lands a fresh visit at Half.
    check((await page.locator(".bottom-sheet--half").count()) === 1, "sheet starts at half");

    console.log("--- opening via the bell ---");
    await page.locator(".mobile-top-bar__output").click();
    await page.waitForSelector('[role="dialog"]', { timeout: 3000 });
    check((await page.locator('[role="dialog"]').count()) === 1, "the bell opens a single modal dialog");
    check(
      (await page.locator('[role="dialog"] .output-console').count()) === 1,
      "the reused OutputConsole (Notices/Log/Metrics) lives INSIDE the dialog"
    );
    check((await page.locator(".output-console").count()) === 1, "exactly one .output-console in the DOM");
    check(await sheetInert(), "the sheet is hidden from assistive tech while the dialog is open — never two stacked surfaces");
    check(
      (await page.locator(".bottom-sheet--half").count()) === 1,
      "opening Messages left the sheet's own detent (half) untouched"
    );

    await runAxe(page, check, "mobile Messages open (modal dialog)");

    console.log("--- closing restores nothing, because nothing moved ---");
    await page.locator(".output-console__close").click();
    await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 3000 });
    check((await page.locator('[role="dialog"]').count()) === 0, "closing Messages removes the dialog");
    check(!(await sheetInert()), "the sheet is reachable again once the dialog is gone");
    check(
      (await page.locator(".bottom-sheet--half").count()) === 1,
      "the sheet is still exactly where it was (half) after closing"
    );

    if (ids.includes("tag")) {
      console.log("--- auto-open on the first warning/assert (AppShell's hasProblem effect) ---");
      await page.getByRole("tab", { name: paramsTabName }).first().click();
      await page.waitForSelector(".quick-start", { timeout: 5000 }).catch(() => {});
      if (await page.locator(".quick-start__step").count())
        await page.locator(".quick-start__step").filter({ hasText: "Text" }).first().click();

      // Raise the sheet to Full FIRST, driving the trip from controls INSIDE
      // it (not the top bar bell — M16 marks the background `inert` and
      // covers it with the sheet's own scrim at Full, so a bell click can
      // never reach it there in the first place; the sheet's own content
      // stays fully reachable at every detent, including Full). This is the
      // one path that actually exercises openOutput's Full -> Half step-down
      // (see its own doc in AppShell.tsx): the auto-open effect fires from
      // this state change, not a click, so it's a faithful repro of the only
      // way a maker could realistically hit "Messages wants to open while
      // the sheet already covers the screen at Full".
      for (let i = 0; i < 3 && !(await page.locator(".bottom-sheet--full").count()); i++) {
        await page.locator(".sheet-handle").click();
        await page.waitForTimeout(50);
      }
      check((await page.locator(".bottom-sheet--full").count()) === 1, "sheet reached full for this scenario");

      await paramRow(page, "engrave_text").getByRole("switch").click();
      // engrave_text && label != "" (default "ScadPub") && text_depth(3) >= thickness(3, default) -> assert.
      await setNumField(page, "text_depth", 3);
      await page
        .waitForFunction(() => /Failed/.test(document.querySelector(".render-status")?.textContent || ""), {
          timeout: 30000,
        })
        .catch(() => {});
      check(
        (await page.locator(".bottom-sheet--half").count()) === 1,
        "auto-opening Messages from Full steps the sheet down to Half (avoids the sheet's own Full-detent trap stacking under the dialog's)"
      );
      let escaped = false;
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press("Tab");
        escaped = await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]');
          const el = document.activeElement;
          return !el || el === document.body || !dialog?.contains(el);
        });
        if (escaped) break;
      }
      check(!escaped, "Tab never escapes the dialog while it's open (a single, unambiguous trap)");
      check(
        (await page.locator('[role="dialog"] .output-console').count()) === 1,
        "a failed-assert render auto-opens Messages as the same modal dialog, unprompted"
      );
      check(
        /engraved text is deeper than the plate/.test((await page.locator(".output-console").textContent()) ?? ""),
        "the auto-opened console shows the assert's own message"
      );
      await page.locator(".output-console__close").click();
      await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 3000 });
    }
  });
}

// Mobile action bar: single row, no wrap, real TEXT LABELS at typical phone
// widths (design review directive: "Use text labels, not unexplained image
// and chain-link icons" — icon-only is a last resort, not the default).
// ActionButtons.tsx is the exact same component/markup on both layouts (see
// its own doc) — only CSS (index.css's `.app-shell__mobile .action-cluster`/
// `.action-dock` rules) makes mobile behave differently: two tiers below
// ~460px shrink the primary's font/padding, and only below ~360px does
// Share drop to icon-only. Exactly two buttons (Download, Share) in every
// workflow now (dock-unification pass) — no split trigger, no "More" menu,
// no "Save image". Verified across the full mobile-layout breadth
// (320/360/390/430/600/820px — everything under the 860px desktop/mobile
// breakpoint, including the 460-859px "mobile-layout tablets" band the
// mid-range truncation bug lived in) rather than just the narrowest phone
// widths.
async function checkMobileActionBar({ browser, base, check }) {
  console.log("=== mobile action bar: single row, real text labels, no truncation (320-820px) ===");
  await withMobileContext(browser, async (page) => {
    await page.goto(base, { waitUntil: "load" });
    await settleFirstVisit(page);
    await waitRenderDone(page).catch(() => {});

    check((await page.locator(".action-more").count()) === 0, "no \"More\" menu on mobile either");
    check((await page.locator(".action-export-options").count()) === 0, "no split \"▾\" trigger on mobile either");

    // Whether an element's own text content is being clipped by CSS
    // (overflow:hidden + truncate) rather than laid out at its natural size —
    // the one thing the design review says must never happen to the primary
    // label's text, at ANY of these widths.
    const isTextClipped = (loc) =>
      loc.evaluate((el) => el.scrollWidth > el.clientWidth + 1).catch(() => false);
    // Whether an element is using the sr-only visually-hidden technique
    // (position:absolute; width:1px; height:1px; clip:rect(0,0,0,0) — see
    // index.css's tier-two `.action-btn-label` rule): Playwright's own
    // `.isVisible()` is the WRONG tool for this — that 1x1 box still has a
    // non-empty bounding rect and no display:none/visibility:hidden, so
    // Playwright reports it "visible" even though no sighted visitor can
    // read it. A real rendered label is comfortably wider than a couple of
    // pixels ("Share" at even the smallest font here measures 25px+), so a
    // tiny width threshold cleanly tells the two apart.
    const isSrOnlyHidden = (loc) =>
      loc.evaluate((el) => el.getBoundingClientRect().width <= 2).catch(() => true);

    for (const width of [320, 360, 390, 430, 600, 820]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(150); // let the reflow settle
      const box = await page.locator(".action-cluster").boundingBox();
      // A wrapped (two-row) cluster is roughly 2x a single row's height; a
      // single row measures well under this. 70px comfortably separates the
      // two cases without pinning an exact, font/DPI-brittle figure.
      check(!!box && box.height < 70, `action row is a single line at ${width}px (height ${box?.height})`);
      check(!!box && box.x >= 0 && box.x + box.width <= width, `action row stays within the ${width}px viewport`);
      check(
        !(await isTextClipped(page.locator(".action-export__label"))),
        `the primary "Download for 3D printing" label's TEXT is never truncated at ${width}px`
      );
      // Round-2 review fix (fa49bcb, item 4): the format sublabel is gone
      // from the markup entirely now (dock-unification pass) — never present
      // on desktop OR mobile, so there's nothing left to hide here.
      check(
        (await page.locator(".action-export-format-note").count()) === 0,
        `no "3MF · …" format sublabel in the DOM at ${width}px`
      );
      // Round-2 review fix (fa49bcb, item 2): HUD buttons drop to size-9
      // (36px) below the 860px breakpoint — every width in this loop
      // qualifies. See checkViewerHudGrid's own desktop-side (size-10) check.
      const hudBtnBox = await page.locator(".viewer-hud button").first().boundingBox();
      check(
        !!hudBtnBox && Math.round(hudBtnBox.width) === 36 && Math.round(hudBtnBox.height) === 36,
        `viewer HUD buttons are size-9 (36px) at ${width}px (measured ${hudBtnBox?.width}x${hudBtnBox?.height})`
      );

      const share = page.locator(".action-share");
      const shareLabelVisible = !(await isSrOnlyHidden(share.locator(".action-btn-label")));
      if (width >= 370) {
        // Typical phone widths and up: Share carries real text — no
        // unexplained icon-only chain-link glyph.
        check(shareLabelVisible, `Share shows its text label at ${width}px (>= ~370px)`);
      } else {
        // Only below ~360px does the last-resort icon-only fallback apply —
        // aria-label/title still carry the name for assistive tech (checked
        // below, once, since it's width-independent).
        check(!shareLabelVisible, `Share falls back to icon-only at ${width}px (< ~360px)`);
      }
    }

    console.log("--- Share stays reachable by aria-label even when icon-only ---");
    await page.setViewportSize({ width: 320, height: 844 });
    await page.waitForTimeout(150);
    const share = page.locator('[aria-label="Copy share link"]');
    check((await share.count()) === 1 && (await share.isVisible()), "Share is reachable by its aria-label");

    // Round-2 review fix (fa49bcb, item 3): the Share button's ICON is now
    // Share2 in EVERY case, including this deterministic copy-link fallback
    // (headless Chromium has no navigator.share) — it's still the Share
    // button, just backed by a different mechanism; the accessible name
    // (shareAria) still says "Copy share link" here, so the icon no longer
    // tracks the branch the way it used to (was Link2 in this fallback,
    // Share2 only for the native-share branch). lucide-react's default
    // per-icon class (`.lucide-share-2`) is a stable enough hook for this.
    const hasNativeShare = await page.evaluate(() => "share" in navigator);
    check(
      !hasNativeShare,
      "sanity: this headless browser has no navigator.share, so the copy-link fallback is the branch actually exercised"
    );
    check(
      (await share.locator(".lucide-share-2").count()) === 1,
      "Share shows the Share2 icon even in the copy-link fallback (no native share sheet here)"
    );

    console.log("--- export + the after-export panel still work (minimal — see checkExports for the full desktop flow) ---");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click(".action-export")]);
    check(!!dl, "Export still produces a download on the compact mobile bar");
    const successPanel = page.locator(".export-success");
    await successPanel.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
    check((await successPanel.count()) === 1, "the after-export panel still appears");
    const successBox = await successPanel.boundingBox();
    const clusterBox = await page.locator(".action-cluster").boundingBox();
    check(
      !!successBox && !!clusterBox && successBox.y + successBox.height <= clusterBox.y + 1,
      "the after-export panel rides above the action cluster (PR9's .action-dock), not overlapping it"
    );
  });
}

// Help modal mobile polish (PR19 item 4): the config-level intro collapses
// into a closed <details> "About" disclosure below the mobile breakpoint (so
// tabs + content lead instead of being pushed down), and the tab strip
// scrolls horizontally on one row instead of wrapping to several. Desktop is
// covered implicitly (untouched) by every other Help-modal check in this
// suite, which all run at the desktop viewport.
async function checkHelpModalMobile({ browser, base, check }) {
  console.log("=== Help modal (mobile): intro collapses to \"About\", tab strip scrolls without wrapping ===");
  await withMobileContext(browser, async (page) => {
    await page.goto(base, { waitUntil: "load" });
    await settleFirstVisit(page);
    await waitRenderDone(page).catch(() => {});

    // The mobile top bar collapses theme/help/licenses into a "⋮" overflow
    // popover (BarActions.tsx's `collapse` presentation) — open it first.
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("button", { name: "Help", exact: true }).click();
    const helpDialog = page.getByRole("dialog");
    await helpDialog.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});

    const about = helpDialog.locator("details.help-about");
    check((await about.count()) === 1, "the config intro renders as a collapsible <details> \"About\" disclosure on mobile");
    check(
      !(await about.evaluate((el) => el.open)),
      "the About disclosure starts collapsed, so the tabs aren't pushed down by it"
    );
    await about.locator("summary").click();
    check(await about.evaluate((el) => el.open), "tapping the summary opens the About disclosure");
    await about.locator("summary").click(); // collapse again before the rest of this check

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(150); // let the reflow settle
      const rows = await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll('[role="dialog"] [role="tab"]'));
        const tops = tabs.map((el) => el.getBoundingClientRect().top);
        return { count: tabs.length, sameRow: tops.every((y) => Math.abs(y - tops[0]) < 1) };
      });
      check(rows.count >= 3, `at least the config's ${rows.count} help tabs are present at ${width}px`);
      check(rows.sameRow, `all tab chips share one row at ${width}px — scrolling, not wrapping`);
      const overflowX = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      check(overflowX <= 0, `no horizontal page overflow at ${width}px (excess ${overflowX}px)`);
    }

    console.log("--- edge-fade affordance (PR23 item 3): appears/disappears with actual scroll position ---");
    // The loop above leaves the viewport at 320px, the narrowest case and the
    // one most likely to clip tabs.
    const scroller = page.locator(".help-tabs-scroll");
    const fadeState = () => scroller.getAttribute("data-fade");
    check(
      (await fadeState()) === "right" || (await fadeState()) === "both",
      `unscrolled tab strip fades the right edge only (saw "${await fadeState()}") — more topics are off-screen there, none to the left yet`
    );
    await scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await page.waitForTimeout(50); // the scroll listener is passive/async
    check(
      (await fadeState()) === "left",
      `scrolling all the way right flips the fade to the left edge only (saw "${await fadeState()}")`
    );
    await scroller.evaluate((el) => { el.scrollLeft = 0; });
    await page.waitForTimeout(50);

    console.log("--- tab strip keyboard operability: roving tabindex reaches every chip and scrolls it into view ---");
    const tabs = helpDialog.getByRole("tab");
    // Clicking a tab focuses AND activates it — the selection change swaps the
    // tab panel and re-derives Radix's roving tabindex asynchronously. Pressing
    // End before that settles was a recurring flake: wait until the click's
    // focus has actually landed, press End, then POLL for the focus move (a
    // keyboard user experiences the settled state, not the same-tick race).
    await tabs.first().click();
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("role") === "tab",
      null,
      { timeout: 2000 }
    );
    await page.keyboard.press("End"); // Radix roving focus: jump to the last tab
    const endMovedFocus = await tabs
      .last()
      .evaluate(
        (el) =>
          new Promise((resolve) => {
            const deadline = Date.now() + 2000;
            const tick = () => {
              if (document.activeElement === el) return resolve(true);
              if (Date.now() > deadline) return resolve(false);
              requestAnimationFrame(tick);
            };
            tick();
          })
      );
    // Same poll discipline as the focus check above: the browser performs the
    // focus-driven scroll in its own frame(s) after focus lands, so a one-shot
    // containment read here raced it (recurring flake).
    const lastVisible = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const deadline = Date.now() + 2000;
          const tick = () => {
            const scrollEl = document.querySelector(".help-tabs-scroll");
            const focused = document.activeElement;
            if (scrollEl && focused) {
              const box = focused.getBoundingClientRect();
              const scrollBox = scrollEl.getBoundingClientRect();
              if (box.left >= scrollBox.left - 1 && box.right <= scrollBox.right + 1) return resolve(true);
            }
            if (Date.now() > deadline) return resolve(false);
            requestAnimationFrame(tick);
          };
          tick();
        })
    );
    check(endMovedFocus, "pressing End on the tab strip moves focus to the last tab (Radix roving tabindex)");
    check(lastVisible, "the newly-focused last tab is scrolled fully into view, not left clipped off-screen");
    await page.keyboard.press("Home"); // leave the strip focused at the first tab for anything after this

    await runAxe(page, check, "Help modal open on mobile (About collapsed, tabs scrollable)");
    await page.keyboard.press("Escape");
  });
}

// F10: ORDERING — main()'s call sequence below isn't arbitrary; several
// checks are load-bearing on state (once-flags, Cache Storage, settings-view,
// …) a PRIOR check left behind, and reordering them would break that chain
// silently rather than loudly. This map collects the ordering rationale
// that's otherwise scattered across each check's own doc comment (kept in
// place below — this is a single point of reference, not a replacement for
// them) into one list, in main()'s actual call order:
//   1. checkOfflineClaimToast runs FIRST, before anything else reloads the
//      page or otherwise disturbs Cache Storage — it needs a genuine,
//      deterministic cache-MISS download to exercise the offline-claim toast
//      (see the sw.js route-block above and the check's own doc).
//   2. checkSettingsView leaves the panel in "All settings" for checkQuickStart
//      right after it (which switches to essentials to exercise QuickStart,
//      then switches back) — and, transitively, for every later check that
//      also expects the full, ungated panel: bundled presets' Import/Export
//      row and checkTagDesign's @showIf/@collapsed checks.
async function main() {
  const { server, port, basePath } = await startServer();
  const base = `http://127.0.0.1:${port}${basePath}`;
  const browser = await launchChromium();
  const page = await browser.newPage();
  // Block the service worker's own script (public/sw.js) for this whole run.
  // Its `install` handler independently warms the render worker's binary
  // cache (see sw.js's precacheBin) — on a fast loopback connection that
  // background fetch usually wins the race against the render worker's own
  // bootstrap download, leaving worker.ts with a Cache Storage HIT and no
  // `loadProgress` events. checkOfflineClaimToast below needs a genuine,
  // deterministic cache-miss download to exercise the offline-claim toast
  // (useAppNotices.ts) reliably; nothing else in this suite depends on an
  // actually-registered/controlling service worker (checkServiceWorker reads
  // sw.js's raw source via an HTTP GET, not through a live registration).
  await page.context().route("**/sw.js*", (route) => route.abort());
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let failures = 0;
  const check = (ok, msg) => console.log(`  ${ok ? "✅" : (failures++, "❌")} ${msg}`);
  const dir = await mkdtemp(join(tmpdir(), "scadpub-smoke-"));

  try {
    await page.goto(base, { waitUntil: "load" });

    // Design list comes from the generated schema (the picker is a Radix Select
    // with no native <option> elements in the DOM). Single-design configs have
    // no picker; treat them as a one-element list.
    const schema = JSON.parse(
      await readFile(fileURLToPath(new URL("../src/generated/designs.json", import.meta.url)), "utf-8")
    );
    const designs = schema.designs ?? [];
    for (const d of designs) designLabels[d.id] = d.label;
    // Panel tab names are config-overridable (ui.presetsLabel/parametersLabel).
    const presetsTabName = schema.ui?.presetsLabel || "Presets";
    const paramsTabName = schema.ui?.parametersLabel || "Customize";
    const ids = designs.map((d) => d.id);
    console.log(`=== designs (${ids.length || 1}): ${ids.join(", ") || "(single)"}  ===`);
    await waitRendered(page, ids[0]);

    const ctx = { page, browser, check, base, dir, schema, ids, presetsTabName, paramsTabName };
    // Runs first, before anything else reloads the page or otherwise disturbs
    // Cache Storage — see the check's own doc comment for why ordering matters.
    await checkOfflineClaimToast(ctx);
    await checkWelcomePopup(ctx);
    await checkViewerHint(ctx);
    await checkDesignPickerDialog(ctx);
    await checkSettingsView(ctx);
    await checkQuickStart(ctx);
    await checkFileImport(ctx);
    await checkFilesCards(ctx);
    await checkThemeToggle(ctx);
    await checkIdleRenderCount(ctx);
    await checkAxe(ctx);
    await checkEveryDesignRenders(ctx);
    await checkBundledPresets(ctx);
    await checkPresetImport(ctx);
    await checkPresetSaveReveal(ctx);
    await checkExportDock(ctx);
    await checkExports(ctx);
    await checkPreviewControls(ctx);
    await checkViewerHudGrid(ctx);
    await checkServiceWorker(ctx);
    await checkTagDesign(ctx);
    await checkReadiness(ctx);
    await checkFilesFontMissingCard(ctx);
    await checkSignageDesign(ctx);
    await checkResponsiveLayout(ctx);
    await checkQuickStartMobile(ctx);
    await checkMobileOutputConsole(ctx);
    await checkMobileActionBar(ctx);
    await checkHelpModalMobile(ctx);

    if (errors.length) {
      console.log("  page errors:", errors);
      failures += errors.length;
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failures === 0 ? "SMOKE PASS ✅" : `${failures} FAILURE(S) ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
