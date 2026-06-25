// smoke.mjs — end-to-end check of the built app in a real browser, all in one
// process (an in-process static server for dist/ + headless Chromium). Confirms
// the default design auto-renders, switches to the textmetrics design, exports
// an STL via the UI, checks the textmetrics advisory surfaced, and runs axe-core
// to guard against serious/critical accessibility regressions. Run after
// `npm run build`.
import { readFile, mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { tmpdir } from "node:os";
import { startServer } from "./serve-dist.mjs";

async function waitRendered(page, label) {
  await page.waitForFunction(
    () =>
      /Rendered in \d+ ms/.test(
        document.querySelector(".status")?.textContent || ""
      ),
    { timeout: 60000 }
  );
  console.log(`  ${label}: ${(await page.textContent(".status")).trim()} ✅`);
}

// Switch design and wait for the fresh render (clearing the stale status first
// so waitRendered can't pass on the previous design's result).
async function selectDesign(page, id) {
  await page.selectOption(".design-picker select", id);
  await page
    .waitForFunction(
      () => !/Rendered in/.test(document.querySelector(".status")?.textContent || ""),
      { timeout: 5000 }
    )
    .catch(() => {});
  // Heavy designs don't auto-render; kick a render manually so the wait resolves.
  if (!(await page.locator(".auto-render input[type=checkbox]").isChecked()))
    await page.click("button:has-text('Render now')");
  await waitRendered(page, id);
}

async function main() {
  const { server, port, basePath } = await startServer();
  const base = `http://127.0.0.1:${port}${basePath}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let failures = 0;
  const check = (ok, msg) => console.log(`  ${ok ? "✅" : (failures++, "❌")} ${msg}`);
  const dir = await mkdtemp(join(tmpdir(), "taktil-smoke-"));

  try {
    await page.goto(base, { waitUntil: "load" });

    const ids = await page.$$eval(".design-picker select option", (os) =>
      os.map((o) => o.value)
    );
    console.log(`=== designs (${ids.length}): ${ids.join(", ")} ===`);
    await waitRendered(page, ids[0]);

    // External-file upload prompt: shown on startup only when the config sets a
    // `filePrompts` entry (font, SVG, …) and no file is stored. Where enabled it
    // must offer an upload and stay dismissed across reloads; its backdrop would
    // block later clicks, so handle it first.
    console.log("=== file upload prompt ===");
    const fileDialog = page.locator('[role="dialog"][aria-label="File upload"]');
    await fileDialog.waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
    if (await fileDialog.count()) {
      check(
        (await fileDialog.locator(".modal-actions .primary").count()) > 0,
        "file prompt offers an upload"
      );
      await fileDialog.locator(".link-btn").click(); // "Don't remind me again"
      await fileDialog.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
      await page.reload({ waitUntil: "load" });
      await waitRendered(page, ids[0]);
      await page.waitForTimeout(300); // give the (now-suppressed) prompt a chance
      check(
        (await page.locator('[role="dialog"][aria-label="File upload"]').count()) === 0,
        "file prompt stays dismissed after reload"
      );
    } else {
      console.log("  (no filePrompts in this config — skipped)");
    }

    console.log("=== theme toggle ===");
    const bg0 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    let themeChanged = false;
    for (let i = 0; i < 3 && !themeChanged; i++) {
      await page.click('[aria-label^="Theme"]');
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
        presetTested = true;
        break;
      }
    }
    if (!presetTested) console.log("  (no bundled presets in this config — skipped)");

    // Export STL + PNG on the first design.
    await selectDesign(page, ids[0]);
    console.log("=== export STL ===");
    const [stl] = await Promise.all([
      page.waitForEvent("download"),
      page.click("button:has-text('Export STL')"),
    ]);
    const stlOut = join(dir, await stl.suggestedFilename());
    await stl.saveAs(stlOut);
    check((await stat(stlOut)).size > 0, `${await stl.suggestedFilename()} (${(await stat(stlOut)).size} bytes)`);

    console.log("=== save PNG ===");
    const [png] = await Promise.all([
      page.waitForEvent("download"),
      page.click("button:has-text('Save PNG')"),
    ]);
    const pngOut = join(dir, await png.suggestedFilename());
    await png.saveAs(pngOut);
    const head = (await readFile(pngOut)).subarray(0, 4);
    const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    check(isPng && (await stat(pngOut)).size > 0, `${await png.suggestedFilename()} (png=${isPng})`);

    console.log("=== preview controls (share link + auto-render) ===");
    check(
      (await page.locator('button:has-text("Copy link")').count()) === 1,
      "copy-link button present"
    );
    const auto = page.locator(".auto-render input[type=checkbox]");
    check(await auto.isChecked(), "auto-render on by default (non-heavy design)");
    await auto.uncheck();
    check(!(await auto.isChecked()), "auto-render can be turned off");
    await auto.check();

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
      const holeRow = page.locator("label.param", {
        has: page.locator("code.param-var", { hasText: /^hole$/ }),
      });
      await holeRow.locator('input[type="checkbox"]').uncheck();
      await hd.first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
      check((await hd.count()) === 0, "hole_diameter hidden when hole off");
    }

    // textmetrics + @showIf arrow_style — exercised on "signage" when present.
    if (ids.includes("signage")) {
      console.log("=== signage: textmetrics + @showIf arrow_style ===");
      await selectDesign(page, "signage");
      await page.click(".log-toggle");
      check(/between characters/.test((await page.textContent(".log")) || ""), "textmetrics advisory present");
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
