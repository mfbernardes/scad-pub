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

const { shouldShowPopup, rememberPopup, resolvePopupSurface } = await import("../src/lib/popup.ts");

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

test("changing the footnote re-shows a remembered popup", () => {
  const p = notice({ mode: "picker", footnote: "No uploads." });
  rememberPopup(p);
  assert.equal(shouldShowPopup(p), false);
  assert.equal(shouldShowPopup({ ...p, footnote: "Different note." }), true);
  // Present vs. absent also counts as a content change.
  assert.equal(shouldShowPopup({ ...p, footnote: undefined }), true);
});

// resolvePopupSurface — the precedence App.tsx follows to decide which
// surface (if any) to render for schema.popup on a given load. See its own
// doc for the full rule set; this is the regression net for it.
test("resolvePopupSurface: no popup, or already remembered -> 'none'", () => {
  assert.equal(
    resolvePopupSurface({ popup: null, galleryEnabled: true, isDeepLink: false }),
    "none"
  );
  const p = notice({ mode: "picker" });
  rememberPopup(p);
  assert.equal(
    resolvePopupSurface({ popup: p, galleryEnabled: true, isDeepLink: false }),
    "none"
  );
});

test("resolvePopupSurface: any non-'picker' mode is always 'classic'", () => {
  for (const mode of ["always", "once", "dismissible"]) {
    const p = notice({ mode });
    assert.equal(
      resolvePopupSurface({ popup: p, galleryEnabled: true, isDeepLink: false }),
      "classic"
    );
    assert.equal(
      resolvePopupSurface({ popup: p, galleryEnabled: false, isDeepLink: true }),
      "classic"
    );
  }
});

test("resolvePopupSurface: 'picker' without the card-grid picker available -> 'classic' (never dead-ends)", () => {
  const p = notice({ mode: "picker" });
  // 1 design, or ui.gallery off / <2 designs — either reads as galleryEnabled: false.
  assert.equal(
    resolvePopupSurface({ popup: p, galleryEnabled: false, isDeepLink: false }),
    "classic"
  );
});

test("resolvePopupSurface: 'picker', eligible, no deep link -> 'welcome'", () => {
  const p = notice({ mode: "picker" });
  assert.equal(
    resolvePopupSurface({ popup: p, galleryEnabled: true, isDeepLink: false }),
    "welcome"
  );
});

test("resolvePopupSurface: 'picker', eligible, but a deep/share link already chose -> 'none' (no fallback either)", () => {
  const p = notice({ mode: "picker" });
  assert.equal(
    resolvePopupSurface({ popup: p, galleryEnabled: true, isDeepLink: true }),
    "none"
  );
});
