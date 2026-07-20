// smoke-guided.mjs — Wave 3's guided-workflow (`ui.workflow: "guided"`)
// end-to-end coverage, a sibling of smoke.mjs (which drives the DEFAULT
// dogfood config, `ui.workflow: "tabs"`, and is left completely unchanged —
// see its own header doc). Neither script can exercise both configs at once
// (the app's schema/build is baked in at build time — see CLAUDE.md's
// generation-pipeline doc), so this owns its OWN build: it derives a guided
// config from `scadpub.config.json` at runtime (buildGuidedConfig below —
// structurally cloned, with a small explicit override applied: a distinct
// `id` so browser-storage namespaces never collide with the tabs-mode smoke
// run, `ui.workflow: "guided"`, and the `tag` design's `reviewLabels`/
// `reviewNote` the guided Review assertions exercise), writes it to a
// gitignored temp file alongside the real config (CONFIG_DIR-relative paths
// — `source`, `assets`, design icons/images — only resolve correctly
// sitting next to it, see gen-schema.mjs's own `CONFIG_DIR`), regenerates
// the schema from THAT, and runs `vite build` into a SEPARATE output
// directory (`dist-guided/`, gitignored — see serve-dist.mjs's
// `startServer(dist)` param), so the default dist/ the rest of the gate
// relies on (tabs-mode smoke, npm run vis) is never touched. Generating
// on every run (rather than hand-maintaining a second static config file,
// this script's original approach) means the guided config can never drift
// from the dogfood config it's meant to be a small, explicit delta on top
// of — no separately-edited copy of `help`, `popup`, `notices`, `designs`,
// … to forget to update. The default schema is regenerated again in a
// `finally` block so a crash here never leaves the repo's generated/ state
// pointed at the guided config for whatever runs next (`npm run smoke` runs
// this straight after smoke.mjs — see package.json's "smoke" script).
//
// Covers (see Wave 3's own task list): stages-only primary nav (no Examples/
// Customize/Files tabs, no guide row), the unified selector (Designs/
// Examples/Saved, footer never covers the last card), the always-visible
// mobile header + overflow menu, inline font/SVG import, the dedicated
// Review screen (no toggle/search/footer/export dropdown; explicit issue
// list; Ready-for-download), direct Download+Share (no split/More), the
// download-with-issues -> focus-Review -> Download-anyway flow, mobile
// detents (Half for Content/Appearance, the taller Review detent, model
// visible), and axe-core accessibility (both themes, desktop + mobile).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { startServer } from "./serve-dist.mjs";
import {
  launchChromium,
  waitRendered as waitRenderDone,
  dismissWelcomePopup,
  settleFirstVisit,
  withMobileContext,
  settleAnimations,
  runAxe,
} from "./lib/browser.mjs";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const BASE_CONFIG = fileURLToPath(new URL("../scadpub.config.json", import.meta.url));
// Gitignored — generated fresh by buildGuidedConfig() below on every run.
// Lives next to scadpub.config.json (not os.tmpdir()): gen-schema.mjs
// resolves `source`/`assets`/design icons/images relative to the config
// file's OWN directory, so the generated file has to sit where the real
// config does for those relative paths to still resolve.
const GUIDED_CONFIG = fileURLToPath(new URL("../scadpub.guided.generated.json", import.meta.url));
const GUIDED_DIST = fileURLToPath(new URL("../dist-guided", import.meta.url));
const GEN_SCHEMA = fileURLToPath(new URL("./gen-schema.mjs", import.meta.url));
// A THIRD, throwaway config+dist (see checkHeavyDesignLivePreview's own doc)
// — `tag` marked `heavy: true` so autoRender starts off. Kept entirely
// separate from GUIDED_CONFIG/GUIDED_DIST: applying that flag there would
// change autoRender's default for every other check in this file (several
// assert `.auto-render` is ABSENT by default on a guided content stage —
// see checkMobileStagesOnlyNav — which only holds while `tag` isn't heavy).
const HEAVY_CONFIG = fileURLToPath(new URL("../scadpub.guided-heavy.generated.json", import.meta.url));
const HEAVY_DIST = fileURLToPath(new URL("../dist-guided-heavy", import.meta.url));

function run(cmd, args, env) {
  execFileSync(cmd, args, { cwd: WEB, stdio: "inherit", env: { ...process.env, ...env } });
}

// Structurally clones scadpub.config.json and applies the SMALL explicit
// delta the guided smoke actually needs — see this file's own header doc.
// Anything not listed here (help copy, popup, notices, designs other than
// `tag`'s two extra keys, …) is inherited verbatim from the dogfood config,
// so this can never silently drift from it the way the old hand-maintained
// scadpub.guided.config.json did.
function buildGuidedConfig() {
  const base = JSON.parse(readFileSync(BASE_CONFIG, "utf-8"));
  const guided = structuredClone(base);
  // Distinct `id` -> distinct localStorage/IndexedDB/preset-cache namespace
  // (see CLAUDE.md's "Config-driven chrome" doc on `id`), so this run's
  // state can never collide with a tabs-mode smoke run against the same
  // origin/port.
  guided.id = "scadpub-guided";
  guided.ui = { ...guided.ui, workflow: "guided" };
  // The guided Review screen's curated-summary assertions (checkDesktopReview
  // below) need the `tag` design to declare reviewLabels/reviewNote — copied
  // verbatim from the old static scadpub.guided.config.json. The note now
  // names the actual transform tag.scad applies (see its own `_uppercase`/
  // `echo("@review", "label", …)`) so checkDesktopReview's own assertion that
  // the curated "Text" row shows the RENDERED (capitalised) value, not the
  // raw typed one, has an honest note to go with it.
  //
  // Round-6 final wave: a SECOND curated key (`hole` -> "Mounting", after
  // `label` -> "Text" in object order) so checkDesktopReview can actually
  // exercise buildGuidedReviewRows' two round-6 ordering rules end-to-end,
  // not just via reviewSummary.test.mjs's unit coverage: rows render in
  // `reviewLabels`' own object-key order (Text first — "Visible lettering"
  // leads, matching real deployments' own reviewLabels shape), and the
  // overall Dimensions row is inserted right BEFORE the last curated row
  // (2+ curated rows), landing Dimensions ahead of Mounting rather than
  // trailing the whole block — see buildGuidedReviewRows' own doc.
  const tag = guided.designs.find((d) => d.id === "tag");
  if (tag) {
    tag.reviewLabels = { label: "Text", hole: "Mounting" };
    tag.reviewNote =
      "Text always prints in capitals, whatever case you type it in; the font shown above sets its style.";
  }
  // Round-5 final wave: opt the "alert" notice category into `attention` +
  // `subsumedByFont` — this generated config ONLY (the real scadpub.config.json
  // is untouched, so the live dogfood site's default "alerts are routine,
  // demo-only notices" behavior is unaffected). tag.scad's own "the label
  // text is tall … may overflow the plate" alert is exactly the docs/
  // config.md example of a subsumedByFont category (an advisory that only
  // fires because a substitute font's metrics differ from the intended one);
  // this lets checkReviewHonestReadiness below exercise the real "a missing
  // font AND its own subsumed alert both pending -> reads as exactly ONE
  // issue" scenario end-to-end, not just via unit tests. See its own
  // `subsumedByFont` doc (src/lib/readiness.ts) for why this is still safe
  // with the "alert" category's OTHER (non-font-related) messages — those
  // remain excluded from Review's issue count too whenever a font is
  // missing, but checkDesktopReview's own "ready" assertion below always
  // navigates with `show_emblem:false` precisely so the always-on-by-default
  // "showing both an emblem and a label" alert can never make a clean render
  // read as "attention" when no font is missing.
  const alertNotice = guided.notices?.find((n) => n.marker === "alert");
  if (alertNotice) {
    alertNotice.attention = true;
    alertNotice.subsumedByFont = true;
  }
  writeFileSync(GUIDED_CONFIG, JSON.stringify(guided, null, 2) + "\n");
}

