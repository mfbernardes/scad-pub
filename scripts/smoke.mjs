// smoke.mjs — end-to-end check of the built app in a real browser, all in one
// process (an in-process static server for dist/ + headless Chromium). Confirms
// the default design auto-renders, every design in the config renders, and a 3MF
// + PNG export work via the UI. Design-specific checks run only when that design
// is present in the built config: the example "tag" design exercises conditional
// visibility (@showIf/@collapsed) and the OpenSCAD-output notice/assert badges;
// a "signage" design, when configured, exercises @showIf arrow_style. Finally
// runs axe-core to guard against serious/critical
// accessibility regressions. Run after `npm run build`.
//
// Structure: each `=== section ===` is a named check* function taking the shared
// context (page, check counter, schema-derived names); main() is setup, the
// ordered calls, and teardown.
import { readFile, mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { startServer } from "./serve-dist.mjs";
import {
  launchChromium,
  renderStatusText,
  waitRendered as waitRenderDone,
  selectDesign as pickDesign,
  settleFirstVisit,
  dismissWelcomePopup,
} from "./lib/browser.mjs";

// Ensure the output console is open. It auto-opens when a render first surfaces
// a notice/assert, but a manual close (or a notice present before this point)
// means it may be shut — so click the Output bell when it's not already open.
// The bell's label is "Open messages" while closed.
async function openConsole(page) {
  if (await page.locator(".output-console").count()) return;
  // Desktop bell (the mobile top bar's twin is CSS-hidden at this viewport).
  await page.locator('.command-bar__output[aria-label^="Open messages"]').click().catch(() => {});
  await page.waitForSelector(".output-console", { timeout: 3000 }).catch(() => {});
}

// "Reset to defaults" confirms via an AlertDialog only when the params differ
// from the defaults — click the button, then the dialog's Reset if it appears.
async function resetDefaults(page) {
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  const dlg = page.getByRole("alertdialog");
  const shown = await dlg.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false);
  if (shown) await dlg.getByRole("button", { name: /^Reset$/ }).click();
}

// Expands the compact one-line checklist (PR14 rule 1 — shown whenever
// QuickStart is the active guide for the current design+view) into its full
// row list. A no-op when the full card is already showing (single-design
// builds, All settings, a design without @step, ui.quickStart:false) — those
// never render the `.getting-started__expand` chevron in the first place.
async function expandChecklist(page) {
  const expand = page.locator(".getting-started__expand");
  if (await expand.count()) await expand.click();
}

async function waitRendered(page, label) {
  await waitRenderDone(page);
  console.log(`  ${label ?? "default"}: ${((await renderStatusText(page)) ?? "").replace(/^Render status: /, "").trim()} ✅`);
}

// Switch design and wait for the fresh render.
// Design id -> label, populated in main() from the generated schema. The picker
// is a shadcn/ui (Radix) Select, so we switch designs by clicking the trigger
// then the option whose visible text is the design's label.
const designLabels = {};

async function selectDesign(page, id) {
  await pickDesign(page, id === undefined ? undefined : designLabels[id] ?? id);
  await waitRendered(page, id);
}

// Staged offline-readiness claim (this milestone): a one-time, informational
// toast telling a visitor this configurator (or its render engine) now works
// offline — see src/lib/useAppNotices.ts and src/lib/offlineClaim.ts. Every
// smoke run is a fresh browser instance with an empty Cache Storage, so the
// first load here is always a genuine cache-miss download, and the check
// runs FIRST (before anything else touches storage/reloads the page) so it
// races nothing else in this suite. main() blocks the service worker's own
// script for the whole run (see its own comment) specifically so THIS check
// is deterministic: with no service worker to independently win the binary-
// cache race, the render worker's own bootstrap always sees the miss and
// posts progress, and (with no controlling service worker) the claim is
// always the weaker "engine offline" one — see selectOfflineClaim's doc for
// why that's the honest choice when nothing controls the page yet. The
// stronger "ready for offline use" claim (a controlling service worker AND a
// verified precache) is exercised by the pure-logic unit tests instead
// (tests/offlineClaim.test.mjs), since reproducing it here would mean
// un-blocking the service worker and accepting back the very race this
// check exists to avoid.
async function checkOfflineClaimToast({ page, check }) {
  console.log("=== offline-claim toast (staged offline readiness) ===");
  const claimToast = page.getByText(/now available offline|ready for offline use/i);
  const shown = await claimToast
    .first()
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check(shown, "a one-time offline-readiness toast appears after the first real engine download");
}

// Configurable popup (schema.popup): a welcome notice on load. It overlays
// the app behind a modal backdrop that intercepts pointer events, so dismiss
// it before driving the UI — ticking "Don't show this again" (when the mode
// offers it) persists the dismissal so it stays gone across the reloads the
// later checks perform. The dialog's accessible name is the configured
// header, so look it up from the schema rather than hardcoding one config's.
async function checkWelcomePopup({ page, check, schema }) {
  console.log("=== welcome popup ===");
  if (schema.popup) {
    const popup = page.getByRole("dialog", { name: schema.popup.header });
    check((await popup.count()) > 0, "welcome popup shown on load");
    if (/\]\(/.test(schema.popup.body ?? "")) {
      check((await popup.getByRole("link").count()) > 0, "popup body renders its link");
    }
    // The primary button's label is config-driven (schema.popup.button), so read
    // it from the schema instead of hardcoding "OK".
    const buttonLabel = schema.popup.button ?? "OK";
    const cta = popup.getByRole("button", { name: buttonLabel, exact: true });
    check((await cta.count()) > 0, `popup shows its configured button "${buttonLabel}"`);
    const dontShow = popup.getByRole("checkbox");
    if (await dontShow.count()) await dontShow.check();
    await cta.click();
    await popup.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    // Named by the popup's own header, not a bare dialog-role count — with
    // `ui.gallery` on, the same click also opens DesignPickerDialog (a
    // *different* named dialog) in the same tick (see below), so "no dialog
    // at all" would be the wrong assertion there.
    check((await popup.count()) === 0, "popup dismissed");
    // The primary CTA also opens the design picker (when there's more than one
    // design) so the user's next step — choosing what to make — is obvious.
    // Which picker UI that is depends on `ui.gallery` (see DesignPickerDialog
    // vs. the classic dropdown Select in DesignPicker.tsx).
    if (schema.designs.length > 1) {
      if (schema.ui?.gallery) {
        const dialog = page.locator(".design-picker-dialog");
        const opened = await dialog
          .first()
          .waitFor({ state: "visible", timeout: 3000 })
          .then(() => true)
          .catch(() => false);
        check(opened, "primary CTA opens the design picker dialog");
        await page.keyboard.press("Escape");
        await dialog.first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
      } else {
        const listbox = page.getByRole("listbox");
        const opened = await listbox
          .first()
          .waitFor({ state: "visible", timeout: 3000 })
          .then(() => true)
          .catch(() => false);
        check(opened, "primary CTA opens the design picker");
        // Close it so it doesn't intercept the later checks' interactions.
        await page.keyboard.press("Escape");
        await listbox.first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
      }
    }
  } else {
    console.log("  (no popup in this config — skipped)");
  }
}

// Getting-started checklist (PR8; compact/peek/retirement — PR14): a
// dismissible onboarding checklist, shown only in guided experience — the
// dogfood config's default (ui.experience.default) — above the panel's tab
// strip in both layouts. Runs immediately after the welcome popup (which
// only OPENS/closes the design picker via Escape, picking nothing) and
// before any other check switches design or settings view, so the "fresh
// visitor" assertions below are honest.
//
// The dogfood config's default landing (tag, guided, essentials, quickStart
// enabled by default) makes QuickStart the active guide from the very first
// load — so PR14's rule 1 applies immediately: the checklist starts in its
// COMPACT one-line form, not the full row list (src/components/
// GettingStarted.tsx's `quickStartActive` branch). Deliberately does NOT
// dismiss the checklist at the end (unlike its PR8-era self) — it leaves the
// card alive, restored to a fresh compact state, for checkChecklistRetirement
// (run immediately after this one) to drive its own export through.
async function checkGettingStarted({ page, check, ids, paramsTabName }) {
  console.log("=== getting-started checklist: compact form (QuickStart active) ===");
  const card = page.locator(".getting-started");
  check((await card.count()) === 1, "getting-started checklist shown on a fresh guided-experience load");
  check(
    (await card.locator("li").count()) === 0,
    "starts in the compact one-line form (QuickStart is the active guide for tag/essentials)"
  );
  const totalTasks = ids.length > 1 ? 3 : 2; // design (multi-design only) + review + export
  check(
    new RegExp(`0 of ${totalTasks} complete`).test((await card.textContent()) ?? ""),
    `compact line reads "0 of ${totalTasks} complete" before any progress`
  );

  await runAxe(page, check, "getting-started checklist visible (compact)");

  // PR22 copy fix: "Hide" -> "Hide guide" on the COMPACT row too, so the
  // dismiss control reads the same everywhere (the full card already said
  // "Hide guide" — see the expanded-card check further below).
  const compactDismissBtn = card.locator(".getting-started__dismiss");
  check(
    ((await compactDismissBtn.textContent()) ?? "").trim() === "Hide guide",
    "the compact row's dismiss control also reads \"Hide guide\", not a bare \"Hide\""
  );

  console.log("=== getting-started checklist: expand chevron reveals the full card ===");
  await card.locator(".getting-started__expand").click();
  const rows = card.locator("li");
  const expectedRowCount = ids.length > 1 ? 4 : 3;
  check(
    (await rows.count()) === expectedRowCount,
    `expanding shows ${expectedRowCount} row(s) for ${ids.length} design(s)`
  );
  const designRow = card.locator("li", { hasText: "Choose a design" });
  if (ids.length > 1) {
    check((await designRow.count()) === 1, "\"Choose a design\" row present for a multi-design build");
  }
  const reviewRow = card.locator("li", { hasText: "Review the essential settings" });
  const exportRow = card.locator("li", { hasText: "Export the model" });
  const previewRow = card.locator("li", { hasText: "Preview" });
  check(!/done/.test((await reviewRow.textContent()) ?? ""), "\"Review the essential settings\" starts pending");
  check(!/done/.test((await exportRow.textContent()) ?? ""), "\"Export the model\" starts pending");
  check(
    /ready/.test((await previewRow.textContent()) ?? ""),
    "\"Preview\" status row reads \"ready\" once the initial render has already succeeded"
  );

  await runAxe(page, check, "getting-started checklist visible (expanded)");

  // A real param edit completes "Review the essential settings" — and, per
  // the documented rule (src/lib/checklist.ts), implicitly "Choose a design"
  // too (reviewing settings is only possible once a design is settled on).
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});
  const widthInput = paramRow(page, "width").locator('input[type="number"]');
  await widthInput.fill("95");
  await widthInput.blur();
  await waitRendered(page, "width edited (checklist)");
  check(/done/.test((await reviewRow.textContent()) ?? ""), "\"Review the essential settings\" completes on a real param edit");
  if (ids.length > 1) {
    check(
      /done/.test((await designRow.textContent()) ?? ""),
      "\"Choose a design\" completes implicitly once settings are reviewed"
    );
  }

  // Collapse back: the compact count reflects the very same progress live.
  await card.locator(".getting-started__expand").click();
  check((await card.locator("li").count()) === 0, "collapsing returns to the one-line form");
  const doneTasks = ids.length > 1 ? 2 : 1; // design (implicit) + review; export still pending
  check(
    new RegExp(`${doneTasks} of ${totalTasks} complete`).test((await card.textContent()) ?? ""),
    `compact line updates live to "${doneTasks} of ${totalTasks} complete"`
  );

  console.log("=== getting-started checklist: dismiss + replay ===");
  await card.locator(".getting-started__expand").click(); // re-expand for the full-card dismiss control below
  const dismissBtn = card.locator(".getting-started__dismiss");
  check(
    ((await dismissBtn.textContent()) ?? "").trim() === "Hide guide",
    "the full card's dismiss control reads \"Hide guide\", not a bare \"×\""
  );
  // Dismiss: hides the card and persists across a reload (the checklist.v1
  // once-flag) — settleFirstVisit's own `.getting-started__dismiss` click is
  // exercised by every OTHER check via its call at the top of main(); this
  // exercises the control itself (hook unchanged) and its persistence
  // explicitly.
  await dismissBtn.click();
  check((await card.count()) === 0, "\"Hide guide\" hides the checklist");
  await page.reload({ waitUntil: "load" });
  await waitRendered(page, "reloaded after checklist dismiss");
  check((await page.locator(".getting-started").count()) === 0, "dismissal persists across a reload");

  // Help modal's replay row. Not selected by accessible name: Radix sets
  // aria-labelledby to the rendered DialogTitle (the modal's title text),
  // which wins over Modal's own aria-label prop per ARIA name computation —
  // only one dialog is open at this point, so an unfiltered role suffices.
  await page.getByRole("button", { name: "Help", exact: true }).click();
  const helpDialog = page.getByRole("dialog");
  await helpDialog.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  const replayBtn = helpDialog.getByRole("button", { name: /show the getting-started checklist again/i });
  check((await replayBtn.count()) === 1, "Help modal offers the \"show checklist again\" row");
  await replayBtn.click();
  await page.keyboard.press("Escape");
  await helpDialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  check((await page.locator(".getting-started").count()) === 1, "Help modal's replay row brings the checklist back");

  // Restore the width edited above so later checks see pristine defaults.
  // Deliberately does NOT dismiss the checklist again — checkChecklistRetirement
  // (run immediately after this) needs a live, un-dismissed checklist to
  // drive its own export through and observe the retirement rule.
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});
  await resetDefaults(page);
  await waitRendered(page, "defaults restored (checklist)");
}

