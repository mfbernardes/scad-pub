// Tests the pure initial-state resolution behind src/lib/viewerPrefs.ts:
// initialGridVisible. Mirrors tests/useExperience.test.mjs's structure for
// the same precedence shape (persisted pref > config default > fallback).
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialGridVisible } from "../src/lib/viewerPrefs.ts";

test("initialGridVisible: a persisted preference wins over the config default", () => {
  assert.equal(initialGridVisible("on", { ui: { grid: "off" } }), true);
  assert.equal(initialGridVisible("off", { ui: { grid: "on" } }), false);
});

test("initialGridVisible: the config default wins when there's no persisted preference", () => {
  assert.equal(initialGridVisible(null, { ui: { grid: "on" } }), true);
  assert.equal(initialGridVisible(null, { ui: { grid: "off" } }), false);
});

test("initialGridVisible: falls back to off (no visible grid) with neither a preference nor a config default", () => {
  assert.equal(initialGridVisible(null, undefined), false);
  assert.equal(initialGridVisible(null, {}), false);
  assert.equal(initialGridVisible(null, { ui: {} }), false);
});

test("initialGridVisible: an unrecognised persisted value is treated as unset", () => {
  assert.equal(initialGridVisible("bogus", { ui: { grid: "on" } }), true);
  assert.equal(initialGridVisible("bogus", undefined), false);
});
