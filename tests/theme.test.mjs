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

// A minimal stand-in for index.html's two media-scoped theme-color metas
// (dark listed first, then light — see apply()'s comment), used to pin the
// "both metas get updated with the *configured* colour for the applied
// theme" fix. `apply()` reads and caches these on first use, so this single
// document/meta pair is shared across the tests below (mirroring the single
// real document a page has).
function makeMeta(media, content) {
  return {
    media,
    content,
    getAttribute(name) {
      return name === "media" ? this.media : name === "content" ? this.content : null;
    },
    setAttribute(name, value) {
      if (name === "content") this.content = value;
    },
  };
}
const darkMeta = makeMeta("(prefers-color-scheme: dark)", "#111111");
const lightMeta = makeMeta("(prefers-color-scheme: light)", "#eeeeee");
globalThis.document = {
  documentElement: { dataset: {} },
  querySelectorAll: () => [darkMeta, lightMeta],
};

const { resolveTheme, apply } = await import("../src/lib/theme.ts");

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

test("apply sets <html data-theme> and updates both theme-color metas", () => {
  apply("dark");
  assert.equal(globalThis.document.documentElement.dataset.theme, "dark");
  // Both metas — not just the (first, dark-media) one a plain querySelector
  // would grab — get the configured dark colour.
  assert.equal(darkMeta.content, "#111111");
  assert.equal(lightMeta.content, "#111111");

  apply("light");
  assert.equal(globalThis.document.documentElement.dataset.theme, "light");
  // Applying light restores the configured *light* colour (from the light
  // meta's original content) on both metas, not a hardcoded "#ffffff".
  assert.equal(darkMeta.content, "#eeeeee");
  assert.equal(lightMeta.content, "#eeeeee");
});