// Retirement after first export (PR14, rule 2): once an export completes,
// the checklist doesn't retire mid-session (a `useState` lazy initializer in
// GettingStarted.tsx only ever runs at mount, so the session that performs
// the export keeps showing its current state normally, same as before this
// milestone) — but the NEXT app load reads the persisted
// `checklist.exported.v1` flag and skips rendering the checklist outright,
// no dismiss needed. The simpler of the two options the milestone brief
// offered (vs. a ~5s timed auto-hide): fully deterministic, no race against
// paint/render timing. Runs immediately after checkGettingStarted, which
// deliberately leaves the checklist alive (compact, undismissed) for this.
async function checkChecklistRetirement({ page, check, ids, dir }) {
  console.log("=== getting-started checklist: retires on the next load after an export ===");
  await selectDesign(page, ids[0]);
  const card = page.locator(".getting-started");
  check((await card.count()) === 1, "checklist still alive going into the export (left visible by the previous check)");

  // Drive a real export (same technique checkExports uses below).
  const [model] = await Promise.all([
    page.waitForEvent("download"),
    page.click(".action-export"),
  ]);
  await model.saveAs(join(dir, `retirement-${await model.suggestedFilename()}`));

  // Same session: the mounted card does NOT retroactively hide itself —
  // it keeps showing, with "Export the model" now done.
  check((await card.count()) === 1, "the checklist stays visible in the SAME session the export completed in");
  await card.locator(".getting-started__expand").click();
  const exportRow = card.locator("li", { hasText: "Export the model" });
  check(/done/.test((await exportRow.textContent()) ?? ""), "\"Export the model\" completes on a real export");

  // Close whatever the export itself opened so it doesn't intercept the reload below.
  await page.locator(".export-success__dismiss").click().catch(() => {});

  // Next app load: retires permanently — simply never rendered, no dismiss
  // click involved.
  await page.reload({ waitUntil: "load" });
  await waitRendered(page, "reloaded after the export that retires the checklist");
  check((await page.locator(".getting-started").count()) === 0, "checklist auto-retires on the next load after an export");

  // Stays retired on a further reload too — persisted, not a one-off.
  await page.reload({ waitUntil: "load" });
  await waitRendered(page, "reloaded again (retirement persists)");
  check((await page.locator(".getting-started").count()) === 0, "retirement persists across further reloads");

  // Help replay is still the one deliberate escape hatch out of retirement.
  await page.getByRole("button", { name: "Help", exact: true }).click();
  const helpDialog = page.getByRole("dialog");
  await helpDialog.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  await helpDialog.getByRole("button", { name: /show the getting-started checklist again/i }).click();
  await page.keyboard.press("Escape");
  await helpDialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  check((await page.locator(".getting-started").count()) === 1, "Help replay still resurrects a retired checklist");

  // Leave the suite in a clean, dismissed state for the checks that follow
  // (checkReadiness's own comment already documents relying on exactly this).
  await page.locator(".getting-started__dismiss").click().catch(() => {});
}

// Viewer gesture hint (PR8): a one-time, non-blocking chip over the viewer,
// shown only in guided experience once the first successful render has
// landed (already true here — the initial render completed in main() before
// any of these checks ran).
async function checkViewerHint({ page, check }) {
  console.log("=== viewer gesture hint ===");
  const hint = page.locator(".viewer-hint");
  check((await hint.count()) === 1, "viewer-hint shown after the first successful render (guided experience)");
  check(/rotate/i.test((await hint.textContent()) ?? ""), "viewer-hint carries the rotate/zoom gesture copy");

  // A pointerdown anywhere inside the viewer dismisses it (dispatchEvent
  // bypasses the chip's own pointer-events:none, matching a real user's
  // pointerdown landing on the canvas underneath it).
  await page.locator(".viewer-wrap").first().dispatchEvent("pointerdown");
  await hint.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  check((await hint.count()) === 0, "a pointerdown on the viewer dismisses the hint");

  await page.reload({ waitUntil: "load" });
  await waitRendered(page, "reloaded after viewer hint dismiss");
  check((await page.locator(".viewer-hint").count()) === 0, "dismissal persists across a reload");
}

// Generic file import: the Files manager shows an "Import file" button when
// the config sets `fileImport`. Uploading a file should surface it in the
// file list and persist across a reload (IndexedDB).
async function checkFileImport({ page, check, ids, schema }) {
  console.log("=== file import ===");
  // On desktop the file manager is the panel's "Files" tab (Radix unmounts the
  // inactive tab, so it must be activated — and re-activated after each reload).
  const gotoFiles = () => page.getByRole("tab", { name: "Files" }).click().catch(() => {});
  await gotoFiles();
  const importBtn = page.getByRole("button", { name: /Import file/i });
  if (await importBtn.count()) {
    check(true, "import-file button present");
    const input = page.locator('.file-manager input[type="file"]').last();
    await input.setInputFiles({
      name: "smoke-overlay.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    });
    const fileRow = page.locator(".file-manager__name", { hasText: "smoke-overlay.svg" });
    await fileRow.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
    check((await fileRow.count()) > 0, "uploaded file appears in the file list");
    await page.reload({ waitUntil: "load" });
    await waitRendered(page, ids[0]);
    await gotoFiles();
    check(
      (await page
        .locator(".file-manager__name", { hasText: "smoke-overlay.svg" })
        .count()) > 0,
      "uploaded file persists across reload"
    );
    // Clear removes the file (and the persisted copy / render cache).
    await page.getByRole("button", { name: /Clear all imported files/i }).click();
    await page
      .locator(".file-manager__name", { hasText: "smoke-overlay.svg" })
      .waitFor({ state: "detached", timeout: 3000 })
      .catch(() => {});
    // The UI row is removed synchronously, but the persisted copy is cleared
    // via a fire-and-forget IndexedDB transaction. Reloading the instant the
    // row detaches can abort that still-uncommitted transaction (page unload
    // cancels in-flight IDB txns), leaving the file on disk to be restored on
    // the next load. Wait for the persisted store to actually be empty before
    // reloading so this assertion tests the guarantee, not the race.
    const dbName = schema?.id || "scadpub";
    await page
      .waitForFunction(
        (name) =>
          new Promise((resolve) => {
            let req;
            try {
              req = indexedDB.open(name);
            } catch {
              return resolve(true); // storage unavailable — nothing persisted
            }
            req.onerror = () => resolve(true);
            req.onsuccess = () => {
              const db = req.result;
              if (!db.objectStoreNames.contains("fonts")) {
                db.close();
                return resolve(true);
              }
              const countReq = db.transaction("fonts", "readonly").objectStore("fonts").count();
              countReq.onsuccess = () => {
                db.close();
                resolve(countReq.result === 0);
              };
              countReq.onerror = () => {
                db.close();
                resolve(true);
              };
            };
          }),
        dbName,
        { timeout: 5000 }
      )
      .catch(() => {});
    await page.reload({ waitUntil: "load" });
    await waitRendered(page, ids[0]);
    await gotoFiles();
    check(
      (await page
        .locator(".file-manager__name", { hasText: "smoke-overlay.svg" })
        .count()) === 0,
      "cleared file stays cleared after reload"
    );
  } else {
    console.log("  (no fileImport in this config — skipped)");
  }
}

// Files tab task cards (PR19 item 1): a font card only for a design with
// @font params, an SVG card only for one with @svg params, and the generic
// "Other files" card always. The dogfood config's example designs cover every
// combination without a bespoke fixture: `tag` has both @font and @svg
// params (examples/tag.scad), `coin` has only @font, `panel` has only @svg.
async function checkFilesCards({ page, check, ids, paramsTabName, schema }) {
  if (!schema?.fileImport || !ids.includes("tag")) return;
  console.log("=== Files tab: schema-driven task cards ===");
  const gotoFiles = () => page.getByRole("tab", { name: "Files" }).click().catch(() => {});
  const gotoParams = () => page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});

  await selectDesign(page, "tag");
  await gotoFiles();
  check((await page.locator(".file-card").count()) === 2, "tag (font + svg params) shows both the font and SVG cards");
  check(
    (await page.getByRole("button", { name: /Import font/i }).count()) === 1,
    "font card offers its own Import action"
  );
  check(
    (await page.getByRole("button", { name: /Import SVG/i }).count()) === 1,
    "SVG card offers its own Import action"
  );
  check(
    (await page.locator(".file-manager__data").count()) === 1,
    "the generic 'Other files' card is always present too"
  );
  check(
    (await page.locator('.file-card[role="status"]').count()) === 0,
    "no card leads with the attention-styled state while the selected font is loaded"
  );
  await runAxe(page, check, "Files tab (tag: font + SVG cards)");

  if (ids.includes("coin")) {
    await selectDesign(page, "coin");
    await gotoFiles();
    check(
      (await page.getByRole("button", { name: /Import font/i }).count()) === 1,
      "coin (font-only design) shows the font card"
    );
    check(
      (await page.getByRole("button", { name: /Import SVG/i }).count()) === 0,
      "coin (no @svg params) does not show the SVG card"
    );
  }

  if (ids.includes("panel")) {
    await selectDesign(page, "panel");
    await gotoFiles();
    check(
      (await page.getByRole("button", { name: /Import SVG/i }).count()) === 1,
      "panel (svg-only design) shows the SVG card"
    );
    check(
      (await page.getByRole("button", { name: /Import font/i }).count()) === 0,
      "panel (no @font params) does not show the font card"
    );
  }

  await selectDesign(page, "tag");
  await gotoParams();
}

// The Files tab's font card leads with the "not loaded" state — reusing the
// same URL-state trick as checkReadiness (a missing font family encoded
// directly into the share-link hash) so the two surfaces are proven to agree
// about what "missing" means, not just asserted to by comment.
async function checkFilesFontMissingCard({ page, check, ids, base, paramsTabName }) {
  if (!ids.includes("tag")) return;
  console.log("=== Files tab: font card leads with the missing-font state ===");
  const hash = `d=tag&v=${encodeURIComponent(JSON.stringify({ font: "No Such Font" }))}`;
  await page.goto(`${base}#${hash}`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "tag with a missing font family (Files tab card)");

  await page.getByRole("tab", { name: "Files" }).click().catch(() => {});
  const leadCard = page.locator('.file-card[role="status"]');
  await leadCard.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await leadCard.count()) === 1, "exactly one file-card leads with the attention-styled state");
  check(
    ((await leadCard.textContent()) ?? "").includes("No Such Font"),
    "the leading card names the missing family, same as the Customize tab's attention chip"
  );
  await runAxe(page, check, "Files tab with the missing-font card");

  // Restore defaults so later checks that reuse `tag` start clean.
  await page.goto(`${base}#d=tag`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "tag reloaded with defaults (Files card cleanup)");
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});
}

