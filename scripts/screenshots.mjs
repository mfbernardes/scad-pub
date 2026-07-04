// screenshots.mjs — light + dark visual-regression of the built UI. Serves
// dist/ in-process, drives headless Chromium at a fixed viewport, and compares
// a full-page screenshot of each theme against a committed baseline.
//
// The WebGL viewer and everything whose presence/content depends on render
// timing (see MASK_CSS) are masked, so the check covers the deterministic
// chrome (top bar, parameter form, action row) only — the 3D canvas is
// non-deterministic across GPUs and is exercised by smoke.mjs.
//
// Baselines are environment-pinned (font rendering differs across OSes), like
// the OpenSCAD reference images in tests/. Regenerate with `--update` (or the
// first run, when no baseline exists yet). Run after `npm run build`.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { startServer } from "./serve-dist.mjs";
import { launchChromium, gotoWithTheme, dismissWelcomePopup } from "./lib/browser.mjs";

const UPDATE = process.argv.includes("--update");
const BASELINE_DIR = fileURLToPath(new URL("../tests/screenshots", import.meta.url));
const DIFF_DIR = fileURLToPath(new URL("../screenshots", import.meta.url));
const THEMES = ["light", "dark"];
// Allow a small fraction of pixels to differ (sub-pixel AA jitter) before failing.
const MAX_DIFF_RATIO = 0.01;

// Hide everything that isn't deterministic so the baseline is stable run-to-run.
// Each selector is a literal class hook the app keeps for these scripts (see
// CLAUDE.md); the volatile render-timing text itself (`.render-status`) is
// sr-only, so it never needs masking.
const MASK_CSS = `
  /* WebGL canvas + its loading/rendering overlay: pixel output differs across
     GPUs/drivers, and whether the spinner is still up depends on render timing
     relative to the screenshot. Exercised by smoke.mjs instead. */
  .viewer, .viewer-overlay { visibility: hidden !important; }
  /* Measurements panel (bounding box + @info values): appears only once a
     render lands, so its presence depends on render timing. */
  .dimension-info { visibility: hidden !important; }
  /* Output console: auto-opens when the default design's render surfaces its
     notices — open/closed depends on render timing — and its Log tab carries
     run-dependent OpenSCAD output. display:none (not visibility) so an opened
     console also doesn't shift the layout relative to a closed one. */
  .output-console { display: none !important; }
  /* Output bell: its corner wears a render-status dot (pulsing while a render
     runs) or a pending-notice count badge once the render surfaces notices —
     both change with render progress. */
  .command-bar__output { visibility: hidden !important; }
`;

async function shoot(page, base, theme) {
  await gotoWithTheme(page, base, theme);
  // Dismiss the first-visit welcome popup if present so it doesn't cover the
  // panel (and would block the tab click below).
  await dismissWelcomePopup(page);
  // The panel opens on the Presets tab; switch to Parameters so the baseline
  // keeps exercising the param form (a richer regression surface).
  await page.getByRole("tab", { name: "Parameters" }).first().click().catch(() => {});
  await page.waitForSelector(".param-form", { timeout: 30000 });
  await page.addStyleTag({ content: MASK_CSS });
  await page.waitForTimeout(150); // let fonts/layout settle
  return PNG.sync.read(await page.screenshot({ fullPage: true }));
}

function compare(theme, actual) {
  const baselinePath = `${BASELINE_DIR}/${theme}.png`;
  if (UPDATE || !existsSync(baselinePath)) {
    mkdirSync(BASELINE_DIR, { recursive: true });
    writeFileSync(baselinePath, PNG.sync.write(actual));
    console.log(`  ${theme}: baseline written (${actual.width}×${actual.height}) ✅`);
    return true;
  }
  const expected = PNG.sync.read(readFileSync(baselinePath));
  if (expected.width !== actual.width || expected.height !== actual.height) {
    console.log(
      `  ❌ ${theme}: size changed ${expected.width}×${expected.height} -> ${actual.width}×${actual.height} (rebaseline with --update)`
    );
    return false;
  }
  const { width, height } = expected;
  const diff = new PNG({ width, height });
  const changed = pixelmatch(expected.data, actual.data, diff.data, width, height, {
    threshold: 0.2,
  });
  const ratio = changed / (width * height);
  const ok = ratio <= MAX_DIFF_RATIO;
  if (!ok) {
    mkdirSync(DIFF_DIR, { recursive: true });
    writeFileSync(`${DIFF_DIR}/${theme}-diff.png`, PNG.sync.write(diff));
  }
  console.log(
    `  ${ok ? "✅" : "❌"} ${theme}: ${changed} px differ (${(ratio * 100).toFixed(2)}%${
      ok ? "" : ` > ${MAX_DIFF_RATIO * 100}% — see screenshots/${theme}-diff.png`
    })`
  );
  return ok;
}

async function main() {
  const { server, port, basePath } = await startServer();
  const base = `http://127.0.0.1:${port}${basePath}`;
  const browser = await launchChromium();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  let failures = 0;
  try {
    console.log(`=== visual regression (${UPDATE ? "updating baselines" : "comparing"}) ===`);
    for (const theme of THEMES) {
      const png = await shoot(page, base, theme);
      if (!compare(theme, png)) failures++;
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${failures === 0 ? "VISUAL PASS ✅" : `${failures} VISUAL FAILURE(S) ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
