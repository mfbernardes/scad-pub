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
  dismissWelcomePopup,
  openDialog,
  waitDialogClosed,
} from "./lib/browser.mjs";

// Ensure the output console is open. It auto-opens when a render first surfaces
// a notice/assert, but a manual close (or a notice present before this point)
// means it may be shut — so click the Output bell when it's not already open.
// The bell's label is "Open Messages" while closed.
async function openConsole(page) {
  if (await page.locator(".output-console").count()) return;
  // Desktop bell (the mobile top bar's twin is CSS-hidden at this viewport).
  await page.locator('.command-bar__output[aria-label^="Open Messages"]').click().catch(() => {});
  await page.waitForSelector(".output-console", { timeout: 3000 }).catch(() => {});
}

// How many messages the Output bell currently has pending, read from its
// `data-notice-count` hook rather than the "(N notices)" in its aria-label —
// the count has to be readable whether or not the badge is rendering it (see
// OutputToggle's `showCount`), and a hook doesn't break when the copy changes.
async function bellNoticeCount(page) {
  const attr = await page.locator(".command-bar__output").first().getAttribute("data-notice-count");
  return Number(attr ?? 0);
}

// The bell's count badge shows exactly when there are messages to count AND no
// readiness pill is up to own the count instead — see OutputToggle.tsx for why
// the bell's message tally and the pill's issue tally legitimately differ.
// Asserted as a biconditional so it says something in every config and every
// readiness state, rather than skipping when a state doesn't match one shape:
// an attention state can carry no messages at all (a font fallback echoes
// nothing), and a clean design can carry several.
async function checkBellCount(page, check, where) {
  const messages = await bellNoticeCount(page);
  const pillUp = (await page.locator(".status-strip").count()) > 0;
  const badges = await page.locator(".output-toggle__count").count();
  check(
    badges === (messages > 0 && !pillUp ? 1 : 0),
    `the bell's count badge shows exactly when messages are pending and no pill owns the count ` +
      `(${where}: ${messages} message(s), pill ${pillUp ? "up" : "absent"})`
  );
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
// is a shadcn/ui (Radix) Select or, under `ui.gallery`, a card dialog; pickDesign
// (scripts/lib/browser.mjs) drives whichever one this config mounts, targeting
// the design by its visible label either way.
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
//
// The MODE decides what the dialog actually renders (PopupModal.tsx):
// "picker" draws the design gallery (cards, no primary button) and remembers
// the dismissal on any close, while "always"/"once"/"dismissible" draw the
// Markdown body plus a primary button (and, for "dismissible", the
// "Don't show this again" checkbox). PopupModal falls back to the button form
// when a "picker" config has only one design, so derive the shape the same way
// it does rather than trusting `mode` alone.
async function checkWelcomePopup({ page, check, schema }) {
  console.log("=== welcome popup ===");
  if (schema.popup) {
    const popup = page.getByRole("dialog", { name: schema.popup.header });
    check((await popup.count()) > 0, "welcome popup shown on load");
    if (/\]\(/.test(schema.popup.body ?? "")) {
      check((await popup.getByRole("link").count()) > 0, "popup body renders its link");
    }
    if (schema.popup.footnote) {
      check(
        (await popup.getByText(schema.popup.footnote, { exact: true }).count()) > 0,
        "popup renders its configured footnote"
      );
    }
    if (schema.popup.mode === "picker" && schema.designs.length > 1) {
      // Picker mode embeds the design gallery directly and has NO primary CTA
      // button — the visitor's next step (choosing what to make) IS the popup.
      // Picking a card selects that design and dismisses the popup.
      const card = popup.locator("button[data-design]").first();
      check((await card.count()) > 0, "picker popup shows selectable design cards");
      await card.click();
      await waitDialogClosed(page, schema.popup.header).catch(() => {});
      check((await page.getByRole("dialog").count()) === 0, "picking a design card dismisses the popup");
    } else {
      // Non-picker modes show a config-driven primary button (schema.popup.button)
      // that dismisses the popup and, when there's more than one design, opens
      // the design picker so the next step is obvious.
      const buttonLabel = schema.popup.button ?? "OK";
      const cta = popup.getByRole("button", { name: buttonLabel, exact: true });
      check((await cta.count()) > 0, `popup shows its configured button "${buttonLabel}"`);
      const dontShow = popup.getByRole("checkbox");
      if (await dontShow.count()) await dontShow.check();
      await cta.click();
      await waitDialogClosed(page, schema.popup.header).catch(() => {});
      check((await page.getByRole("dialog").count()) === 0, "popup dismissed");
      if (schema.designs.length > 1) {
        // Under `ui.gallery` the picker the CTA opens is a card dialog, not a
        // Radix listbox, so target whichever this config mounts.
        const picker = schema.ui?.gallery
          ? page.getByRole("dialog", { name: "Choose a design" })
          : page.getByRole("listbox");
        const opened = await picker
          .first()
          .waitFor({ state: "visible", timeout: 3000 })
          .then(() => true)
          .catch(() => false);
        check(opened, "primary CTA opens the design picker");
        // Close it so it doesn't intercept the later checks' interactions.
        await page.keyboard.press("Escape");
        await picker.first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
      }
    }
  } else {
    console.log("  (no popup in this config — skipped)");
  }
}

// File import is CONTEXTUAL now: the Files action (BarActions, a toolbar icon
// button opening the FilesModal) only MANAGES imported files — it lists them
// (name, type, size), removes one via its row X, and clears all, plus an empty
// state — and carries NO generic import button. Importing happens at the
// control that needs the file. This check (a) confirms the management-only
// dialog + empty state, then (b) drives a real import through a contextual
// control — the tag design's `@font` param renders a FontSelect whose hidden
// file input is the same addFile path as its in-dropdown "Import font…" — and
// verifies the file surfaces in the list with its type/size, persists across a
// reload (IndexedDB), removes via the row X, and clears via "Clear all".
async function checkFileImport({ page, check, ids, schema, paramsTabName }) {
  console.log("=== file import (contextual) ===");
  if (schema.fileImport == null) {
    console.log("  (no fileImport in this config — skipped)");
    return;
  }
  // FilesModal (a Dialog) doesn't persist across a reload, so it must be
  // re-opened each time — exact match: a substring "Files" would also catch
  // "Clear all imported files" once the modal is open.
  // FilesModal is code-split (App.tsx loads it through `lazy()`), so the dialog
  // mounts a tick or two after the click rather than synchronously — wait for it
  // here rather than at each call site, so neither an assertion nor the Escape
  // in closeFiles below can run against a dialog that hasn't appeared yet.
  const gotoFiles = async () => {
    await page.getByRole("button", { name: "Files", exact: true }).first().click().catch(() => {});
    await openDialog(page, "Files").catch(() => {});
  };
  const closeFiles = async () => {
    await page.keyboard.press("Escape").catch(() => {});
    await waitDialogClosed(page, "Files").catch(() => {});
  };

  // (a) Management-only dialog: no generic import button, and with nothing
  //     imported yet the empty state (guidance to the contextual controls) shows.
  await gotoFiles();
  check(
    (await page.getByRole("button", { name: /Import file/i }).count()) === 0,
    "Files dialog has no generic import button (import is contextual)"
  );
  check(
    (await page.locator(".file-manager__empty").count()) > 0,
    "Files dialog shows the empty state when nothing is imported"
  );
  await closeFiles();

  // (b) Import through a contextual control: the tag design's `@font` param.
  //     Real bundled TTF bytes so the family parses; a distinct filename marks
  //     it as a user import rather than the bundled copy.
  await page.getByRole("tab", { name: paramsTabName }).first().click().catch(() => {});
  const fontInput = page.locator('.param[data-param="font"] input[type="file"]').last();
  check((await fontInput.count()) > 0, "font control exposes a contextual import input");
  const ttf = await readFile(
    fileURLToPath(new URL("../public/fonts/LiberationSans-Regular.ttf", import.meta.url))
  );
  const importedName = "smoke-imported.ttf";
  await fontInput.setInputFiles({ name: importedName, mimeType: "font/ttf", buffer: ttf });

  const row = () => page.locator(".file-manager__name", { hasText: importedName });
  await gotoFiles();
  await row().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await row().count()) > 0, "imported file appears in the Files list");
  // The row carries a type indicator (Font) and a formatted size.
  const itemText = await page
    .locator(".file-manager li", { has: row() })
    .innerText()
    .catch(() => "");
  check(/Font/.test(itemText), "imported file shows its Font type indicator");
  check(/\b(?:B|KB|MB)\b/.test(itemText), "imported file shows a formatted size");

  // (c) Persist across a reload (IndexedDB).
  await page.reload({ waitUntil: "load" });
  await waitRendered(page, ids[0]);
  await gotoFiles();
  check((await row().count()) > 0, "imported file persists across reload");

  // (d) The row's own X removes just that file, and the empty state returns.
  await page.getByRole("button", { name: new RegExp(`Remove ${importedName}`, "i") }).click();
  await row().waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  check((await row().count()) === 0, "row remove deletes the file");
  check(
    (await page.locator(".file-manager__empty").count()) > 0,
    "empty state returns after removing the last file"
  );
  await closeFiles();

  // (e) Re-import, then "Clear all" empties the list and the persisted store.
  await page.getByRole("tab", { name: paramsTabName }).first().click().catch(() => {});
  await page
    .locator('.param[data-param="font"] input[type="file"]')
    .last()
    .setInputFiles({ name: importedName, mimeType: "font/ttf", buffer: ttf });
  await gotoFiles();
  await row().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  await page.getByRole("button", { name: /Clear all imported files/i }).click();
  await row().waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  // The UI row is removed synchronously, but the persisted copy is cleared via a
  // fire-and-forget IndexedDB transaction. Reloading the instant the row detaches
  // can abort that still-uncommitted transaction (page unload cancels in-flight
  // IDB txns), leaving the file on disk to be restored on the next load. Wait for
  // the persisted store to actually be empty before reloading so this assertion
  // tests the guarantee, not the race. The store name is "fonts" — its original
  // purpose — kept stable so older builds' files still load (see idb.ts).
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
  check((await row().count()) === 0, "cleared file stays cleared after reload");
  // Close it — later checks click other toolbar/panel controls, and an open
  // dialog's overlay would intercept those clicks.
  await closeFiles();
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