async function checkThemeToggle({ page, check }) {
  console.log("=== theme toggle ===");
  const bg0 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  let themeChanged = false;
  // Theme is a direct icon button in the CommandBar; select it by its label
  // (the first .icon-btn there is now the status-bearing Output bell).
  for (let i = 0; i < 3 && !themeChanged; i++) {
    await page.locator('.command-bar__right button[aria-label^="Switch to"]').first().click();
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
}

// The viewer's rendering is invalidation-driven (M6): once OrbitControls'
// damping has settled and nothing else invalidates the scene, renderer.render()
// must stop firing every animation frame. Viewer.tsx stamps a running count
// onto the mount node's dataset (data-render-count) on every actual render
// call, purely for this assertion. Sample it, wait past a few animation
// frames' worth of idle time with no input, and confirm it didn't move.
async function checkIdleRenderCount({ page, check }) {
  console.log("=== idle render count (invalidation-driven rendering) ===");
  const before = await page.$eval(".viewer", (el) => Number(el.dataset.renderCount ?? "0"));
  await page.waitForTimeout(500); // ~30 animation frames at idle, no input
  const after = await page.$eval(".viewer", (el) => Number(el.dataset.renderCount ?? "0"));
  check(
    before > 0 && after === before,
    `idle viewer issues no extra render() calls (before=${before}, after=${after})`
  );
}

async function checkAxe({ page, check }) {
  console.log("=== accessibility (axe-core) ===");
  await page.addScriptTag({
    path: fileURLToPath(new URL("../node_modules/axe-core/axe.min.js", import.meta.url)),
  });
  // axe's color-contrast check reads *computed* colours. Several controls (the
  // tab chips especially) carry `transition-[color,box-shadow]`, and a theme
  // swap animates every colour token, so sampling an element mid-transition
  // yields an intermediate colour and a spurious contrast violation — settled
  // by the shared settleAnimations() helper (see its own doc; also used by
  // runAxe() for the same reason on every other pass in this suite).
  // Palettes are per-theme (and config-overridable per theme), so a contrast
  // regression can hide in whichever theme a single sweep doesn't visit: run
  // the AA sweep in the current theme, then toggle and sweep the other. The
  // second toggle also returns the app to the theme it started the section in.
  for (let pass = 0; pass < 2; pass++) {
    const theme = await page.getAttribute("html", "data-theme");
    await settleAnimations(page);
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
    check(serious.length === 0, `axe (${theme}): ${serious.length} serious/critical violation(s)`);
    if (pass === 0) {
      await page.locator('.command-bar__right button[aria-label^="Switch to"]').first().click();
    }
  }
}

// The card-grid DesignPickerDialog (`ui.gallery: true`, PR7): the top bar
// shows a `.design-picker-button` instead of the classic Select; it opens a
// dialog with one card per design, a click switches design + renders, the
// dialog is axe-clean while open, and ⌘K/Ctrl-K opens it from anywhere.
async function checkDesignPickerDialog({ page, check, ids, schema }) {
  if (!(schema.ui?.gallery && schema.designs.length > 1)) return;
  console.log("=== design picker dialog (ui.gallery) ===");
  const dialog = page.locator(".design-picker-dialog");
  const button = page.locator(".command-bar__design-picker .design-picker-button");
  check((await button.count()) === 1, "design-picker-button shown in the top bar (desktop)");
  await button.click();
  await dialog.waitFor({ state: "visible", timeout: 3000 });
  const cards = page.locator(".design-picker-dialog__card");
  check((await cards.count()) === ids.length, `dialog shows one card per design (${ids.length})`);
  await runAxe(page, check, "design picker dialog open");

  // Selecting a card (other than the current design) switches design and renders.
  const targetId = ids.find((id) => id !== ids[0]) ?? ids[0];
  const targetLabel = designLabels[targetId] ?? targetId;
  await page
    .locator(".design-picker-dialog__card")
    .filter({ has: page.getByText(targetLabel, { exact: true }) })
    .first()
    .click();
  await dialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  await waitRendered(page, targetId);
  check(
    (await page.evaluate(() => location.hash)).includes(`d=${targetId}`),
    "selecting a card switches the design"
  );
  // Back to the first design for the checks that follow.
  await selectDesign(page, ids[0]);

  console.log("=== ⌘K / Ctrl-K opens the design picker ===");
  await page.keyboard.press("Control+k");
  await dialog.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check(await dialog.isVisible().catch(() => false), "Ctrl-K opens the design picker dialog");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  check((await dialog.count()) === 0, "Escape closes the design picker dialog");

  // Adaptive search box (this milestone): below SEARCH_THRESHOLD (6), the box
  // is hidden until the card grid actually overflows the dialog's scroll area
  // — only exercisable when the build itself is under that count (the dogfood
  // config's 3 designs), since at/above it the fast path already forces the
  // box on regardless of viewport, which the earlier assertions already cover
  // implicitly via `searchVisible`'s count-rule branch.
  if (ids.length <= 6) {
    console.log("=== design picker: adaptive search (overflow, not just count) ===");
    const search = page.locator(".design-picker-dialog__search");
    await button.click();
    await dialog.waitFor({ state: "visible", timeout: 3000 });
    check(
      (await search.count()) === 0,
      `no search box for ${ids.length} designs at the default viewport (no overflow)`
    );
    const original = page.viewportSize();
    // A short viewport (same width, so the layout stays desktop) leaves the
    // dialog's max-height small enough that even a handful of cards overflow
    // its scroll area — the adaptive ResizeObserver check should reveal the
    // search box without any count-rule help.
    await page.setViewportSize({ width: original?.width ?? 1280, height: 300 });
    await search.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
    check((await search.count()) === 1, "shrinking the viewport reveals the search box once the grid overflows");
    if (original) await page.setViewportSize(original);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  }
}

async function checkEveryDesignRenders({ page, ids }) {
  console.log("=== every design renders ===");
  for (const id of ids) await selectDesign(page, id);
}

// Bundled presets — exercised on the first design that ships any. Desktop
// presets live in the panel's Presets tab (a button list), applied by click.
async function checkBundledPresets({ page, check, ids, presetsTabName, paramsTabName }) {
  console.log("=== bundled presets ===");
  let presetTested = false;
  const gotoPresets = () =>
    page.getByRole("tab", { name: presetsTabName }).first().click().catch(() => {});
  const gotoParams = () =>
    page.getByRole("tab", { name: paramsTabName }).first().click().catch(() => {});
  for (const id of ids) {
    await selectDesign(page, id);
    await gotoPresets();
    // Ready-made presets sit in the "Ready-made" section as a plain button list;
    // the applied one carries aria-pressed="true" (see PresetPicker.tsx).
    const bundled = page.locator('[aria-label="Ready-made presets"] .preset-picker__item');
    if (await bundled.count()) {
      const name = (await bundled.first().textContent())?.trim() ?? "";
      await bundled.first().click();
      await waitRendered(page, `${id} + "${name}"`);
      // The applied preset shows as selected, and the choice is in the URL.
      check(
        (await page.locator('[aria-label="Ready-made presets"] .preset-picker__item[aria-pressed="true"]').count()) >= 1,
        `applied bundled preset "${name}"`
      );
      // persistState debounces ~300ms after the apply, so wait for the hash.
      await page
        .waitForFunction(() => /[#&]p=/.test(location.hash), undefined, { timeout: 3000 })
        .catch(() => {});
      check(
        /[#&]p=/.test(await page.evaluate(() => location.hash)),
        "selected preset is encoded in the URL"
      );
      // The choice survives a reload (restored from the URL hash).
      await page.reload({ waitUntil: "load" });
      await waitRendered(page, `${id} reloaded`);
      await gotoPresets();
      check(
        (await page.locator('[aria-label="Ready-made presets"] .preset-picker__item[aria-pressed="true"]').count()) >= 1,
        "preset auto-selected from the URL after reload"
      );
      await gotoParams();
      presetTested = true;
      break;
    }
  }
  if (!presetTested) console.log("  (no bundled presets in this config — skipped)");
}

// Preset import: an OpenSCAD parameterSets file becomes a saved preset.
async function checkPresetImport({ page, check, ids, presetsTabName, paramsTabName }) {
  console.log("=== preset import (parameterSets round-trip) ===");
  await selectDesign(page, ids[0]);
  await page.getByRole("tab", { name: presetsTabName }).first().click().catch(() => {});
  // An empty set still lists by name (values default in); enough to prove the
  // parse→save→list wiring. Round-trip coercion is covered by the unit tests.
  const setsFile = JSON.stringify({
    fileFormatVersion: "1",
    parameterSets: { "Imported Set": {} },
  });
  await page
    .locator('.preset-picker input[type="file"]')
    .first()
    .setInputFiles({ name: "presets.json", mimeType: "application/json", buffer: Buffer.from(setsFile) });
  // The import parses and saves asynchronously; wait for the item to list.
  const importedItem = page.locator(
    '[aria-label="Your saved presets"] .preset-picker__item',
    { hasText: "Imported Set" }
  );
  await importedItem.first().waitFor({ state: "attached", timeout: 3000 }).catch(() => {});
  check((await importedItem.count()) >= 1, "imported parameterSets file added a saved preset");
  await page.getByRole("tab", { name: paramsTabName }).first().click().catch(() => {});
}

// "Save as preset…" (PR19 item 2): demoted from an always-visible input row
// to a button that reveals it on demand, auto-focused; Escape or a blur while
// still empty collapses it back.
async function checkPresetSaveReveal({ page, check, ids, presetsTabName, paramsTabName }) {
  console.log("=== presets: \"Save as preset…\" reveals inline, Escape/blur-empty collapses ===");
  await selectDesign(page, ids[0]);
  await page.getByRole("tab", { name: presetsTabName }).first().click().catch(() => {});

  const trigger = page.locator(".preset-picker__save-trigger");
  await trigger.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await trigger.count()) === 1, "the 'Save as preset…' trigger button is shown");
  check((await page.locator(".preset-picker__save-row").count()) === 0, "the inline save row is collapsed by default");

  const row = page.locator(".preset-picker__save-row");

  await trigger.click();
  await row.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await row.count()) === 1, "clicking the trigger reveals the inline save row");
  check(
    await row.locator("input").evaluate((el) => el === document.activeElement),
    "the revealed input is auto-focused"
  );

  // Escape collapses back to the trigger, discarding whatever was typed.
  await row.locator("input").fill("Throwaway");
  await page.keyboard.press("Escape");
  await trigger.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await page.locator(".preset-picker__save-row").count()) === 0, "Escape collapses the reveal back to the trigger");

  // A blur while the field is still empty also collapses it.
  await trigger.click();
  await row.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  await page.keyboard.press("Tab");
  await trigger.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await page.locator(".preset-picker__save-row").count()) === 0, "blurring the still-empty input also collapses it");

  // A real save: reveal, type a name, press Enter — the row collapses and the
  // preset lists under "Saved by you".
  await trigger.click();
  await row.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  const name = "Smoke Saved Preset";
  await row.locator("input").fill(name);
  await page.keyboard.press("Enter");
  const savedItem = page.locator('[aria-label="Your saved presets"] .preset-picker__item', { hasText: name });
  await savedItem.first().waitFor({ state: "attached", timeout: 3000 }).catch(() => {});
  check((await savedItem.count()) >= 1, "Enter saves the preset and it appears under 'Saved by you'");
  check((await page.locator(".preset-picker__save-row").count()) === 0, "saving collapses the reveal back to the trigger");

  await runAxe(page, check, "Presets tab (save-as-preset reveal/collapse)");

  // Clean up: delete the smoke-created preset so it doesn't pollute later
  // checks that iterate "Saved by you" (e.g. a rerun's own checkPresetImport).
  await page
    .locator('[aria-label="Your saved presets"] li', { hasText: name })
    .getByRole("button", { name: /^Delete/i })
    .click()
    .catch(() => {});
  const deleteDlg = page.getByRole("alertdialog");
  const deleteDlgShown = await deleteDlg
    .waitFor({ state: "visible", timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  if (deleteDlgShown) await deleteDlg.getByRole("button", { name: /^Delete$/ }).click();
  await savedItem.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  await page.getByRole("tab", { name: paramsTabName }).first().click().catch(() => {});
}

// Export 3MF + PNG on the first design, plus the after-export panel it drives
// (PR9): the dogfood config sets `ui.afterExport.helpTab` ("Printing"), so
// every completed export here should surface the panel.
async function checkExports({ page, check, ids, dir }) {
  await selectDesign(page, ids[0]);
  console.log("=== export 3MF ===");
  const [model] = await Promise.all([
    page.waitForEvent("download"),
    // PR9: the CTA reads "Export 3D model" now, not "Download {format}" — the
    // label is expected to keep evolving, so smoke selects the stable
    // `.action-export` hook rather than the visible text/aria-label.
    page.click(".action-export"),
  ]);
  const modelOut = join(dir, await model.suggestedFilename());
  await model.saveAs(modelOut);
  check((await stat(modelOut)).size > 0, `${await model.suggestedFilename()} (${(await stat(modelOut)).size} bytes)`);
  check(
    (await page.getByLabel(/Export 3D model/i).count()) >= 1,
    "the renamed export CTA is present with its outcome-led label"
  );

  console.log("=== after-export panel ===");
  // Headless Chromium has no Web Share API target here, so exportModel falls
  // back to a plain browser download — the panel should show the
  // "downloaded" wording (src/lib/exportOutcome.ts's exportOutcomeTitleKey).
  const successPanel = page.locator(".export-success");
  await successPanel.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await successPanel.count()) === 1, "export-success panel appears after a completed 3MF export");
  check(
    /downloaded/i.test((await successPanel.textContent()) ?? ""),
    "export-success panel shows the downloaded wording for a plain browser download"
  );
  await runAxe(page, check, "export-success panel visible");

  const guideLink = successPanel.getByRole("button", { name: "Printing guide" });
  check((await guideLink.count()) === 1, 'export-success panel offers a "Printing guide" action');
  await guideLink.click();
  const helpDialog = page.getByRole("dialog");
  await helpDialog.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  const printingTab = helpDialog.getByRole("tab", { name: "Printing" });
  check(
    (await printingTab.getAttribute("aria-selected")) === "true",
    '"Printing guide" opens Help deep-linked to the Printing tab'
  );
  await page.keyboard.press("Escape");
  await helpDialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

  // Export again (the panel from the first export never got its own X) to
  // exercise the dismiss button itself.
  const [model2] = await Promise.all([
    page.waitForEvent("download"),
    page.click(".action-export"),
  ]);
  await model2.saveAs(join(dir, `redownload-${await model2.suggestedFilename()}`));
  await successPanel.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  await successPanel.locator(".export-success__dismiss").click();
  check((await successPanel.count()) === 0, "export-success panel's dismiss (X) hides it");

  console.log("=== save PNG ===");
  const [png] = await Promise.all([
    page.waitForEvent("download"),
    page.click('[aria-label="Save image"]'),
  ]);
  const pngOut = join(dir, await png.suggestedFilename());
  await png.saveAs(pngOut);
  const head = (await readFile(pngOut)).subarray(0, 4);
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  check(isPng && (await stat(pngOut)).size > 0, `${await png.suggestedFilename()} (png=${isPng})`);
  // The PNG snapshot is about a picture of the model, not the printable model
  // itself — it must never surface the export-success panel.
  check((await successPanel.count()) === 0, "Image export does not show the export-success panel");
}

async function checkPreviewControls({ page, check }) {
  console.log("=== preview controls (share link + live preview) ===");
  check(
    (await page.locator('[aria-label="Copy share link"]').count()) >= 1,
    "copy-link button present"
  );
  // Live preview (auto-render): a shadcn/ui Switch (role=switch) in the params footer.
  const auto = page.getByRole("switch", { name: /Live preview/i }).first();
  const autoOn = async () => (await auto.getAttribute("aria-checked")) === "true";
  check(await autoOn(), "live preview on by default (non-heavy design)");
  await auto.click();
  check(!(await autoOn()), "live preview can be turned off");
  await auto.click();
}

async function checkServiceWorker({ page, check, base }) {
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
}

// Locate a parameter row by its stable data-param hook (present regardless
// of ui.showVarName), shared by the tag + signage checks.
const paramRow = (page, name) => page.locator(`.param[data-param="${name}"]`);

// Fill a number param's own numeric input (the box beside its slider) and
// blur to commit — shared by checkTagDesign's assert-trip flow and the PR16
// mobile Messages check, which reproduces the same trip on a mobile context.
const setNumField = async (page, name, value) => {
  const input = paramRow(page, name).locator('input[type="number"]');
  await input.fill(String(value));
  await input.blur();
};

// Click the essentials/all settings-view segmented control (CustomizeTab /
// SettingsViewToggle) — present only when the active design has at least one
// @advanced param. No-op (rather than a throw) when it's absent, so callers
// that run against a design/config without any advanced params stay safe.
async function switchSettingsView(page, view) {
  const label = view === "all" ? "All settings" : "Essential settings";
  const btn = page.locator(".settings-view-toggle").getByRole("button", { name: label, exact: true });
  if (await btn.count()) await btn.click();
}

// Waits for every in-flight CSS transition/animation on the page to actually
// finish — a Radix dialog's fade/zoom entrance, a tab underline, a theme
// swap, … — before an axe-core sweep reads *computed* colour. Sampling mid-
// animation (e.g. a dialog still fading its content in from opacity 0) yields
// an intermediate, non-deterministic colour and a spurious (flaky, timing-
// dependent) color-contrast violation. A fixed sleep was flaky on its own —
// the animation can outlast a short one on a slower/loaded CI runner — so
// this polls the real Web Animations API state instead of guessing a
// duration. Shared by every axe pass below (runAxe() and checkAxe()'s own
// loop) so EVERY dialog-open (or other animated-transition) scan gets the
// same determinism, not just the ones that happened to need it first.
async function settleAnimations(page) {
  await page.waitForTimeout(50); // let a just-started transition register first
  await page
    .waitForFunction(
      () => document.getAnimations().every((a) => a.playState !== "running"),
      null,
      { timeout: 3000 }
    )
    .catch(() => {});
}

