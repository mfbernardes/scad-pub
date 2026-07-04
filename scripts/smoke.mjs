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
    const dontShow = popup.getByRole("checkbox");
    if (await dontShow.count()) await dontShow.check();
    await popup.getByRole("button", { name: /^OK$/ }).click();
    await popup.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    check((await page.getByRole("dialog").count()) === 0, "popup dismissed");
  } else {
    console.log("  (no popup in this config — skipped)");
  }
}

// Generic file import: the Files manager shows an "Import file" button when
// the config sets `fileImport`. Uploading a file should surface it in the
// file list and persist across a reload (IndexedDB).
async function checkFileImport({ page, check, ids }) {
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

async function checkAxe({ page, check }) {
  console.log("=== accessibility (axe-core) ===");
  await page.addScriptTag({
    path: fileURLToPath(new URL("../node_modules/axe-core/axe.min.js", import.meta.url)),
  });
  // Palettes are per-theme (and config-overridable per theme), so a contrast
  // regression can hide in whichever theme a single sweep doesn't visit: run
  // the AA sweep in the current theme, then toggle and sweep the other. The
  // second toggle also returns the app to the theme it started the section in.
  for (let pass = 0; pass < 2; pass++) {
    const theme = await page.getAttribute("html", "data-theme");
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
      await page.waitForTimeout(80); // let the palette swap land before the next sweep
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
    // Ready-made presets sit in the "Ready-made" section's listbox.
    const bundled = page.locator('[aria-label="Ready-made presets"] .preset-picker__item');
    if (await bundled.count()) {
      const name = (await bundled.first().textContent())?.trim() ?? "";
      await bundled.first().click();
      await waitRendered(page, `${id} + "${name}"`);
      // The applied preset shows as selected, and the choice is in the URL.
      check(
        (await page.locator('[aria-label="Ready-made presets"] [role="option"][aria-selected="true"]').count()) >= 1,
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
        (await page.locator('[aria-label="Ready-made presets"] [role="option"][aria-selected="true"]').count()) >= 1,
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

// Export 3MF + PNG on the first design.
async function checkExports({ page, check, ids, dir }) {
  await selectDesign(page, ids[0]);
  console.log("=== export 3MF ===");
  const [model] = await Promise.all([
    page.waitForEvent("download"),
    // ActionCluster uses aria-label="Export STL/3MF"; button text is just the format
    page.click('[aria-label^="Download "]'),
  ]);
  const modelOut = join(dir, await model.suggestedFilename());
  await model.saveAs(modelOut);
  check((await stat(modelOut)).size > 0, `${await model.suggestedFilename()} (${(await stat(modelOut)).size} bytes)`);

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

// @showIf + @collapsed — exercised on the example "tag" design when present.
// Param rows are located by their stable data-param hook, which exists
// regardless of ui.showVarName, so this block runs in every config.
async function checkTagDesign({ page, check, ids, paramsTabName }) {
  if (!ids.includes("tag")) return;
  console.log("=== conditional visibility (@showIf, tag) ===");
  await selectDesign(page, "tag");
  // Back to the Customize tab (the file-import test left the panel on Files).
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
  await paramRow(page, "arrow").locator('[data-slot="select-trigger"]').click();
  await page.getByRole("option", { name: "right" }).click();
  await arrowStyle.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  check((await arrowStyle.count()) > 0, "arrow_style shown when arrow = right");
  await waitRendered(page, "arrow");
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

    const ctx = { page, check, base, dir, schema, ids, presetsTabName, paramsTabName };
    await checkWelcomePopup(ctx);
    await checkFileImport(ctx);
    await checkThemeToggle(ctx);
    await checkAxe(ctx);
    await checkEveryDesignRenders(ctx);
    await checkBundledPresets(ctx);
    await checkPresetImport(ctx);
    await checkExports(ctx);
    await checkPreviewControls(ctx);
    await checkServiceWorker(ctx);
    await checkTagDesign(ctx);
    await checkSignageDesign(ctx);

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