// Inject axe-core via evaluate (the DevTools runtime channel), NOT
// page.addScriptTag: serve-dist now sends the built dist/_headers, whose CSP
// rightly refuses an inline <script> tag — and loosening the page's policy
// (bypassCSP, or an 'unsafe-inline' carve-out) just to measure accessibility
// would stop this suite from exercising the exact headers a real deploy
// sends. Runtime evaluation is tooling-plane and not governed by the page's
// CSP.
async function injectAxe(page) {
  const source = await readFile(
    fileURLToPath(new URL("../node_modules/axe-core/axe.min.js", import.meta.url)),
    "utf8"
  );
  await page.evaluate(source);
}

async function checkAxe({ page, check }) {
  console.log("=== accessibility (axe-core) ===");
  await injectAxe(page); // see injectAxe for why not addScriptTag
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

// Bundled-preset card grid (PresetPicker.tsx, config's `designs[].presetImages`
// — see docs/config.md's "Bundled presets" note). Exercised on the first
// design the schema configures any presetImages for (the dogfood config sets
// two on "tag" — see scadpub.config.json); a config with none is skipped
// rather than assumed.
async function checkPresetCardGrid({ page, check, schema, presetsTabName, paramsTabName }) {
  console.log("=== bundled-preset card grid (presetImages) ===");
  const design = schema.designs.find((d) => d.presetImages && Object.keys(d.presetImages).length);
  if (!design) {
    console.log("  (no design configures presetImages in this config — skipped)");
    return;
  }
  await selectDesign(page, design.id);
  await page.getByRole("tab", { name: presetsTabName }).first().click().catch(() => {});
  const cards = page.locator('[aria-label="Ready-made presets"] .preset-picker__card');
  const expectedCount = Object.keys(design.presetImages).length;
  await cards.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await cards.count()) === expectedCount, `preset card grid shows ${expectedCount} card(s) for "${design.id}"`);
  check((await cards.locator("img").count()) >= 1, "at least one preset card renders its thumbnail image");
  // Cards are still plain buttons: clicking one applies the preset, same as
  // the list variant (checkBundledPresets already exercises apply/URL/reload
  // — this just confirms the card path routes through the same handler).
  const firstCardText = (await cards.first().textContent())?.trim() ?? "";
  await cards.first().click();
  await waitRendered(page, `${design.id} + preset card "${firstCardText}"`);
  check(
    (await page.locator('[aria-label="Ready-made presets"] .preset-picker__card[aria-pressed="true"]').count()) >= 1,
    "clicking a preset card applies it (aria-pressed)"
  );
  await page.getByRole("tab", { name: paramsTabName }).first().click().catch(() => {});
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