// A standalone axe-core sweep (WCAG 2.1 AA, serious/critical only), reusable
// outside the dedicated checkAxe() pass below — used by checkSettingsView to
// confirm both the essentials and All settings states of the Customize tab
// are accessible, not just the default state checkAxe() happens to catch.
async function runAxe(page, check, label) {
  await page.addScriptTag({
    path: fileURLToPath(new URL("../node_modules/axe-core/axe.min.js", import.meta.url)),
  });
  await settleAnimations(page);
  const axeRes = await page.evaluate(async () =>
    window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
    })
  );
  const serious = axeRes.violations.filter((v) => ["serious", "critical"].includes(v.impact));
  for (const v of serious)
    console.log(`  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s)) -> ${v.nodes.map((n) => n.target.join(" ")).join("; ")}`);
  check(serious.length === 0, `axe (${label}): ${serious.length} serious/critical violation(s)`);
}

// Essentials/all settings view (the essentials/beginner milestone): the
// dogfood config's guided default (ui.experience.default) starts a FRESH
// visitor on the essentials view, which hides every @advanced param — tag's
// Quality section (facet_angle/facet_size). Must run before any other check
// has touched the settingsView preference (it reads the still-fresh page
// straight after the welcome popup is dismissed), and deliberately ends with
// the choice persisted as "all" — later checks (bundled presets' Import/
// Export row, the @showIf/@collapsed checks in checkTagDesign) expect the
// full, ungated panel.
async function checkSettingsView({ page, check, ids, paramsTabName }) {
  if (!ids.includes("tag")) return;
  console.log("=== settings view (essentials/all) ===");
  await selectDesign(page, "tag");
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});

  const toggle = page.locator(".settings-view-toggle");
  check((await toggle.count()) === 1, "settings-view toggle shown for a design with @advanced params");
  check(
    (await toggle.getByRole("button", { name: "Essential settings" }).getAttribute("aria-pressed")) === "true",
    "fresh visitor starts on the Essential settings view (config ui.experience.default)"
  );

  const facet = paramRow(page, "facet_angle");
  check((await facet.count()) === 0, "essentials view: the @advanced facet_angle control isn't in the DOM at all");
  const hiddenNote = page.locator(".settings-hidden-note");
  check((await hiddenNote.count()) === 1, "hidden-settings note shown at the bottom of the form in essentials view");
  const hiddenNoteText = ((await hiddenNote.textContent()) ?? "").trim();
  check(/\b2\b/.test(hiddenNoteText), `hidden-settings note reports the right count (saw "${hiddenNoteText}")`);
  await runAxe(page, check, "essentials view, tag Customize tab");

  // A search term matching only a hidden (advanced) param surfaces the
  // "N matching settings are in All settings — Show them" note; clicking it
  // switches view and (via ParamForm's existing search-force-open behavior)
  // reveals the match.
  const search = page.locator("#param-search-input");
  await search.fill("facet");
  const searchNote = page.locator(".settings-search-note");
  await searchNote.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await searchNote.count()) === 1, "search note shown when a query matches only hidden (essentials-demoted) settings");
  await searchNote.getByRole("button", { name: "Show them" }).click();
  await facet.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check(
    (await facet.count()) > 0 && (await facet.first().isVisible()),
    "\"Show them\" switches to All settings and reveals the matching hidden setting"
  );
  check(
    (await toggle.getByRole("button", { name: "All settings" }).getAttribute("aria-pressed")) === "true",
    "toggle reflects the switch to All settings"
  );
  await search.fill("");
  await search.press("Escape").catch(() => {});
  await runAxe(page, check, "all settings view, tag Customize tab");

  // The switch persists across a reload.
  await page.reload({ waitUntil: "load" });
  await waitRendered(page, "tag reloaded (settings view)");
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});
  check(
    (await paramRow(page, "facet_angle").count()) > 0,
    "the All-settings choice is honored (persisted) after a reload"
  );
  check(
    (await page.locator(".settings-view-toggle").getByRole("button", { name: "All settings" }).getAttribute("aria-pressed")) === "true",
    "toggle still reads All settings after reload"
  );

  // The toggle itself (not just the shortcut links) switches views.
  await switchSettingsView(page, "essentials");
  check(
    (await paramRow(page, "facet_angle").count()) === 0,
    "clicking \"Essential settings\" on the toggle hides facet_angle again"
  );
  // Leave the suite in All settings — the checks that follow (bundled
  // presets' Import/Export row, checkTagDesign's @showIf/@collapsed checks)
  // expect the full, ungated panel.
  await switchSettingsView(page, "all");
}

// QuickStart step navigation (PR11; scroll mode PR15): shown instead of the
// classic scrolling form when guided + essentials + a stepped design (tag,
// via examples/tag.scad's `@step` annotations) + `ui.quickStart` (default
// true). Runs right after checkSettingsView, which conveniently leaves the
// suite on "All settings" — switch to essentials here to exercise QuickStart,
// and leave the suite back on "All settings" at the end (per
// checkSettingsView's own comment, later checks — bundled presets' Import/
// Export row, checkTagDesign's @showIf/@collapsed checks — expect the full,
// ungated panel).
//
// This desktop-context pass exercises "scroll" mode (ParamPanel's own docked
// panel + its scroll container): every step renders at once, chips are
// scroll anchors, and there's no Back/Next — see QuickStart.tsx's own
// variant doc. Mobile's unchanged "steps" mode (one step at a time,
// Back/Next) has its own pass, checkQuickStartMobile, in its own mobile
// context alongside checkResponsiveLayout.
async function checkQuickStart({ page, check, ids, paramsTabName }) {
  if (!ids.includes("tag")) return;
  console.log("=== QuickStart step navigation (desktop scroll mode) ===");
  await selectDesign(page, "tag");
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});
  await switchSettingsView(page, "essentials");

  const quickStart = page.locator(".quick-start");
  await quickStart.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await quickStart.count()) === 1, "QuickStart shown in guided + essentials for a stepped design (tag)");

  const chips = page.locator(".quick-start__step");
  check((await chips.count()) === 5, "5 chips shown (4 @step sections + Review)");
  check((await chips.nth(0).getAttribute("aria-current")) === "step", "the first step chip starts current");

  // Scroll mode: every step's group renders simultaneously — a scrollable
  // form, not a one-step-at-a-time wizard — and there's no Back/Next.
  const groupHeadings = page.locator(".quick-start__group h3");
  check((await groupHeadings.count()) === 4, "all 4 step groups render at once (scroll mode, not a wizard)");
  const headingTexts = await groupHeadings.allTextContents();
  check(
    ["Size", "Text", "Emblem", "Hanging hole"].every((label) => headingTexts.includes(label)),
    "every step's own heading is present in the scrolled form"
  );
  check((await page.locator(".quick-start__back").count()) === 0, "no Back button in desktop scroll mode");
  check((await page.locator(".quick-start__next").count()) === 0, "no Next button in desktop scroll mode");

  await runAxe(page, check, "QuickStart visible (essentials view, tag, scroll mode)");

  // A param edit inside a step re-renders the preview — the same pipeline as
  // the classic form, just mounted through ParamRows' flat chrome. Every
  // step's own params are already in the DOM (scroll mode), so no navigation
  // is needed first — unlike steps mode, which has to walk there.
  const labelInput = paramRow(page, "label").locator('input[type="text"]');
  if (await labelInput.count()) {
    await labelInput.fill("QuickStart");
    await labelInput.blur();
    await waitRendered(page, "quickstart param edit");
  }

  // Chip click smooth-scrolls its group into view and moves focus to the
  // step heading (this suite doesn't force prefers-reduced-motion, so the
  // real scroll animation plays — see QuickStart.tsx's own reduced-motion
  // handling, covered structurally by its pure helper's unit tests instead).
  await chips.nth(2).click(); // "Emblem"
  await page
    .waitForFunction(() => document.activeElement?.tagName === "H3", { timeout: 3000 })
    .catch(() => {});
  check(
    await page.evaluate(() => document.activeElement?.textContent?.includes("Emblem") ?? false),
    "clicking a chip moves focus to that step's heading"
  );
  check((await chips.nth(2).getAttribute("aria-current")) === "step", "clicking a chip sets it current immediately");
  // The click above triggers a native smooth-scroll animation (this suite
  // doesn't force prefers-reduced-motion), which takes a few hundred ms to
  // settle — poll the heading's position instead of reading it the instant
  // focus lands (focus({preventScroll: true}) is effectively synchronous
  // with the scrollIntoView call, well before the animation finishes).
  const scrolledNearTop = await page
    .waitForFunction(
      () => {
        const el = Array.from(document.querySelectorAll(".quick-start__group h3")).find((h) =>
          (h.textContent ?? "").includes("Emblem")
        );
        const container = el?.closest(".customize-tab__scroll");
        if (!el || !container) return false;
        const r = el.getBoundingClientRect();
        const c = container.getBoundingClientRect();
        // "Near the top" (not necessarily pixel-0 — the sticky chip strip
        // and its scroll-margin sit above it): generous enough to avoid
        // flaking on exact scroll-animation easing while still catching a
        // chip click that scrolled nowhere.
        return r.top >= c.top - 40 && r.top <= c.top + 250;
      },
      { timeout: 3000, polling: 50 }
    )
    .then(() => true)
    .catch(() => false);
  check(scrolledNearTop, "the clicked step's heading actually scrolled near the top of the panel");

  // Review chip (PR18 — was a bare "Export" pointer): scrolls to the end of
  // the form and shows a readiness line, the "what will actually be
  // produced" summary (bounding box + @info rows), a "Front view" button,
  // and — unchanged — the pointer at the Export action (never a duplicate of
  // the floating Export button itself).
  await chips.last().click();
  check((await chips.last().getAttribute("aria-current")) === "step", "clicking the Review chip sets it current");
  const review = page.locator(".quick-start__review");
  check(await review.isVisible(), "the Review chip's own section actually scrolled into view");
  check(
    /Ready to export/.test((await page.locator(".quick-start__review-readiness").textContent()) ?? ""),
    "Review's readiness line reads \"Ready to export\" for the default, fully-rendered, no-attention state"
  );
  check(
    /Dimensions/.test((await page.locator(".quick-start__review-summary").textContent()) ?? ""),
    "Review's summary includes the Dimensions row (reused from DimensionInfo's own derivation)"
  );
  check(
    (await page.locator(".quick-start__review-summary > div").count()) > 1,
    "Review's summary includes at least one @info row beyond the Dimensions headline (tag has several)"
  );
  check(
    /Export 3D model/.test((await review.textContent()) ?? ""),
    "Review's content still points at the Export action rather than duplicating it"
  );

  // PR23 item 4: readiness line, then the summary dl (Dimensions leading,
  // then @info rows), then Font status, then warnings (absent here — the
  // default state is "Ready to export"), then actions, then the export
  // pointer. Reads the block-level markers in actual DOM order rather than
  // asserting on any one of them in isolation.
  const reviewOrderReady = await review.evaluate((el) => {
    const wanted = [
      ".quick-start__review-readiness",
      ".quick-start__review-summary",
      ".quick-start__review-font",
      ".quick-start__review-attention",
      ".quick-start__review-front-view",
      ".quick-start__review-export-hint",
    ];
    return Array.from(el.children)
      .map((child) => wanted.find((sel) => child.matches(sel)))
      .filter(Boolean);
  });
  check(
    reviewOrderReady.join(" -> ") ===
      [
        ".quick-start__review-readiness",
        ".quick-start__review-summary",
        ".quick-start__review-font",
        ".quick-start__review-front-view",
        ".quick-start__review-export-hint",
      ].join(" -> "),
    `Review card blocks render readiness -> summary -> font status -> actions -> export hint (saw ${reviewOrderReady.join(" -> ")})`
  );
  const reviewDtOrder = await page.locator(".quick-start__review-summary dt").allTextContents();
  check(
    reviewDtOrder[0] === "Dimensions" && reviewDtOrder.length > 1,
    `the summary's own dt sequence leads with Dimensions, then @info rows (saw: ${reviewDtOrder.join(", ")})`
  );

  // "Front view" actually drives the shared viewer: the HUD's view picker
  // trigger reflects the newly-applied view (ViewPicker.tsx's own
  // aria-label/title), proving the button is wired through AppShell's
  // onSelectView the same way the HUD's own picker is.
  await review.getByRole("button", { name: "Front view" }).click();
  await page
    .waitForFunction(
      () => document.querySelector(".viewer-hud button[title^='View:']")?.getAttribute("title") === "View: Front",
      { timeout: 3000 }
    )
    .catch(() => {});
  check(
    (await page.locator(".viewer-hud button[title='View: Front']").count()) === 1,
    "Review's \"Front view\" button snaps the shared viewer to the front view"
  );

  await runAxe(page, check, "QuickStart Review stage visible (essentials view, tag, scroll mode)");

  // All settings escape: switching to All settings shows the classic form
  // (and facet_angle — the @advanced Quality section, per PR3's toggle
  // behavior) instead of QuickStart; switching back to essentials brings
  // QuickStart back.
  await switchSettingsView(page, "all");
  check((await page.locator(".quick-start").count()) === 0, "All settings shows the classic form, not QuickStart");
  check((await paramRow(page, "facet_angle").count()) > 0, "facet_angle (advanced) is reachable in All settings");
  await switchSettingsView(page, "essentials");
  await quickStart.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await page.locator(".quick-start").count()) === 1, "QuickStart returns when switching back to essentials");

  // Search interplay: typing a query bypasses QuickStart for the classic
  // filtered form; clearing it restores QuickStart.
  const search = page.locator("#param-search-input");
  await search.fill("width");
  await page.locator(".quick-start").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  check((await page.locator(".quick-start").count()) === 0, "a search query shows the classic filtered form, not QuickStart");
  check((await paramRow(page, "width").count()) > 0, "the search actually filters to the matching param");
  await search.fill("");
  await quickStart.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await page.locator(".quick-start").count()) === 1, "clearing the search restores QuickStart");

  // Leave the suite in All settings for the checks that follow.
  await switchSettingsView(page, "all");
}