// See HEAVY_CONFIG/HEAVY_DIST's own doc — a small, explicit delta on the SAME
// base config, `tag` (the only `@step`-declaring example design, so the only
// one QuickStart ever runs for) marked `heavy: true`. tag.scad's only
// `@advanced` params (facet_angle/facet_size, under the `[Quality]` section)
// belong to the "size" step, so its own "Show advanced settings" toggle
// appears there — but not on the other three stages (Text/Emblem/Hanging
// hole). checkHeavyDesignLivePreview below navigates off the Size stage to
// one of those, to exercise the shape the round-5 review's functional item 9
// fix targets (a heavy design on a stage with no @advanced params reachable).
function buildGuidedHeavyConfig() {
  const base = JSON.parse(readFileSync(BASE_CONFIG, "utf-8"));
  const guided = structuredClone(base);
  guided.id = "scadpub-guided-heavy";
  guided.ui = { ...guided.ui, workflow: "guided" };
  const tag = guided.designs.find((d) => d.id === "tag");
  if (tag) tag.heavy = true;
  writeFileSync(HEAVY_CONFIG, JSON.stringify(guided, null, 2) + "\n");
}

async function waitRendered(page, label) {
  await waitRenderDone(page);
  console.log(`  ${label ?? "default"}: rendered ✅`);
}

// ─── Desktop: stages-only primary nav, no guide row, no tab strip ─────────
async function checkDesktopStagesOnlyNav({ page, check }) {
  console.log("=== desktop: stages-only primary nav ===");
  check((await page.getByRole("tab").count()) === 0, "no Presets/Customize/Files tab strip in guided primary nav");
  check((await page.locator(".getting-started").count()) === 0, "no getting-started guide row in guided mode");
  check((await page.locator(".settings-view-toggle").count()) === 0, "no standing Essential/All settings toggle");
  const chips = page.locator(".quick-start__step");
  check((await chips.count()) === 5, "5 stage chips shown (4 @step sections + Review) for the tag design");
  check((await page.locator(".quick-start__nav").count()) === 0, "no Back/Next row on desktop (chips are the only nav — stepNav=false)");
}

// ─── Desktop: no empty collapse-chevron row above the panel's stage nav ───
// Round-6 Wave 2, item 11: the collapse control used to sit alone in its own
// otherwise-empty header strip above the stage nav; it now floats directly on
// the panel's resize-handle edge (`.param-panel__collapse-btn`, `position:
// absolute` — out of flow, doesn't push the stage nav down), so the stage
// nav (`.quick-start-strip-slot`, `mt-(--space-5)` = 24px) should start
// right after the panel's own top edge with nothing else occupying flow
// space above it.
async function checkDesktopCollapseRow({ page, check }) {
  console.log("=== desktop: no empty collapse-chevron row above the guided panel's stage nav ===");
  const collapseBtn = page.locator(".param-panel__collapse-btn");
  check((await collapseBtn.count()) === 1, "the collapse control renders as its own floating button");
  const geom = await page.evaluate(() => {
    const panel = document.querySelector(".param-panel");
    const strip = document.querySelector(".quick-start-strip-slot");
    if (!panel || !strip) return null;
    const p = panel.getBoundingClientRect();
    const s = strip.getBoundingClientRect();
    return { gap: s.top - p.top };
  });
  check(
    !!geom && geom.gap >= 0 && geom.gap <= 40,
    `the stage nav starts within 40px of the panel's own top edge (measured gap ${geom?.gap}px) — no leftover empty header row (the old row + its own top margin measured well over 60px)`
  );

  // The collapse button itself is still fully functional from its new spot —
  // clicking it still collapses the panel to the rail (a zero-WIDTH flex
  // item once collapsed — see its own "Collapsed" doc in index.css — so
  // Playwright's "visible" wait targets the floating re-open button that
  // actually gets a real box, not the now-empty rail div itself).
  await collapseBtn.click();
  await page.locator(".param-panel-open-btn").waitFor({ state: "visible", timeout: 3000 });
  check((await page.locator(".param-panel-open-btn").count()) === 1, "the relocated collapse button still collapses the panel (the re-open rail button appears)");
  check((await page.locator(".param-panel__collapse-btn").count()) === 0, "the collapse button itself is gone once collapsed (only the panel, not the rail, carries it)");
  await page.locator(".param-panel-open-btn").click();
  await page.locator(".param-panel__collapse-btn").waitFor({ state: "visible", timeout: 3000 });
  check((await page.locator(".param-panel").count()) === 1, "reopening restores the panel");
}

// ─── Desktop: unified selector — Designs / Examples / Saved, footer clearance ─
async function checkUnifiedSelectorDesktop({ page, check }) {
  console.log("=== desktop: unified selector (Designs/Examples/Saved) ===");
  await page.locator(".command-bar__design-picker .design-picker-button").click();
  const dialog = page.getByRole("dialog", { name: "Choose a design" });
  await dialog.waitFor({ state: "visible", timeout: 3000 });
  check(await dialog.isVisible(), "unified selector dialog opens from the header design-name button");

  const groups = page.locator(".unified-selector__groups [role='tab']");
  check((await groups.count()) === 3, "3 groups: Designs / Examples / Saved setups");
  const groupLabels = await groups.allTextContents();
  check(
    groupLabels.join("|") === "Designs|Examples|Saved setups",
    `groups read Designs/Examples/Saved setups (saw ${groupLabels.join("|")})`
  );

  await runAxe(page, check, "unified selector open (Designs group, desktop)");

  // Examples group: the tag design's bundled presets (examples/tag.json).
  await groups.filter({ hasText: "Examples" }).click();
  const exampleCards = page.locator("[data-selector-card^='example:']");
  await exampleCards.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await exampleCards.count()) === 2, "Examples group shows the tag design's 2 bundled presets");

  // Footer never covers the last card: the scroll area's own bottom padding
  // must be at least the footer's live height (+ some clearance).
  const clearance = await page.evaluate(() => {
    const scroll = document.querySelector(".unified-selector__scroll");
    const footer = document.querySelector(".unified-selector__footer");
    if (!scroll || !footer) return null;
    const pad = parseFloat(getComputedStyle(scroll).paddingBottom || "0");
    return { pad, footerH: footer.getBoundingClientRect().height };
  });
  check(
    !!clearance && clearance.pad >= clearance.footerH,
    `Examples scroll area's bottom padding (${clearance?.pad}px) clears the footer's live height (${clearance?.footerH}px)`
  );

  // Saved group: save the current settings under a name, then see it listed.
  await groups.filter({ hasText: "Saved setups" }).click();
  const saveInput = page.locator(".unified-selector__save-row input");
  await saveInput.fill("Smoke saved setup");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const savedItem = page.locator("[data-selector-card='saved:Smoke saved setup']");
  await savedItem.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check((await savedItem.count()) === 1, "a setup saved from the Saved group appears in its own list");

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
}

// ─── Desktop: inline font/SVG import stays reachable without a Files tab ──
async function checkInlineFileImportDesktop({ page, check }) {
  console.log("=== desktop: inline font/SVG import (no Files tab) ===");
  // (no Files tab check needed here — checkDesktopStagesOnlyNav already
  // asserts zero `[role="tab"]` elements in guided primary nav.)

  // tag: a bogus font family surfaces the missing-font warning card, which
  // leads with its own "Import font" action — the inline affordance
  // FontSelect's own dropdown + ParamRows' adjacent row both offer.
  await page.goto(`${page.url().split("#")[0]}#d=tag&v=${encodeURIComponent(JSON.stringify({ font: "No Such Font" }))}`);
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "tag with a missing font (desktop inline import)");
  // Jump to the "Text" stage chip, where the font control lives.
  await page.locator(".quick-start__step").filter({ hasText: "Text" }).click();
  const fontImportBtn = page.getByRole("button", { name: "Import font" }).first();
  await fontImportBtn.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  check((await fontImportBtn.count()) > 0, "an inline \"Import font\" action is reachable from the font control's own warning card");

  // panel: the @svg control's own drop zone is the ONLY svg import surface
  // (no Files tab to fall back to).
  await page.goto(`${page.url().split("#")[0]}#d=panel`);
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "panel (desktop inline svg import)");
  const svgDrop = page.locator(".svg-prepare");
  await svgDrop.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  check((await svgDrop.count()) > 0, "the @svg param's own drop zone is visible inline (panel design, guided mode)");

  // Leave clean for what follows.
  await page.goto(`${page.url().split("#")[0]}#d=tag`);
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "tag reloaded with defaults (desktop cleanup)");
}