// Export the model (+ PNG, when the config offers Save image) on the first
// design.
//
// The example "tag" design (ids[0]) carries an attention-flagged notice by
// default (both an emblem and a label shown at once — see tag.scad's own
// comment), so Download opens the Review dialog (ReviewDialog.tsx) armed with
// "Download anyway" instead of exporting immediately (ActionButtons.tsx's
// onDownloadClick). Arm the download listener BEFORE the click so the event
// can never fire and go unheard while we're still deciding whether a dialog
// showed up.
async function checkExports({ page, check, ids, dir, schema }) {
  await selectDesign(page, ids[0]);
  console.log("=== export 3MF ===");
  // Whether the Review gate opens is a property of the DESIGN's live readiness,
  // not of the suite: only a "ready" render exports straight from the dock
  // (AppShell's onDownloadClick). The dogfood config's first design ("tag")
  // carries a default attention issue, but another config's first design may be
  // clean — so branch on what actually happened and assert the matching
  // contract either way, instead of assuming one config's shape.
  const downloadPromise = page.waitForEvent("download");
  await page.click('[aria-label^="Download "]');
  const reviewDialog = await openDialog(page, "Review", { timeout: 2000 }).catch(() => null);
  if (reviewDialog) {
    check(true, "downloading with a pending attention issue opens the Review dialog");
    check(
      (await reviewDialog.locator(".attention-card").count()) > 0,
      "Review dialog shows an attention card"
    );
    await reviewDialog.getByRole("button", { name: "Download anyway" }).click();
  } else {
    check(true, `"${ids[0]}" is ready, so Download exports straight from the dock`);
  }
  const model = await downloadPromise;
  const modelOut = join(dir, await model.suggestedFilename());
  await model.saveAs(modelOut);
  check((await stat(modelOut)).size > 0, `${await model.suggestedFilename()} (${(await stat(modelOut)).size} bytes)`);

  // Save PNG lives in the top-bar overflow — but a deployment can hide it with
  // `ui.saveImage: false`, in which case there's nothing to click.
  if (schema.ui?.saveImage === false) {
    console.log("=== save PNG (disabled via ui.saveImage — skipped) ===");
    check(
      (await page.locator('[aria-label="Save image"]').count()) === 0,
      "Save image action is absent when ui.saveImage is false"
    );
  } else {
    console.log("=== save PNG (relocated to the top-bar overflow) ===");
    const [png] = await Promise.all([
      page.waitForEvent("download"),
      page.click('[aria-label="Save image"]'),
    ]);
    const pngOut = join(dir, await png.suggestedFilename());
    await png.saveAs(pngOut);
    const head = (await readFile(pngOut)).subarray(0, 4);
    const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    check(isPng && (await stat(pngOut)).size > 0, `${await png.suggestedFilename()} (png=${isPng})`);
  }
}

// The unified export dock (ActionButtons.tsx): exactly two buttons (Download
// + Share), no separate Image button — Save-image moved to the top-bar
// overflow (BarActions.tsx), exercised above by checkExports' PNG click.
async function checkExportDock({ page, check }) {
  console.log("=== export dock (two buttons, no Image button) ===");
  const cluster = page.locator(".app-shell__desktop .action-cluster");
  check((await cluster.locator('[data-slot="button"]').count()) === 2, "dock shows exactly two buttons");
  check((await cluster.getByRole("button", { name: /^Image$/ }).count()) === 0, "no bare Image button in the dock");
  check((await cluster.locator('[aria-label="Save image"]').count()) === 0, "Save image is not in the dock");
}

// Status pill (StatusStrip.tsx) + Review dialog (ReviewDialog.tsx): the
// readiness surface in the export dock — above the Download button, same
// component in both layouts — that opens the dialog. It is mounted ONLY for
// the attention/failed states (a ready model needs no announcement; see
// StatusStrip's own doc), so "present" and "absent" are both assertions here.
// Which footer actions the dialog offers is keyed on the LIVE readiness state,
// not on how it was opened — so branch on what the first design actually
// reports (the dogfood config's "tag" carries a default attention issue;
// another config's first design may be clean) rather than assuming one
// config's shape. The pill's own copy is resolved through the i18n catalogue +
// `strings` overrides (see `labels` in main()).
async function checkStatusStripAndReview({ page, check, ids, labels }) {
  console.log("=== status pill + review dialog ===");
  await selectDesign(page, ids[0]);
  const pill = page.locator(".status-strip").first();
  await pill.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  if (await pill.count()) {
    const pillText = (await pill.textContent()) ?? "";
    await pill.click();
    const infoDialog = await openDialog(page, "Review");
    const infoFooter = infoDialog.locator('[data-slot="dialog-footer"]');
    // Issues pending: the footer offers "Download anyway" / "Go back and fix"
    // — identical to the dock entry point (checkExports above). Scope to the
    // footer so we assert the state-based footer, not the trigger.
    check(labels.issues.test(pillText), "status pill names the pending issue(s)");
    check(
      (await infoDialog.locator(".attention-card").count()) > 0,
      "a mounted status pill means the dialog has something to review"
    );
    check(
      (await infoFooter.getByRole("button", { name: "Download anyway" }).count()) === 1,
      "status-opened dialog with issues offers the same Download anyway action as the dock"
    );
    check(
      (await infoFooter.getByRole("button", { name: "Go back and fix" }).count()) === 1,
      "status-opened dialog with issues offers Go back and fix"
    );
    await infoFooter.getByRole("button", { name: "Go back and fix" }).click();
    await waitDialogClosed(page, "Review").catch(() => {});
    // With a pill up, the pill owns the count and the bell drops its badge.
    await checkBellCount(page, check, ids[0]);
    // Nothing is hidden by that: pending messages stay reported to assistive
    // tech. Only assertable when this design actually has some.
    if ((await bellNoticeCount(page)) > 0) {
      const bellLabel = (await page.locator(".command-bar__output").first().getAttribute("aria-label")) ?? "";
      check(
        /\(\d+ notices?\)/.test(bellLabel),
        "the bell still reports its pending messages to assistive tech while the pill is up"
      );
    } else {
      console.log("  (this design's attention state carries no messages — the bell's label is not exercised)");
    }
  } else {
    console.log(`  (the first design "${ids[0]}" is clean — no pill, as designed)`);
  }

  // The other half of the contract needs a design in the OPPOSITE state. The
  // dogfood config pairs "tag" (attention by default) with "panel" (a clean
  // SVG-extrusion design, no font/notice concerns); a config without such a
  // known-clean design just doesn't exercise it. A clean design must show NO
  // pill at all — the ready state is deliberately silent.
  if (ids.includes("panel")) {
    await selectDesign(page, "panel");
    await page.waitForTimeout(300);
    check(
      (await page.locator(".status-strip").count()) === 0,
      "no status pill on a clean design (ready is silent — the Download button is the confirmation)"
    );
    // …and with no pill to own it, the count comes back to the bell — the other
    // half of the `showCount` contract, same biconditional.
    await checkBellCount(page, check, "panel");
    // Back to the design the rest of the suite expects to be selected.
    await selectDesign(page, ids[0]);
  } else {
    console.log("  (no known attention-free design in this config — the Ready state is not exercised)");
  }
}

