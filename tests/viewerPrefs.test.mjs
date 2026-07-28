// Tests the pure initial-state resolution behind src/lib/viewerPrefs.ts:
// initialGridVisible's precedence (persisted pref > config default > fallback)
// and initialMeasureCollapsed's (persisted pref > layout).
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialGridVisible, initialMeasureCollapsed } from "../src/lib/viewerPrefs.ts";

test("initialGridVisible: a persisted preference wins over the config default", () => {
  assert.equal(initialGridVisible("on", { viewer: { grid: "off" } }), true);
  assert.equal(initialGridVisible("off", { viewer: { grid: "on" } }), false);
});

test("initialGridVisible: the config default wins when there's no persisted preference", () => {
  assert.equal(initialGridVisible(null, { viewer: { grid: "on" } }), true);
  assert.equal(initialGridVisible(null, { viewer: { grid: "off" } }), false);
});

test("initialGridVisible: falls back to off (no visible grid) with neither a preference nor a config default", () => {
  assert.equal(initialGridVisible(null, undefined), false);
  assert.equal(initialGridVisible(null, {}), false);
  assert.equal(initialGridVisible(null, { viewer: {} }), false);
});

test("initialGridVisible: an unrecognised persisted value is treated as unset", () => {
  assert.equal(initialGridVisible("bogus", { viewer: { grid: "on" } }), true);
  assert.equal(initialGridVisible("bogus", undefined), false);
});

test("initialMeasureCollapsed: a persisted preference wins over the layout default", () => {
  assert.equal(initialMeasureCollapsed("off", true), false);
  assert.equal(initialMeasureCollapsed("on", false), true);
});

test("initialMeasureCollapsed: with no preference, mobile starts folded and desktop expanded", () => {
  assert.equal(initialMeasureCollapsed(null, true), true);
  assert.equal(initialMeasureCollapsed(null, false), false);
});

test("initialMeasureCollapsed: an unrecognised persisted value is treated as unset", () => {
  assert.equal(initialMeasureCollapsed("bogus", true), true);
  assert.equal(initialMeasureCollapsed("bogus", false), false);
});