// ─── Desktop: dedicated Review — no toggle/search/footer/export/colour ────
async function checkDesktopReview({ page, check }) {
  console.log("=== desktop: dedicated Review screen ===");
  // A genuinely CLEAN state, not whatever the previous check left behind:
  // `show_emblem:false` is the only way to make tag's own "showing both an
  // emblem and a label" alert stay silent (it's true for every OTHER field
  // at its design default — see buildGuidedConfig's own subsumedByFont doc),
  // so this really does land on the honest "ready" state the assertions
  // below check for. `#d=…&v=…` always starts from the design's OWN
  // defaults (urlState.ts's applyDiff), so this is deterministic regardless
  // of what earlier checks did to stored/session state.
  await page.goto(`${page.url().split("#")[0]}#d=tag&v=${encodeURIComponent(JSON.stringify({ show_emblem: false }))}`);
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "tag, clean/ready state (show_emblem off)");

  await page.locator(".quick-start__step--review").click();
  const review = page.locator(".quick-start__review--guided");
  await review.waitFor({ state: "visible", timeout: 3000 });
  check((await review.count()) === 1, "the guided Review screen renders");
  check((await page.locator(".settings-view-toggle").count()) === 0, "no Essential/All toggle on Review");
  check((await page.locator("#param-search-input").count()) === 0, "no search box on Review");
  check((await page.locator(".auto-render").count()) === 0, "no Live-preview footer on Review");
  check((await page.locator(".quick-start__review-export").count()) === 0, "no standing Export button on the dedicated Review screen (tabs-only markup)");
  check((await page.locator(".preset-diff").count()) === 0, "no preset-diff bar on Review");
  check((await page.locator(".quick-start__review-summary dt", { hasText: /braille/i }).count()) === 0, "no Braille row invented for this design's curated summary");

  // ─ Slim summary: ONLY the curated `reviewLabels` row(s) + ONE overall
  // "Dimensions" row — never the @info/computed metric rows tabs mode's own
  // Review (buildReviewSummaryRows) also shows for tag (Plate thickness,
  // Corner radius, Text height, Font, Text colour, Hole diameter, …) — see
  // buildGuidedReviewRows' own doc.
  //
  // Round-6, item 3: with TWO curated keys (buildGuidedConfig's `label` ->
  // "Text", `hole` -> "Mounting", in that object-key order), this also
  // exercises the actual ordering rules: rows render in reviewLabels' own
  // key order (Text first — "Visible lettering" leads, not whatever order
  // tag.scad happens to declare its params in), and Dimensions is inserted
  // right BEFORE the last curated row rather than appended after the whole
  // block — so the exact sequence is Text, Dimensions, Mounting.
  const summaryLabels = await page.locator(".quick-start__review-summary dt").allTextContents();
  check(
    summaryLabels.join("|") === "Text|Dimensions|Mounting",
    `guided Review's curated summary is EXACTLY "Text" + "Dimensions" + "Mounting" IN THAT ORDER — reviewLabels' own key order (Visible lettering first), with Dimensions landing before Mounting, not the @info/computed metric rows (saw ${summaryLabels.join("|")})`
  );
  check(summaryLabels[0] === "Text", 'the FIRST summary row is "Text" (visible lettering leads, per reviewLabels\' own key order)');
  check(
    summaryLabels.indexOf("Dimensions") < summaryLabels.indexOf("Mounting"),
    'the overall "Dimensions" row sits BEFORE "Mounting", not appended after every curated row'
  );
  for (const excluded of ["Plate thickness", "Corner radius", "Text height", "Font", "Text colour", "Hole diameter"]) {
    check(
      (await page.locator(".quick-start__review-summary dt", { hasText: excluded }).count()) === 0,
      `no "${excluded}" row in the slimmed guided summary (that stays in Messages)`
    );
  }

  // ─ Round-6, item 3: labels never ellipsize — the two-column grid's label
  // column wraps (whitespace-normal/overflow-visible) instead of clipping a
  // short column the way tabs-mode ReviewContent's `truncate` pairing did.
  // Checked two ways: the CSS itself never opts into ellipsis, and (the
  // behavioural proof) the rendered box is never actually narrower than its
  // own text needs — scrollWidth <= clientWidth with no overflow, for every
  // row's label, at the panel's normal desktop width.
  const dtOverflow = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".quick-start__review-summary dt")).map((dt) => ({
      text: dt.textContent,
      textOverflow: getComputedStyle(dt).textOverflow,
      ellipsized: dt.scrollWidth > dt.clientWidth + 1,
    }))
  );
  for (const row of dtOverflow) {
    check(row.textOverflow !== "ellipsis", `"${row.text}" label never opts into CSS text-ellipsis (saw ${row.textOverflow})`);
    check(!row.ellipsized, `"${row.text}" label never overflows its own column (scrollWidth <= clientWidth — wraps instead of clipping)`);
  }

  // ─ `@review` override: the curated "Text" row shows what tag.scad actually
  // RENDERED (its own `_uppercase(label)` + `echo("@review", "label", …)`),
  // not the raw typed default ("ScadPub") — see tag.scad's own doc.
  const textRow = page.locator(".quick-start__review-summary > div").filter({ has: page.locator("dt", { hasText: "Text" }) });
  const textValue = (await textRow.locator("dd").first().textContent())?.trim();
  check(
    textValue === "SCADPUB",
    `the curated "Text" row shows the @review-rendered value "SCADPUB", not the raw typed "ScadPub" (saw "${textValue}")`
  );

  // ─ Readiness sits ABOVE THE FOLD: Review always opens scrolled to the top
  // (Wave 1) with the readiness block visible without scrolling.
  const scrollTop = await page.locator(".customize-tab__scroll").evaluate((el) => el.scrollTop);
  check(scrollTop === 0, `Review opens scrolled to the top of the panel (scrollTop was ${scrollTop})`);

  // Clean tag defaults (show_emblem off) -> no attention items -> "Ready for
  // download" strip.
  const readyStrip = page.locator(".quick-start__review-ready");
  await readyStrip.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  check((await readyStrip.count()) === 1, "\"Ready for download\" strip shows when there is nothing to review");
  check((await page.locator(".quick-start__review-issue-count").count()) === 0, "no issue-count line when there's nothing to review");

  // The guided Review carries no "Front view" camera shortcut (the viewer's
  // own controls own that) — only the "Edit <stage>" navigation links.
  check(
    (await page.locator(".quick-start__review-front-view").count()) === 0,
    "the guided Review has no \"Front view\" button"
  );

  // ─ Ready state carries no dot/badge anywhere — neither the Review chip's
  // own amber dot nor the header bell's quiet notice dot (round-5 Wave 1:
  // "reads as ready" has to mean ready everywhere at once, not just here).
  check(
    (await page.locator(".quick-start__step--review .quick-start__step-attention").count()) === 0,
    "the Review chip carries no amber attention dot while ready"
  );
  check(
    (await page.locator(".command-bar__output .output-toggle__dot").count()) === 0,
    "the header bell carries no notice dot while ready"
  );

  // reviewNote (config's designs[].reviewNote) renders.
  check((await page.locator(".quick-start__review-note").count()) === 1, "the design's configured reviewNote renders on Review");

  // "Edit <stage>" links jump back to a real stage.
  const editLinks = page.locator(".quick-start__review-edit");
  check((await editLinks.count()) === 4, "one \"Edit <stage>\" link per declared step");
  await editLinks.first().click();
  check((await page.locator(".quick-start__review--guided").count()) === 0, "an \"Edit <stage>\" link actually navigates away from Review");

  await runAxe(page, check, "guided Review screen, clean/ready state (desktop)");
}

