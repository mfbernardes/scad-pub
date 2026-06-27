// shots.mjs — capture UI screenshots of the built app for visual comparison.
import { chromium } from "playwright";
import { startServer } from "./serve-dist.mjs";

const OUT = process.env.SHOT_DIR || "/tmp/claude-0/-home-user-scad-pub/2a6aad91-10f7-5652-9624-038fa86c7a71/scratchpad";

async function waitRendered(page) {
  await page.waitForFunction(
    () => /\d+ ms/.test(document.querySelector(".status-pill")?.getAttribute("aria-label") || ""),
    { timeout: 60000 }
  ).catch(() => {});
}

async function dismissPopup(page) {
  const btn = page.locator('.modal-backdrop button:has-text("Got it"), .modal-backdrop .notice-ok, .modal-backdrop button:has-text("OK"), .modal-backdrop button:has-text("Close")');
  if (await btn.count()) await btn.first().click().catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);
}

async function applyFirstPreset(page) {
  // Open the command-bar presets dropdown and pick the first bundled preset.
  const trigger = page.locator(".command-bar__presets-btn");
  if (await trigger.count()) {
    await trigger.click();
    await page.waitForTimeout(200);
    const item = page.locator(".command-bar__presets-popover .preset-picker__item").first();
    if (await item.count()) { await item.click(); await page.waitForTimeout(300); }
    await page.keyboard.press("Escape").catch(() => {});
  }
}

async function main() {
  const { server, port, basePath } = await startServer();
  const base = `http://127.0.0.1:${port}${basePath}`;
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });

  // Desktop dark
  const d = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await d.goto(base, { waitUntil: "networkidle" });
  await dismissPopup(d);
  await waitRendered(d);
  await applyFirstPreset(d);
  await waitRendered(d);
  await d.waitForTimeout(500);
  await d.screenshot({ path: `${OUT}/shot-desktop-dark.png` });

  // Desktop dark — command-bar presets popover open
  await d.locator(".command-bar__presets-btn").click();
  await d.waitForTimeout(300);
  await d.screenshot({ path: `${OUT}/shot-desktop-presets.png` });
  await d.keyboard.press("Escape");

  // Desktop light
  await d.emulateMedia({ colorScheme: "light" });
  await d.waitForTimeout(300);
  await d.screenshot({ path: `${OUT}/shot-desktop-light.png` });
  await d.close();

  // Mobile dark
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
  await m.goto(base, { waitUntil: "networkidle" });
  await dismissPopup(m);
  await waitRendered(m);
  await m.waitForTimeout(600);
  await m.screenshot({ path: `${OUT}/shot-mobile-peek.png` });

  const handle = m.locator(".sheet-handle");
  if (await handle.count()) await handle.click();
  await m.waitForTimeout(400);
  const presetsTab = m.locator('.sheet-tabs__tab:has-text("Presets")');
  if (await presetsTab.count()) await presetsTab.click();
  await m.waitForTimeout(300);
  await m.screenshot({ path: `${OUT}/shot-mobile-presets.png` });

  const filesTab = m.locator('.sheet-tabs__tab:has-text("Files")');
  if (await filesTab.count()) { await filesTab.click(); await m.waitForTimeout(300); await m.screenshot({ path: `${OUT}/shot-mobile-files.png` }); }
  await m.close();

  await browser.close();
  await server.close();
  console.log("shots written to", OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