// After-export panel (ExportSuccess.tsx, ui.afterExport — the dogfood config
// sets `helpTab: "Printing"`). Exercised by re-downloading the first design.
async function checkAfterExport({ page, check, ids, schema }) {
  if (!schema.ui?.afterExport) {
    console.log("=== after-export panel === (ui.afterExport not configured — skipped)");
    return;
  }
  console.log("=== after-export panel ===");
  await selectDesign(page, ids[0]);
  const downloadPromise = page.waitForEvent("download");
  await page.click('[aria-label^="Download "]');
  const reviewDialog = await openDialog(page, "Review", { timeout: 2000 }).catch(() => null);
  if (reviewDialog) {
    await reviewDialog.getByRole("button", { name: /Download/ }).click();
  }
  await downloadPromise;
  const panel = page.locator(".export-success");
  await panel.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await panel.count()) > 0, "after-export panel appears once the download settles");
  if (schema.ui.afterExport.helpTab) {
    const guideBtn = panel.getByRole("button", { name: "Open printing help" });
    const guideVisible = await guideBtn
      .waitFor({ state: "visible", timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    check(guideVisible, `after-export panel offers "Open printing help"`);
    await guideBtn.click();
    // NOT openDialog/waitDialogClosed here: Help's accessible NAME isn't stable
    // across configs. Modal.tsx's `aria-label={label ?? title}` sets an
    // `aria-label="Help"` attribute, but Radix's DialogContent also wires
    // `aria-labelledby` to the rendered DialogTitle (the config's `help.title`,
    // defaulting to "How to use this configurator") — and per the ARIA
    // accessible-name algorithm, aria-labelledby wins over aria-label, so the
    // dialog's actual accessible name is that title text, not "Help". Locate
    // it structurally instead (any dialog containing the deep-linked tab),
    // which is name-agnostic and was the original approach here.
    const helpDialog = page.getByRole("dialog").filter({ has: page.getByRole("tab", { name: schema.ui.afterExport.helpTab }) });
    const helpOpened = await helpDialog.first().waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false);
    check(helpOpened, `"Open printing help" opens Help scrolled to "${schema.ui.afterExport.helpTab}"`);
    check(
      (await page.getByRole("tab", { name: schema.ui.afterExport.helpTab, selected: true }).count()) === 1,
      `the "${schema.ui.afterExport.helpTab}" tab is the active one`
    );
    await page.keyboard.press("Escape");
    await helpDialog.first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  } else {
    await panel.locator(".export-success__dismiss").click().catch(() => {});
  }
}

async function checkPreviewControls({ page, check }) {
  console.log("=== preview controls (share link + live preview) ===");
  // Headless Chromium never implements navigator.share, so canShareNatively()
  // is always false here — the Share button always renders its clipboard-copy
  // form (see ActionButtons.tsx's NATIVE_SHARE / share.ts's own doc).
  check(
    (await page.locator('[aria-label="Copy link"]').count()) >= 1,
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

// @showIf + @collapsed — exercised on the example "tag" design when present.
// Param rows are located by their stable data-param hook, which exists
// regardless of ui.showVarName, so this block runs in every config.
async function checkTagDesign({ page, check, ids, paramsTabName }) {
  if (!ids.includes("tag")) {
    console.log('=== conditional visibility (@showIf, tag) === (no "tag" design in this config — skipped)');
    return;
  }
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
  // The reload above re-derives the panel's tab (Presets when the design ships
  // bundled presets, else Customize) — land on Customize explicitly since the
  // checks below drive parameter controls.
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});


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
  await setNum("thickness", 1);
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

  // Restore a clean, rendering state for the checks that follow.
  await resetDefaults(page);
  await waitRendered(page, "tag");
}

// On-model text editing ("type on the sign") — exercised on the example "tag"
// design, whose `label` param is annotated `// @editOnModel`. Covers the pointer
// path (click the mesh → floating editor → type → panel + render follow),
// Escape-reverts, and axe with the editor open. The feature is deliberately
// pointer-only and carries no permanent affordance over the viewer (the panel's
// own text box is the canonical, keyboard-reachable path), which the first check
// pins. Runs only when "tag" is present.
async function checkEditOnModel({ page, check, ids, paramsTabName }) {
  if (!ids.includes("tag")) {
    console.log('=== on-model text editing (@editOnModel, tag) === (no "tag" design in this config — skipped)');
    return;
  }
  console.log("=== on-model text editing (@editOnModel, tag) ===");
  await selectDesign(page, "tag");
  await waitRendered(page, "tag (edit-on-model)");

  // Nothing floats over the viewer for this feature until the model is clicked:
  // the retired pencil chip sat top-left on mobile, over the measurements panel.
  check(
    (await page.locator(".viewer-edit-chip").count()) === 0 &&
      (await page.locator(".model-text-editor").count()) === 0,
    "on-model editing adds no permanent affordance over the viewer"
  );

  const labelInput = () => paramRow(page, "label").locator('input[type="text"]');
  const editor = page.locator(".model-text-editor");
  const editorInput = editor.locator("input");

  // Open the editor by clicking the rendered mesh. The tag plate fills most of
  // the canvas, but try a few points around the centre in case the exact centre
  // lands on a gap. A miss simply doesn't open the editor.
  const canvas = page.locator(".app-shell__desktop .viewer canvas");
  const box = await canvas.boundingBox();
  const clickModel = async () => {
    for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.45], [0.5, 0.55], [0.45, 0.5], [0.55, 0.5]]) {
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      if (
        await editor
          .first()
          .waitFor({ state: "visible", timeout: 1200 })
          .then(() => true)
          .catch(() => false)
      )
        return true;
    }
    return false;
  };
  check(await clickModel(), "clicking the model opens the inline text editor");

  // Type a new value ON THE MODEL and confirm both the render re-runs and the
  // panel's own text box follows — same change() the panel input calls.
  const typed = "SMOKE-EDIT";
  const statusBefore = (await renderStatusText(page)) ?? "";
  await editorInput.fill(typed);
  const rerendered = await page
    .waitForFunction(
      (prev) => {
        const s = document.querySelector(".render-status")?.textContent || "";
        return /\d+ ms/.test(s) && s !== prev;
      },
      statusBefore,
      { timeout: 30000 }
    )
    .then(() => true)
    .catch(() => false);
  check(rerendered, "typing on the model re-runs the render");
  await page.keyboard.press("Enter"); // Enter closes; value already applied
  await editor.first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  await page.getByRole("tab", { name: paramsTabName }).first().click().catch(() => {});
  check((await labelInput().inputValue()) === typed, "the panel's text input shows the on-model edit");

  // Reopen from the mesh — focus must land in the input, so typing needs no
  // second click.
  check(await clickModel(), "clicking the model reopens the editor");
  check(
    await page.evaluate((id) => document.activeElement?.id === id, "model-text-editor-input"),
    "focus lands in the editor input on open"
  );

  // Escape reverts to the value the editor had when it opened (still "typed").
  await editorInput.fill("DISCARD-ME");
  await page.keyboard.press("Escape");
  await editor.first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  await page.getByRole("tab", { name: paramsTabName }).first().click().catch(() => {});
  check(
    (await labelInput().inputValue()) === typed,
    "Escape reverts the on-model edit to the value at open"
  );

  // Accessibility: no serious/critical axe violation with the editor open.
  check(await clickModel(), "the editor opens for the accessibility pass");
  await injectAxe(page); // see injectAxe for why not addScriptTag
  const axeRes = await page.evaluate(async () =>
    window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
    })
  );
  const serious = axeRes.violations.filter((v) => ["serious", "critical"].includes(v.impact));
  for (const v of serious)
    console.log(`  [${v.impact}] ${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(" ")).join("; ")}`);
  check(serious.length === 0, `axe with the on-model editor open: ${serious.length} serious/critical`);
  await page.keyboard.press("Escape");
  await editor.first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

  // Leave the design at its defaults for whatever runs next.
  await resetDefaults(page);
  await waitRendered(page, "tag");
}

