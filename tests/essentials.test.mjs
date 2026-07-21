// Tests hiddenAdvancedCount, the pure count behind the essentials toggle's
// "Show all settings (N more)" label (ParamPanel.tsx/SheetTabs.tsx).
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
