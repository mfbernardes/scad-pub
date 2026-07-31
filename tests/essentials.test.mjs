// Tests hiddenAdvancedCount, the pure count behind the essentials toggle's
// "Show all settings (N more)" label AND its render gate (EssentialsToggle.tsx
// returns null on zero): the two are the same number on purpose, so a count
// of zero can't produce a button that reveals nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hiddenAdvancedCount } from "../src/lib/essentials.ts";

function param(name, overrides = {}) {
  return {
    name,
    section: "General",
    description: name,
    help: name,
    type: "number",
    default: 0,
    ...overrides,
  };
}

test("hiddenAdvancedCount: counts only @advanced params", () => {
  const params = [param("a"), param("b", { advanced: true }), param("c", { advanced: true })];
  assert.equal(hiddenAdvancedCount(params, {}), 2);
});

test("hiddenAdvancedCount: zero when no param is advanced", () => {
  const params = [param("a"), param("b")];
  assert.equal(hiddenAdvancedCount(params, {}), 0);
});

test("hiddenAdvancedCount: an advanced param hidden by its own @showIf doesn't count", () => {
  const params = [
    param("mode", { type: "boolean", default: false }),
    param("tuning", { advanced: true, showIf: "mode" }),
  ];
  assert.equal(hiddenAdvancedCount(params, { mode: false }), 0);
  assert.equal(hiddenAdvancedCount(params, { mode: true }), 1);
});

test("hiddenAdvancedCount: a malformed @showIf fails open (still counted)", () => {
  const params = [param("tuning", { advanced: true, showIf: "a <> b" })];
  assert.equal(hiddenAdvancedCount(params, {}), 1);
});

// The regression this gate exists for: a design that DECLARES advanced params
// but has none currently reachable. "Does the design have an advanced param
// anywhere" (the condition EssentialsToggle used to render on) is true here,
// while the count is zero, so the toggle would have offered "Show all
// settings", revealed nothing when pressed, and renamed itself. Every advanced
// param being @showIf-hidden at a design's own defaults is the real shape of
// this, and an unremarkable way to author a design: gate the fine-tuning on
// the feature it tunes, and leave that feature off by default.
test("hiddenAdvancedCount: zero while advanced params exist but none are reachable", () => {
  const params = [
    param("mode", { type: "boolean", default: false }),
    param("tuning", { advanced: true, showIf: "mode" }),
    param("bias", { advanced: true, showIf: "mode" }),
  ];
  assert.ok(params.some((p) => p.advanced), "the design does declare advanced params");
  assert.equal(hiddenAdvancedCount(params, { mode: false }), 0, "…yet none can be revealed");
  // …and the toggle earns its place again the moment one becomes reachable.
  assert.equal(hiddenAdvancedCount(params, { mode: true }), 2);
});
