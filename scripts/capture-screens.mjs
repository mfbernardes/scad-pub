// capture-screens.mjs — capture a screenshot of every ScadPub view, in both
// the light and dark themes, at the desktop and mobile layouts, then bundle
// them into a single zip.
//
// Serves the BUILT app (run `npm run build` first), drives headless Chromium
// through each view at a desktop and a phone viewport for each theme, writes the
// PNGs under screenshots/captures/<viewport>/<theme>/ and zips them to
// screenshots/scadpub-screenshots.zip. On mobile it also walks the bottom sheet
// through all three detents (peek/half/full) and each of its tabs (Presets,
// Parameters) — Files is a toolbar-opened dialog now, not a tab, so it's
// captured alongside Help/Licenses instead. Output lives under the gitignored
// screenshots/ dir. Needs Chromium (PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH or a
// `playwright install chromium`).
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { startServer } from "./serve-dist.mjs";
import {
  launchChromium,
  gotoWithTheme,
  dismissWelcomePopup,
  waitRendered as waitRenderDone,
  selectDesign as pickDesign,
} from "./lib/browser.mjs";

const OUT_DIR = fileURLToPath(new URL("../screenshots/captures", import.meta.url));
const ZIP_PATH = fileURLToPath(new URL("../screenshots/scadpub-screenshots.zip", import.meta.url));

const THEMES = ["light", "dark"];

// Desktop (CommandBar + docked panel) vs mobile (top bar + bottom sheet). The
// 860px breakpoint in useIsMobile decides which layout mounts.
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitRendered(page) {
  // Tolerate a missing render (a shot of a loading state still has value here).
  await waitRenderDone(page).catch(() => {});
  await sleep(600); // let the WebGL canvas paint the model
}

async function shot(page, dir, name) {
  await page.screenshot({ path: `${dir}/${name}.png` });
  console.log(`  ✅ ${name}.png`);
}

async function selectDesign(page, kind, label) {
  await pickDesign(page, label, { mobile: kind === "mobile" });
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

async function closeConsole(page) {
  // Both layouts render an .output-console (one is CSS-hidden), so target the
  // visible one to avoid a strict-mode multiple-match on the close button.
  const close = page.locator(".output-console__close:visible").first();
  if (await close.count()) {
    await close.click().catch(() => {});
    await sleep(200);
  }
}

async function closeDialog(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 3000 }).catch(() => {});
  await sleep(150);
}

