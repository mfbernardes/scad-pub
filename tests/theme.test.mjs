// Tests the pure theme resolver. `resolveTheme` reads window.matchMedia in
// "auto" mode, so we stub it. (The React hook itself is exercised by the smoke
// test's theme-toggle check.)
import { test } from "node:test";
import assert from "node:assert/strict";

let systemPrefersDark = true;
// A minimal mock matchMedia MediaQueryList that supports exactly one
// "change" listener — enough to prove the M5 store's subscribe/unsubscribe
// contract without a real browser.
let changeListener = null;
globalThis.window = {
  matchMedia: (q) => ({
    matches: /dark/.test(q) ? systemPrefersDark : !systemPrefersDark,
    addEventListener: (type, fn) => {
      if (type === "change") changeListener = fn;
    },
    removeEventListener: (type, fn) => {
      if (type === "change" && changeListener === fn) changeListener = null;
    },
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

const { resolveTheme, apply, subscribeSystemDark, getSystemDarkSnapshot } =
  await import("../src/lib/theme.ts");

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

// M5: in auto mode, `useTheme`'s `resolved` is driven by
// useSyncExternalStore(subscribeSystemDark, getSystemDarkSnapshot) rather
// than a value computed once and left stale until an unrelated render. These
// tests exercise that store directly — the pure unit the hook is built
// from — proving a bare `matchMedia` "change" event (no other interaction)
// both notifies subscribers and immediately changes what the snapshot
// getter returns, so every consumer reading it (DOM token via `apply` in
// the hook's effect, BarBrand's `theme` prop, Toaster's `theme` prop, and
// conceptually the Viewer canvas) re-renders from the same authoritative
// value in the same pass.
test("subscribeSystemDark notifies on a matchMedia change with no other interaction", () => {
  systemPrefersDark = true;
  assert.equal(getSystemDarkSnapshot(), true);

  let notified = 0;
  const unsubscribe = subscribeSystemDark(() => {
    notified++;
  });

  // Flip the OS preference and fire the mocked MediaQueryList's "change"
  // event — nothing else touches the app.
  systemPrefersDark = false;
  assert.ok(changeListener, "subscribe must register a change listener");
  changeListener();

  assert.equal(notified, 1, "the change callback fires exactly once");
  // The snapshot is authoritative *before* the subscriber even re-renders:
  // useSyncExternalStore calls getSnapshot again after notification, and it
  // must already reflect the new system preference.
  assert.equal(getSystemDarkSnapshot(), false);

  unsubscribe();
  assert.equal(changeListener, null, "unsubscribe removes the listener");

  // No listener left — a further flip does not throw and is simply unheard.
  systemPrefersDark = true;
  assert.equal(getSystemDarkSnapshot(), true);
});

test("getSystemDarkSnapshot mirrors resolveTheme('auto') at every point", () => {
  for (const pref of [true, false, true]) {
    systemPrefersDark = pref;
    assert.equal(getSystemDarkSnapshot(), pref);
    assert.equal(resolveTheme("auto"), pref ? "dark" : "light");
  }
});
