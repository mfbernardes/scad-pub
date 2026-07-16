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

// Configurable popup (schema.popup): a welcome notice on load. It overlays
// the app behind a modal backdrop that intercepts pointer events, so dismiss
// it before driving the UI — ticking "Don't show this again" (when the mode
// offers it) persists the dismissal so it stays gone across the reloads the
// later checks perform. The dialog's accessible name is the configured
// header, so look it up from the schema rather than hardcoding one config's.
async function checkWelcomePopup({ page, check, schema }) {
  console.log("=== welcome popup ===");
  if (schema.popup) {
    const popup = page.getByRole("dialog", { name: schema.popup.header });
    check((await popup.count()) > 0, "welcome popup shown on load");
    if (/\]\(/.test(schema.popup.body ?? "")) {
      check((await popup.getByRole("link").count()) > 0, "popup body renders its link");
    }
    // The primary button's label is config-driven (schema.popup.button), so read
    // it from the schema instead of hardcoding "OK".
    const buttonLabel = schema.popup.button ?? "OK";
    const cta = popup.getByRole("button", { name: buttonLabel, exact: true });
    check((await cta.count()) > 0, `popup shows its configured button "${buttonLabel}"`);
    const dontShow = popup.getByRole("checkbox");
    if (await dontShow.count()) await dontShow.check();
    await cta.click();
    await popup.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    // Named by the popup's own header, not a bare dialog-role count — with
    // `ui.gallery` on, the same click also opens DesignPickerDialog (a
    // *different* named dialog) in the same tick (see below), so "no dialog
    // at all" would be the wrong assertion there.
    check((await popup.count()) === 0, "popup dismissed");
    // The primary CTA also opens the design picker (when there's more than one
    // design) so the user's next step — choosing what to make — is obvious.
    // Which picker UI that is depends on `ui.gallery` (see DesignPickerDialog
    // vs. the classic dropdown Select in DesignPicker.tsx).
    if (schema.designs.length > 1) {
      if (schema.ui?.gallery) {
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
        // Close it so it doesn't intercept the later checks' interactions.
        await page.keyboard.press("Escape");
        await listbox.first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
      }
    }
  } else {
    console.log("  (no popup in this config — skipped)");
  }
}