// "Jump to section" navigator (SectionNavigator.tsx): a compact control above
// the form on designs with >= 4 visible sections. Present on such a design,
// absent on a simple one; selecting a section opens + scrolls + focuses it; and
// a narrowing search shrinks (or removes) the option set. Located by the
// trigger's accessible name and the option/section DOM hooks.
async function checkSectionNavigator({ page, check, ids, schema, paramsTabName }) {
  console.log("=== section navigator (jump to section) ===");
  const sectionCount = (id) => (schema.designs.find((d) => d.id === id)?.sections?.length ?? 0);
  const navDesign = ids.find((id) => sectionCount(id) >= 4);
  const simpleDesign = ids.find((id) => sectionCount(id) < 4);
  if (!navDesign) {
    console.log("  (no design with >= 4 sections in this config — skipped)");
    return;
  }

  const trigger = page.getByRole("button", { name: "Jump to section", exact: true });
  const gotoParams = () =>
    page.getByRole("tab", { name: paramsTabName }).first().click().catch(() => {});

  // (a) Present on a multi-section design; absent on a simple one.
  await selectDesign(page, navDesign);
  await gotoParams();
  await trigger.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await trigger.count()) >= 1, `navigator present on "${navDesign}" (>= 4 sections)`);
  if (simpleDesign) {
    await selectDesign(page, simpleDesign);
    await gotoParams();
    await page.locator(".param-form").first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
    check((await trigger.count()) === 0, `navigator absent on simple "${simpleDesign}" design (< 4 sections)`);
    await selectDesign(page, navDesign);
    await gotoParams();
    await trigger.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  }

  // (b) Selecting a section opens it, scrolls it in, and focuses its summary.
  //     Prefer a currently-collapsed section (a stronger test — it wasn't open);
  //     fall back to the last section (which still re-scrolls/focuses).
  await trigger.first().click();
  const items = page.locator(".section-nav-item");
  await items.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  const beforeCount = await items.count();
  check(beforeCount >= 4, `navigator lists all ${beforeCount} visible sections`);
  const target = await page.evaluate(() => {
    const all = [...document.querySelectorAll("details.param-group")];
    const closed = all.find((d) => !d.open);
    return (closed ?? all[all.length - 1])?.getAttribute("data-section") ?? null;
  });
  check(target !== null, "a target section is resolvable");
  await page.getByRole("button", { name: target, exact: true }).click();
  const opened = await page
    .waitForFunction(
      (sec) => {
        const d = document.querySelector(`details.param-group[data-section="${sec}"]`);
        return !!d && d.open;
      },
      target,
      { timeout: 3000 }
    )
    .then(() => true)
    .catch(() => false);
  check(opened, `selecting "${target}" opens its section`);
  const focused = await page
    .waitForFunction(
      (sec) => document.activeElement === document.querySelector(`details.param-group[data-section="${sec}"] summary`),
      target,
      { timeout: 3000 }
    )
    .then(() => true)
    .catch(() => false);
  check(focused, `the opened section's <summary> holds DOM focus`);

  // (c) A narrowing search shrinks the option set. Searching a single param's
  //     exact name matches (at least) that one param, so sections without it
  //     drop out — often below the threshold, which removes the navigator
  //     entirely (a 0-option shrink). Either way the count must fall.
  await trigger.first().click();
  const before = await page.locator(".section-nav-item").count();
  await page.keyboard.press("Escape");
  const firstParam = await page.locator(".param[data-param]").first().getAttribute("data-param");
  const search = page.locator("#param-search-input");
  await search.fill(firstParam ?? "zzznomatch");
  await page.waitForTimeout(400); // search debounce (150ms) + re-filter
  let after = 0;
  if ((await trigger.count()) >= 1) {
    await trigger.first().click();
    after = await page.locator(".section-nav-item").count();
    await page.keyboard.press("Escape");
  }
  check(after < before, `a narrowing search shrinks the navigator (${before} -> ${after} sections)`);
  await search.fill(""); // restore for whatever runs next
}

// @showIf arrow_style — exercised on a "signage" design when present. (No
// notice expectation here: a well-tuned config renders its defaults
// advisory-free; the notice/assert badge machinery is covered by "tag".)
// Params are located by their stable `data-param` hook, which exists
// regardless of ui.showVarName.
async function checkSignageDesign({ page, check, ids, schema }) {
  if (!ids.includes("signage")) {
    console.log('=== signage: @showIf arrow_style === (no "signage" design in this config — skipped)');
    return;
  }
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
  // `@showIf arrow != none` is now satisfied, but a config can also mark
  // arrow_style `@advanced`; under `ui.essentials` an advanced param stays
  // hidden until "Show all settings" is on (that hiding is orthogonal to
  // @showIf — see EssentialsToggle / lib/essentials.ts). Reveal it first so
  // this check tests @showIf in isolation, whatever config drives the build.
  const arrowStyleAdvanced = (schema?.designs ?? [])
    .find((d) => d.id === "signage")
    ?.params?.find((p) => p.name === "arrow_style")?.advanced === true;
  if (schema?.ui?.essentials === true && arrowStyleAdvanced) {
    await page.getByRole("button", { name: /show all settings/i }).first().click().catch(() => {});
  }
  await arrowStyle.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  check((await arrowStyle.count()) > 0, "arrow_style shown when arrow = right");
  await waitRendered(page, "arrow");
}

// M7 + M16 (docs/architecture-review.md): responsive layout mounting and
// mobile bottom-sheet focus behavior. These need a real mobile-sized
// viewport/context (the default page above is desktop-sized), so this opens
// its own context rather than reusing `page`. Covers:
//  - M7: exactly one interactive layout (ParamForm) is in the DOM at a given
//    breakpoint, and a breakpoint change preserves active tab, search text,
//    search focus, and (on the way back) the sheet's detent.
//  - M16: at Peek/Half the mobile background stays keyboard-reachable
//    (not `inert`); at Full it's `inert` and focus is trapped inside the
//    sheet — Tab never lands on a covered background control — with Escape
//    collapsing back out and focus returning to the sheet.
// Crossing the breakpoint UNMOUNTS one layout tree and mounts the other, and
// the incoming tree stands up a fresh three.js Viewer (a new WebGL context,
// plus the environment/IBL setup a `viewer.style: "studio"` config asks for).
// That work is main-thread-bound and lands at the very end of a long run, so
// it can take a few seconds on a software GL stack with a big config — far
// longer than the 3s the rest of this section's waits use. Generous on
// purpose: a layout that never swaps still fails, just later.
const LAYOUT_SWAP_MS = 20000;

