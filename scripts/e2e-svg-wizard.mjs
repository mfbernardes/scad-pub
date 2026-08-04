// e2e-svg-wizard.mjs: manual end-to-end for the @svg field wizard. Drives the
// BUILT app: opens the tag design's @svg field, drops an SVG with issues, walks
// the wizard (check -> fix -> use), and confirms the fixed SVG imports and the
// 3D render updates. Run: node scripts/e2e-svg-wizard.mjs (after npm run build).
//
// Selectors deliberately avoid matching the wizard's own findings/hints/button
// copy: that text moved through the i18n catalogue (Phase 2 of the translation
// coverage plan) and is no longer guaranteed to read the same in every build.
// Structural hooks instead: the `svg-wizard__*` classes, the `ERROR`/`WARN`
// badge LEVELS (Finding["level"] values, English by construction — see
// svgPrepText.ts — not prose, so stable across locales), counts, disabled
// state, and data the drawing itself carries (region ids, filenames, the
// derived layers string).
import {
  bootstrap,
  makeCheck,
  waitRendered,
  dismissWelcomePopup,
  selectDesign,
  openDialog,
  waitDialogClosed,
} from "./lib/browser.mjs";

const DIRTY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50">
  <text x="20" y="40">hello</text>
  <rect x="10" y="20" width="100" height="50" fill="black"/>
</svg>`;

const { check, state } = makeCheck();

/** A region's editable row in the colours step, found by the id its <code>
 *  shows — not by an aria-label, which now carries translated copy. */
function regionRow(dialog, page, id) {
  return dialog
    .locator(".svg-wizard__region")
    .filter({ has: page.locator("code", { hasText: id }) });
}

/** The badge level markers (Finding["level"]: "ERROR"/"WARN"/"INFO") the
 *  wizard renders next to each finding — stable, uppercase, English by
 *  construction regardless of locale, so counting them is a locale-safe proxy
 *  for "how many findings of this severity are showing". */
function levelBadges(dialog, level) {
  return dialog.getByText(level, { exact: true });
}

const { base, page, close } = await bootstrap();
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
    (await field.locator(".svg-prepare__drop button").count()) > 0,
    "the drop zone's trigger button is present",
  );

  // Feed the wizard a problematic SVG through the field's hidden file input.
  await field.locator('input[type="file"]').setInputFiles({
    name: "demo.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(DIRTY_SVG),
  });

  const dialog = await openDialog(page, undefined, { timeout: 5000 });
  check(true, "wizard dialog opened");

  // DIRTY_SVG raises exactly two WARNs at the check step: the off-origin
  // viewBox and the live <text>. The rect isn't flagged as a background — it's
  // the drawing's only other shape, and covers-canvas only fires when removing
  // it would still leave something behind. No ERROR (the rect is importable
  // geometry).
  check((await levelBadges(dialog, "WARN").count()) === 2, "check step flags two WARNs");
  check((await levelBadges(dialog, "ERROR").count()) === 0, "check step reports no ERROR");

  await dialog.locator(".svg-wizard__advance").click();
  // The fix step resolves the viewBox and the background, leaving only the
  // (unfixable) live text as a residual WARN.
  check((await levelBadges(dialog, "WARN").count()) === 1, "fix step leaves one residual WARN");

  await dialog.locator(".svg-wizard__finish").click();
  await waitDialogClosed(page, undefined, { timeout: 5000 });
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
  const d2 = await openDialog(page, undefined, { timeout: 5000 });
  await d2.locator(".svg-wizard__advance").click();
  await d2.locator(".svg-wizard__advance").click(); // → colours step
  check((await d2.locator(".svg-wizard__region").count()) === 2, "colours step lists both regions");
  check(
    (await regionRow(d2, page, "left").count()) === 1 && (await regionRow(d2, page, "right").count()) === 1,
    "each region row is found by its id",
  );
  await d2.locator(".svg-wizard__finish").click();
  await waitDialogClosed(page, undefined, { timeout: 5000 });
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
  const d4 = await openDialog(page, undefined, { timeout: 5000 });
  await d4.locator(".svg-wizard__advance").click();
  await d4.locator(".svg-wizard__advance").click(); // → colours step
  const heightBox = regionRow(d4, page, "left").locator('input[type="number"]');
  check((await heightBox.count()) === 1, "the 'left' region has its own height box");
  // The design's relief height is offered as the placeholder, so a blank box
  // reads as "use that height" with the number in view.
  check(await heightBox.getAttribute("placeholder") === "1.2",
    "the height box shows the design's relief height as its placeholder");
  await heightBox.fill("2.5");
  const editedSpec = await d4.locator('input:not([type="number"])').last().inputValue();
  check(/left:red:2\.5/.test(editedSpec) && /right:blue(,|$)/.test(editedSpec),
    `a typed height lands on its own region only (${editedSpec})`);
  // A height the browser's number input accepts but a design's own parser does
  // not (0, a negative, exponent syntax) blocks completion here instead of
  // hard-failing the render.
  const finishBtn = d4.locator(".svg-wizard__finish");
  for (const bad of ["0", "-1", "1e3"]) {
    await heightBox.fill(bad);
    check(await finishBtn.isDisabled(), `a height of ${bad} blocks completion`);
  }
  check((await d4.locator(".svg-wizard__height-error").count()) === 1, "the wizard flags the unusable height");
  await heightBox.fill("2.5");
  check(!(await finishBtn.isDisabled()), "fixing the height re-enables completion");
  await finishBtn.click();
  await waitDialogClosed(page, undefined, { timeout: 5000 });
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
  const d3 = await openDialog(page, undefined, { timeout: 5000 });
  await d3.locator(".svg-wizard__advance").click();
  check((await levelBadges(d3, "ERROR").count()) >= 1, "an ERROR remains after the fix step");
  check(await d3.locator(".svg-wizard__finish").isDisabled(),
    "completion is disabled while an ERROR remains");
  await page.keyboard.press("Escape");
} catch (e) {
  console.error("E2E ERROR:", e.message);
  state.failures += 1;
} finally {
  await close();
}

console.log(
  state.failures === 0
    ? "\nSVG WIZARD E2E PASS ✅"
    : `\nSVG WIZARD E2E FAIL ❌ (${state.failures})`
);
process.exit(state.failures === 0 ? 0 : 1);
