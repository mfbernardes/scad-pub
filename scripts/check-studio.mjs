// check-studio.mjs: prove that `viewer.style: "studio"` actually lights the
// model, in a real browser, against a real build.
//
// This exists because the studio path had a bug nothing could catch. The rig
// disposed the PMREM render target and kept its texture — but a target owns its
// textures, so the environment map was freed before first use and the model
// rendered almost black. Every gate stayed green: the repo's own config uses
// `viewer.style: "plain"`, the visual suite masks the viewer outright, and no
// unit test can load viewerRig.ts because `PMREMGenerator.fromScene` needs a
// live GL context.
//
// WHAT IS ASSERTED, and why it is this and not something simpler: the
// environment map is an ambient light from above, so what it changes most is
// the model's DARKEST faces — the sides and undersides the two directional
// lights do not reach. With it alive those sit around 96/255; with it disposed
// they crush to 28. Mean brightness does NOT separate the two (207 vs 198 —
// the key and fill lights dominate it), which is why the first version of this
// check passed with the bug deliberately reintroduced. The 5th percentile of
// the model's own pixels does separate them, by more than 3x.
//
// That margin is what makes this safe to gate on. It measures a physical
// consequence of the lighting rather than exact pixels, so it does not need a
// baseline image and does not care about antialiasing, GPU or framing — where a
// pixel comparison of a WebGL canvas across machines would.
//
// Builds into its own outDir and restores the checkout's generated tree on the
// way out, so it can run alongside the ordinary build.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { makeCheck } from "./lib/check.mjs";
import { launchChromium, dismissWelcomePopup, PINNED_LOCALE } from "./lib/browser.mjs";
import { startServer } from "./serve-dist.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = join(ROOT, "dist-studio");
const CONFIG = join(ROOT, "studio.check.config.json");
const { check, state } = makeCheck();
// Between the lit (~96) and unlit (~28) measurements, with margin on both sides.
const SHADOW_FLOOR = 50;

console.log("=== studio viewer ===");

// A copy of this checkout's own config with the viewer style flipped. Written
// at the repo root so every config-relative path in it still resolves.
const base = JSON.parse(readFileSync(join(ROOT, "scadpub.config.json"), "utf-8"));
writeFileSync(
  CONFIG,
  JSON.stringify({ ...base, viewer: { ...(base.viewer ?? {}), style: "studio" } }, null, 2)
);

const run = (cmd, args, env) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });

let browser;
let server;
try {
  run("node", ["scripts/gen-schema.mjs"], { SCADPUB_CONFIG: CONFIG });
  run("npx", ["vite", "build", "--outDir", OUT_DIR, "--emptyOutDir"], { SCADPUB_CONFIG: CONFIG });

  ({ server } = await startServer(OUT_DIR));
  const port = server.address().port;

  browser = await launchChromium();
  const page = await browser.newPage({ ...PINNED_LOCALE, viewport: { width: 1280, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await dismissWelcomePopup(page);
  await page.waitForSelector("canvas", { timeout: 180000 });
  // The first render has to land before there is anything lit to measure.
  await page
    .waitForFunction(() => !document.body.textContent.includes("Rendering"), null, { timeout: 240000 })
    .catch(() => {});
  await page.waitForTimeout(6000);

  const shotPath = process.env.STUDIO_SHOT ?? join(mkdtempSync(join(tmpdir(), "studio-check-")), "canvas.png");
  await page.locator("canvas").screenshot({ path: shotPath });

  const png = PNG.sync.read(readFileSync(shotPath));
  const lum = (i) => 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];

  // The background is the four corners, which the model never reaches. The
  // model is whatever differs from it inside the central box — central so the
  // HUD column, the export dock and the over-viewer chips stay out of the
  // sample.
  const corner = [];
  const bw = Math.floor(png.width * 0.08);
  const bh = Math.floor(png.height * 0.08);
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++)
      if ((x < bw || x >= png.width - bw) && (y < bh || y >= png.height - bh))
        corner.push(lum((y * png.width + x) * 4));
  const background = corner.reduce((a, b) => a + b, 0) / corner.length;

  const model = [];
  for (let y = Math.floor(png.height * 0.3); y < png.height * 0.7; y++)
    for (let x = Math.floor(png.width * 0.3); x < png.width * 0.7; x++) {
      const l = lum((y * png.width + x) * 4);
      if (Math.abs(l - background) > 6) model.push(l);
    }
  model.sort((a, b) => a - b);

  if (
    check(
      model.length > png.width * png.height * 0.01,
      `the model occupies a real part of the frame (${model.length} px) — otherwise nothing rendered`
    )
  ) {
    const p05 = model[Math.floor(model.length * 0.05)];
    const mean = model.reduce((a, b) => a + b, 0) / model.length;
    console.log(`  background ≈ ${background.toFixed(1)}, model mean ≈ ${mean.toFixed(1)}`);
    // 50 sits between the two measured states (96 lit, 28 unlit) with roughly
    // 2x margin either side. Printed on both paths so a failure says how far.
    check(
      p05 > SHADOW_FLOOR,
      `the model's shadow side is lifted by the environment map ` +
        `(5th-percentile luminance ${p05} > ${SHADOW_FLOOR}; an environment disposed ` +
        `before use measures around 28)`
    );
  }
} finally {
  await browser?.close();
  server?.close();
  rmSync(CONFIG, { force: true });
  rmSync(OUT_DIR, { recursive: true, force: true });
  // Put the checkout's own generated tree back: this build overwrote
  // src/generated and public/ against the studio config.
  try {
    run("node", ["scripts/gen-schema.mjs"], {});
  } catch {
    console.warn("check-studio: could not regenerate the default schema — run `npm run gen`");
  }
}

console.log(state.failures ? `\nSTUDIO CHECK FAIL ❌ (${state.failures})` : "\nSTUDIO CHECK PASS ✅");
process.exit(state.failures ? 1 : 0);