async function checkResponsiveLayout({ browser, base, check, schema, paramsTabName }) {
  console.log("=== responsive layout: single mounted tree + state across a breakpoint change (M7) ===");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  // The first-visit sheet policy (src/lib/sheetPolicy.ts) would boot this
  // 390×844 (tall) context to the "half" detent, breaking the peek→half handle
  // walk below. Seed the once-flag so this walk starts from a deterministic
  // peek, as a returning visitor would. checkFirstVisitSheetPolicy covers the
  // fresh-visit boot detents separately.
  await context.addInitScript((key) => {
    try { localStorage.setItem(key, "1"); } catch { /* storage unavailable */ }
  }, `${schema?.id || "scadpub"}.sheet.introduced.v1`);
  const page = await context.newPage();
  try {
    await page.goto(base, { waitUntil: "load" });
    await dismissWelcomePopup(page);
    await waitRenderDone(page).catch(() => {});

    // Only the active (mobile) layout is in the DOM — the desktop tree isn't
    // mounted at all.
    check(
      (await page.locator(".app-shell__mobile").count()) === 1 &&
        (await page.locator(".app-shell__desktop").count()) === 0,
      "mobile viewport mounts only the mobile layout tree"
    );

    // Raise the sheet to Half and switch to the Parameters tab (tapping a tab
    // at Peek also raises it, but starting from Half keeps this deterministic
    // regardless of the landing tab). The design may land on Presets (bundled
    // presets), so ParamForm only mounts once Parameters is active — Radix
    // Tabs unmounts inactive tab content.
    await page.locator(".sheet-handle").click(); // peek -> half
    await page.waitForSelector(".bottom-sheet--half", { timeout: 3000 });
    await page.getByRole("tab", { name: paramsTabName }).first().click();
    await page.waitForSelector(".param-form", { timeout: 3000 });
    check((await page.locator(".param-form").count()) === 1, "exactly one ParamForm is mounted");

    // The sheet's form toolbar is the search field ALONE. Its two former
    // neighbours are gone from this layout by design: the "+N more" essentials
    // chip is the form's own closing row now, and the section navigator is
    // desktop-only (both still exist — see the desktop checks above and the
    // end-of-form check below — they just don't stand a row here anymore).
    // This is the sheet's vertical budget, so guard it against creeping back.
    const toolbarControls = await page
      .locator(".sheet-toolbar")
      .getByRole("button")
      .count();
    check(
      (await page.locator(".sheet-toolbar #param-search-input").count()) === 1,
      "the sheet toolbar holds the search field",
    );
    check(
      (await page.getByRole("button", { name: "Jump to section", exact: true }).count()) === 0,
      "no section navigator on the mobile sheet",
    );
    // The search field's own clear button is a legitimate inhabitant; it only
    // exists while the box has text, which it doesn't yet at this point.
    check(toolbarControls === 0, `the sheet toolbar carries no extra controls (${toolbarControls})`);

    // Sticky group headers are what took over the navigator's orientation job,
    // so assert the actual computed behaviour rather than the class — a
    // `position: static` regression here would silently leave the mobile form
    // with no way to tell which section you're reading.
    const summaryPosition = await page
      .locator(".param-group > summary")
      .first()
      .evaluate((el) => getComputedStyle(el).position)
      .catch(() => null);
    check(summaryPosition === "sticky", `param-group headers are sticky (${summaryPosition})`);

    // Essentials lives at the END of the form now — after the last group, not
    // in a row above it. Only present when the design actually has `@advanced`
    // params (EssentialsToggle renders nothing otherwise).
    const essentials = page.locator(".param-form .essentials-toggle");
    if (await essentials.count()) {
      const isLast = await page
        .locator(".param-form > *:last-child")
        .evaluate((el) => el.classList.contains("essentials-toggle"));
      check(isLast, "the essentials toggle is the form's last row");
      check(
        await essentials.first().isVisible(),
        "the essentials toggle is reachable inside the sheet",
      );
      // If it's on screen it must have something to do. The toggle renders only
      // while its count is non-zero (EssentialsToggle), so pressing it has to
      // move the number of visible param rows — a toggle that reveals nothing
      // and then renames itself is the regression this guards.
      const shown = () => page.locator(".param:visible").count();
      const before = await shown();
      await essentials.first().click();
      await page.waitForTimeout(300);
      const after = await shown();
      check(after !== before, `the essentials toggle actually reveals/hides (${before} -> ${after})`);
      // Restore the mode for whatever runs next; the toggle may have retired
      // itself if flipping it left nothing reachable, so re-locate rather than
      // reusing the stale handle.
      const back = page.locator(".param-form .essentials-toggle");
      if (await back.count()) await back.first().click();
      await page.waitForTimeout(300);
    } else {
      // Absent is a real state, not just "config has no advanced params": it's
      // also every design whose advanced params are all @showIf-hidden right
      // now, and every config that leaves `ui.essentials` off.
      console.log("  (no essentials toggle on this design — nothing reachable to reveal)");
    }

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
    await page.waitForSelector(".app-shell__desktop", { timeout: LAYOUT_SWAP_MS });
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
    await page.waitForSelector(".app-shell__mobile", { timeout: LAYOUT_SWAP_MS });
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
  } finally {
    await context.close();
  }
}

