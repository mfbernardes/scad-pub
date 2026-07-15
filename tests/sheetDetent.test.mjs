// Tests the pure policy behind the mobile bottom sheet's INITIAL detent:
// src/lib/sheetDetent.ts's initialSheetDetent. Mirrors
// tests/useExperience.test.mjs's style — pure inputs (mode, config, viewport
// height), no React/DOM, covering every branch of the guided-half policy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialSheetDetent, SHORT_VIEWPORT_HEIGHT } from "../src/lib/sheetDetent.ts";

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
