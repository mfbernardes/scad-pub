// Tests the pure theme resolver. `resolveTheme` reads window.matchMedia in
// "auto" mode, so we stub it. (The React hook itself is exercised by the smoke
// test's theme-toggle check.)
import { test } from "node:test";
import assert from "node:assert/strict";

let systemPrefersDark = true;
globalThis.window = {
  matchMedia: (q) => ({
    matches: /dark/.test(q) ? systemPrefersDark : !systemPrefersDark,
  }),
};

const { resolveTheme } = await import("../src/lib/theme.ts");

test("explicit modes resolve to themselves", () => {
  assert.equal(resolveTheme("light"), "light");
  assert.equal(resolveTheme("dark"), "dark");
});

test("auto follows the OS preference", () => {
  systemPrefersDark = true;
  assert.equal(resolveTheme("auto"), "dark");
  systemPrefersDark = false;
  assert.equal(resolveTheme("auto"), "light");
});