async function captureViewport(context, base, kind, theme) {
  const dir = `${OUT_DIR}/${kind}/${theme}`;
  mkdirSync(dir, { recursive: true });
  const page = await context.newPage();

  // Establish the origin, force the theme, then reload so it applies before paint.
  await gotoWithTheme(page, base, theme);
  // The Output bell's status live region always renders but is visually hidden,
  // so wait for it to be attached (not visible) before polling its render state.
  await page.waitForSelector(".render-status", { state: "attached", timeout: 30000 });
  await waitRendered(page);

  // 1. Welcome popup (config-driven schema.popup, shown on first visit).
  if (await page.locator('[role="dialog"]').count()) {
    await shot(page, dir, "01-welcome-popup");
    await dismissWelcomePopup(page);
    await sleep(250);
  }

  // 2. Landing view — Tag design (the console auto-opens on its default notices).
  await shot(page, dir, "02-home-tag");

  // 3. Coin design.
  await selectDesign(page, kind, "Coin");
  await shot(page, dir, "03-design-coin");
  await selectDesign(page, kind, "Tag");

  if (kind === "mobile") {
    // 4. Bottom-sheet drawer in each detent, then each tab at full height.
    // Returning to Tag re-auto-opens the console on its notices; wait for that,
    // then close it so the drawer-position shots show a clean canvas.
    await page.waitForSelector(".output-console", { timeout: 3000 }).catch(() => {});
    await closeConsole(page);
    await sheetTo(page, "peek");
    await shot(page, dir, "04-drawer-peek");
    await sheetTo(page, "half");
    await shot(page, dir, "05-drawer-half");
    await sheetTo(page, "full");
    for (const [n, tab] of [
      ["06", "Presets"],
      ["07", "Customize"],
    ]) {
      await page.getByRole("tab", { name: tab }).click().catch(() => {});
      await sleep(250);
      await shot(page, dir, `${n}-tab-${tab.toLowerCase()}`);
    }
    await sheetTo(page, "peek");
  } else {
    // 4. Desktop parameters are always docked (visible in 02); switch the panel
    // to its Presets tab for the shot, then back to Parameters.
    await page.getByRole("tab", { name: "Presets" }).first().click().catch(() => {});
    await sleep(300);
    await shot(page, dir, "04-presets");
    await page.getByRole("tab", { name: "Customize" }).first().click().catch(() => {});
    await sleep(200);
  }

  // 8 / 5. Output console. The Output bell lives in the top bar in both layouts —
  // the mobile top bar and the desktop CommandBar.
  const outputSel =
    kind === "mobile"
      ? '.mobile-top-bar__output[aria-label^="Open Messages"]'
      : '.command-bar__output[aria-label^="Open Messages"]';
  const consoleName = kind === "mobile" ? "08-output-console" : "05-output-console";
  await page.locator(outputSel).click().catch(() => {});
  await page.waitForSelector(".output-console", { timeout: 5000 }).catch(() => {});
  await sleep(300);
  await shot(page, dir, consoleName);
  await closeConsole(page);

  // On mobile, Files/Help/Licenses live behind the top bar's "⋮" overflow menu;
  // open it before each. On desktop they're inline in the CommandBar (BarActions).
  const openOverflow = async () => {
    if (kind !== "mobile") return;
    await page.getByRole("button", { name: "More actions" }).first().click().catch(() => {});
    await sleep(150);
  };

  // Files dialog (BarActions' "Files" action — a toolbar icon on desktop, a
  // row in the mobile overflow). Only rendered when the config sets
  // `fileImport` (this repo's example config does); skip gracefully otherwise,
  // same guard as smoke.mjs's own file-import check, closing any overflow
  // popover this opened so it doesn't linger over the next shot.
  const filesName = kind === "mobile" ? "09-files" : "06-files";
  await openOverflow();
  const filesBtn = page.getByRole("button", { name: "Files", exact: true }).first();
  if (await filesBtn.count()) {
    await filesBtn.click().catch(() => {});
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 }).catch(() => {});
    await sleep(300);
    await shot(page, dir, filesName);
    await closeDialog(page);
  } else {
    console.log("  (no fileImport in this config — Files dialog skipped)");
    await page.keyboard.press("Escape").catch(() => {});
  }

  // Help + About dialogs.
  const helpName = kind === "mobile" ? "10-help" : "07-help";
  const aboutName = kind === "mobile" ? "11-about-licenses" : "08-about-licenses";
  await openOverflow();
  await page.getByRole("button", { name: kind === "mobile" ? "Help" : "Help & keyboard shortcuts" })
    .first().click().catch(() => {});
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 }).catch(() => {});
  await sleep(300);
  await shot(page, dir, helpName);
  await closeDialog(page);

  await openOverflow();
  await page.getByRole("button", { name: "Open-source licenses" })
    .first().click().catch(() => {});
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 }).catch(() => {});
  await sleep(300);
  await shot(page, dir, aboutName);
  await closeDialog(page);

  await page.close();
}

async function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  rmSync(ZIP_PATH, { force: true });
  const { server, port, basePath } = await startServer();
  const base = `http://127.0.0.1:${port}${basePath}`;
  const browser = await launchChromium();
  try {
    for (const kind of Object.keys(VIEWPORTS)) {
      const vp = VIEWPORTS[kind];
      for (const theme of THEMES) {
        console.log(`=== ${kind} / ${theme} ===`);
        // Fresh context per theme: clean storage so the welcome popup shows again.
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: vp.deviceScaleFactor,
          isMobile: vp.isMobile,
          hasTouch: vp.isMobile,
        });
        await captureViewport(context, base, kind, theme);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  // Bundle into a single zip (entries relative to screenshots/ → captures/...).
  // Pure Node via fflate — no system `zip` binary needed (same principle as
  // fetch-wasm.mjs, which unzips with fflate).
  const files = {};
  for (const entry of readdirSync(OUT_DIR, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath, entry.name);
    // Zip entry names always use forward slashes, whatever the host separator.
    const rel = abs.slice(OUT_DIR.length + 1).split("\\").join("/");
    files[`captures/${rel}`] = readFileSync(abs);
  }
  writeFileSync(ZIP_PATH, zipSync(files));
  console.log(`\nWrote ${ZIP_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
