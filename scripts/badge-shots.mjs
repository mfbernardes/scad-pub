// badge-shots.mjs — demo screenshots of the OpenSCAD-output badges:
// the default tag fires two notices (advisory + note); an over-deep engraving
// trips an assert. Captured on desktop and mobile with the Output console open.
import { chromium } from "playwright";
import { startServer } from "./serve-dist.mjs";

const OUT = process.env.SHOT_DIR || "/tmp/claude-0/-home-user-scad-pub/2a6aad91-10f7-5652-9624-038fa86c7a71/scratchpad";

async function waitSettled(page) {
  await page.waitForFunction(
    () => /\d+ ms|Failed/.test(document.querySelector(".status-pill")?.getAttribute("aria-label") || ""),
    { timeout: 60000 }
  ).catch(() => {});
  await page.waitForTimeout(400);
}
async function dismissPopup(page) {
  const btn = page.locator('.modal-backdrop button:has-text("OK"), .modal-backdrop .notice-ok');
  if (await btn.count()) await btn.first().click().catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);
}
async function openConsole(page) {
  if (await page.locator(".output-console").count()) return;
  await page.locator(".advisory-badge").first().click().catch(() => {});
  await page.waitForSelector(".output-console", { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(300);
}
async function closeConsole(page) {
  const x = page.locator(".output-console__close");
  if (await x.count()) { await x.click().catch(() => {}); await page.waitForTimeout(200); }
}
async function setNum(page, name, value) {
  const input = page.locator("label.param", { has: page.locator("code.param-var", { hasText: new RegExp(`^${name}$`) }) })
    .first().locator('input[type="number"]').first();
  await input.scrollIntoViewIfNeeded();
  await input.fill(String(value));
  await input.blur();
  await page.waitForTimeout(200);
}
async function checkBox(page, name) {
  const box = page.locator("label.param", { has: page.locator("code.param-var", { hasText: new RegExp(`^${name}$`) }) })
    .first().locator('input[type="checkbox"]');
  await box.scrollIntoViewIfNeeded();
  await box.check().catch(() => {});
  await page.waitForTimeout(200);
}
// engrave deeper than the plate is thick -> assert
async function triggerAssert(page) {
  await checkBox(page, "engrave_text");
  await setNum(page, "thickness", 1);
  await setNum(page, "text_depth", 2);
  await waitSettled(page);
}

async function main() {
  const { server, port, basePath } = await startServer();
  const base = `http://127.0.0.1:${port}${basePath}`;
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });

  // ── Desktop ──
  const d = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await d.goto(base, { waitUntil: "networkidle" });
  await dismissPopup(d);
  await waitSettled(d);
  await openConsole(d);
  await d.screenshot({ path: `${OUT}/badge-desktop-notices.png` });
  await closeConsole(d);

  await triggerAssert(d);
  await openConsole(d);
  await d.screenshot({ path: `${OUT}/badge-desktop-assert.png` });
  // Capture the URL with the assert-triggering params so mobile can reuse it.
  const assertUrl = await d.evaluate(() => location.href);
  await d.close();

  // ── Mobile ── (open the console via the footer "Output" button)
  const openConsoleMobile = async (page) => {
    if (await page.locator(".output-console").count()) return;
    await page.locator(".mobile-footer__output").click().catch(() => {});
    await page.waitForSelector(".output-console", { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(300);
  };

  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
  await m.goto(base, { waitUntil: "networkidle" });
  await dismissPopup(m);
  await waitSettled(m);
  await openConsoleMobile(m);
  await m.screenshot({ path: `${OUT}/badge-mobile-notices.png` });

  // Assert on mobile: reuse the URL-encoded params from the desktop assert run.
  const m2 = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
  await m2.goto(assertUrl, { waitUntil: "networkidle" });
  await dismissPopup(m2);
  await waitSettled(m2);
  await openConsoleMobile(m2);
  await m2.screenshot({ path: `${OUT}/badge-mobile-assert.png` });
  await m2.close();
  await m.close();

  await browser.close();
  await server.close();
  console.log("badge shots written to", OUT);
}
main().catch((e) => { console.error(e); process.exit(1); });
