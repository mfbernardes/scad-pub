// smoke.mjs — end-to-end check of the built app in a real browser, all in one
// process (an in-process static server for dist/ + headless Chromium). Confirms
// the default design auto-renders, every design in the config renders, and a 3MF
// + PNG export work via the UI. Design-specific checks run only when that design
// is present in the built config: the example "tag" design exercises conditional
// visibility (@showIf/@collapsed) and the OpenSCAD-output notice/assert badges;
// a "signage" design, when configured, exercises the textmetrics advisory and
// @showIf arrow_style. Finally runs axe-core to guard against serious/critical
// accessibility regressions. Run after `npm run build`.
import { readFile, mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { tmpdir } from "node:os";
import { startServer } from "./serve-dist.mjs";

// Status pill shows "123 ms" or "123 ms (cached)" on success, "Failed (exit N)" on error.
// The status pill shows only a colour dot; its detail ("123 ms" / "Failed …")
// lives in aria-label and is revealed on click.
// Both layouts render a status pill (the inactive one is CSS-hidden but still in
// the DOM), and both carry the same aria-label — so read the first match.
const statusText = (page) =>
  page.locator(".status-pill").first().getAttribute("aria-label");

// Ensure the output console is open. It auto-opens when a render first surfaces
// a notice/assert, but a manual close (or a notice present before this point)
// means it may be shut — so click the Output toggle when it's not already open.
// The toggle's label is "Open output console" while closed.
async function openConsole(page) {
  if (await page.locator(".output-console").count()) return;
  // Desktop toggle (the mobile footer's twin is CSS-hidden at this viewport).
  await page.locator('.action-cluster__output[aria-label^="Open output console"]').click().catch(() => {});
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
  await page.waitForFunction(
    () => /\d+ ms/.test(document.querySelector(".status-pill")?.getAttribute("aria-label") || ""),
    { timeout: 60000 }
  );
  console.log(`  ${label ?? "default"}: ${((await statusText(page)) ?? "").replace(/^Render status: /, "").trim()} ✅`);
}

// Switch design and wait for the fresh render.
// Design id -> label, populated in main() from the generated schema. The picker
// is a shadcn/ui (Radix) Select, so we switch designs by clicking the trigger
// then the option whose visible text is the design's label.
const designLabels = {};

async function selectDesign(page, id) {
  if (id !== undefined) {
    const trigger = page.locator('.command-bar__design-picker [data-slot="select-trigger"]');
    if (await trigger.count()) {
      await trigger.click();
      await page.getByRole("option", { name: designLabels[id] ?? id, exact: true }).click();
      // Clear the cached "ok" state so waitRendered can't pass on prior render
      await page
        .waitForFunction(
          () => !/\d+ ms/.test(document.querySelector(".status-pill")?.getAttribute("aria-label") || ""),
          { timeout: 5000 }
        )
        .catch(() => {});
    }
  }
  // Every design renders once on first view; if a "Render now" button is present
  // (auto-render off + pending changes), click it to be safe.
  const renderBtn = page.getByRole("button", { name: "Render now" }).first();
  if (await renderBtn.count()) await renderBtn.click().catch(() => {});
  await waitRendered(page, id);
}

async function main() {
  const { server, port, basePath } = await startServer();
  const base = `http://127.0.0.1:${port}${basePath}`;
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let failures = 0;
  const check = (ok, msg) => console.log(`  ${ok ? "✅" : (failures++, "❌")} ${msg}`);
  const dir = await mkdtemp(join(tmpdir(), "taktil-smoke-"));

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
    console.log(`=== designs (${ids.length || 1}): ${ids.join(", ") || "(single)"}  ===`);
    await waitRendered(page, ids[0]);

    // Configurable popup (schema.popup): the example config shows a dismissible
    // welcome notice on load. It overlays the app behind a modal backdrop that
    // intercepts pointer events, so dismiss it before driving the UI — ticking
    // "Don't show this again" persists the dismissal so it stays gone across the
    // reloads the later checks perform.
    console.log("=== welcome popup ===");
    const popup = page.getByRole("dialog", { name: /Welcome to ScadPub/i });
    if (await popup.count()) {
      check(true, "welcome popup shown on load");
      check(
        (await popup.getByRole("link", { name: /GitHub/i }).count()) > 0,
        "popup body renders its link"
      );
      await popup.getByRole("checkbox").check();
      await popup.getByRole("button", { name: /^OK$/ }).click();
      await popup.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
      check((await page.getByRole("dialog").count()) === 0, "popup dismissed");
    } else {
      console.log("  (no popup in this config — skipped)");
    }

    // Generic file import: the Files manager shows an "Import file" button when
    // the config sets `fileImport`. Uploading a file should surface it in the
    // file list and persist across a reload (IndexedDB).
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

    console.log("=== theme toggle ===");
    const bg0 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    let themeChanged = false;
    // Theme is now a direct icon button in the CommandBar (first .icon-btn in the right section)
    for (let i = 0; i < 3 && !themeChanged; i++) {
      await page.locator('.command-bar__right .icon-btn').first().click();
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

    console.log("=== accessibility (axe-core) ===");
    await page.addScriptTag({
      path: fileURLToPath(new URL("../node_modules/axe-core/axe.min.js", import.meta.url)),
    });
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
    check(serious.length === 0, `axe: ${serious.length} serious/critical violation(s)`);

    console.log("=== every design renders ===");
    for (const id of ids) await selectDesign(page, id);

    // Bundled presets — exercised on the first design that ships any.
    console.log("=== bundled presets ===");
    let presetTested = false;
    for (const id of ids) {
      await selectDesign(page, id);
      const opts = await page.$$eval('optgroup[label="Bundled"] option', (os) =>
        os.map((o) => o.value)
      );
      if (opts.length) {
        await page.selectOption(".preset-bar select", opts[0]);
        await waitRendered(page, `${id} + "${opts[0]}"`);
        check((await page.inputValue(".preset-bar select")) === opts[0], `applied ${opts[0]}`);
        // The selection is encoded in the URL and auto-selected on reload.
        check(
          /[#&]p=/.test(await page.evaluate(() => location.hash)),
          "selected preset is encoded in the URL"
        );
        await page.reload({ waitUntil: "load" });
        await waitRendered(page, `${id} reloaded`);
        check(
          (await page.inputValue(".preset-bar select")) === opts[0],
          "preset auto-selected from the URL after reload"
        );
        // Editing a parameter flags the preset as "(modified)" in the dropdown.
        const num = page.locator('.param-form input[type="number"]').first();
        await num.fill("85");
        await num.blur();
        await page.waitForTimeout(200);
        check(
          (await page.inputValue(".preset-bar select")) === "__modified__",
          "editing a param flags the preset as modified"
        );
        check(
          /\(modified\)/.test(
            (await page.locator(".preset-bar select option:checked").textContent()) ?? ""
          ),
          "dropdown shows the (modified) label"
        );
        presetTested = true;
        break;
      }
    }
    if (!presetTested) console.log("  (no bundled presets in this config — skipped)");

    // Export 3MF + PNG on the first design.
    await selectDesign(page, ids[0]);
    console.log("=== export 3MF ===");
    const [model] = await Promise.all([
      page.waitForEvent("download"),
      // ActionCluster uses aria-label="Export STL/3MF"; button text is just the format
      page.click('[aria-label^="Export "]'),
    ]);
    const modelOut = join(dir, await model.suggestedFilename());
    await model.saveAs(modelOut);
    check((await stat(modelOut)).size > 0, `${await model.suggestedFilename()} (${(await stat(modelOut)).size} bytes)`);

    console.log("=== save PNG ===");
    const [png] = await Promise.all([
      page.waitForEvent("download"),
      page.click('[aria-label="Save PNG"]'),
    ]);
    const pngOut = join(dir, await png.suggestedFilename());
    await png.saveAs(pngOut);
    const head = (await readFile(pngOut)).subarray(0, 4);
    const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    check(isPng && (await stat(pngOut)).size > 0, `${await png.suggestedFilename()} (png=${isPng})`);

    console.log("=== preview controls (share link + auto-render) ===");
    check(
      (await page.locator('[aria-label="Copy share link"]').count()) >= 1,
      "copy-link button present"
    );
    // Auto-render: a shadcn/ui Switch (role=switch) in the ActionCluster.
    const auto = page.getByRole("switch", { name: /Auto-render/i }).first();
    const autoOn = async () => (await auto.getAttribute("aria-checked")) === "true";
    check(await autoOn(), "auto-render on by default (non-heavy design)");
    await auto.click();
    check(!(await autoOn()), "auto-render can be turned off");
    await auto.click();

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

    // @showIf + @collapsed — exercised on the example "tag" design when present.
    if (ids.includes("tag")) {
      console.log("=== conditional visibility (@showIf, tag) ===");
      await selectDesign(page, "tag");
      // Back to the Parameters tab (the file-import test left the panel on Files).
      await page.getByRole("tab", { name: "Parameters" }).click().catch(() => {});

      // @collapsed: the "Quality" group starts folded; its params are hidden
      // until the group header is opened.
      const quality = page.locator("details.param-group", {
        has: page.locator("summary", { hasText: "Quality" }),
      });
      check((await quality.count()) === 1, "Quality group is collapsible");
      const facet = page.locator("code.param-var", { hasText: /^facet_angle$/ });
      check(!(await facet.isVisible()), "collapsed @collapsed group hides its params");
      await quality.locator("summary").click();
      check(await facet.isVisible(), "opening the group reveals its params");

      const hd = page.locator("code.param-var", { hasText: /^hole_diameter$/ });
      check((await hd.count()) > 0, "hole_diameter shown when hole on");
      const holeRow = page.locator(".param", {
        has: page.locator("code.param-var", { hasText: /^hole$/ }),
      });
      await holeRow.getByRole("checkbox").uncheck();
      await hd.first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
      check((await hd.count()) === 0, "hole_diameter hidden when hole off");

      console.log("=== notice + assert badges on the OpenSCAD output panel (tag) ===");
      // Start from known defaults (also re-checks `hole` toggled off above).
      await resetDefaults(page);
      await waitRendered(page, "tag");

      const paramRow = (name) =>
        page.locator(".param", {
          has: page.locator("code.param-var", { hasText: new RegExp(`^${name}$`) }),
        });
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
      await paramRow("engrave_text").getByRole("checkbox").check();
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
        const input = paramRow(name).locator('input[type="number"]');
        await input.fill(String(value));
        await input.blur();
      };
      await setNum("thickness", 1);
      await setNum("text_depth", 2);
      check(
        await waitFor(() =>
          /Failed/.test(document.querySelector(".status-pill")?.getAttribute("aria-label") || "")
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

    // textmetrics + @showIf arrow_style — exercised on "signage" when present.
    if (ids.includes("signage")) {
      console.log("=== signage: textmetrics + @showIf arrow_style ===");
      await selectDesign(page, "signage");
      // Open the output console and switch to the Log tab.
      await openConsole(page);
      await page.click('.output-console__tab:has-text("Log")').catch(() => {});
      check(/between characters/.test((await page.textContent(".output-console").catch(() => "")) || ""), "textmetrics advisory present");
      // arrow_style is relevant only once an arrow is chosen (`@showIf arrow != none`);
      // the signage default is arrow = "none", so it starts hidden.
      const arrowStyle = page.locator("code.param-var", { hasText: /^arrow_style$/ });
      check((await arrowStyle.count()) === 0, "arrow_style hidden when arrow = none");
      const arrowRow = page.locator("label.param", {
        has: page.locator("code.param-var", { hasText: /^arrow$/ }),
      });
      await arrowRow.locator("select").selectOption("right");
      await arrowStyle.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
      check((await arrowStyle.count()) > 0, "arrow_style shown when arrow = right");
      await waitRendered(page, "arrow");
    }

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