// First-visit mobile sheet policy (src/lib/sheetPolicy.ts): a fresh (never
// visited) mobile context boots the settings sheet to a viewport-driven detent
// — "half" on a tall portrait, "peek" on a short portrait or landscape — and
// shows the one-time "swipe up for settings" nudge ONLY when that resolves to
// peek. Each sub-case uses its own fresh context so localStorage starts empty
// (a genuine first visit); the app writes the introduced flag once it mounts,
// so a reload in the same context is a returning visit.
//
// `firstVisit` below waits out the first render on purpose: the nudge only
// arms once the stage is past its pre-first-render loading overlay (AppShell's
// `sheetHintArmed`), and its fade timeout runs from there — so sampling before
// the render would find nothing, and sampling long after it would race the
// fade. Don't drop the waitRenderDone.
async function checkFirstVisitSheetPolicy({ browser, base, check, schema }) {
  console.log("=== first-visit mobile sheet policy (initial detent + swipe-up nudge) ===");
  const introKey = `${schema?.id || "scadpub"}.sheet.introduced.v1`;

  const firstVisit = async (width, height) => {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: "load" });
    await dismissWelcomePopup(page);
    await waitRenderDone(page).catch(() => {});
    return { page, context };
  };

  // (a) Tall portrait → half, with no nudge (a half-open sheet advertises
  //     itself), and the introduced flag persisted for later visits.
  {
    const { page, context } = await firstVisit(390, 844);
    try {
      await page.waitForSelector(".bottom-sheet--half", { timeout: 3000 }).catch(() => {});
      check((await page.locator(".bottom-sheet--half").count()) === 1, "tall portrait first visit boots the sheet to half");
      check((await page.locator(".sheet-hint").count()) === 0, "no swipe-up nudge when the first visit opens to half");
      check(
        (await page.evaluate((k) => localStorage.getItem(k), introKey)) === "1",
        "the first visit persists the introduced flag"
      );
    } finally {
      await context.close();
    }
  }

  // (b) Short portrait → peek, with the swipe-up nudge present and accessible;
  //     a returning visit (same context) still peeks but shows no nudge.
  {
    const { page, context } = await firstVisit(390, 667);
    try {
      await page.waitForSelector(".bottom-sheet--peek", { timeout: 3000 }).catch(() => {});
      check((await page.locator(".bottom-sheet--peek").count()) === 1, "short portrait first visit boots the sheet to peek");
      const hint = page.locator(".sheet-hint");
      await hint.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
      check((await hint.count()) === 1, "short portrait first-visit peek shows the swipe-up nudge");
      // Actionable (not aria-hidden): it must expose an accessible name via its
      // role="status" live region, not be hidden from assistive tech.
      check(
        (await page.getByRole("status").filter({ hasText: /settings/i }).count()) >= 1,
        "the swipe-up nudge has an accessible name (role=status, not aria-hidden)"
      );
      // …and it must be VISIBLE, not just mounted: the nudge shares its
      // over-sheet slot with the export dock, which outranks it (z-10 vs z-9)
      // and grows with what it holds — a readiness pill, an after-export panel.
      // The dogfood config's first design carries a default attention issue, so
      // this first visit has a pill up, which is exactly the case that used to
      // cover an 8-second, once-per-browser nudge. Geometry, not counts: both
      // elements exist either way. See `--action-dock-h` in index.css.
      const nudgeBox = await hint.first().boundingBox();
      const dockBox = await page.locator(".action-dock").first().boundingBox();
      check(
        !!nudgeBox && !!dockBox && nudgeBox.y + nudgeBox.height <= dockBox.y + 1,
        "the swipe-up nudge clears the export dock instead of being covered by it"
      );

      await page.reload({ waitUntil: "load" });
      await dismissWelcomePopup(page);
      await waitRenderDone(page).catch(() => {});
      await page.waitForSelector(".bottom-sheet--peek", { timeout: 3000 }).catch(() => {});
      check((await page.locator(".bottom-sheet--peek").count()) === 1, "returning visit still starts at peek");
      check((await page.locator(".sheet-hint").count()) === 0, "returning visit shows no swipe-up nudge");
    } finally {
      await context.close();
    }
  }

  // (c) Landscape (short along its own axis) → peek, regardless of height.
  {
    const { page, context } = await firstVisit(844, 390);
    try {
      await page.waitForSelector(".bottom-sheet--peek", { timeout: 3000 }).catch(() => {});
      check((await page.locator(".bottom-sheet--peek").count()) === 1, "landscape first visit boots the sheet to peek");
    } finally {
      await context.close();
    }
  }

}

// The viewer HUD must stay reachable at every detent, on the narrow and short
// viewports where it used not to. The HUD is anchored to the top of the viewer
// while the export dock rides the sheet UPWARD, and the dock outranks it (z-10
// vs z-5) — so at the half detent on a 360- or 320-wide phone the dock came to
// rest ON the rail's last buttons. Counting elements cannot see that (both are
// mounted and "visible"), so this hit-tests each button's own centre, which is
// what a finger does.
//
// The full detent is excluded on purpose: the sheet legitimately covers the
// background there, AppShell marks it `inert`, and the chrome over the model
// strip is hidden outright — all checked by the M16 block above.
// Mirrors BottomSheet's DETENT_ORDER — the order Arrow Up/Down step through.
const DETENTS = ["peek", "half", "full"];

// The app is a fixed-height shell: `#root` is 100dvh and every scrollable
// region is an inner one, so the DOCUMENT must never be scrollable. When it is,
// iOS ends up scrolling it while the software keyboard is up and does not undo
// it afterwards — the whole shell sits shifted above its own viewport, with the
// model clipped off the top and page background exposed below the sheet.
//
// Checked at the mobile breakpoint with the sheet expanded and a text field
// focused, which is the exact state that produced it.
//
// The `overflow: hidden` assertion is the one with teeth. The scrollTop one
// states the user-visible invariant, but headless Chromium has no software
// keyboard and never makes the document overflow, so it cannot fail here —
// verified by reverting the fix, which trips the overflow check alone. Keep
// both: one is the property, the other is the mechanism that guarantees it.
async function checkDocumentNeverScrolls({ browser, base, check }) {
  console.log("=== fixed shell: the document never scrolls ===");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(base, { waitUntil: "load" });
    await dismissWelcomePopup(page);
    await waitRenderDone(page).catch(() => {});

    // Raise the sheet and put a text field in focus — a real keyboard would be
    // up at this point on a device.
    await page.locator(".sheet-handle").focus();
    await page.keyboard.press("ArrowUp");
    await page.waitForSelector(".bottom-sheet--half", { timeout: 3000 }).catch(() => {});
    const field = page.locator('.sheet-content input[type="text"]').first();
    if (await field.count()) await field.click().catch(() => {});
    await page.waitForTimeout(500); // outlast useScrollFocusedIntoView's settle

    const doc = await page.evaluate(() => {
      const se = document.scrollingElement ?? document.documentElement;
      // Try to scroll it, then read back. A locked shell reports 0 either way.
      se.scrollTop = 200;
      window.scrollTo(0, 200);
      const after = { scrollTop: se.scrollTop, scrollY: window.scrollY };
      se.scrollTop = 0;
      window.scrollTo(0, 0);
      return {
        ...after,
        overflowY: getComputedStyle(document.documentElement).overflowY,
        bodyOverflowY: getComputedStyle(document.body).overflowY,
        shellTop: Math.round(
          document.querySelector(".app-shell__mobile")?.getBoundingClientRect().top ?? 0
        ),
      };
    });
    check(
      doc.scrollTop === 0 && doc.scrollY === 0,
      `the document stays at scroll 0 even when pushed (got ${doc.scrollTop}/${doc.scrollY})`
    );
    check(
      doc.overflowY === "hidden" && doc.bodyOverflowY === "hidden",
      `html/body keep overflow hidden (got ${doc.overflowY}/${doc.bodyOverflowY})`
    );
    check(doc.shellTop === 0, `the mobile shell stays flush with the viewport top (got ${doc.shellTop})`);
  } finally {
    await context.close();
  }
}