// ─── Desktop: honest readiness — subsumedByFont, notice dot == visible cards ─
async function checkReviewHonestReadiness({ page, check }) {
  console.log("=== desktop: honest readiness (subsumedByFont collapses to 1 issue; bell == genuine notice count) ===");

  // ─ Part 1: a GENUINE notice, no font problem at all — the positive half
  // of the bell's contract. tag's own always-on-by-default "alert" (show an
  // emblem AND a label at once) is opted into `attention: true` by
  // buildGuidedConfig; with the design's plain defaults (no url overrides —
  // a working bundled font, show_emblem/label both left on) that alert is
  // pending and there is no font-fallback in the picture, so it counts as a
  // genuine `kind: "notice"` attention item (readiness.ts's `deriveAttention`
  // — subsumedByFont only excludes a category's notice when a font-fallback
  // is ALSO present this render). Round-6, item 5: this is exactly the case
  // the header bell's dot SHOULD carry — a real notices[]-category problem,
  // not a readiness gap with its own separate carrier.
  await page.goto(`${page.url().split("#")[0]}#d=tag`);
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "tag with plain defaults (genuine-notice honest readiness)");

  const bellDot = page.locator(".command-bar__output .output-toggle__dot");
  await bellDot.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  check((await bellDot.count()) === 1, "the header bell shows its quiet notice dot for a genuine pending notice (no font problem involved)");

  await page.locator(".command-bar__output").click();
  const noticesCards = page.locator(".console-attention .attention-card__item");
  await noticesCards.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check(
    (await noticesCards.count()) === 1,
    "the Notices panel shows exactly ONE visible card, matching the header dot — a genuine notice, bell count == visible notice card count"
  );
  await page.locator(".command-bar__output").click(); // close it again

  // ─ Part 2: missing font AND that SAME "alert" (flagged subsumedByFont)
  // both pending at once — the alert is a SYMPTOM of the substituted font's
  // metrics, so it must NOT double-count alongside the font problem actually
  // causing it. deriveAttention drops the subsumed notice ENTIRELY here (not
  // merely merges it) — the one surviving attention item is the font-
  // fallback itself, `kind: "font-fallback"`, never `kind: "notice"`.
  const hash = `d=tag&v=${encodeURIComponent(JSON.stringify({ font: "No Such Font" }))}`;
  await page.goto(`${page.url().split("#")[0]}#${hash}`);
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "tag with a missing font (subsumedByFont honest readiness)");

  await page.locator(".quick-start__step--review").click();
  const issueCount = page.locator(".quick-start__review-issue-count");
  await issueCount.waitFor({ state: "visible", timeout: 5000 });
  check(
    ((await issueCount.textContent()) ?? "").trim() === "1 issue to review",
    "exactly ONE issue reads on Review despite the subsumed alert also being pending — the font is the one real cause"
  );
  const reviewAttentionCards = page.locator(".quick-start__review-attention .attention-card__item");
  check((await reviewAttentionCards.count()) === 1, "Review's own attention list shows exactly one item, not two");

  // Round-6, item 5: the survivor here is a READINESS gap (font-fallback),
  // not a genuine notice — the Review chip's own dot already carries it (see
  // checkMobileStageNav320's mobile-header equivalent of this same check), so
  // the header bell now honestly shows NOTHING, even though Review still
  // reads "1 issue" and its own attention list still shows one card. This is
  // the fix f881b43 made: round-5's bell counted `attention.length` (any
  // attention item at all), which lit the SAME bell for a font problem the
  // Review dot already represented — a font-only gap now has exactly one
  // carrier (Review's dot/issue card), not two.
  check((await bellDot.count()) === 0, "the header bell shows NO notice dot here — the sole surviving issue is a font-fallback readiness gap, not a genuine notice");

  // The general-purpose Notices/Messages panel (AttentionItems, reused
  // verbatim from Review/Appearance's own font-warning cards) still renders
  // that font item as its own card — it's never hidden, just not double-
  // counted as a distinct "notice" the way the subsumed alert itself would
  // have been. So the panel and the bell deliberately DISAGREE here: one
  // card showing, zero notice-bell dots — because that one card is a
  // readiness gap with its own separate carrier, not a notices[]-category
  // problem the bell's vocabulary covers.
  await page.locator(".command-bar__output").click();
  await noticesCards.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check(
    (await noticesCards.count()) === 1,
    "the Notices panel still shows the font item as its own card (never hidden), even though the bell above it stays quiet — the subsumed alert itself stays fully excluded either way"
  );
  await page.locator(".command-bar__output").click(); // close it again

  // Clean up.
  await page.goto(`${page.url().split("#")[0]}#d=tag`);
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "tag reloaded with defaults (honest-readiness cleanup)");
}

// ─── Desktop: export-attention banner suppressed on EVERY guided stage ─────
// Round-6, item 2 (supersedes round-5 Wave 2 item 3, which kept a compact
// copy of this banner over the viewer while Review itself was active): the
// standing "N issues to review before download" banner now never shows in
// guided workflow, on ANY stage, including Review — it read as a literal
// duplicate of Review's own issue card once Review already showed the same
// count/detail inline. Readiness is now carried entirely by the Review
// chip's amber dot, the contextual font warning in Appearance, and Review's
// own issue card — never a floating viewer-overlay banner.
async function checkNoIssueBannerAnyStage({ page, check }) {
  console.log('=== desktop: "N issues to review" banner absent on EVERY guided stage (Content/Appearance AND Review) ===');
  const hash = `d=tag&v=${encodeURIComponent(JSON.stringify({ font: "No Such Font" }))}`;
  await page.goto(`${page.url().split("#")[0]}#${hash}`);
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "tag with a missing font (export-attention banner gating)");

  // On a content stage (Text, where the font control lives) there IS a real
  // unresolved issue, yet the standing viewer banner must stay hidden — the
  // Review chip's own dot and the contextual font warning already cover it.
  await page.locator(".quick-start__step").filter({ hasText: "Text" }).click();
  check(
    (await page.locator(".export-attention").count()) === 0,
    "no \"N issues to review\" banner over the viewer on a guided Content stage, despite a real unresolved issue"
  );

  // tag has no step literally named "Appearance" (its steps are Size/Text/
  // Emblem/Hanging hole) — Emblem is the closest non-Text content stage, so
  // covering it too confirms the gate isn't accidentally scoped to just the
  // ONE stage a font control happens to live on.
  const secondContentStage = page.locator(".quick-start__step").filter({ hasText: "Emblem" });
  if ((await secondContentStage.count()) > 0) {
    await secondContentStage.first().click();
    check(
      (await page.locator(".export-attention").count()) === 0,
      "no \"N issues to review\" banner over the viewer on a second guided content stage either"
    );
  }

  // Round-6: the banner stays gone even on Review itself now — Review's own
  // issue card (`.quick-start__review-attention`) carries the same
  // information without a second, floating copy of it.
  await page.locator(".quick-start__step--review").click();
  await page.locator(".quick-start__review-attention").waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check(
    (await page.locator(".export-attention").count()) === 0,
    "the \"N issues to review\" banner stays absent once the Review stage itself is active too — Review's own issue card is the only surface for it now"
  );
  check(
    (await page.locator(".quick-start__review-attention").count()) === 1,
    "Review's own issue card is still present (readiness isn't lost, just no longer duplicated as a floating banner)"
  );

  await page.goto(`${page.url().split("#")[0]}#d=tag`);
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "tag reloaded with defaults (banner-gating cleanup)");
}

// ─── Desktop: direct Download + Share, download-with-issues -> Review flow ─
async function checkDesktopExportFlow({ page, check }) {
  console.log("=== desktop: direct Download+Share, download-with-issues routing ===");
  await page.locator(".quick-start__step").first().click(); // back to a content stage
  check((await page.locator(".action-export").count()) === 1, "direct Download button (no split trigger)");
  check((await page.locator(".action-export-options").count()) === 0, "no split \"▾\" trigger in guided mode");
  check((await page.locator(".action-export-menu").count()) === 0, "no export format dropdown menu in guided mode");
  check((await page.locator(".action-share").count()) === 1, "direct Share button");
  check((await page.locator(".action-more").count()) === 0, "no \"More\" menu (Save image/Copy link) in guided mode");
  check(!(await page.locator(".action-export-format-note").isVisible()), "the format note (3MF caption) is hidden on the guided dock, matching mobile");

  // Force an unresolved issue (missing font), then press Download: must NOT
  // download immediately — routes to Review with the just-in-time confirm.
  await page.goto(`${page.url().split("#")[0]}#d=tag&v=${encodeURIComponent(JSON.stringify({ font: "No Such Font" }))}`);
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "tag with a missing font (download routing)");

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 3000 }).catch(() => null),
    page.locator(".action-export").click(),
  ]);
  check(download === null, "pressing Download with an unresolved issue does NOT download immediately");
  await page.locator(".quick-start__review--guided").waitFor({ state: "visible", timeout: 3000 });
  check((await page.locator(".quick-start__review--guided").count()) === 1, "Download with an unresolved issue focuses the Review screen instead");
  const confirm = page.locator(".quick-start__review-download-confirm");
  await confirm.waitFor({ state: "visible", timeout: 3000 });
  check((await confirm.count()) === 1, "the just-in-time \"Download anyway\" confirmation appears on Review");

  const [download2] = await Promise.all([
    page.waitForEvent("download", { timeout: 10000 }).catch(() => null),
    page.locator(".quick-start__review-download-anyway").click(),
  ]);
  check(download2 !== null, "\"Download anyway\" actually exports the file");
  check((await page.locator(".quick-start__review-download-confirm").count()) === 0, "the confirmation clears after Download anyway");

  // Clean up.
  await page.goto(`${page.url().split("#")[0]}#d=tag`);
  await page.reload({ waitUntil: "load" });
  await settleFirstVisit(page).catch(() => {});
  await waitRendered(page, "tag reloaded with defaults (export-flow cleanup)");
}