// QuickStart step navigation, mobile (PR15): the bottom sheet keeps today's
// one-step-at-a-time "steps" variant unchanged (Back/Next, one step's
// ParamRows mounted at a time) — desktop's own scroll-mode assertions live in
// checkQuickStart above. Needs its own real mobile viewport/context, same
// reasoning as checkResponsiveLayout's own doc (the shared `page` above is
// desktop-sized) — a fresh context so this doesn't inherit any state the
// desktop pass above left behind.
async function checkQuickStartMobile({ browser, base, check, ids, paramsTabName }) {
  if (!ids.includes("tag")) return;
  console.log("=== QuickStart step navigation (mobile steps mode) ===");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(base, { waitUntil: "load" });
    await settleFirstVisit(page);
    await waitRenderDone(page).catch(() => {});

    // The dogfood config's default landing (tag, guided, essentials) already
    // makes QuickStart the active guide, and guided+half policy starts the
    // sheet at Half (see checkResponsiveLayout) — Parameters is reachable
    // without raising the sheet first.
    await page.getByRole("tab", { name: paramsTabName }).first().click();
    await page.waitForSelector(".quick-start", { timeout: 5000 }).catch(() => {});

    const quickStart = page.locator(".quick-start");
    check((await quickStart.count()) === 1, "QuickStart shown on mobile too (guided + essentials + stepped design)");

    const chips = page.locator(".quick-start__step");
    check((await chips.count()) === 5, "5 chips shown on mobile (4 @step sections + Review)");

    // Mobile stays one-step-at-a-time: scroll mode's simultaneous-group
    // markup never mounts here, and Back/Next still drive navigation.
    check((await page.locator(".quick-start__group").count()) === 0, "mobile never renders scroll mode's step-group markup");
    check((await page.locator(".quick-start__content").count()) === 1, "mobile renders exactly one step's content at a time");
    check((await page.locator(".quick-start__back").count()) === 1, "Back button present on mobile");
    const nextBtn = page.locator(".quick-start__next");
    check((await nextBtn.count()) === 1, "Next button present on mobile");

    check((await chips.nth(0).getAttribute("aria-current")) === "step", "the first step chip starts current on mobile");
    check((await paramRow(page, "width").count()) > 0, "the current (first, \"Size\") step's own params are shown");
    check((await paramRow(page, "label").count()) === 0, "a later step's (\"Text\") params are NOT shown until navigated to");

    await nextBtn.click(); // Size -> Text
    check((await chips.nth(1).getAttribute("aria-current")) === "step", "Next advances to the second step on mobile");
    check((await paramRow(page, "label").count()) > 0, "the Text step's own param appears once current");
    check((await paramRow(page, "width").count()) === 0, "the previous step's param is no longer shown (one step at a time)");

    // Chip jump still works directly too (free navigation, not a wizard).
    await chips.nth(0).click();
    check((await chips.nth(0).getAttribute("aria-current")) === "step", "clicking a chip jumps directly to it on mobile");
    check((await paramRow(page, "width").count()) > 0, "jumping back via chip shows that step's params again");

    await runAxe(page, check, "QuickStart visible on mobile (steps mode)");

    // Walk forward through every real step via Next to the terminal Review
    // stage (PR18): the LAST real step's Next button reads "Next: Review"
    // (was "Next: Export"), and clicking it actually lands on the Review
    // stage's own content — the same stage scroll mode shows all at once,
    // here reached one step at a time like every other mobile step.
    await chips.nth(0).click(); // back to Size, a known starting point
    for (let i = 0; i < 3; i++) await nextBtn.click(); // Size -> Text -> Emblem -> Hanging hole
    check(
      /Next: Review/.test((await nextBtn.textContent()) ?? ""),
      "the last real step's Next button reads \"Next: Review\""
    );
    await nextBtn.click(); // Hanging hole -> Review
    check((await page.locator(".quick-start__review").count()) === 1, "\"Next: Review\" walks to the Review step on mobile");
    check((await page.locator(".quick-start__back").count()) === 1, "Back is still reachable from the Review step");
    check((await page.locator(".quick-start__next").count()) === 0, "no Next button once the Review step is current");
    check(
      /Ready to export/.test((await page.locator(".quick-start__review-readiness").textContent()) ?? ""),
      "mobile Review stage shows the same readiness line as desktop"
    );

    await runAxe(page, check, "QuickStart Review stage visible on mobile (steps mode)");
  } finally {
    await context.close();
  }
}

// @showIf + @collapsed — exercised on the example "tag" design when present.
// Param rows are located by their stable data-param hook, which exists
// regardless of ui.showVarName, so this block runs in every config.
async function checkTagDesign({ page, check, ids, paramsTabName }) {
  if (!ids.includes("tag")) return;
  console.log("=== conditional visibility (@showIf, tag) ===");
  await selectDesign(page, "tag");
  // A bundled preset may still be selected from the earlier presets check —
  // while one is selected, the preset-diff strip's restore action reverts to
  // the PRESET rather than the design's defaults (see PresetDiffBar), which
  // would break the deterministic "Reset to defaults" flow below. Clear the
  // selection via a fresh reload before driving the rest of this design.
  await page.evaluate(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    params.delete("p");
    history.replaceState(null, "", "#" + params.toString());
  });
  await page.reload({ waitUntil: "load" });
  await waitRendered(page, "tag reloaded");
  // Back to the Customize tab (the file-import test left the panel on Files).
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});
  // "Quality" (facet_angle/facet_size) is @advanced — the config's guided
  // default starts in the essentials view, which hides it entirely. Switch to
  // All settings so the @showIf/@collapsed checks below see it at all; the
  // essentials-view behavior itself is covered by checkSettingsView.
  await switchSettingsView(page, "all");

  // @collapsed: the "Quality" group starts folded; its params are hidden
  // until the group header is opened.
  const quality = page.locator("details.param-group", {
    has: page.locator("summary", { hasText: "Quality" }),
  });
  check((await quality.count()) === 1, "Quality group is collapsible");
  const facet = paramRow(page, "facet_angle");
  check(!(await facet.isVisible()), "collapsed @collapsed group hides its params");
  await quality.locator("summary").click();
  check(await facet.isVisible(), "opening the group reveals its params");

  // Boolean params are switches now — toggle by click, read aria-checked.
  const holeSwitch = paramRow(page, "hole").getByRole("switch");
  if ((await holeSwitch.getAttribute("aria-checked")) !== "true")
    await holeSwitch.click(); // ensure on (an applied preset may have turned it off)
  const hd = paramRow(page, "hole_diameter");
  await hd.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  check((await hd.count()) > 0, "hole_diameter shown when hole on");
  await holeSwitch.click();
  await hd.first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  check((await hd.count()) === 0, "hole_diameter hidden when hole off");

  console.log("=== notice + assert badges on the OpenSCAD output panel (tag) ===");
  // Start from known defaults (also re-checks `hole` toggled off above).
  await resetDefaults(page);
  await waitRendered(page, "tag");

  // Wait for a DOM predicate (returns false on timeout instead of throwing)
  // — a param edit only re-renders after a debounce, and the status text can
  // still read "N ms" from the previous render, so we wait on the result.
  const waitFor = async (fn) => {
    try {
      await page.waitForFunction(fn, { timeout: 30000 });
      return true;
    } catch {
      return false;
    }
  };

  // Engraving the label trips the design's `note` category (a config-driven
  // notice). The console auto-opens on the first notice; open it explicitly
  // in case it was already showing earlier notices (no badge in the top bar).
  await paramRow(page, "engrave_text").getByRole("switch").click();
  await openConsole(page);
  check(
    await waitFor(() =>
      /engraved/.test(document.querySelector(".output-console")?.textContent || "")
    ),
    "the engrave note is surfaced as a diagnostic"
  );
  // Close the console again
  await page.click('.output-console__close').catch(() => {});

  // Making the engraving deeper than the plate trips a hard assert(): the
  // render fails and the hardcoded "asserts" badge appears.
  const setNum = (name, value) => setNumField(page, name, value);
  // Quality (facet_angle/facet_size) is @advanced and untouched (still at its
  // defaults) — switch back to the essentials view so the friendly-error
  // checks below exercise the real "nothing hidden differs from defaults"
  // case, not the trivially-empty "all settings" case (hiddenAdvancedDiff is
  // always [] in "all" — see paramFilter.ts). This (re-)mounts QuickStart
  // fresh (tag is a stepped design), starting on its first step ("Size",
  // which holds `thickness`). Desktop scroll mode (PR15) already mounts
  // every step's params at once, so `text_depth` (the "Text" step) exists
  // regardless — click its chip anyway, both to exercise chip navigation
  // here too and to keep this check meaningful if a future variant reverts
  // to mounting only the current step's ParamRows.
  await switchSettingsView(page, "essentials");
  await setNum("thickness", 1);
  if (await page.locator(".quick-start").count())
    await page.locator(".quick-start__step").filter({ hasText: "Text" }).first().click();
  await setNum("text_depth", 2);
  check(
    await waitFor(() =>
      /Failed/.test(document.querySelector(".render-status")?.textContent || "")
    ),
    "the failed assert render reports a render failure"
  );
  // The console surfaces the assert as an "asserts" count badge in its header.
  await openConsole(page);
  check(
    await waitFor(() => document.querySelector(".badge-assert") !== null),
    "an assert failure raises an asserts badge"
  );

  console.log("=== friendly render-failure summary (tag) ===");
  check(
    (await page.locator(".friendly-error").count()) === 1,
    "the friendly error card is shown in Notices on a failed render"
  );
  const friendlyText = await page.locator(".friendly-error").innerText();
  check(
    friendlyText.includes(
      "engraved text is deeper than the plate is thick; reduce text depth or thicken the plate"
    ),
    "the friendly error's body is the assert's authored message, verbatim and unquoted"
  );
  // A successful tag render preceded this failure, so the pipeline retains
  // it: the reassurance line must be present AND true — the viewer keeps the
  // last good geometry (dimmed) instead of clearing to an empty canvas.
  check(
    friendlyText.includes("Your last working preview is still shown"),
    "the reassurance line is shown (a previous successful render is retained)"
  );
  check(
    (await page.locator(".viewer-wrap .opacity-55").count()) > 0,
    "the retained last-good geometry is displayed dimmed while the latest render failed"
  );
  check(
    (await page.locator(".friendly-error").getByRole("button", { name: "Review hidden settings" }).count()) === 0,
    "Quality (advanced, still default) means no hidden setting differs, so 'Review hidden settings' is not offered"
  );
  await page.locator(".friendly-error").getByText("Show technical details").click();
  const technicalText = await page.locator(".friendly-error details").innerText();
  check(
    /Assertion '.*' failed/.test(technicalText),
    "the technical details disclosure reveals the raw assertion line"
  );
  await runAxe(page, check, "Notices tab: friendly-error card visible");

  // Restore a clean, rendering state for the checks that follow — and confirm
  // the canvas recovers: the render succeeds again, the friendly card clears,
  // and the retained-geometry dimming lifts.
  await resetDefaults(page);
  await waitRendered(page, "tag");
  check(
    await waitFor(() => document.querySelector(".friendly-error") === null),
    "the friendly error card clears once a render succeeds again"
  );
  check(
    (await page.locator(".viewer-wrap .opacity-55").count()) === 0,
    "the dimmed retained-geometry treatment lifts after recovery"
  );
}

