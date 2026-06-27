import { chromium } from "playwright";
import { startServer } from "./serve-dist.mjs";
const OUT = "/tmp/claude-0/-home-user-scad-pub/2a6aad91-10f7-5652-9624-038fa86c7a71/scratchpad";

async function main() {
  const { server, port, basePath } = await startServer();
  const base = `http://127.0.0.1:${port}${basePath}`;
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  const d = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await d.goto(base, { waitUntil: "networkidle" });
  await d.getByRole("button", { name: /^OK$/ }).click().catch(() => {});
  await d.waitForFunction(() => /\d+ ms/.test(document.querySelector(".status-pill")?.getAttribute("aria-label") || ""), { timeout: 60000 }).catch(() => {});
  await d.waitForTimeout(400);

  // Files tab in the desktop panel
  await d.getByRole("tab", { name: "Files" }).click();
  await d.waitForTimeout(300);
  await d.screenshot({ path: `${OUT}/feat-desktop-files.png` });

  // Toast: click Share to copy the link
  await d.getByRole("button", { name: "Copy share link" }).first().click();
  await d.waitForTimeout(500);
  await d.screenshot({ path: `${OUT}/feat-desktop-toast.png` });

  await d.close();
  await browser.close();
  await server.close();
  console.log("feature shots written");
}
main().catch((e) => { console.error(e); process.exit(1); });