// ─── Desktop axe sweep, both themes ────────────────────────────────────────
async function checkAxeBothThemes({ page, check }) {
  console.log("=== accessibility (axe-core), both themes ===");
  for (let pass = 0; pass < 2; pass++) {
    const theme = await page.getAttribute("html", "data-theme");
    await runAxe(page, check, `guided desktop, ${theme} theme`);
    if (pass === 0) await page.locator('.command-bar__right button[aria-label^="Switch to"]').first().click();
  }
}

// ─── Mobile: always-visible header + overflow menu ─────────────────────────
async function checkMobileHeader({ browser, base, check }) {
  console.log("=== mobile: always-visible guided header + overflow menu ===");
  await withMobileContext(browser, async (page) => {
    await page.goto(base, { waitUntil: "load" });
    await settleFirstVisit(page);
    await waitRenderDone(page).catch(() => {});

    const header = page.locator(".guided-mobile-header");
    check((await header.count()) === 1, "the guided mobile header is present");
    const box = await header.boundingBox();
    check(!!box && box.height >= 56 && box.height <= 68, `guided mobile header height is 56-68px (measured ${box?.height}px)`);

    // Raise the sheet to Full and confirm the header stays visible/operable —
    // unlike tabs mode's .mobile-top-bar, which the sheet covers/inerts there.
    await page.locator(".sheet-handle").click(); // peek -> half
    await page.locator(".sheet-handle").click(); // half -> full
    await page.waitForSelector(".bottom-sheet--full", { timeout: 3000 }).catch(() => {});
    check(await header.isVisible(), "the guided header stays visible even at the Full sheet detent");

    const overflow = page.locator(".guided-mobile-header__overflow");
    await overflow.click();
    const menu = page.getByRole("menu");
    await menu.waitFor({ state: "visible", timeout: 3000 });
    const items = await menu.getByRole("menuitem").allTextContents();
    for (const label of ["Help", "Theme", "Imported files", "Messages", "Open-source licenses"]) {
      check(items.some((t) => t.includes(label)), `overflow menu includes "${label}"`);
    }
    await runAxe(page, check, "guided mobile header overflow menu open");

    // "Imported files" opens the management screen.
    await menu.getByRole("menuitem", { name: /Imported files/ }).click();
    const filesDialog = page.getByRole("dialog", { name: "Imported files" });
    await filesDialog.waitFor({ state: "visible", timeout: 3000 });
    check(await filesDialog.isVisible(), "\"Imported files\" opens ImportedFilesModal");
    // Round-5 Wave 2 (item 8): "Clear all" is hidden entirely (not merely
    // disabled) while there's nothing imported — a fresh guided session here
    // has never imported a font/SVG, so the empty state is exactly what's
    // showing.
    check((await filesDialog.getByRole("button", { name: "Clear all" }).count()) === 0, "\"Clear all\" is hidden (not just disabled) when no files are imported");
    check((await filesDialog.locator(".file-manager").count()) === 1, "the imported-files list shell still renders (its own empty-state message covers \"nothing here\")");
    await page.keyboard.press("Escape");
    await filesDialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Collapse back down for whatever runs after this.
    await page.locator(".sheet-handle").click().catch(() => {});
  });
}

// ─── Mobile: stages-only nav, no tab strip/guide row/footer ────────────────
async function checkMobileStagesOnlyNav({ browser, base, check }) {
  console.log("=== mobile: stages-only nav (no tabs, no guide row, no live-preview footer) ===");
  await withMobileContext(browser, async (page) => {
    await page.goto(base, { waitUntil: "load" });
    await settleFirstVisit(page);
    await waitRenderDone(page).catch(() => {});

    check((await page.getByRole("tab").count()) === 0, "no Examples/Customize/Files tab strip on mobile guided");
    check((await page.locator(".getting-started").count()) === 0, "no getting-started guide row on mobile guided");
    check((await page.locator(".auto-render").count()) === 0, "no permanent live-preview footer on mobile guided stages");
    check((await page.locator(".settings-view-toggle").count()) === 0, "no Essential/All switch on mobile guided");
    check((await page.locator("#param-search-input").count()) === 0, "no search box in essential mode on mobile guided");

    // Only ONE persistent nav row above the active stage content: the
    // stage-chip strip.
    const stripSlot = page.locator(".quick-start-strip-slot");
    await stripSlot.waitFor({ state: "visible", timeout: 5000 });
    const firstFieldVisible = await page.evaluate(() => {
      const strip = document.querySelector(".quick-start-strip-slot");
      const field = document.querySelector(".param");
      if (!strip || !field) return false;
      const sheet = document.querySelector(".sheet-frame");
      if (!sheet) return false;
      const sheetBottom = sheet.getBoundingClientRect().bottom;
      const fieldBottom = field.getBoundingClientRect().bottom;
      return fieldBottom <= sheetBottom;
    });
    check(firstFieldVisible, "the first Content field is visible without scrolling once the sheet is open");
  });
}

