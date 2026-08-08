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

test("a plain-string popup hashes exactly like the pre-LocalizableText formula", () => {
  // Reproduces contentHash's ORIGINAL formula (bare template-literal
  // interpolation, before `header`/`body`/`button` could be a locale-map
  // object) independently, so this test fails if a plain-string popup's
  // hash ever drifts from what an already-deployed config's returning
  // visitors have stored. That drift would re-show a "once"/"dismissible"
  // popup to every visitor on the next release for free — exactly the
  // regression an earlier draft of the LocalizableText change introduced by
  // JSON.stringify-ing every field unconditionally.
  function legacyHash(popup) {
    const s = `${popup.mode}\n${popup.header}\n${popup.body}\n${popup.button ?? ""}`;
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  const p = notice({ mode: "once", header: "Welcome", body: "Configure a design and export a 3MF.", button: "Got it" });
  rememberPopup(p);
  assert.equal(globalThis.localStorage.getItem("scadpub.popup.seen.v1"), legacyHash(p));
});

test("an object-valued field hashes differently from an equal-looking plain string (the 'obj:' shape prefix)", () => {
  const plain = notice({ mode: "once", header: "Hi" });
  rememberPopup(plain);
  const plainHash = globalThis.localStorage.getItem("scadpub.popup.seen.v1");
  globalThis.localStorage.clear();
  // A single-entry object whose JSON text alone would read almost like the
  // plain string above — the prefix is what keeps the two from colliding.
  const mapped = notice({ mode: "once", header: { en: "Hi" } });
  rememberPopup(mapped);
  const mappedHash = globalThis.localStorage.getItem("scadpub.popup.seen.v1");
  assert.notEqual(plainHash, mappedHash);
});

test("translating one locale of an object-valued field re-shows a remembered popup", () => {
  const p = notice({ mode: "once", header: { en: "Welcome", de: "Willkommen" } });
  rememberPopup(p);
  assert.equal(shouldShowPopup(p), false);
  assert.equal(shouldShowPopup({ ...p, header: { en: "Welcome", de: "Hallo" } }), true);
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