// Getting-started checklist (PR8): a dismissible onboarding card, shown only
// in guided experience — the dogfood config's default (ui.experience.default)
// — above the panel's tab strip in both layouts. Runs immediately after the
// welcome popup (which only OPENS/closes the design picker via Escape,
// picking nothing) and before any other check switches design or settings
// view, so the "fresh visitor" assertions below are honest. Ends by
// restoring defaults so later checks see the same pristine state they'd
// otherwise expect.
async function checkGettingStarted({ page, check, ids, paramsTabName }) {
  console.log("=== getting-started checklist ===");
  const card = page.locator(".getting-started");
  check((await card.count()) === 1, "getting-started checklist shown on a fresh guided-experience load");

  const rows = card.locator("li");
  const expectedRowCount = ids.length > 1 ? 4 : 3;
  check(
    (await rows.count()) === expectedRowCount,
    `checklist shows ${expectedRowCount} row(s) for ${ids.length} design(s)`
  );
  const designRow = card.locator("li", { hasText: "Choose a design" });
  if (ids.length > 1) {
    check((await designRow.count()) === 1, "\"Choose a design\" row present for a multi-design build");
  }
  const reviewRow = card.locator("li", { hasText: "Review the essential settings" });
  const exportRow = card.locator("li", { hasText: "Export the model" });
  const previewRow = card.locator("li", { hasText: "Preview" });
  check(!/done/.test((await reviewRow.textContent()) ?? ""), "\"Review the essential settings\" starts pending");
  check(!/done/.test((await exportRow.textContent()) ?? ""), "\"Export the model\" starts pending");
  check(
    /ready/.test((await previewRow.textContent()) ?? ""),
    "\"Preview\" status row reads \"ready\" once the initial render has already succeeded"
  );

  await runAxe(page, check, "getting-started checklist visible");

  // A real param edit completes "Review the essential settings" — and, per
  // the documented rule (src/lib/checklist.ts), implicitly "Choose a design"
  // too (reviewing settings is only possible once a design is settled on).
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});
  const widthInput = paramRow(page, "width").locator('input[type="number"]');
  await widthInput.fill("95");
  await widthInput.blur();
  await waitRendered(page, "width edited (checklist)");
  check(/done/.test((await reviewRow.textContent()) ?? ""), "\"Review the essential settings\" completes on a real param edit");
  if (ids.length > 1) {
    check(
      /done/.test((await designRow.textContent()) ?? ""),
      "\"Choose a design\" completes implicitly once settings are reviewed"
    );
  }

  // Dismiss: hides the card and persists across a reload (the checklist.v1
  // once-flag) — settleFirstVisit's own `.getting-started__dismiss` click is
  // exercised by every OTHER check via its call at the top of main(); this
  // exercises the dismiss button itself and its persistence explicitly.
  await card.locator(".getting-started__dismiss").click();
  check((await card.count()) === 0, "dismiss hides the checklist");
  await page.reload({ waitUntil: "load" });
  await waitRendered(page, "reloaded after checklist dismiss");
  check((await page.locator(".getting-started").count()) === 0, "dismissal persists across a reload");

  // Help modal's replay row. Not selected by accessible name: Radix sets
  // aria-labelledby to the rendered DialogTitle (the modal's title text),
  // which wins over Modal's own aria-label prop per ARIA name computation —
  // only one dialog is open at this point, so an unfiltered role suffices.
  await page.getByRole("button", { name: "Help", exact: true }).click();
  const helpDialog = page.getByRole("dialog");
  await helpDialog.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  const replayBtn = helpDialog.getByRole("button", { name: /show the getting-started checklist again/i });
  check((await replayBtn.count()) === 1, "Help modal offers the \"show checklist again\" row");
  await replayBtn.click();
  await page.keyboard.press("Escape");
  await helpDialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  check((await page.locator(".getting-started").count()) === 1, "Help modal's replay row brings the checklist back");

  // Clean up: dismiss again and restore the width edited above, so later
  // checks see the same pristine defaults they'd otherwise expect.
  await page.locator(".getting-started__dismiss").click().catch(() => {});
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});
  await resetDefaults(page);
  await waitRendered(page, "defaults restored (checklist)");
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
  await page.addScriptTag({
    path: fileURLToPath(new URL("../node_modules/axe-core/axe.min.js", import.meta.url)),
  });
  // axe's color-contrast check reads *computed* colours. Several controls (the
  // tab chips especially) carry `transition-[color,box-shadow]`, and a theme
  // swap animates every colour token, so sampling an element mid-transition
  // yields an intermediate colour and a spurious contrast violation. A fixed
  // wait was flaky (the transition outlasts a short sleep on slower CI); wait
  // for all running CSS transitions/animations to actually settle instead.
  const settle = async () => {
    await page.waitForTimeout(50); // let a just-started transition register first
    await page
      .waitForFunction(
        () => document.getAnimations().every((a) => a.playState !== "running"),
        null,
        { timeout: 3000 }
      )
      .catch(() => {});
  };
  // Palettes are per-theme (and config-overridable per theme), so a contrast
  // regression can hide in whichever theme a single sweep doesn't visit: run
  // the AA sweep in the current theme, then toggle and sweep the other. The
  // second toggle also returns the app to the theme it started the section in.
  for (let pass = 0; pass < 2; pass++) {
    const theme = await page.getAttribute("html", "data-theme");
    await settle();
    const axeRes = await page.evaluate(async () =>
      // WCAG 2.1 AA tags; report only violations.
      window.axe.run(document, {
        resultTypes: ["violations"],
        runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      })
    );
    const serious = axeRes.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact)
    );
    for (const v of serious)
      console.log(`  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s)) -> ${v.nodes.map((n) => n.target.join(" ")).join("; ")}`);
    check(serious.length === 0, `axe (${theme}): ${serious.length} serious/critical violation(s)`);
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