// Production-readiness attention surfacing (PR13; consolidated PR22): a
// design can render successfully while its selected font family isn't
// loaded — Fontconfig silently substitutes a fallback, and dimensions/
// spacing can shift, yet nothing about the render itself failed. "Rendered"
// and "ready to ship" are different claims (src/lib/readiness.ts); this
// exercises the whole path: the checklist's "needs attention" wording, the
// Customize tab's CONSOLIDATED attention chip (a "1 issue to review" summary
// plus "Go to setting" AND "Use a bundled font" actions — PR22 replaced the
// old bare per-item row), the export dock's explicit `.export-attention`
// line (replacing the old ambiguous corner dot), the Review stage's new
// "Font status" row, and the Notices tab's friendly attention card leading
// the raw rows. Runs against the desktop `page` (scroll mode, PR15): every
// step's ParamRows is already mounted, so "the jump" is really a
// scroll+focus of the font control itself rather than a step swap —
// QuickStart still moves `aria-current` to "Text" alongside it (see
// QuickStart.tsx's focusParam effect), which the assertions below still
// check for.
async function checkReadiness({ page, check, ids, base, paramsTabName }) {
  if (!ids.includes("tag")) return;
  console.log("=== production readiness: font-fallback attention ===");

  // A URL hash directly encodes the missing-font override — see
  // src/lib/urlState.ts's "d=/v=/p=" encoding (`v` is a JSON diff-from-
  // defaults object). Navigating to a URL differing only by its hash is a
  // same-document navigation (App.tsx's own `hashchange` listener applies
  // it via applyExternalState) rather than a fresh module load, which would
  // leave session-only state (paramInteracted etc., carried over from
  // earlier checks in this suite) stale — so `goto` then an explicit
  // `reload` to force a genuine fresh mount that re-derives EVERYTHING
  // (including those session flags) from this hash, same as a visitor
  // opening the link fresh. Every first-visit once-flag it could trip
  // (welcome popup dismissal, getting-started dismissal) was already
  // persisted by earlier checks in this suite, so nothing blocks driving
  // the UI here. Only `font` differs from the design's shipped defaults, so
  // the "1 alert + 1 note" the tag design fires out of the box (see its own
  // "Configurator notices" comment) is present here too — reused below for
  // the singular-badge check (item 5).
  const hash = `d=tag&v=${encodeURIComponent(JSON.stringify({ font: "No Such Font" }))}`;
  await page.goto(`${base}#${hash}`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "tag with a missing font family");

  // The getting-started checklist was dismissed (and that dismissal
  // persisted) by an earlier check — bring it back via the Help modal's
  // replay row (same action checkGettingStarted itself exercises) so its
  // live "Preview" status is visible here too.
  await page.getByRole("button", { name: "Help", exact: true }).click();
  const helpDialog = page.getByRole("dialog");
  await helpDialog.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  await helpDialog.getByRole("button", { name: /show the getting-started checklist again/i }).click();
  await page.keyboard.press("Escape");
  await helpDialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

  // QuickStart is the active guide here too (tag/essentials/guided), so the
  // replayed checklist lands in its compact one-line form — expand it (PR14)
  // before reading the Preview row.
  await expandChecklist(page);
  const previewRow = page.locator(".getting-started li", { hasText: "Preview" });
  await previewRow.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check(
    /needs attention/.test((await previewRow.textContent()) ?? ""),
    "checklist 'Preview' row reads 'needs attention' when the selected font isn't loaded"
  );

  // The consolidated attention chip (PR22): top of the Customize tab, a
  // pluralized summary line first, then the one row for the missing font.
  await page.getByRole("tab", { name: paramsTabName }).click().catch(() => {});
  const chip = page.locator(".attention-chip");
  await chip.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await chip.count()) === 1, "exactly one attention row shown for the one missing font");
  check(
    ((await chip.textContent()) ?? "").includes("No Such Font"),
    "the attention row names the missing family"
  );
  const chipSummary = page.locator(".attention-chip__summary");
  check(
    ((await chipSummary.textContent()) ?? "").trim() === "1 issue to review",
    "the consolidated chip leads with a pluralized \"1 issue to review\" summary"
  );
  check(
    (await chip.first().getByRole("button", { name: "Go to setting" }).count()) === 1,
    "the attention row offers \"Go to setting\""
  );
  check(
    (await chip.first().getByRole("button", { name: "Use a bundled font" }).count()) === 1,
    "the attention row ALSO offers \"Use a bundled font\" (item 1's second action) since a bundled family is available"
  );

  // The export dock's explicit attention line (PR22) replaces the old
  // ambiguous corner dot: real text plus a "Review" action. Export stays
  // enabled and uninterrupted throughout — it's a caution, never a block.
  const exportBtn = page.locator(".action-export");
  check(
    (await page.locator(".action-export__attention-dot").count()) === 0,
    "the export button's old corner dot is gone"
  );
  const exportAttention = page.locator(".export-attention");
  await exportAttention.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await exportAttention.count()) === 1, "the export dock shows the attention line");
  check(
    ((await exportAttention.textContent()) ?? "").includes("1 issue to review") &&
      ((await exportAttention.textContent()) ?? "").includes("Font needed: No Such Font"),
    "the export dock's attention line reads \"N issue(s) to review — <first item>\""
  );
  check(await exportBtn.isEnabled(), "export stays enabled despite the attention line");
  check(
    (await exportBtn.getAttribute("aria-describedby")) === "export-attention-hint",
    "export button is described by the visible attention line for assistive tech"
  );

  await runAxe(page, check, "Customize tab with the attention chip visible");

  // The export dock's "Review" action jumps to the Review stage: scroll mode
  // scrolls the trailing Review section into view AND focuses its heading
  // (scrollToGroup's own contract) — a deterministic signal that doesn't
  // depend on the IntersectionObserver having caught up yet.
  await page.locator(".export-attention__review").click();
  await page
    .waitForFunction(() => document.activeElement?.id === "quick-start-heading-__review__", { timeout: 3000 })
    .catch(() => {});
  check(
    await page.evaluate(() => document.activeElement?.id === "quick-start-heading-__review__"),
    "the export dock's \"Review\" action scrolls to and focuses the Review stage heading"
  );

  // Notices tab: the same gap leads as a friendly card, above the raw rows
  // (PR22 item 4) — a visitor who opens Messages directly still gets the
  // readable summary, not just parsed log lines. Also where the singular-
  // labelOne badge (item 5) is reliably drivable: the shipped tag defaults
  // fire exactly one alert and one note (see the hash comment above).
  await openConsole(page);
  const consoleAttention = page.locator(".console-attention");
  await consoleAttention.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await consoleAttention.count()) === 1, "the Notices tab shows one friendly attention card block");
  check(
    ((await consoleAttention.textContent()) ?? "").includes("No Such Font"),
    "the friendly attention card names the missing family, same as the Customize tab's chip"
  );
  check(
    (await consoleAttention.getByRole("button", { name: "Use a bundled font" }).count()) === 1,
    "the friendly attention card offers \"Use a bundled font\" too"
  );
  const attentionBox = await consoleAttention.boundingBox();
  const rawRowsBox = await page.locator(".output-console ul, .output-console p").first().boundingBox();
  check(
    !!attentionBox && !!rawRowsBox && attentionBox.y <= rawRowsBox.y,
    "the friendly attention card leads the raw notices rows, not the other way around"
  );
  check(
    (await page.locator('.output-console [aria-label="1 alert"]').count()) === 1,
    "the alert count badge's accessible name uses the singular labelOne (\"1 alert\", not \"1 alerts\")"
  );
  check(
    (await page.locator('.output-console [aria-label="1 note"]').count()) === 1,
    "the note count badge's accessible name uses the singular labelOne (\"1 note\", not \"1 notes\") too"
  );
  await runAxe(page, check, "Notices tab with the friendly attention card visible");
  await page.click(".output-console__close").catch(() => {});

  // "Go to setting": tag mounts QuickStart on its first ("Size") step by
  // default on a fresh design view — the font control lives on "Text", a
  // DIFFERENT step — so this also exercises QuickStart's own step-jump
  // composition, not just a scroll on an already-visible control. Scrolled
  // to the Review section above, so land back on the first step's chip
  // first by re-reading it fresh (scroll position doesn't affect which chip
  // this locator targets — `aria-current` state, not viewport position).
  await chip.first().getByRole("button", { name: "Go to setting" }).click();
  await page
    .waitForFunction(() => document.activeElement?.classList.contains("font-select"), { timeout: 3000 })
    .catch(() => {});
  check(
    await page.evaluate(() => document.activeElement?.classList.contains("font-select")),
    "\"Go to setting\" switches to the Text step and focuses the font control"
  );
  check(
    ((await page.locator(".quick-start__step--current").textContent()) ?? "").includes("Text"),
    "QuickStart's current step actually switched to Text"
  );

  // The Review stage (PR18) surfaces the same gap a third time: its own
  // readiness line, attention listing, AND (PR22 item 3) a dedicated "Font
  // status" row above that listing. Scroll mode mounts every step's group at
  // once (including the trailing Review section), so these are already in
  // the DOM regardless of which chip is "current" — no navigation needed.
  check(
    /Needs attention/.test((await page.locator(".quick-start__review-readiness").textContent()) ?? ""),
    "Review's readiness line reads \"Needs attention\" while the font fallback is unresolved"
  );
  const reviewFontRow = page.locator(".quick-start__review-font");
  check(
    ((await reviewFontRow.textContent()) ?? "").includes("Font status") &&
      ((await reviewFontRow.textContent()) ?? "").includes("substitute in use"),
    "Review's own \"Font status — substitute in use\" row is shown while the font fallback is unresolved"
  );
  check(
    (await reviewFontRow.getByRole("button", { name: "Import font…" }).count()) === 1,
    "the Font status row offers \"Import font…\""
  );
  check(
    (await reviewFontRow.getByRole("button", { name: "Use a bundled font" }).count()) === 1,
    "the Font status row ALSO offers \"Use a bundled font\""
  );
  check(
    ((await page.locator(".quick-start__review-attention").textContent()) ?? "").includes("No Such Font"),
    "Review's own attention listing names the missing family too"
  );

  // PR23 item 4, the attention-present variant: Font status now sits between
  // the summary and the warnings block, not ahead of the summary — confirm
  // the full 6-part order with every optional block actually present.
  const reviewOrderAttention = await page.locator(".quick-start__review").first().evaluate((el) => {
    const wanted = [
      ".quick-start__review-readiness",
      ".quick-start__review-summary",
      ".quick-start__review-font",
      ".quick-start__review-attention",
      ".quick-start__review-front-view",
      ".quick-start__review-export-hint",
    ];
    return Array.from(el.children)
      .map((child) => wanted.find((sel) => child.matches(sel)))
      .filter(Boolean);
  });
  check(
    reviewOrderAttention.join(" -> ") ===
      [
        ".quick-start__review-readiness",
        ".quick-start__review-summary",
        ".quick-start__review-font",
        ".quick-start__review-attention",
        ".quick-start__review-front-view",
        ".quick-start__review-export-hint",
      ].join(" -> "),
    `with every optional block present, Review still renders readiness -> summary -> font status -> warnings -> actions -> export hint (saw ${reviewOrderAttention.join(" -> ")})`
  );

  // "Use a bundled font" (item 1's second action): a one-click fix, not just
  // a pointer — resolves the issue in place, no manual dropdown needed.
  await chip.first().getByRole("button", { name: "Use a bundled font" }).click();
  await waitRendered(page, "tag with a bundled font restored via \"Use a bundled font\"");
  check((await page.locator(".attention-chip").count()) === 0, "the attention row clears once a loaded family is selected");
  check((await page.locator(".export-attention").count()) === 0, "the export dock's attention line clears too");
  check(
    /Ready to export/.test((await page.locator(".quick-start__review-readiness").textContent()) ?? ""),
    "Review's readiness line returns to \"Ready to export\" once the font is restored"
  );
  check(
    ((await page.locator(".quick-start__review-font").textContent()) ?? "").includes("Font status — Liberation Sans"),
    "Review's Font status row switches to the clean \"Font status — <family>\" form once resolved"
  );

  // Confirm the checklist itself returns to "ready" too. Selecting the
  // restored font above was itself a real param edit, which already
  // completed "Review the essential settings" — combined with "Choose a
  // design"/"Export the model" already done (persisted flags from earlier
  // checks), the card may now be fully collapsed (see GettingStarted.tsx —
  // checklistAllDone doesn't depend on the Preview row at all, so that
  // collapse is a red herring here, not evidence either way). Reload fresh
  // (defaults -> a loaded font) and replay the checklist the same way as
  // above for an unambiguous read on the Preview row alone.
  await page.goto(`${base}#d=tag`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "tag reloaded with defaults (readiness cleanup)");
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await helpDialog.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  await helpDialog.getByRole("button", { name: /show the getting-started checklist again/i }).click();
  await page.keyboard.press("Escape");
  await helpDialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  await expandChecklist(page); // compact by default here too — see above
  const previewRow2 = page.locator(".getting-started li", { hasText: "Preview" });
  await previewRow2.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  const previewText2 = (await previewRow2.textContent()) ?? "";
  check(
    /ready/i.test(previewText2) && !/needs attention/.test(previewText2),
    "checklist 'Preview' row returns to 'ready' once a loaded font is selected"
  );

  // Leave the suite in a clean state for whatever runs after this.
  await page.locator(".getting-started__dismiss").click().catch(() => {});
}

// @showIf arrow_style — exercised on a "signage" design when present. (No
// notice expectation here: a well-tuned config renders its defaults
// advisory-free; the notice/assert badge machinery is covered by "tag".)
// Params are located by their stable `data-param` hook, which exists
// regardless of ui.showVarName.
async function checkSignageDesign({ page, check, ids }) {
  if (!ids.includes("signage")) return;
  console.log("=== signage: @showIf arrow_style ===");
  await selectDesign(page, "signage");
  // arrow_style is relevant only once an arrow is chosen (`@showIf arrow != none`);
  // the signage default is arrow = "none", so it starts hidden.
  const arrowStyle = paramRow(page, "arrow_style");
  check((await arrowStyle.count()) === 0, "arrow_style hidden when arrow = none");
  // Enums are Radix Selects: open the row's trigger, then click the option.
  // Match exactly — several arrow options contain "right" (Up-right, Turn
  // right…), so a substring match would be ambiguous.
  await paramRow(page, "arrow").locator('[data-slot="select-trigger"]').click();
  await page.getByRole("option", { name: "Right", exact: true }).click();
  await arrowStyle.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  check((await arrowStyle.count()) > 0, "arrow_style shown when arrow = right");
  await waitRendered(page, "arrow");
}