// ─── Mobile: detents — peek -> select stage -> half; Review -> taller detent ─
async function checkMobileDetents({ browser, base, check }) {
  console.log("=== mobile: guided detents (peek -> half on stage select; taller Review detent) ===");
  await withMobileContext(browser, async (page) => {
    await page.goto(base, { waitUntil: "load" });
    await settleFirstVisit(page);
    await waitRenderDone(page).catch(() => {});

    // The base config's mobileInitialSheet:"half" (inherited verbatim by the
    // generated guided config, see buildGuidedConfig above) means a fresh
    // guided+half visit already lands on Half (PR4 policy, unchanged by this
    // wave) — collapse to Peek first so the peek->half transition below is
    // actually exercised from Peek, not a no-op.
    check((await page.locator(".bottom-sheet--half").count()) === 1, "sanity: guided+half policy starts the sheet at Half");
    await page.locator(".sheet-handle").click(); // half -> full (tap-cycle)
    await page.locator(".sheet-handle").click(); // full -> peek (tap-cycle wraps)
    await page.waitForSelector(".bottom-sheet--peek", { timeout: 3000 });

    // At Peek, the stage-chip strip itself must be visible/tappable (it now
    // sizes the Peek height — see BottomSheet's measure() fix).
    const firstChip = page.locator(".quick-start__step").first();
    check(await firstChip.isVisible(), "the first stage chip is visible at the Peek detent");
    const chipBox = await firstChip.boundingBox();
    check(!!chipBox && chipBox.height >= 44, `guided stage chips are >= 44px tall (measured ${chipBox?.height}px)`);

    // Selecting a stage at Peek raises the sheet straight to Half — never to Full.
    await firstChip.click();
    await page.waitForSelector(".bottom-sheet--half", { timeout: 3000 });
    check((await page.locator(".bottom-sheet--full").count()) === 0, "selecting a stage from Peek lands on Half, never Full");

    // Switching between two content stages stays at Half (no jump to Full).
    await page.locator(".quick-start__step").nth(1).click();
    check((await page.locator(".bottom-sheet--half").count()) === 1, "switching between Content/Appearance stages stays at Half");

    // Entering Review raises to the taller "review" detent — model still
    // visible above the sheet at every step.
    const modelVisibleAbove = async () => {
      const sheetTop = await page.locator(".bottom-sheet").evaluate((el) => el.getBoundingClientRect().top);
      const viewportH = await page.evaluate(() => window.innerHeight);
      return sheetTop > 0 && sheetTop < viewportH;
    };
    check(await modelVisibleAbove(), "the model area is visible above the sheet at Half");

    await page.locator(".quick-start__step--review").click();
    await page.waitForSelector(".bottom-sheet--review", { timeout: 3000 });
    check((await page.locator(".bottom-sheet--review").count()) === 1, "entering Review raises the sheet to its own taller \"review\" detent");
    check(await modelVisibleAbove(), "the model area is still visible above the sheet at the Review detent");
    // "review" is taller than "half" but the sign/model is never fully covered
    // (never reaches "full" — sheetTop stays > 0, already asserted above).
    const reviewTop = await page.locator(".bottom-sheet").evaluate((el) => el.getBoundingClientRect().top);
    check(reviewTop >= 0, "the Review detent never crops the model off the top of the viewport");

    // Round-5 Wave 2 (item 4): the export dock rides the sheet's REAL top
    // edge at the taller Review detent too (--sheet-cap-ratio) — Download/
    // Share must stay above the sheet, not hidden behind it, exactly where a
    // visitor who just reviewed an issue would look for them.
    const downloadBtn = page.locator(".action-export");
    const shareBtn = page.locator(".action-share");
    check(await downloadBtn.isVisible(), "the Download button is visible above the sheet at the Review detent");
    check(await shareBtn.isVisible(), "the Share button is visible above the sheet at the Review detent");
    // The Review detent animates via CSS transitions — the dock's `bottom`
    // (driven by --sheet-top) and the sheet's own height both ease in. Reading
    // geometry synchronously right after the class swap races those
    // transitions; wait until the dock-bottom / sheet-top pair is stable across
    // two consecutive frames (≈2s cap) before measuring, so the check is
    // deterministic rather than timing-dependent.
    await page.evaluate(async () => {
      const rectOf = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.getBoundingClientRect() : null;
      };
      const snap = () => {
        const d = rectOf(".action-dock");
        const s = rectOf(".bottom-sheet");
        return d && s ? `${Math.round(d.bottom)}:${Math.round(s.top)}` : null;
      };
      const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
      let prev = null;
      for (let i = 0; i < 120; i++) {
        const cur = snap();
        if (cur !== null && cur === prev) return;
        prev = cur;
        await frame();
      }
    });
    const dockBottom = await page.locator(".action-dock").evaluate((el) => el.getBoundingClientRect().bottom);
    const sheetTopNow = await page.locator(".bottom-sheet").evaluate((el) => el.getBoundingClientRect().top);
    check(dockBottom <= sheetTopNow + 1, `the export dock's own bottom edge (${dockBottom}) clears the sheet's real top edge (${sheetTopNow}) at the Review detent, not just the shorter Half cap`);

    // Leaving Review restores Half.
    await page.locator(".quick-start__step").first().click();
    await page.waitForSelector(".bottom-sheet--half", { timeout: 3000 });
    check((await page.locator(".bottom-sheet--half").count()) === 1, "leaving Review restores the Half detent");
  });
}

// ─── Mobile: viewer HUD reduced to TWO controls — Reset + View menu ───────
// Round-5 Wave 2 (item 6): Fullscreen moved OFF the directly-visible row and
// INTO the View menu (alongside the camera-angle options/grid/measure
// toggles it already held) — was three direct controls (Reset + Fullscreen +
// the View menu trigger), now exactly two.
async function checkMobileViewerHud({ browser, base, check }) {
  console.log("=== mobile: guided viewer HUD (Reset + View menu) ===");
  await withMobileContext(browser, async (page) => {
    await page.goto(base, { waitUntil: "load" });
    await settleFirstVisit(page);
    await waitRenderDone(page).catch(() => {});

    const hud = page.locator(".viewer-hud.viewer-hud--compact");
    await hud.waitFor({ state: "visible", timeout: 5000 });
    check((await hud.count()) === 1, "the compact HUD variant renders on mobile guided");
    check((await hud.getByLabel("Reset view").count()) === 1, "Reset view shown directly");
    check((await hud.locator(".viewer-hud__view-menu").count()) === 1, "a single \"View\" menu control replaces the individual view/measure/grid/zoom/fullscreen buttons");
    check((await hud.locator(".icon-btn").count()) === 2, "exactly two directly-visible HUD controls (Reset + the View menu trigger) — fullscreen is folded in, not tested for visibility here since headless support is environment-dependent");
    check((await hud.getByLabel(/show reference grid|hide reference grid/i).count()) === 0, "grid toggle is NOT a direct HUD button in compact mode");
    check((await hud.getByLabel(/show dimensions|hide dimensions/i).count()) === 0, "measure toggle is NOT a direct HUD button in compact mode");

    await hud.locator(".viewer-hud__view-menu").click();
    const menu = page.getByRole("menu");
    await menu.waitFor({ state: "visible", timeout: 3000 });
    check((await menu.getByText("Isometric").count()) === 1, "the View menu holds the camera-angle options");
    check((await menu.getByText(/show reference grid|hide reference grid/i).count()) === 1, "the View menu holds the grid toggle");
    check((await menu.getByText(/show dimensions|hide dimensions/i).count()) === 1, "the View menu holds the measure toggle");
    await runAxe(page, check, "guided mobile compact HUD View menu open");
    await page.keyboard.press("Escape");
  });
}

// Scans a PNG buffer for the on-screen pixel bounding box of "non-background"
// content — every pixel that differs from the top-left corner sample (the
// scene background) by more than THRESH in any channel. Used below to
// measure the RENDERED MODEL's width in canvas pixels without any access to
// Viewer.tsx's internal camera state — a coarse but honest end-to-end probe
// of what a visitor actually sees, immune to any framing.ts refactor.
function modelPixelBBox(buf) {
  const png = PNG.sync.read(buf);
  const { width, height, data } = png;
  const bg = [data[0], data[1], data[2]];
  const THRESH = 22;
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (Math.abs(data[i] - bg[0]) > THRESH || Math.abs(data[i + 1] - bg[1]) > THRESH || Math.abs(data[i + 2] - bg[2]) > THRESH) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const modelWidth = maxX >= minX ? maxX - minX : 0;
  return { canvasWidth: width, canvasHeight: height, modelWidth, widthFrac: modelWidth / width };
}

// ─── Mobile: Review's camera fit — the model doesn't shrink dramatically ──
// Round-6, item 1: before this wave, jumping from a Content-stage stage to
// the taller mobile "review" sheet detent made the model render at roughly a
// QUARTER of its Content-stage width (a flat, Content-sized top inset
// combined with Review's much shorter unobscured canvas rect to produce a
// near-degenerate aspect ratio — see framing.ts's TOP_INSET_REVIEW_MOBILE_PX
// doc). This is an end-to-end pixel probe of the actual fix: hide every
// floating chrome element that can paint OVER the canvas (so it never gets
// mistaken for "model"), screenshot the bare `.viewer canvas` at Content and
// again at Review, and scan each for the rendered model's own pixel width.
async function checkMobileReviewCameraFit({ browser, base, check }) {
  console.log("=== mobile: Review's camera fit doesn't shrink the model dramatically ===");
  const HIDE_CSS = `
    .action-dock, .viewer-hud, .viewer-hint, .stale-banner, .dimension-info,
    .updating-chip, .export-attention { visibility: hidden !important; }
  `;
  await withMobileContext(browser, async (page) => {
    await page.goto(base, { waitUntil: "load" });
    await settleFirstVisit(page);
    await waitRenderDone(page).catch(() => {});
    await page.addStyleTag({ content: HIDE_CSS });

    const measure = async () => {
      await page.waitForTimeout(700); // let the camera-fit recompute/settle after any stage/detent change
      const canvas = page.locator(".viewer canvas").first();
      const buf = await canvas.screenshot();
      return modelPixelBBox(buf);
    };

    const content = await measure();
    console.log(`  Content: canvas=${content.canvasWidth}x${content.canvasHeight} model width=${content.modelWidth}px (${(content.widthFrac * 100).toFixed(1)}%)`);
    check(content.widthFrac > 0.3, `sanity: the model actually renders something substantial on the Content stage (${(content.widthFrac * 100).toFixed(1)}% of canvas width)`);

    await page.locator(".quick-start__step--review").click();
    await page.waitForSelector(".bottom-sheet--review", { timeout: 3000 }).catch(() => {});
    const review = await measure();
    console.log(`  Review: canvas=${review.canvasWidth}x${review.canvasHeight} model width=${review.modelWidth}px (${(review.widthFrac * 100).toFixed(1)}%)`);

    // Two independent thresholds, both aimed at the actual regression: a
    // coarse pixel scan (anti-aliased edges, the HUD's own reserved strip
    // still counted in the raw canvas width) can't hit the spec's ~55-65%
    // band exactly, so these are deliberately loose with real margin above
    // the ~25% the pre-fix bug measured at.
    check(review.widthFrac >= 0.4, `Review's model fills a substantial share of the visible canvas width (${(review.widthFrac * 100).toFixed(1)}%, target ~55-65% of the unobscured viewer)`);
    const ratio = review.widthFrac / content.widthFrac;
    check(ratio >= 0.75, `Review's model width fraction isn't dramatically smaller than Content's (ratio ${ratio.toFixed(2)}, was ~0.25 before the round-6 fix)`);
  }, { viewport: { width: 390, height: 844 } });
}

