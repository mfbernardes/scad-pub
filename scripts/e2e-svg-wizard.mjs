// e2e-svg-wizard.mjs: manual end-to-end for the @svg field wizard. Drives the
// BUILT app: opens the tag design's @svg field, drops an SVG with issues, walks
// the wizard (check -> fix -> use), and confirms the fixed SVG imports and the
// 3D render updates. Run: node scripts/e2e-svg-wizard.mjs (after npm run build).
import { startServer } from "./serve-dist.mjs";
import {
  launchChromium,
  waitRendered,
  dismissWelcomePopup,
  selectDesign,
} from "./lib/browser.mjs";

const DIRTY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50">
  <text x="20" y="40">hello</text>
  <rect x="10" y="20" width="100" height="50" fill="black"/>
</svg>`;

let failures = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "✅" : "❌"} ${msg}`);
  if (!ok) failures++;
};

const { server, port, basePath } = await startServer();
const base = `http://127.0.0.1:${port}${basePath}`;

const browser = await launchChromium();
const page = await browser.newPage();
try {
  await page.goto(base, { waitUntil: "load" });
  await dismissWelcomePopup(page);
  await selectDesign(page, "Tag");
  await waitRendered(page).catch(() => {});
  // Bring the Customize panel forward (the design's parameters live there).
  await page.getByRole("tab", { name: "Customize" }).click().catch(() => {});

  // The @svg field replaces the plain path box with a drop zone + button.
  const field = page.locator('[data-svg-field="svg_file"]');
  check((await field.count()) === 1, "svg_file renders as the Prepare-SVG affordance");
  check(
    await page.getByRole("button", { name: /Prepare SVG for/i }).count() > 0,
    "‘Prepare SVG…’ button present",
  );

  // Feed the wizard a problematic SVG through the field's hidden file input.
  await field.locator('input[type="file"]').setInputFiles({
    name: "demo.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(DIRTY_SVG),
  });

  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  check(true, "wizard dialog opened");

  const bodyText = await dialog.textContent();
  check(/text can't be raised/.test(bodyText), "check step flags dropped <text>");
  check(/doesn't start at the top-left corner/.test(bodyText), "check step flags the off-origin viewBox");

  await dialog.getByRole("button", { name: /Fix & continue/i }).click();
  const fixText = await dialog.textContent();
  check(/re-centred the drawing/.test(fixText), "fix step reports the viewBox normalisation");

  await dialog.getByRole("button", { name: /Use this SVG/i }).click();
  await dialog.waitFor({ state: "detached", timeout: 5000 });
  check(true, "wizard closed on completion");

  // The field now points at the prepared file, and a fresh render succeeds.
  const shown = await field.textContent();
  check(/demo\.svg/.test(shown), "svg_file value updated to the prepared file (demo.svg)");
  await waitRendered(page, { timeout: 60000 });
  check(true, "3D render completed with the imported SVG");

  // --- colour path: a `@svg layers=` field derives per-region colours ---
  const MULTI_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40">
    <g id="left" fill="#ff0000"><rect x="0" y="0" width="30" height="40"/></g>
    <g id="right" fill="#0000ff"><rect x="30" y="0" width="30" height="40"/></g>
  </svg>`;
  await selectDesign(page, "Panel");
  await page.getByRole("tab", { name: "Customize" }).click().catch(() => {});
  const pField = page.locator('[data-svg-field="svg_file"]').first();
  check((await page.locator('[data-svg-field="svg_file"]').count()) >= 1, "panel svg_file renders the Prepare-SVG affordance");
  await pField.locator('input[type="file"]').setInputFiles({
    name: "regions.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(MULTI_SVG),
  });
  const d2 = page.getByRole("dialog");
  await d2.waitFor({ state: "visible", timeout: 5000 });
  await d2.getByRole("button", { name: /Fix & continue/i }).click();
  await d2.getByRole("button", { name: /Next/i }).click(); // → colours step
  const colourText = await d2.textContent();
  check(/colour regions/i.test(colourText), "wizard shows the colours step");
  check(/left/.test(colourText) && /right/.test(colourText), "colours step lists both regions");
  await d2.getByRole("button", { name: /Use this SVG/i }).click();
  await d2.waitFor({ state: "detached", timeout: 5000 });
  // The @filledBy layers target (svg_layers) is populated with the derived string.
  const layersVal = await page.locator('.param[data-param="svg_layers"] input').first().inputValue();
  check(/left:red/.test(layersVal) && /right:blue/.test(layersVal),
    `svg_layers derived from the drawing's colours (${layersVal})`);
  // The drawing's canvas leads the string, without it the design can't centre
  // the regions, which it imports uncentred to keep them registered.
  check(/^60x40,/.test(layersVal), `svg_layers leads with the drawing's canvas (${layersVal})`);
  await waitRendered(page, { timeout: 60000 });
  check(true, "panel re-rendered with per-region colours");

  // --- per-region heights: the wizard's height boxes edit the layers string ---
  await page.locator('[data-svg-field="svg_file"]').first().locator('input[type="file"]')
    .setInputFiles({ name: "regions2.svg", mimeType: "image/svg+xml", buffer: Buffer.from(MULTI_SVG) });
  const d4 = page.getByRole("dialog");
  await d4.waitFor({ state: "visible", timeout: 5000 });
  await d4.getByRole("button", { name: /Fix & continue/i }).click();
  await d4.getByRole("button", { name: /Next/i }).click(); // → colours step
  const heightBox = d4.getByRole("spinbutton", { name: /Height of region left/i });
  check(await heightBox.count() === 1, "each region has its own height box");
  // The design's relief height is offered as the placeholder, so a blank box
  // reads as "use that height" with the number in view.
  check(await heightBox.getAttribute("placeholder") === "1.2",
    "the height box shows the design's relief height as its placeholder");
  await heightBox.fill("2.5");
  const editedSpec = await d4.getByRole("textbox", { name: /Region colours and heights/i }).inputValue();
  check(/left:red:2\.5/.test(editedSpec) && /right:blue(,|$)/.test(editedSpec),
    `a typed height lands on its own region only (${editedSpec})`);
  // A height the browser's number input accepts but a design's own parser does
  // not (0, a negative, exponent syntax) blocks completion here instead of
  // hard-failing the render.
  const useBtn = d4.getByRole("button", { name: /Use this SVG/i });
  for (const bad of ["0", "-1", "1e3"]) {
    await heightBox.fill(bad);
    check(await useBtn.isDisabled(), `a height of ${bad} blocks ‘Use this SVG’`);
  }
  check(/isn't usable/.test(await d4.textContent()), "the wizard says which height isn't usable");
  await heightBox.fill("2.5");
  check(!(await useBtn.isDisabled()), "fixing the height re-enables ‘Use this SVG’");
  await useBtn.click();
  await d4.waitFor({ state: "detached", timeout: 5000 });
  await waitRendered(page, { timeout: 60000 });
  check(true, "panel re-rendered with a per-region height");

  // --- reverting the @svg field also reverts the layers it filled ------------
  // The two are written together by the wizard: the layers string names regions
  // that exist only in the drawing it prepared, so reverting the drawing alone
  // would leave the design pointing at regions that aren't there.
  const revert = page.locator('.param[data-param="svg_file"] .param-drift-revert').first();
  check(await revert.count() === 1, "the drifted svg_file offers a revert control");
  await revert.click();
  await page.waitForTimeout(300);
  const fileAfter = await page.locator('[data-svg-field="svg_file"]').first().textContent();
  const layersAfter = await page.locator('.param[data-param="svg_layers"] input').first().inputValue();
  check(/panel\.svg/.test(fileAfter), "reverting restores the design's own drawing");
  check(!/left|right/.test(layersAfter),
    `reverting clears the prepared drawing's regions too (${layersAfter})`);

  // --- error gate: a drawing with no importable geometry can't complete ---
  const TEXT_ONLY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text x="1" y="6">hi</text></svg>`;
  await selectDesign(page, "Tag");
  await page.getByRole("tab", { name: "Customize" }).click().catch(() => {});
  await page.locator('[data-svg-field="svg_file"]').first().locator('input[type="file"]').setInputFiles({
    name: "text-only.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(TEXT_ONLY),
  });
  const d3 = page.getByRole("dialog");
  await d3.waitFor({ state: "visible", timeout: 5000 });
  await d3.getByRole("button", { name: /Fix & continue/i }).click();
  check(/can't be used as-is/i.test(await d3.textContent()), "error step explains the drawing can't be used");
  check(await d3.getByRole("button", { name: /Use this SVG/i }).isDisabled(),
    "‘Use this SVG’ is disabled while an ERROR remains");
  await page.keyboard.press("Escape");
} catch (e) {
  console.error("E2E ERROR:", e.message);
  failures++;
} finally {
  await browser.close();
  server.close();
}

console.log(failures === 0 ? "\nSVG WIZARD E2E PASS ✅" : `\nSVG WIZARD E2E FAIL ❌ (${failures})`);
process.exit(failures === 0 ? 0 : 1);