// M7 + M16 (docs/architecture-review.md) + PR4 (guided mobile sheet policy):
// responsive layout mounting and mobile bottom-sheet focus behavior. These
// need a real mobile-sized viewport/context (the default page above is
// desktop-sized), so this opens its own context rather than reusing `page`.
// Covers:
//  - M7: exactly one interactive layout (ParamForm) is in the DOM at a given
//    breakpoint, and a breakpoint change preserves active tab, search text,
//    search focus, and (on the way back) the sheet's detent.
//  - M16: at Peek/Half the mobile background stays keyboard-reachable
//    (not `inert`); at Full it's `inert` and focus is trapped inside the
//    sheet — Tab never lands on a covered background control — with Escape
//    collapsing back out and focus returning to the sheet.
//  - PR4: the dogfood config sets guided experience + `mobileInitialSheet:
//    "half"` (scadpub.config.json), so a fresh mobile visit lands the sheet
//    at Half (not the long-standing Peek default) with a one-time
//    "Drag up for all settings" hint on the handle — dismissed by the first
//    detent change and never shown again (once-flag), even across a reload.
async function checkResponsiveLayout({ browser, base, check, paramsTabName }) {
  console.log("=== responsive layout: single mounted tree + state across a breakpoint change (M7) ===");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(base, { waitUntil: "load" });
    await settleFirstVisit(page);
    await waitRenderDone(page).catch(() => {});

    // Only the active (mobile) layout is in the DOM — the desktop tree isn't
    // mounted at all.
    check(
      (await page.locator(".app-shell__mobile").count()) === 1 &&
        (await page.locator(".app-shell__desktop").count()) === 0,
      "mobile viewport mounts only the mobile layout tree"
    );

    // PR4: guided experience + mobileInitialSheet "half" (the dogfood config)
    // lands a fresh visit's sheet at Half, not Peek, with the one-time handle
    // hint showing.
    check((await page.locator(".bottom-sheet--half").count()) === 1, "guided+half policy starts the sheet at half");
    check((await page.locator(".sheet-hint").count()) === 1, "one-time sheet hint shows on first load");

    // Switch to the Parameters tab (the sheet is already at Half via the
    // policy above, so no handle tap is needed to raise it here). The design
    // may land on Presets (bundled presets), so ParamForm only mounts once
    // Parameters is active — Radix Tabs unmounts inactive tab content.
    await page.getByRole("tab", { name: paramsTabName }).first().click();
    await page.waitForSelector(".param-form", { timeout: 3000 });
    check((await page.locator(".param-form").count()) === 1, "exactly one ParamForm is mounted");

    // Type into the search box and leave it focused.
    const mobileSearch = page.locator("#param-search-input");
    await mobileSearch.click();
    await mobileSearch.fill("thick");
    check(
      await page.evaluate((id) => document.activeElement?.id === id, "param-search-input"),
      "search input holds focus before the breakpoint change"
    );

    // Flip the breakpoint (a real device rotation crossing 860px would fire
    // the same matchMedia change useIsMobile listens for).
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector(".app-shell__desktop", { timeout: 3000 });
    check(
      (await page.locator(".app-shell__mobile").count()) === 0 &&
        (await page.locator(".param-form").count()) === 1,
      "switching to desktop remounts to a single layout tree"
    );
    check(
      (await page.locator("#param-search-input").inputValue()) === "thick",
      "search query survives the breakpoint change"
    );
    check(
      (await page.getByRole("tab", { name: paramsTabName }).first().getAttribute("aria-selected")) === "true",
      "active tab survives the breakpoint change"
    );
    // Poll rather than snapshot: the restore lands in a layout effect after
    // the desktop tree commits, and other mount-time focus (Radix tabs) can
    // hold the active element for a frame or two first. A bounded wait is
    // what a user experiences; a one-shot read here was a long-lived flake.
    const focusRestored = await page
      .waitForFunction((id) => document.activeElement?.id === id, "param-search-input", { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    check(focusRestored, "search focus is restored after the breakpoint change");

    // Back to mobile: the sheet detent set above (Half) must not have reset
    // to Peek just because the layout remounted.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForSelector(".app-shell__mobile", { timeout: 3000 });
    check(
      (await page.locator(".bottom-sheet--half").count()) === 1,
      "sheet detent survives a round-trip breakpoint change"
    );

    console.log("=== mobile bottom sheet: focus at peek/half/full (M16) ===");
    // Peek/Half: non-modal — the background (top bar etc.) is not inert and
    // stays keyboard-reachable. Currently at Half (set above); cycle the
    // handle taps (cycleDetent order is peek -> half -> full -> peek) back to
    // Peek deterministically.
    for (let i = 0; i < 3 && !(await page.locator(".bottom-sheet--peek").count()); i++) {
      await page.locator(".sheet-handle").click();
      await page.waitForTimeout(50);
    }
    check((await page.locator(".bottom-sheet--peek").count()) === 1, "sheet returned to peek");
    // PR4: the loop above changed detents at least once (half -> full and/or
    // full -> peek) — the one-time hint must be dismissed by now.
    check((await page.locator(".sheet-hint").count()) === 0, "sheet hint is dismissed after a detent change");
    check(
      !(await page.locator(".app-shell__mobile-background").getAttribute("inert").catch(() => null)),
      "background is not inert at peek"
    );
    const outputBell = page.locator(".mobile-top-bar__output");
    await outputBell.focus();
    check(
      await page.evaluate(() => document.activeElement?.classList.contains("mobile-top-bar__output")),
      "a background control is keyboard-focusable at peek"
    );

    await page.locator(".sheet-handle").click(); // peek -> half
    await page.waitForSelector(".bottom-sheet--half", { timeout: 3000 });
    check(
      !(await page.locator(".app-shell__mobile-background").getAttribute("inert").catch(() => null)),
      "background is not inert at half"
    );

    // Full: modal — background goes inert, and Tab must never escape the sheet.
    await page.locator(".sheet-handle").click(); // half -> full
    await page.waitForSelector(".bottom-sheet--full", { timeout: 3000 });
    check(
      (await page.locator(".app-shell__mobile-background").getAttribute("inert")) === "",
      "background is inert at full"
    );
    check(
      await page.evaluate(() => {
        const sheet = document.querySelector(".bottom-sheet");
        const el = document.activeElement;
        return !!sheet && !!el && (sheet.contains(el) || el.classList.contains("sheet-scrim"));
      }),
      "focus moves into the sheet on entering full"
    );
    // Tab repeatedly (well past the sheet's focusable count) and confirm
    // focus never lands in the inert background or on <body>.
    let escaped = false;
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      escaped = await page.evaluate(() => {
        const sheet = document.querySelector(".bottom-sheet");
        const bg = document.querySelector(".app-shell__mobile-background");
        const el = document.activeElement;
        if (!el || el === document.body) return true;
        if (bg?.contains(el)) return true;
        return !(sheet?.contains(el) || el.classList.contains("sheet-scrim"));
      });
      if (escaped) break;
    }
    check(!escaped, "Tab never escapes the sheet (or lands on <body>) while full is modal");

    // Escape collapses the modal detent and un-inerts the background.
    await page.keyboard.press("Escape");
    await page.waitForSelector(".bottom-sheet--half", { timeout: 3000 });
    check(
      !(await page.locator(".app-shell__mobile-background").getAttribute("inert").catch(() => null)),
      "Escape collapses full and un-inerts the background"
    );

    // PR4: the hint's once-flag is a persisted (localStorage) preference —
    // reloading must not re-arm it, even though the guided+half policy still
    // lands the sheet at Half every time (it isn't itself persisted).
    await page.reload({ waitUntil: "load" });
    await settleFirstVisit(page);
    await waitRenderDone(page).catch(() => {});
    check(
      (await page.locator(".bottom-sheet--half").count()) === 1,
      "guided+half policy still starts the sheet at half after reload"
    );
    check(
      (await page.locator(".sheet-hint").count()) === 0,
      "sheet hint does not return after reload (once-flag)"
    );
  } finally {
    await context.close();
  }
}

// Mobile peek is a real peek (PR14, rule 3): at the sheet's Peek detent, the
// checklist card (compact OR full) must NOT mount inside the sheet — only a
// slim, non-dismissible progress line may. BottomSheet measures the Peek
// height from whatever sits between the sheet's top edge and its tab strip
// (see BottomSheet.tsx's `measure()`), so a full card there balloons Peek
// past "handle + tab strip", exactly the bug this milestone fixes. Needs its
// own fresh mobile context: checkResponsiveLayout's context deliberately
// dismisses every first-visit surface (settleFirstVisit) before it starts,
// since ITS assertions are about focus/tab-order, not the checklist.
async function checkMobileChecklistPeek({ browser, base, check }) {
  console.log("=== mobile bottom sheet: checklist at peek/half/full (PR14) ===");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(base, { waitUntil: "load" });
    await dismissWelcomePopup(page);
    await waitRenderDone(page).catch(() => {});

    // The dogfood config's guided+half policy lands a fresh mobile visit at
    // Half, not Peek — the checklist (compact; QuickStart is active for tag)
    // shows normally there, above the tab strip.
    check((await page.locator(".bottom-sheet--half").count()) === 1, "fresh mobile load starts at half (guided+half policy)");
    check((await page.locator(".getting-started").count()) === 1, "checklist card shown inside the sheet at half");
    check((await page.locator(".getting-started-peek").count()) === 0, "no peek strip while at half");

    // Collapse to Peek (cycleDetent order is peek -> half -> full -> peek;
    // nudge the handle deterministically the same way checkResponsiveLayout does).
    for (let i = 0; i < 3 && !(await page.locator(".bottom-sheet--peek").count()); i++) {
      await page.locator(".sheet-handle").click();
      await page.waitForTimeout(50);
    }
    check((await page.locator(".bottom-sheet--peek").count()) === 1, "sheet reached peek");
    check((await page.locator(".getting-started").count()) === 0, "no checklist card (compact or full) inside the sheet at peek");
    const peekLine = page.locator(".getting-started-peek");
    check((await peekLine.count()) === 1, "a slim progress line takes its place at peek");
    check(/of \d+ complete/.test((await peekLine.textContent()) ?? ""), "the peek line carries the same task-progress copy");

    await runAxe(page, check, "mobile sheet at peek with the checklist progress strip");

    // Half again: the full checklist mounts back inside the sheet.
    await page.locator(".sheet-handle").click(); // peek -> half
    await page.waitForSelector(".bottom-sheet--half", { timeout: 3000 });
    check((await page.locator(".getting-started").count()) === 1, "checklist card returns inside the sheet at half");
    check((await page.locator(".getting-started-peek").count()) === 0, "peek strip is gone once raised off peek");

    // Full: same rule (card mounts, not the slim strip).
    await page.locator(".sheet-handle").click(); // half -> full
    await page.waitForSelector(".bottom-sheet--full", { timeout: 3000 });
    check((await page.locator(".getting-started").count()) === 1, "checklist card shown inside the sheet at full");
    check((await page.locator(".getting-started-peek").count()) === 0, "no peek strip at full");
  } finally {
    await context.close();
  }
}

// PR16: mobile Messages is a full-height MODAL DIALOG, not a second bottom
// surface stacked over the persistent sheet (see AppShell.tsx's own doc on
// openOutput / the mobile JSX for the full rationale). Covers:
//  - opening via the bell mounts exactly one surface: the reused
//    <OutputConsole> lives INSIDE the dialog, and the sheet is hidden from
//    assistive tech (Radix's own hideOthers) while it's up — never two
//    stacked bottom surfaces.
//  - closing (the console's own `.output-console__close`, or Escape) leaves
//    the sheet's detent exactly where it was — nothing was ever moved by
//    opening it, so there's nothing to "restore".
//  - the bell still opens it (the toggle's close branch is exercised by the
//    desktop checks elsewhere in this suite — see openConsole/closeOutput —
//    since on mobile the bell sits UNDER the now-opaque dialog and can't be
//    clicked at all while it's open, same as every other modal in the app).
//  - the pre-existing auto-open-on-first-warning effect (AppShell's
//    hasProblem) still fires on mobile, still doesn't touch the sheet's
//    detent, and the one deliberate exception — stepping Full down to Half
//    so this dialog's focus trap doesn't stack under the sheet's own Full-
//    detent trap — actually holds a keyboard user inside a single trap.
//  - axe with the console open on mobile.
async function checkMobileOutputConsole({ browser, base, check, ids, paramsTabName }) {
  console.log("=== mobile Messages: one bottom surface at a time (PR16) ===");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const sheetInert = () =>
    page.evaluate(() => {
      let el = document.querySelector(".bottom-sheet");
      while (el) {
        if (el.getAttribute("aria-hidden") === "true") return true;
        el = el.parentElement;
      }
      return false;
    });
  try {
    await page.goto(base, { waitUntil: "load" });
    await settleFirstVisit(page);
    await waitRenderDone(page).catch(() => {});

    check((await page.locator(".output-console").count()) === 0, "Messages starts closed");
    // Guided+half policy (see checkResponsiveLayout) lands a fresh visit at Half.
    check((await page.locator(".bottom-sheet--half").count()) === 1, "sheet starts at half");

    console.log("--- opening via the bell ---");
    await page.locator(".mobile-top-bar__output").click();
    await page.waitForSelector('[role="dialog"]', { timeout: 3000 });
    check((await page.locator('[role="dialog"]').count()) === 1, "the bell opens a single modal dialog");
    check(
      (await page.locator('[role="dialog"] .output-console').count()) === 1,
      "the reused OutputConsole (Notices/Log/Metrics) lives INSIDE the dialog"
    );
    check((await page.locator(".output-console").count()) === 1, "exactly one .output-console in the DOM");
    check(await sheetInert(), "the sheet is hidden from assistive tech while the dialog is open — never two stacked surfaces");
    check(
      (await page.locator(".bottom-sheet--half").count()) === 1,
      "opening Messages left the sheet's own detent (half) untouched"
    );

    await runAxe(page, check, "mobile Messages open (modal dialog)");

    console.log("--- closing restores nothing, because nothing moved ---");
    await page.locator(".output-console__close").click();
    await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 3000 });
    check((await page.locator('[role="dialog"]').count()) === 0, "closing Messages removes the dialog");
    check(!(await sheetInert()), "the sheet is reachable again once the dialog is gone");
    check(
      (await page.locator(".bottom-sheet--half").count()) === 1,
      "the sheet is still exactly where it was (half) after closing"
    );

    if (ids.includes("tag")) {
      console.log("--- auto-open on the first warning/assert (AppShell's hasProblem effect) ---");
      await page.getByRole("tab", { name: paramsTabName }).first().click();
      await page.waitForSelector(".quick-start", { timeout: 5000 }).catch(() => {});
      if (await page.locator(".quick-start__step").count())
        await page.locator(".quick-start__step").filter({ hasText: "Text" }).first().click();

      // Raise the sheet to Full FIRST, driving the trip from controls INSIDE
      // it (not the top bar bell — M16 marks the background `inert` and
      // covers it with the sheet's own scrim at Full, so a bell click can
      // never reach it there in the first place; the sheet's own content
      // stays fully reachable at every detent, including Full). This is the
      // one path that actually exercises openOutput's Full -> Half step-down
      // (see its own doc in AppShell.tsx): the auto-open effect fires from
      // this state change, not a click, so it's a faithful repro of the only
      // way a maker could realistically hit "Messages wants to open while
      // the sheet already covers the screen at Full".
      for (let i = 0; i < 3 && !(await page.locator(".bottom-sheet--full").count()); i++) {
        await page.locator(".sheet-handle").click();
        await page.waitForTimeout(50);
      }
      check((await page.locator(".bottom-sheet--full").count()) === 1, "sheet reached full for this scenario");

      await paramRow(page, "engrave_text").getByRole("switch").click();
      // engrave_text && label != "" (default "ScadPub") && text_depth(3) >= thickness(3, default) -> assert.
      await setNumField(page, "text_depth", 3);
      await page
        .waitForFunction(() => /Failed/.test(document.querySelector(".render-status")?.textContent || ""), {
          timeout: 30000,
        })
        .catch(() => {});
      check(
        (await page.locator(".bottom-sheet--half").count()) === 1,
        "auto-opening Messages from Full steps the sheet down to Half (avoids the sheet's own Full-detent trap stacking under the dialog's)"
      );
      let escaped = false;
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press("Tab");
        escaped = await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]');
          const el = document.activeElement;
          return !el || el === document.body || !dialog?.contains(el);
        });
        if (escaped) break;
      }
      check(!escaped, "Tab never escapes the dialog while it's open (a single, unambiguous trap)");
      check(
        (await page.locator('[role="dialog"] .output-console').count()) === 1,
        "a failed-assert render auto-opens Messages as the same modal dialog, unprompted"
      );
      check(
        /engraved text is deeper than the plate/.test((await page.locator(".output-console").textContent()) ?? ""),
        "the auto-opened console shows the assert's own message"
      );
      await page.locator(".output-console__close").click();
      await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 3000 });
    }
  } finally {
    await context.close();
  }
}