// ─── Mobile: the stage nav's equal-grid layout never overflows at 320px ───
// Round-6 Wave 2, item 1: the old flex row + fixed-width connectors scrolled
// internally once content exceeded its own width, leaving the trailing
// Review chip (and its amber readiness dot) scrolled past the visible edge
// at 320px with no scroll affordance — it just read as clipped. The new
// equal N-column grid divides the available width up front instead.
async function checkMobileStageNav320({ browser, base, check }) {
  console.log("=== mobile: stage-nav at 320px shows every stage (incl. Review's label + dot) with no overflow ===");
  const hash = `d=tag&v=${encodeURIComponent(JSON.stringify({ font: "No Such Font" }))}`;
  await withMobileContext(
    browser,
    async (page) => {
      await page.goto(`${base}#${hash}`, { waitUntil: "load" });
      await settleFirstVisit(page).catch(() => {});
      await waitRenderDone(page).catch(() => {});

      const nav = page.locator(".stage-navigation");
      await nav.waitFor({ state: "visible", timeout: 5000 });

      const overflow = await nav.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      check(!overflow, "the stage-nav grid never scrolls internally at 320px (scrollWidth <= clientWidth)");

      const viewportWidth = 320;
      const items = page.locator(".stage-navigation .stage-item");
      const itemCount = await items.count();
      check(itemCount === 5, `all 5 stage chips (4 @step + Review) are in the DOM at 320px (saw ${itemCount})`);
      for (let i = 0; i < itemCount; i++) {
        const box = await items.nth(i).boundingBox();
        check(!!box && box.x >= 0 && box.x + box.width <= viewportWidth + 1, `stage chip ${i} sits fully within the 320px viewport (left ${box?.x}, right ${(box?.x ?? 0) + (box?.width ?? 0)})`);
      }

      // The trailing Review chip specifically — the one the round-6 bug
      // clipped — and its own amber readiness dot (font missing above, so
      // readiness genuinely reads "attention" here) both fully on-screen.
      const reviewChip = page.locator(".quick-start__step--review");
      const reviewBox = await reviewChip.boundingBox();
      check(!!reviewBox && reviewBox.x + reviewBox.width <= viewportWidth + 1, `the Review chip's label is fully visible at 320px, not scrolled past the edge (right edge ${(reviewBox?.x ?? 0) + (reviewBox?.width ?? 0)})`);

      const reviewDot = reviewChip.locator(".quick-start__step-attention");
      await reviewDot.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
      check((await reviewDot.count()) === 1, "sanity: the Review chip's amber readiness dot is present (a real unresolved issue is pending)");
      const dotBox = await reviewDot.boundingBox();
      check(!!dotBox && dotBox.x + dotBox.width <= viewportWidth + 1, `the Review chip's amber readiness dot is fully visible at 320px too (right edge ${(dotBox?.x ?? 0) + (dotBox?.width ?? 0)})`);

      // Round-6, item 5, on the MOBILE header specifically: a missing font is
      // a readiness gap (kind "font-fallback"), not a genuine config
      // `notices[]` category — the Review chip's own dot is the right place
      // for it, but the header bell should stay quiet, exactly as already
      // proven for the desktop CommandBar bell in checkReviewHonestReadiness.
      const headerBellDot = page.locator(".guided-mobile-header__output .output-toggle__dot");
      check((await headerBellDot.count()) === 0, "the mobile header bell shows no notice dot for a font-only readiness gap, even while the Review chip's own dot is lit");
    },
    { viewport: { width: 320, height: 700 } }
  );
}

// ─── Mobile: unified selector auto-opens on first run, one-column layout ──
async function checkUnifiedSelectorAutoOpenMobile({ browser, base, check }) {
  console.log("=== mobile: unified selector auto-opens on first run (one-column layout) ===");
  await withMobileContext(browser, async (page) => {
    await page.goto(base, { waitUntil: "load" });
    const dialog = page.getByRole("dialog", { name: "Choose a design to create" });
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    check(await dialog.isVisible(), "the unified selector auto-opens on first run on mobile too");
    check((await page.locator(".unified-selector-dialog--mobile").count()) === 1, "mobile renders the dialog's own full-screen shell, not the shared centred Modal");

    // m6: like desktop, mobile's first-run welcome omits the empty
    // Saved-setups tab (nothing saved yet) — Designs/Examples only.
    const groups = dialog.locator(".unified-selector__groups [role='tab']");
    const groupLabels = await groups.allTextContents();
    check(
      groupLabels.join("|") === "Designs|Examples",
      `mobile's first-run surface omits the empty Saved-setups tab, same as desktop (saw ${groupLabels.join("|")})`
    );

    // One-column illustrated list (flex column), replacing desktop's 3-col
    // grid — see UnifiedSelectorDialog's own `cardLayout`/`gridClass` doc.
    const flexDirection = await page
      .locator(".unified-selector__grid")
      .first()
      .evaluate((el) => getComputedStyle(el).flexDirection);
    check(flexDirection === "column", `mobile's Designs group renders as a one-column list (flex-direction: ${flexDirection})`);
    // The Designs group reuses the shared DesignCard (`.design-picker-dialog__card`
    // + `[data-design]`) in its `layout="row"` form on mobile — the old
    // `SelectorListRow`/`.unified-selector__card` copy was removed in the
    // round-5 cleanup, so target the shared card class here.
    const firstCard = page.locator(".unified-selector__grid .design-picker-dialog__card").first();
    const cardBox = await firstCard.boundingBox();
    check(!!cardBox && cardBox.width > 300, `mobile's illustrated list rows span (near) the full width, not a narrow grid tile (measured ${cardBox?.width}px)`);

    // Same footer-clearance contract as desktop (checkUnifiedSelectorDesktop).
    const clearance = await page.evaluate(() => {
      const scroll = document.querySelector(".unified-selector__scroll");
      const footer = document.querySelector(".unified-selector__footer");
      if (!scroll || !footer) return null;
      const pad = parseFloat(getComputedStyle(scroll).paddingBottom || "0");
      return { pad, footerH: footer.getBoundingClientRect().height };
    });
    check(
      !!clearance && clearance.pad >= clearance.footerH,
      `mobile's footer never covers the last card either (scroll padding ${clearance?.pad}px >= footer height ${clearance?.footerH}px)`
    );

    await dismissWelcomePopup(page);
  });
}

