// Tests the configurable popup's show/remember logic (src/lib/popup.ts). It only
// touches `localStorage`, so a minimal in-memory stub lets it run under Node.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

class MemStorage {
  m = new Map();
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

globalThis.localStorage = new MemStorage();

const { shouldShowPopup, rememberPopup, isDesignChooser } = await import(
  "../src/lib/popup.ts"
);

const notice = (over = {}) => ({ header: "Hi", body: "Welcome.", mode: "once", ...over });

beforeEach(() => globalThis.localStorage.clear());

test("no popup configured -> never shown", () => {
  assert.equal(shouldShowPopup(null), false);
});

test("'always' mode shows every visit, even after remember", () => {
  const p = notice({ mode: "always" });
  assert.equal(shouldShowPopup(p), true);
  rememberPopup(p);
  assert.equal(shouldShowPopup(p), true);
});

test("'once' / 'dismissible' hide after being remembered", () => {
  for (const mode of ["once", "dismissible"]) {
    globalThis.localStorage.clear();
    const p = notice({ mode });
    assert.equal(shouldShowPopup(p), true);
    rememberPopup(p);
    assert.equal(shouldShowPopup(p), false);
  }
});

test("changing the content re-shows a remembered popup", () => {
  const p = notice({ mode: "once", body: "First." });
  rememberPopup(p);
  assert.equal(shouldShowPopup(p), false);
  // A later deploy edits the body -> the remembered hash no longer matches.
  assert.equal(shouldShowPopup({ ...p, body: "Second." }), true);
});

test("changing the button label re-shows a remembered popup", () => {
  const p = notice({ mode: "once", button: "OK" });
  rememberPopup(p);
  assert.equal(shouldShowPopup(p), false);
  // The button label is part of the content hash, so editing it re-shows.
  assert.equal(shouldShowPopup({ ...p, button: "Start designing" }), true);
});

// --- The picker popup is the app's first screen, not a notice over one -----
// `picker` means the chooser and only the chooser: gen-schema's checkPopupMode
// refuses to build one with fewer than two designs, so every consumer
// (PopupModal's body, App's boot gate, App's dismiss-on-navigation, the
// linked-visit suppression below) reads the mode and cannot disagree.
test("isDesignChooser is exactly picker mode", () => {
  assert.equal(isDesignChooser({ mode: "picker", header: "Pick", body: "" }), true);
  // Every other mode is a notice over the app, which renders behind it as usual.
  assert.equal(isDesignChooser({ mode: "once", header: "Hi", body: "" }), false);
  assert.equal(isDesignChooser({ mode: "dismissible", header: "Hi", body: "" }), false);
  assert.equal(isDesignChooser({ mode: "always", header: "Hi", body: "" }), false);
  assert.equal(isDesignChooser(null), false);
});

test("a shared link skips the design chooser, but never a notice", () => {
  const picker = { mode: "picker", header: "Pick", body: "" };
  assert.equal(shouldShowPopup(picker, false), true);
  // The link already names the design: asking "what are you making?" over it
  // is noise, and it would hold the render back for a visitor who came to see
  // exactly one thing.
  assert.equal(shouldShowPopup(picker, true), false);
  // Skipping is not dismissing: a later visit to the bare URL still asks.
  assert.equal(shouldShowPopup(picker, false), true);
  // A notice asks nothing, so no URL can have answered it: a linked visitor is
  // still a new visitor.
  for (const mode of ["once", "dismissible", "always"]) {
    assert.equal(shouldShowPopup({ mode, header: "Welcome", body: "" }, true), true, mode);
  }
});