// PR16: single-row mobile action bar. ActionButtons.tsx is the exact same
// component/markup on both layouts (see its own doc) — only CSS
// (index.css's `.app-shell__mobile .action-cluster` rules) makes mobile
// behave differently: Image/Share drop to icon-only and Export's format line
// shrinks further, freeing enough width that the row never wraps to a second
// line, even at 320px (the WCAG 1.4.10 Reflow floor this suite otherwise
// doesn't have a dedicated check for). Desktop's own two-row-tolerant wrap
// (ACTION_CLUSTER_CLASS's doc) is untouched and not exercised here.
async function checkMobileActionBar({ browser, base, check }) {
  console.log("=== mobile action bar: single row, no wrap down to 320px (PR16) ===");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(base, { waitUntil: "load" });
    await settleFirstVisit(page);
    await waitRenderDone(page).catch(() => {});

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(150); // let the reflow settle
      const box = await page.locator(".action-cluster").boundingBox();
      // A wrapped (two-row) cluster is roughly 2x a single row's height; a
      // single row — even with Export's own two-line CTA — measures well
      // under this. 70px comfortably separates the two cases (observed
      // single-row height ~60px, wrapped ~110px+) without pinning an exact,
      // font/DPI-brittle figure.
      check(!!box && box.height < 70, `action row is a single line at ${width}px (height ${box?.height})`);
      check(!!box && box.x >= 0 && box.x + box.width <= width, `action row stays within the ${width}px viewport`);
    }

    console.log("--- Image/Share are icon-only but stay reachable by aria-label ---");
    const img = page.locator('[aria-label="Save image"]');
    const share = page.locator('[aria-label="Copy share link"]');
    check((await img.count()) === 1 && (await img.isVisible()), "Image is reachable by its aria-label");
    check((await share.count()) === 1 && (await share.isVisible()), "Share is reachable by its aria-label");
    check(
      !(await img.locator(".action-btn-label").isVisible().catch(() => false)),
      "Image's visible text label is hidden on mobile (icon-only) — the aria-label above is unaffected"
    );

    // PR23 item 2: the Share button's icon/aria-label track whether it will
    // actually hand off to the native OS share sheet (navigator.share) or
    // fall back to a clipboard copy — headless Chromium (even with touch
    // emulation) doesn't implement the Web Share API, so this build's
    // deterministic branch is the copy-link one: Link2 + "Copy share link",
    // asserted above. Confirm the icon actually matches — lucide-react's
    // default per-icon class (`.lucide-link-2` / `.lucide-share-2`, see
    // ActionButtons.tsx) is a stable enough hook for this.
    const hasNativeShare = await page.evaluate(() => "share" in navigator);
    check(
      !hasNativeShare,
      "sanity: this headless browser has no navigator.share, so the copy-link branch below is the one actually exercised"
    );
    check(
      (await share.locator(".lucide-link-2").count()) === 1,
      "Share shows the Link2 (copy) icon when navigator.share is unavailable"
    );
    check(
      (await share.locator(".lucide-share-2").count()) === 0,
      "Share does NOT show the Share2 (native share sheet) icon here"
    );

    console.log("--- export + the after-export panel still work (minimal — see checkExports for the full desktop flow) ---");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click(".action-export")]);
    check(!!dl, "Export still produces a download on the compact mobile bar");
    const successPanel = page.locator(".export-success");
    await successPanel.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
    check((await successPanel.count()) === 1, "the after-export panel still appears");
    const successBox = await successPanel.boundingBox();
    const clusterBox = await page.locator(".action-cluster").boundingBox();
    check(
      !!successBox && !!clusterBox && successBox.y + successBox.height <= clusterBox.y + 1,
      "the after-export panel rides above the action cluster (PR9's .action-dock), not overlapping it"
    );
  } finally {
    await context.close();
  }
}

// Help modal mobile polish (PR19 item 4): the config-level intro collapses
// into a closed <details> "About" disclosure below the mobile breakpoint (so
// tabs + content lead instead of being pushed down), and the tab strip
// scrolls horizontally on one row instead of wrapping to several. Desktop is
// covered implicitly (untouched) by every other Help-modal check in this
// suite, which all run at the desktop viewport.
async function checkHelpModalMobile({ browser, base, check }) {
  console.log("=== Help modal (mobile): intro collapses to \"About\", tab strip scrolls without wrapping ===");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(base, { waitUntil: "load" });
    await settleFirstVisit(page);
    await waitRenderDone(page).catch(() => {});

    // The mobile top bar collapses theme/help/licenses into a "⋮" overflow
    // popover (BarActions.tsx's `collapse` presentation) — open it first.
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("button", { name: "Help", exact: true }).click();
    const helpDialog = page.getByRole("dialog");
    await helpDialog.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});

    const about = helpDialog.locator("details.help-about");
    check((await about.count()) === 1, "the config intro renders as a collapsible <details> \"About\" disclosure on mobile");
    check(
      !(await about.evaluate((el) => el.open)),
      "the About disclosure starts collapsed, so the tabs aren't pushed down by it"
    );
    await about.locator("summary").click();
    check(await about.evaluate((el) => el.open), "tapping the summary opens the About disclosure");
    await about.locator("summary").click(); // collapse again before the rest of this check

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(150); // let the reflow settle
      const rows = await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll('[role="dialog"] [role="tab"]'));
        const tops = tabs.map((el) => el.getBoundingClientRect().top);
        return { count: tabs.length, sameRow: tops.every((y) => Math.abs(y - tops[0]) < 1) };
      });
      check(rows.count >= 3, `at least the config's ${rows.count} help tabs are present at ${width}px`);
      check(rows.sameRow, `all tab chips share one row at ${width}px — scrolling, not wrapping`);
      const overflowX = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      check(overflowX <= 0, `no horizontal page overflow at ${width}px (excess ${overflowX}px)`);
    }

    console.log("--- edge-fade affordance (PR23 item 3): appears/disappears with actual scroll position ---");
    // The loop above leaves the viewport at 320px, the narrowest case and the
    // one most likely to clip tabs.
    const scroller = page.locator(".help-tabs-scroll");
    const fadeState = () => scroller.getAttribute("data-fade");
    check(
      (await fadeState()) === "right" || (await fadeState()) === "both",
      `unscrolled tab strip fades the right edge only (saw "${await fadeState()}") — more topics are off-screen there, none to the left yet`
    );
    await scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await page.waitForTimeout(50); // the scroll listener is passive/async
    check(
      (await fadeState()) === "left",
      `scrolling all the way right flips the fade to the left edge only (saw "${await fadeState()}")`
    );
    await scroller.evaluate((el) => { el.scrollLeft = 0; });
    await page.waitForTimeout(50);

    console.log("--- tab strip keyboard operability: roving tabindex reaches every chip and scrolls it into view ---");
    const tabs = helpDialog.getByRole("tab");
    await tabs.first().click(); // focus + set as the roving tab stop
    await page.keyboard.press("End"); // Radix roving focus: jump to the last tab
    const lastVisible = await page.evaluate(() => {
      const scrollEl = document.querySelector(".help-tabs-scroll");
      const focused = document.activeElement;
      if (!scrollEl || !focused) return false;
      const box = focused.getBoundingClientRect();
      const scrollBox = scrollEl.getBoundingClientRect();
      return box.left >= scrollBox.left - 1 && box.right <= scrollBox.right + 1;
    });
    check(
      await tabs.last().evaluate((el) => el === document.activeElement),
      "pressing End on the tab strip moves focus to the last tab (Radix roving tabindex)"
    );
    check(lastVisible, "the newly-focused last tab is scrolled fully into view, not left clipped off-screen");
    await page.keyboard.press("Home"); // leave the strip focused at the first tab for anything after this

    await runAxe(page, check, "Help modal open on mobile (About collapsed, tabs scrollable)");
    await page.keyboard.press("Escape");
  } finally {
    await context.close();
  }
}

// F10: ORDERING — main()'s call sequence below isn't arbitrary; several
// checks are load-bearing on state (once-flags, Cache Storage, settings-view,
// the checklist's dismiss/retirement flag, …) a PRIOR check left behind, and
// reordering them would break that chain silently rather than loudly. This
// map collects the ordering rationale that's otherwise scattered across each
// check's own doc comment (kept in place below — this is a single point of
// reference, not a replacement for them) into one list, in main()'s actual
// call order:
//   1. checkOfflineClaimToast runs FIRST, before anything else reloads the
//      page or otherwise disturbs Cache Storage — it needs a genuine,
//      deterministic cache-MISS download to exercise the offline-claim toast
//      (see the sw.js route-block above and the check's own doc).
//   2. checkGettingStarted deliberately leaves the checklist alive (compact,
//      undismissed) for checkChecklistRetirement, right after it, to drive a
//      real export against.
//   3. checkViewerHint runs BEFORE checkChecklistRetirement: the gesture hint
//      auto-fades 8s after first render if untouched, and that fade PERSISTS
//      (the same once-flag a real dismiss uses) — running it first keeps its
//      own wall-clock budget short and deterministic instead of racing
//      checkChecklistRetirement's heavier reload/dialog round-trips.
//   4. checkChecklistRetirement leaves the checklist DISMISSED (persisted)
//      at the end — checkReadiness (much later) relies on exactly that: it
//      brings the checklist back itself via the Help modal's replay row to
//      check the live "Preview" status, and leaves it dismissed again
//      afterward for whatever runs after it.
//   5. checkSettingsView leaves the panel in "All settings" for checkQuickStart
//      right after it (which switches to essentials to exercise QuickStart,
//      then switches back) — and, transitively, for every later check that
//      also expects the full, ungated panel: bundled presets' Import/Export
//      row and checkTagDesign's @showIf/@collapsed checks.
async function main() {
  const { server, port, basePath } = await startServer();
  const base = `http://127.0.0.1:${port}${basePath}`;
  const browser = await launchChromium();
  const page = await browser.newPage();
  // Block the service worker's own script (public/sw.js) for this whole run.
  // Its `install` handler independently warms the render worker's binary
  // cache (see sw.js's precacheBin) — on a fast loopback connection that
  // background fetch usually wins the race against the render worker's own
  // bootstrap download, leaving worker.ts with a Cache Storage HIT and no
  // `loadProgress` events. checkOfflineClaimToast below needs a genuine,
  // deterministic cache-miss download to exercise the offline-claim toast
  // (useAppNotices.ts) reliably; nothing else in this suite depends on an
  // actually-registered/controlling service worker (checkServiceWorker reads
  // sw.js's raw source via an HTTP GET, not through a live registration).
  await page.context().route("**/sw.js*", (route) => route.abort());
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let failures = 0;
  const check = (ok, msg) => console.log(`  ${ok ? "✅" : (failures++, "❌")} ${msg}`);
  const dir = await mkdtemp(join(tmpdir(), "scadpub-smoke-"));

  try {
    await page.goto(base, { waitUntil: "load" });

    // Design list comes from the generated schema (the picker is a Radix Select
    // with no native <option> elements in the DOM). Single-design configs have
    // no picker; treat them as a one-element list.
    const schema = JSON.parse(
      await readFile(fileURLToPath(new URL("../src/generated/designs.json", import.meta.url)), "utf-8")
    );
    const designs = schema.designs ?? [];
    for (const d of designs) designLabels[d.id] = d.label;
    // Panel tab names are config-overridable (ui.presetsLabel/parametersLabel).
    const presetsTabName = schema.ui?.presetsLabel || "Presets";
    const paramsTabName = schema.ui?.parametersLabel || "Customize";
    const ids = designs.map((d) => d.id);
    console.log(`=== designs (${ids.length || 1}): ${ids.join(", ") || "(single)"}  ===`);
    await waitRendered(page, ids[0]);

    const ctx = { page, browser, check, base, dir, schema, ids, presetsTabName, paramsTabName };
    // Runs first, before anything else reloads the page or otherwise disturbs
    // Cache Storage — see the check's own doc comment for why ordering matters.
    await checkOfflineClaimToast(ctx);
    await checkWelcomePopup(ctx);
    await checkGettingStarted(ctx);
    // Runs BEFORE checkChecklistRetirement (which drives a real export
    // through several reload/dialog round-trips) — the viewer gesture hint
    // auto-fades 8s after its first successful render if untouched
    // (ViewerGestureHint.tsx's FADE_TIMEOUT_MS), and that fade PERSISTS (the
    // same once-flag a real dismiss uses) — ordering it here keeps this
    // check's own wall-clock budget short and deterministic instead of
    // racing checkChecklistRetirement's heavier round-trips.
    await checkViewerHint(ctx);
    await checkChecklistRetirement(ctx);
    await checkDesignPickerDialog(ctx);
    await checkSettingsView(ctx);
    await checkQuickStart(ctx);
    await checkFileImport(ctx);
    await checkFilesCards(ctx);
    await checkThemeToggle(ctx);
    await checkIdleRenderCount(ctx);
    await checkAxe(ctx);
    await checkEveryDesignRenders(ctx);
    await checkBundledPresets(ctx);
    await checkPresetImport(ctx);
    await checkPresetSaveReveal(ctx);
    await checkExports(ctx);
    await checkPreviewControls(ctx);
    await checkServiceWorker(ctx);
    await checkTagDesign(ctx);
    await checkReadiness(ctx);
    await checkFilesFontMissingCard(ctx);
    await checkSignageDesign(ctx);
    await checkResponsiveLayout(ctx);
    await checkQuickStartMobile(ctx);
    await checkMobileChecklistPeek(ctx);
    await checkMobileOutputConsole(ctx);
    await checkMobileActionBar(ctx);
    await checkHelpModalMobile(ctx);

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
