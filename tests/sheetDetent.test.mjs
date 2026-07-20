// Tests the pure policy behind the mobile bottom sheet's INITIAL detent:
// src/lib/sheetDetent.ts's initialSheetDetent. Mirrors
// tests/useExperience.test.mjs's style — pure inputs (mode, config, viewport
// height), no React/DOM, covering every branch of the guided-half policy.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialSheetDetent,
  SHORT_VIEWPORT_HEIGHT,
  reviewDetentOnEnter,
  reviewDetentOnLeave,
  sheetTopCapRatio,
  HALF_VH_RATIO,
  REVIEW_VH_RATIO,
} from "../src/lib/sheetDetent.ts";

const TALL = 900; // an ordinary portrait phone

test("initialSheetDetent: standard experience always starts at peek, regardless of config", () => {
  assert.equal(
    initialSheetDetent("standard", { ui: { experience: { mobileInitialSheet: "half" } } }, TALL),
    "peek"
  );
  assert.equal(initialSheetDetent("standard", undefined, TALL), "peek");
});

test("initialSheetDetent: guided experience stays at peek unless the config opts into half", () => {
  assert.equal(initialSheetDetent("guided", undefined, TALL), "peek");
  assert.equal(initialSheetDetent("guided", { ui: {} }, TALL), "peek");
  assert.equal(initialSheetDetent("guided", { ui: { experience: {} } }, TALL), "peek");
  assert.equal(
    initialSheetDetent("guided", { ui: { experience: { mobileInitialSheet: "peek" } } }, TALL),
    "peek"
  );
});

test("initialSheetDetent: guided + config half + a tall viewport starts at half", () => {
  assert.equal(
    initialSheetDetent("guided", { ui: { experience: { mobileInitialSheet: "half" } } }, TALL),
    "half"
  );
});

test("initialSheetDetent: a landscape-short viewport falls back to peek even when guided+half otherwise applies", () => {
  const config = { ui: { experience: { mobileInitialSheet: "half" } } };
  assert.equal(initialSheetDetent("guided", config, SHORT_VIEWPORT_HEIGHT - 1), "peek");
  assert.equal(initialSheetDetent("guided", config, SHORT_VIEWPORT_HEIGHT), "half");
});

test("reviewDetentOnEnter: raises Peek or Half to the taller \"review\" detent", () => {
  assert.equal(reviewDetentOnEnter("peek"), "review");
  assert.equal(reviewDetentOnEnter("half"), "review");
});

test("reviewDetentOnEnter: leaves a deliberately-full sheet alone", () => {
  assert.equal(reviewDetentOnEnter("full"), "full");
});

test("reviewDetentOnEnter: is idempotent — already at \"review\" stays put", () => {
  assert.equal(reviewDetentOnEnter("review"), "review");
});

test("reviewDetentOnLeave: restores \"review\" back to Half", () => {
  assert.equal(reviewDetentOnLeave("review"), "half");
});

test("reviewDetentOnLeave: leaves every other detent untouched (a deliberate drag to Full, or already Peek/Half)", () => {
  assert.equal(reviewDetentOnLeave("peek"), "peek");
  assert.equal(reviewDetentOnLeave("half"), "half");
  assert.equal(reviewDetentOnLeave("full"), "full");
});

// sheetTopCapRatio — round-5 Wave 2, item 4: the ratio AppShell writes into
// `--sheet-cap-ratio` so the export dock/viewer's reserved bottom space
// tracks the SHEET'S OWN height for the given detent, instead of always
// being capped at Half's shorter height (which used to let the taller
// "review" detent's real top edge rise over the dock, covering it).
test("sheetTopCapRatio: every detent but \"review\" keeps the long-standing Half cap", () => {
  assert.equal(sheetTopCapRatio("peek"), HALF_VH_RATIO);
  assert.equal(sheetTopCapRatio("half"), HALF_VH_RATIO);
  // "full" is deliberately UNCHANGED too: it's modal (the sheet is SUPPOSED
  // to rise over the dock/viewer there — see BottomSheet.tsx's own M16 doc),
  // which capping at Half's shorter height is exactly what achieves.
  assert.equal(sheetTopCapRatio("full"), HALF_VH_RATIO);
});

test("sheetTopCapRatio: \"review\" gets its own taller ratio, matching BottomSheet's REVIEW_VH_RATIO", () => {
  assert.equal(sheetTopCapRatio("review"), REVIEW_VH_RATIO);
  assert.ok(REVIEW_VH_RATIO > HALF_VH_RATIO, "review's own ratio must exceed Half's for the fix to do anything");
});
