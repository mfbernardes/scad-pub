// Tests the pure initial-state resolution behind src/lib/useExperience.ts:
// initialExperienceMode / initialSettingsView. The hook itself (useState +
// readPref/writePref) isn't exercised here — this repo has no DOM-rendering
// test harness (see tests/theme.test.mjs) — so these are the pure units the
// hook is built from, covering every precedence branch directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialExperienceMode, initialSettingsView } from "../src/lib/useExperience.ts";

test("initialExperienceMode: a persisted preference wins over the config default", () => {
  assert.equal(initialExperienceMode("guided", { ui: { experience: { default: "standard" } } }), "guided");
  assert.equal(initialExperienceMode("standard", { ui: { experience: { default: "guided" } } }), "standard");
});

test("initialExperienceMode: the config default wins when there's no persisted preference", () => {
  assert.equal(initialExperienceMode(null, { ui: { experience: { default: "guided" } } }), "guided");
});

test("initialExperienceMode: falls back to \"standard\" with neither a preference nor a config default", () => {
  assert.equal(initialExperienceMode(null, undefined), "standard");
  assert.equal(initialExperienceMode(null, {}), "standard");
  assert.equal(initialExperienceMode(null, { ui: {} }), "standard");
  assert.equal(initialExperienceMode(null, { ui: { experience: {} } }), "standard");
});

test("initialExperienceMode: an unrecognised persisted value is treated as unset", () => {
  // e.g. a mode retired in a later build — falls through to the config, then
  // the hardcoded default, rather than throwing or returning the garbage value.
  assert.equal(initialExperienceMode("bogus", { ui: { experience: { default: "guided" } } }), "guided");
  assert.equal(initialExperienceMode("bogus", undefined), "standard");
});

test("initialSettingsView: a persisted preference wins over both the config and the mode", () => {
  assert.equal(
    initialSettingsView("all", { ui: { experience: { settingsView: "essentials" } } }, "guided"),
    "all"
  );
  assert.equal(
    initialSettingsView("essentials", { ui: { experience: { settingsView: "all" } } }, "standard"),
    "essentials"
  );
});

test("initialSettingsView: the config's settingsView wins over the mode-derived default", () => {
  assert.equal(initialSettingsView(null, { ui: { experience: { settingsView: "all" } } }, "guided"), "all");
  assert.equal(
    initialSettingsView(null, { ui: { experience: { settingsView: "essentials" } } }, "standard"),
    "essentials"
  );
});

test("initialSettingsView: derives from the mode when nothing else is set", () => {
  assert.equal(initialSettingsView(null, undefined, "guided"), "essentials");
  assert.equal(initialSettingsView(null, undefined, "standard"), "all");
});

test("initialSettingsView: an unrecognised persisted value is treated as unset", () => {
  assert.equal(initialSettingsView("bogus", { ui: { experience: { settingsView: "all" } } }, "guided"), "all");
  assert.equal(initialSettingsView("bogus", undefined, "standard"), "all");
});