// ─── Isolated: a heavy design, on a stage with no per-stage Advanced toggle ──
// still has a reachable Live-preview control (round-5 review, functional
// item 9). Builds its OWN separate config+dist (see HEAVY_CONFIG/HEAVY_DIST's
// own doc) so marking `tag` heavy never leaks into the main guided suite
// above, several of whose assertions depend on `tag` NOT being heavy (e.g.
// checkMobileStagesOnlyNav's "no permanent live-preview footer" — see its own
// doc, since a heavy design starts with autoRender off, which is exactly
// the condition that now surfaces this control).
async function checkHeavyDesignLivePreview({ check }) {
  console.log("=== isolated: heavy design (tag, on a stage with no @advanced params) still reaches Live preview ===");
  buildGuidedHeavyConfig();
  run(process.execPath, [GEN_SCHEMA], { SCADPUB_CONFIG: HEAVY_CONFIG });
  run(fileURLToPath(new URL("../node_modules/.bin/vite", import.meta.url)), ["build", "--outDir", HEAVY_DIST], {});

  const { server, port, basePath } = await startServer(HEAVY_DIST);
  const base = `http://127.0.0.1:${port}${basePath}`;
  const browser = await launchChromium();
  try {
    // Mobile ("steps") navigation, not desktop scroll: desktop mounts every
    // stage's group simultaneously (QuickStart.tsx's scroll-mode `steps.map`),
    // so Size's now-present Advanced toggle would stay in the DOM no matter
    // where the page is scrolled — "no Advanced toggle reachable on the
    // current stage" can only be checked honestly where only ONE step's
    // group is ever mounted at a time. That's also exactly the mode
    // `stepAdvancedInfo`'s `isFirstStep` doc calls out: "steps" mode always
    // passes `isFirstStep: true` for whichever step is currently mounted, so
    // the live-preview escape hatch still fires on Text even though it isn't
    // literally the first declared step.
    await withMobileContext(browser, async (page) => {
      await page.context().route("**/sw.js*", (route) => route.abort());
      await page.goto(base, { waitUntil: "load" });
      await dismissWelcomePopup(page);
      // A heavy design still fires exactly one initial render on load
      // (renderState.ts's shouldFireInitialRender) — only SUBSEQUENT live
      // edits are paused.
      await waitRenderDone(page);

      // The landing stage is "Size", which now carries tag's `[Quality]`
      // section (facet_angle/facet_size) and so has its own Advanced toggle —
      // navigate to "Text" instead, which (like Emblem/Hanging hole) has
      // none, to keep this check's premise (a stage with NO reachable
      // Advanced toggle) genuinely true. In mobile "steps" mode this actually
      // unmounts Size's group, unlike desktop scroll mode.
      await page.locator(".quick-start__step").filter({ hasText: "Text" }).click();

      // Sanity: the Text stage genuinely has no Advanced toggle to open —
      // none of its params are `// @advanced`, unlike Size (which now hosts
      // the `[Quality]` section), so `currentStepHasAdvanced` is false here.
      check((await page.locator(".quick-start__advanced-toggle").count()) === 0, "sanity: the current stage (Text) has no \"Show advanced settings\" toggle at all");

      const livePreview = page.locator(".quick-start__advanced-live-preview .auto-render");
      await livePreview.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
      check((await livePreview.count()) === 1, "the Live-preview control is reachable anyway, because autoRender starts off for a heavy design");

      const toggle = page.getByRole("switch", { name: "Live preview" });
      check(await toggle.isVisible(), "the Live-preview switch itself is visible and interactive");
      check((await toggle.getAttribute("aria-checked")) === "false", "it honestly reflects autoRender being off (heavy design, not yet turned on)");

      await runAxe(page, check, "guided heavy-design stage, Live-preview control visible");

      // Clicking it actually flips autoRender on — proven not by re-reading
      // the SAME switch (its own reveal condition, `!autoRender` with no
      // per-stage Advanced toggle here, stops holding the INSTANT autoRender
      // flips true, so the control correctly tucks itself away again — the
      // same standing-footer-free behavior a light, non-heavy design already
      // has) but by the control disappearing once turned on, which could
      // only happen if the click actually reached `autoRenderChange`.
      await toggle.click();
      await livePreview.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
      check((await livePreview.count()) === 0, "turning Live preview on tucks the control away again (no Advanced toggle to keep it open) — proves the click actually flipped autoRender");
    });
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  console.log("=== building guided config (ui.workflow: \"guided\") into dist-guided/ ===");
  try {
    buildGuidedConfig();
    run(process.execPath, [GEN_SCHEMA], { SCADPUB_CONFIG: GUIDED_CONFIG });
    run(fileURLToPath(new URL("../node_modules/.bin/vite", import.meta.url)), ["build", "--outDir", GUIDED_DIST], {});

    const { server, port, basePath } = await startServer(GUIDED_DIST);
    const base = `http://127.0.0.1:${port}${basePath}`;
    const browser = await launchChromium();
    const page = await browser.newPage();
    await page.context().route("**/sw.js*", (route) => route.abort());
    let failures = 0;
    const check = (ok, msg) => console.log(`  ${ok ? "✅" : (failures++, "❌")} ${msg}`);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    try {
      await page.goto(base, { waitUntil: "load" });

      // ─ Round-5 final wave: the unified selector auto-opens as the guided
      // FIRST-RUN welcome surface (config's own `popup.mode: "picker"`
      // header/body/footnote — see App.tsx's `popupSurface === "welcome"`
      // branch) — the SAME UnifiedSelectorDialog every later selection uses,
      // not a separate two-step welcome variant. Must run BEFORE
      // dismissWelcomePopup below, on this genuinely first load.
      console.log("=== desktop: unified selector auto-opens on first run (welcome surface) ===");
      const welcomeDialog = page.getByRole("dialog", { name: "Choose a design to create" });
      await welcomeDialog.waitFor({ state: "visible", timeout: 5000 });
      check(await welcomeDialog.isVisible(), "the unified selector auto-opens on first run, titled from the configured popup header");
      check(
        (await welcomeDialog.getByText("Configure it in your browser and export a ready-to-print model").count()) > 0,
        "the popup's own body text shows as the dialog's subtitle"
      );
      // m6: at first run there are no saved setups yet, so the welcome surface
      // omits the "Saved setups" tab (an empty tab advertises a feature the
      // visitor can't use). It reappears on any later open once something has
      // been saved (see checkUnifiedSelectorDesktop, which sees all three).
      const welcomeGroups = welcomeDialog.locator(".unified-selector__groups [role='tab']");
      const welcomeGroupLabels = await welcomeGroups.allTextContents();
      check(
        welcomeGroupLabels.join("|") === "Designs|Examples",
        `the first-run welcome surface omits the empty Saved-setups tab (Designs/Examples only; saw ${welcomeGroupLabels.join("|")})`
      );
      check(
        (await welcomeDialog.getByText("Everything runs in your browser. No file uploads.").count()) === 1,
        "the popup's own footnote replaces the default privacy line in the footer"
      );

      await dismissWelcomePopup(page);
      await waitRenderDone(page);

      const ctx = { page, browser, base, check };
      await checkDesktopStagesOnlyNav(ctx);
      await checkDesktopCollapseRow(ctx);
      await checkUnifiedSelectorDesktop(ctx);
      await checkInlineFileImportDesktop(ctx);
      await checkDesktopReview(ctx);
      await checkReviewHonestReadiness(ctx);
      await checkNoIssueBannerAnyStage(ctx);
      await checkDesktopExportFlow(ctx);
      await checkAxeBothThemes(ctx);
      await checkMobileHeader(ctx);
      await checkMobileStagesOnlyNav(ctx);
      await checkMobileDetents(ctx);
      await checkMobileViewerHud(ctx);
      await checkMobileReviewCameraFit(ctx);
      await checkMobileStageNav320(ctx);
      await checkUnifiedSelectorAutoOpenMobile(ctx);

      if (errors.length) {
        console.log("  page errors:", errors);
        failures += errors.length;
      }
    } finally {
      await browser.close();
      server.close();
    }

    // A separate, throwaway config+build+browser session (see its own doc) —
    // deliberately run AFTER the main guided browser/dist above are torn
    // down, never sharing them: marking `tag` `heavy` there would change
    // autoRender's default for every other check in this file.
    await checkHeavyDesignLivePreview({ check });

    console.log(`\n${failures === 0 ? "SMOKE (guided) PASS ✅" : `${failures} FAILURE(S) ❌`}`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    // Always restore the default config's generated schema — see this file's
    // own header doc.
    console.log("=== restoring the default config's generated schema ===");
    run(process.execPath, [GEN_SCHEMA], {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