// Square opaque children painted over a ROUNDED parent that doesn't clip them.
// The parent's border curve is left stranded outside the child's fill, so the
// corner reads as a notch — which is what a sticky group header did to every
// `.param-group` card, in both layouts and both themes.
//
// Expressed as the general property rather than as a check on that one header:
// find any child whose own background reaches its parent's padding edge where
// the parent is rounded, the child is not, and no `overflow` clips it. Reverting
// the `.param-group > summary` radius reproduces exactly two hits (the open and
// closed header) and nothing else, so this is measuring what it claims to.
const CORNER_SCAN = `(() => {
  const px = (v) => parseFloat(v) || 0;
  const opaque = (bg, img) =>
    (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") || (img && img !== "none");
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const p = el.parentElement;
    if (!p) continue;
    const ps = getComputedStyle(p), es = getComputedStyle(el);
    const pr = px(ps.borderTopLeftRadius);
    if (pr <= 0) continue;
    if (ps.overflow !== "visible" || ps.overflowX !== "visible") continue;
    if (!opaque(es.backgroundColor, es.backgroundImage)) continue;
    const er = px(es.borderTopLeftRadius);
    if (er >= pr - 1.5) continue;
    const pb = p.getBoundingClientRect(), eb = el.getBoundingClientRect();
    if (eb.width === 0 || eb.height === 0) continue;
    const reachesX =
      eb.left <= pb.left + px(ps.borderLeftWidth) + 0.5 &&
      eb.right >= pb.right - px(ps.borderRightWidth) - 0.5;
    const reachesTop = eb.top <= pb.top + px(ps.borderTopWidth) + 0.5;
    const reachesBottom = eb.bottom >= pb.bottom - px(ps.borderBottomWidth) - 0.5;
    if (!reachesX || !(reachesTop || reachesBottom)) continue;
    const name = (n) => n.tagName.toLowerCase() + "." + String(n.className).split(" ").filter(Boolean).slice(0, 2).join(".");
    out.push(name(el) + " in " + name(p));
  }
  return [...new Set(out)];
})()`;

async function checkRoundedCorners({ page, check, paramsTabName }) {
  console.log("=== rounded corners: no square fill over a rounded parent ===");
  // Scan the params form in both its open and collapsed group states — the
  // header is a different box in each, and only one of them was caught by eye.
  await page.getByRole("tab", { name: paramsTabName }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  const open = await page.evaluate(CORNER_SCAN);
  check(open.length === 0, `no square-over-rounded corners with groups open${open.length ? ` (${open.join("; ")})` : ""}`);
  await page.locator(".param-group > summary").first().click().catch(() => {});
  await page.waitForTimeout(300);
  const collapsed = await page.evaluate(CORNER_SCAN);
  check(collapsed.length === 0, `no square-over-rounded corners with a group collapsed${collapsed.length ? ` (${collapsed.join("; ")})` : ""}`);
  // Leave the group as we found it.
  await page.locator(".param-group > summary").first().click().catch(() => {});
  await page.waitForTimeout(200);
}

async function checkViewerHudReachable({ browser, base, check }) {
  console.log("=== viewer HUD reachability (narrow + short viewports) ===");
  for (const [width, height] of [[360, 740], [320, 568]]) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    try {
      await page.goto(base, { waitUntil: "load" });
      await dismissWelcomePopup(page);
      await waitRenderDone(page).catch(() => {});
      for (const detent of ["peek", "half"]) {
        // Drive the sheet with the handle's ARROW KEYS, not its tap-to-cycle:
        // the starting detent depends on the first-visit policy (a tall
        // portrait viewport opens to half), so "click once to get to half"
        // silently lands somewhere else on some viewports. Arrow Down/Up step
        // one detent and stop at the ends, so Down x2 normalises to peek from
        // anywhere and Up x N walks to the one under test.
        await page.locator(".sheet-handle").focus();
        for (let i = 0; i < DETENTS.length - 1; i++) await page.keyboard.press("ArrowDown");
        for (let i = 0; i < DETENTS.indexOf(detent); i++) await page.keyboard.press("ArrowUp");
        // Assert we actually GOT there before measuring. Swallowing this (as a
        // bare `.catch(() => {})` would) turns a step that didn't take into a
        // green "half" result measured at peek — the failure mode this whole
        // check exists to catch, reported as a pass.
        const reached = await page
          .waitForSelector(`.bottom-sheet--${detent}`, { timeout: 3000 })
          .then(() => true)
          .catch(() => false);
        check(reached, `${width}x${height}: sheet reached the ${detent} detent`);
        if (!reached) continue;
        // Let the dock's `bottom` transition settle before measuring — it
        // mirrors the sheet's own 0.28s ease (see .action-dock in index.css).
        await page.waitForTimeout(450);
        const covered = await page.evaluate(() =>
          Array.from(document.querySelectorAll(".viewer-hud button"))
            .filter((b) => b.getBoundingClientRect().width > 0)
            .filter((b) => {
              const r = b.getBoundingClientRect();
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return !hit || !hit.closest(".viewer-hud");
            })
            .map((b) => b.getAttribute("aria-label") || b.textContent?.trim() || "?")
        );
        check(
          covered.length === 0,
          `${width}x${height} ${detent}: every viewer HUD button is hit-testable${covered.length ? ` (covered: ${covered.join(", ")})` : ""}`
        );
      }
    } finally {
      await context.close();
    }
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
    const ids = designs.map((d) => d.id);
    // Chrome copy comes from the i18n catalogue (src/locales/en.json), which a
    // deployment overrides per key via the config's `strings` block — so build
    // the matchers from what the app will ACTUALLY render, not from stock
    // English. Plural keys carry `#one`/`#other` variants (either may show, so
    // accept both) with a `{count}` placeholder standing in for a number.
    const catalogue = JSON.parse(
      await readFile(fileURLToPath(new URL("../src/locales/en.json", import.meta.url)), "utf-8")
    );
    const uiText = (key) => schema.strings?.[key] ?? catalogue[key] ?? "";
    // Panel tab names used to be config-overridable via ui.presetsLabel/
    // parametersLabel; they're catalogue keys now (presets.title/settings.title).
    const presetsTabName = uiText("presets.title") || "Presets";
    const paramsTabName = uiText("settings.title") || "Customize";
    const textRe = (...keys) =>
      new RegExp(
        keys
          .map(uiText)
          .filter(Boolean)
          .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{count\\\}/g, "\\d+"))
          .join("|"),
        "i"
      );
    const labels = {
      issues: textRe("review.issueCount#one", "review.issueCount#other"),
    };
    console.log(`=== designs (${ids.length || 1}): ${ids.join(", ") || "(single)"}  ===`);
    await waitRendered(page, ids[0]);

    const ctx = { page, browser, check, base, dir, schema, ids, presetsTabName, paramsTabName, labels };
    await checkWelcomePopup(ctx);
    await checkFileImport(ctx);
    await checkThemeToggle(ctx);
    await checkIdleRenderCount(ctx);
    await checkAxe(ctx);
    await checkEveryDesignRenders(ctx);
    await checkBundledPresets(ctx);
    await checkPresetCardGrid(ctx);
    await checkPresetImport(ctx);
    await checkExports(ctx);
    await checkExportDock(ctx);
    await checkStatusStripAndReview(ctx);
    await checkAfterExport(ctx);
    await checkPreviewControls(ctx);
    await checkServiceWorker(ctx);
    await checkTagDesign(ctx);
    await checkEditOnModel(ctx);
    await checkSignageDesign(ctx);
    await checkSectionNavigator(ctx);
    await checkResponsiveLayout(ctx);
    await checkFirstVisitSheetPolicy(ctx);
    await checkViewerHudReachable(ctx);
    await checkDocumentNeverScrolls(ctx);
    await checkRoundedCorners(ctx);

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