// Export 3MF + PNG on the first design, plus the after-export panel it drives
// (PR9): the dogfood config sets `ui.afterExport.helpTab` ("Printing"), so
// every completed export here should surface the panel.
async function checkExports({ page, check, ids, dir }) {
  await selectDesign(page, ids[0]);
  console.log("=== export 3MF ===");
  const [model] = await Promise.all([
    page.waitForEvent("download"),
    // PR9: the CTA reads "Export 3D model" now, not "Download {format}" — the
    // label is expected to keep evolving, so smoke selects the stable
    // `.action-export` hook rather than the visible text/aria-label.
    page.click(".action-export"),
  ]);
  const modelOut = join(dir, await model.suggestedFilename());
  await model.saveAs(modelOut);
  check((await stat(modelOut)).size > 0, `${await model.suggestedFilename()} (${(await stat(modelOut)).size} bytes)`);
  check(
    (await page.getByLabel(/Export 3D model/i).count()) >= 1,
    "the renamed export CTA is present with its outcome-led label"
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

  console.log("=== save PNG ===");
  const [png] = await Promise.all([
    page.waitForEvent("download"),
    page.click('[aria-label="Save image"]'),
  ]);
  const pngOut = join(dir, await png.suggestedFilename());
  await png.saveAs(pngOut);
  const head = (await readFile(pngOut)).subarray(0, 4);
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  check(isPng && (await stat(pngOut)).size > 0, `${await png.suggestedFilename()} (png=${isPng})`);
  // The PNG snapshot is about a picture of the model, not the printable model
  // itself — it must never surface the export-success panel.
  check((await successPanel.count()) === 0, "Image export does not show the export-success panel");
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

// Click the essentials/all settings-view segmented control (CustomizeTab /
// SettingsViewToggle) — present only when the active design has at least one
// @advanced param. No-op (rather than a throw) when it's absent, so callers
// that run against a design/config without any advanced params stay safe.
async function switchSettingsView(page, view) {
  const label = view === "all" ? "All settings" : "Essential settings";
  const btn = page.locator(".settings-view-toggle").getByRole("button", { name: label, exact: true });
  if (await btn.count()) await btn.click();
}

// A standalone axe-core sweep (WCAG 2.1 AA, serious/critical only), reusable
// outside the dedicated checkAxe() pass below — used by checkSettingsView to
// confirm both the essentials and All settings states of the Customize tab
// are accessible, not just the default state checkAxe() happens to catch.
async function runAxe(page, check, label) {
  await page.addScriptTag({
    path: fileURLToPath(new URL("../node_modules/axe-core/axe.min.js", import.meta.url)),
  });
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

// Essentials/all settings view (the essentials/beginner milestone): the
// dogfood config's guided default (ui.experience.default) starts a FRESH
// visitor on the essentials view, which hides every @advanced param — tag's
// Quality section (facet_angle/facet_size). Must run before any other check
// has touched the settingsView preference (it reads the still-fresh page
// straight after the welcome popup is dismissed), and deliberately ends with
// the choice persisted as "all" — later checks (bundled presets' Import/
// Export row, the @showIf/@collapsed checks in checkTagDesign) expect the
// full, ungated panel.
async function checkSettingsView({ page, check, ids, paramsTabName }) {
  if (!ids.includes("tag")) return;
  console.log("=== settings view (essentials/all) ===");
  await selectDesign(page, "tag");
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
  await runAxe(page, check, "essentials view, tag Customize tab");

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
  await runAxe(page, check, "all settings view, tag Customize tab");

  // The switch persists across a reload.
  await page.reload({ waitUntil: "load" });
  await waitRendered(page, "tag reloaded (settings view)");
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

// QuickStart step navigation (this milestone, PR11): shown instead of the
// classic scrolling form when guided + essentials + a stepped design (tag,
// via examples/tag.scad's `@step` annotations) + `ui.quickStart` (default
// true). Runs right after checkSettingsView, which conveniently leaves the
// suite on "All settings" — switch to essentials here to exercise QuickStart,
// and leave the suite back on "All settings" at the end (per
// checkSettingsView's own comment, later checks — bundled presets' Import/
// Export row, checkTagDesign's @showIf/@collapsed checks — expect the full,
// ungated panel).
async function checkQuickStart({ page, check, ids, paramsTabName }) {
  if (!ids.includes("tag")) return;
  console.log("=== QuickStart step navigation ===");
  await selectDesign(page, "tag");
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});
  await switchSettingsView(page, "essentials");

  const quickStart = page.locator(".quick-start");
  await quickStart.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await quickStart.count()) === 1, "QuickStart shown in guided + essentials for a stepped design (tag)");

  const chips = page.locator(".quick-start__step");
  check((await chips.count()) === 5, "5 chips shown (4 @step sections + Export)");
  check((await chips.nth(0).getAttribute("aria-current")) === "step", "the first step chip starts current");

  await runAxe(page, check, "QuickStart visible (essentials view, tag)");

  // Next walks steps: size -> text -> emblem -> hole -> Export.
  const nextBtn = page.locator(".quick-start__next");
  await nextBtn.click();
  check((await chips.nth(1).getAttribute("aria-current")) === "step", "Next advances to the second step");

  // A param edit inside the current step re-renders the preview — the same
  // pipeline as the classic form, just mounted through ParamRows' flat
  // chrome here (the "text" step is current after the Next click above).
  const labelInput = paramRow(page, "label").locator('input[type="text"]');
  if (await labelInput.count()) {
    await labelInput.fill("QuickStart");
    await labelInput.blur();
    await waitRendered(page, "quickstart param edit");
  }

  await nextBtn.click(); // -> emblem
  await nextBtn.click(); // -> hole (the last real step)
  check(
    ((await nextBtn.textContent()) ?? "").trim() === "Next: Export",
    "Next reads \"Next: Export\" on the last step"
  );
  await nextBtn.click(); // -> Export chip
  check((await chips.last().getAttribute("aria-current")) === "step", "Next from the last step lands on the Export chip");
  check((await page.locator(".quick-start__next").count()) === 0, "no Next button on the Export chip");
  check(
    /Export 3D model/.test((await page.locator(".quick-start__export").textContent()) ?? ""),
    "the Export chip's content points at the Export action rather than duplicating it"
  );

  // Jump via chip: clicking a chip directly jumps there (free navigation).
  await chips.nth(0).click();
  check((await chips.nth(0).getAttribute("aria-current")) === "step", "clicking a chip jumps directly to it");

  // All settings escape: switching to All settings shows the classic form
  // (and facet_angle — the @advanced Quality section, per PR3's toggle
  // behavior) instead of QuickStart; switching back to essentials brings
  // QuickStart back.
  await switchSettingsView(page, "all");
  check((await page.locator(".quick-start").count()) === 0, "All settings shows the classic form, not QuickStart");
  check((await paramRow(page, "facet_angle").count()) > 0, "facet_angle (advanced) is reachable in All settings");
  await switchSettingsView(page, "essentials");
  await quickStart.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await page.locator(".quick-start").count()) === 1, "QuickStart returns when switching back to essentials");

  // Search interplay: typing a query bypasses QuickStart for the classic
  // filtered form; clearing it restores QuickStart.
  const search = page.locator("#param-search-input");
  await search.fill("width");
  await page.locator(".quick-start").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  check((await page.locator(".quick-start").count()) === 0, "a search query shows the classic filtered form, not QuickStart");
  check((await paramRow(page, "width").count()) > 0, "the search actually filters to the matching param");
  await search.fill("");
  await quickStart.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await page.locator(".quick-start").count()) === 1, "clearing the search restores QuickStart");

  // Leave the suite in All settings for the checks that follow.
  await switchSettingsView(page, "all");
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
  const setNum = async (name, value) => {
    const input = paramRow(page, name).locator('input[type="number"]');
    await input.fill(String(value));
    await input.blur();
  };
  // Quality (facet_angle/facet_size) is @advanced and untouched (still at its
  // defaults) — switch back to the essentials view so the friendly-error
  // checks below exercise the real "nothing hidden differs from defaults"
  // case, not the trivially-empty "all settings" case (hiddenAdvancedDiff is
  // always [] in "all" — see paramFilter.ts). This (re-)mounts QuickStart
  // fresh (tag is a stepped design), starting on its first step ("Size",
  // which holds `thickness`) — jump to the "Text" step's chip before editing
  // `text_depth`, which QuickStart only mounts for the CURRENT step.
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
  await page.locator(".friendly-error").getByText("Show technical details").click();
  const technicalText = await page.locator(".friendly-error details").innerText();
  check(
    /Assertion '.*' failed/.test(technicalText),
    "the technical details disclosure reveals the raw assertion line"
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
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
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

    // Type into the search box and leave it focused.
    const mobileSearch = page.locator("#param-search-input");
    await mobileSearch.click();
    await mobileSearch.fill("thick");
    check(
      await page.evaluate((id) => document.activeElement?.id === id, "param-search-input"),
      "search input holds focus before the breakpoint change"
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
    check(
      await page.evaluate((id) => document.activeElement?.id === id, "param-search-input"),
      "search focus is restored after the breakpoint change"
    );

    // Back to mobile: the sheet detent set above (Half) must not have reset
    // to Peek just because the layout remounted.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForSelector(".app-shell__mobile", { timeout: 3000 });
    check(
      (await page.locator(".bottom-sheet--half").count()) === 1,
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
  } finally {
    await context.close();
  }
}

async function main() {
  const { server, port, basePath } = await startServer();
  const base = `http://127.0.0.1:${port}${basePath}`;
  const browser = await launchChromium();
  const page = await browser.newPage();
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
    await checkWelcomePopup(ctx);
    await checkGettingStarted(ctx);
    await checkViewerHint(ctx);
    await checkDesignPickerDialog(ctx);
    await checkSettingsView(ctx);
    await checkQuickStart(ctx);
    await checkFileImport(ctx);
    await checkThemeToggle(ctx);
    await checkIdleRenderCount(ctx);
    await checkAxe(ctx);
    await checkEveryDesignRenders(ctx);
    await checkBundledPresets(ctx);
    await checkPresetImport(ctx);
    await checkExports(ctx);
    await checkPreviewControls(ctx);
    await checkServiceWorker(ctx);
    await checkTagDesign(ctx);
    await checkSignageDesign(ctx);
    await checkResponsiveLayout(ctx);

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
