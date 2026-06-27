// capture-screens.mjs — capture a screenshot of every ScadPub view at both the
// desktop and mobile layouts, then bundle them into a single zip.
//
// Serves the BUILT app (run `npm run build` first), drives headless Chromium
// through each view (welcome popup, both designs, presets, parameters, output
// console, help + licenses dialogs) at a desktop and a phone viewport, writes
// the PNGs under screenshots/captures/{desktop,mobile}/ and zips them to
// screenshots/scadpub-screenshots.zip. Output lives under the gitignored
// screenshots/ dir. Needs Chromium (PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH or a
// `playwright install chromium`).
import { mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startServer } from "./serve-dist.mjs";

const OUT_DIR = fileURLToPath(new URL("../screenshots/captures", import.meta.url));
const ZIP_PATH = fileURLToPath(new URL("../screenshots/scadpub-screenshots.zip", import.meta.url));

// Desktop (CommandBar + docked panel) vs mobile (top bar + bottom sheet). The
// 860px breakpoint in useIsMobile decides which layout mounts.
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitRendered(page) {
  await page
    .waitForFunction(
      () => /\d+ ms/.test(document.querySelector(".status-pill")?.getAttribute("aria-label") || ""),
      { timeout: 60000 }
    )
    .catch(() => {});
  await sleep(600); // let the WebGL canvas paint the model
}

async function shot(page, dir, name) {
  await page.screenshot({ path: `${dir}/${name}.png` });
  console.log(`  ✅ ${name}.png`);
}

async function selectDesign(page, kind, label) {
  const sel =
    kind === "mobile"
      ? '.mobile-top-bar__center [data-slot="select-trigger"]'
      : '.command-bar__design-picker [data-slot="select-trigger"]';
  const trigger = page.locator(sel);
  if (await trigger.count()) {
    await trigger.click();
    await page.getByRole("option", { name: label, exact: true }).click();
  }
  const renderBtn = page.getByRole("button", { name: "Render now" }).first();
  if (await renderBtn.count()) await renderBtn.click().catch(() => {});
  await waitRendered(page);
}

// Cycle the mobile bottom sheet to a target detent by tapping its handle.
async function sheetTo(page, target) {
  const order = ["peek", "half", "full"];
  for (let i = 0; i < 4; i++) {
    const cls = (await page.locator(".bottom-sheet").getAttribute("class")) || "";
    const at = order.find((d) => cls.includes(`bottom-sheet--${d}`)) || "peek";
    if (at === target) break;
    await page.locator(".sheet-handle").click();
    await sleep(350);
  }
}

async function closeDialog(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 3000 }).catch(() => {});
  await sleep(150);
}

async function captureViewport(browser, kind, base, theme) {
  const dir = `${OUT_DIR}/${kind}`;
  mkdirSync(dir, { recursive: true });
  const vp = VIEWPORTS[kind];
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
  });
  const page = await context.newPage();

  // Establish the origin, force the theme, reload so it applies before paint.
  await page.goto(base, { waitUntil: "load" });
  await page.evaluate((t) => localStorage.setItem("scadpub.theme", t), theme);
  await page.reload({ waitUntil: "load" });
  // The status pill always renders but is visually hidden in the mobile layout,
  // so wait for it to be attached (not visible) before polling its render state.
  await page.waitForSelector(".status-pill", { state: "attached", timeout: 30000 });
  await waitRendered(page);

  // 1. Welcome popup (config-driven schema.popup, shown on first visit).
  if (await page.locator('[role="dialog"]').count()) {
    await shot(page, dir, "01-welcome-popup");
    await page.locator(".notice-ok").click().catch(() => {});
    await sleep(250);
  }

  // 2. Landing view — Tag design.
  await shot(page, dir, "02-home-tag");

  // 3. Coin design.
  await selectDesign(page, kind, "Coin");
  await shot(page, dir, "03-design-coin");
  await selectDesign(page, kind, "Tag");

  // 4. Parameters + presets.
  if (kind === "mobile") {
    await sheetTo(page, "full");
    await page.getByRole("tab", { name: "Parameters" }).click().catch(() => {});
    await sleep(250);
    await shot(page, dir, "04-parameters");
    await page.getByRole("tab", { name: "Presets" }).click().catch(() => {});
    await sleep(250);
    await shot(page, dir, "05-presets");
    await sheetTo(page, "peek");
  } else {
    // Desktop parameters are always docked (visible in 02); capture the presets popover.
    await page.locator(".command-bar__presets-btn").click().catch(() => {});
    await sleep(300);
    await shot(page, dir, "04-presets");
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(200);
  }

  // 6. Output console.
  const outputSel =
    kind === "mobile"
      ? '.mobile-footer__output[aria-label="Open output console"]'
      : '.action-cluster__output[aria-label="Open output console"]';
  await page.locator(outputSel).click().catch(() => {});
  await page.waitForSelector(".output-console", { timeout: 5000 }).catch(() => {});
  await sleep(300);
  await shot(page, dir, "06-output-console");
  await page.locator(".output-console__close").click().catch(() => {});
  await sleep(200);

  // 7. Help dialog.
  await page.getByRole("button", { name: kind === "mobile" ? "Help" : "Help & keyboard shortcuts" })
    .first().click().catch(() => {});
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 }).catch(() => {});
  await sleep(300);
  await shot(page, dir, "07-help");
  await closeDialog(page);

  // 8. About & licenses dialog.
  await page.getByRole("button", { name: kind === "mobile" ? "About & licenses" : "Open-source licenses" })
    .first().click().catch(() => {});
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 }).catch(() => {});
  await sleep(300);
  await shot(page, dir, "08-about-licenses");
  await closeDialog(page);

  await context.close();
}

async function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  rmSync(ZIP_PATH, { force: true });
  const { server, port, basePath } = await startServer();
  const base = `http://127.0.0.1:${port}${basePath}`;
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  try {
    for (const kind of Object.keys(VIEWPORTS)) {
      console.log(`=== ${kind} ===`);
      await captureViewport(browser, kind, base, "light");
    }
  } finally {
    await browser.close();
    server.close();
  }
  // Bundle into a single zip (paths relative to screenshots/ → captures/...).
  execFileSync("zip", ["-r", "-q", ZIP_PATH, "captures"], {
    cwd: fileURLToPath(new URL("../screenshots", import.meta.url)),
  });
  console.log(`\nWrote ${ZIP_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
