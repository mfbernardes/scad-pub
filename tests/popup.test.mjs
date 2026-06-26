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

const { shouldShowPopup, rememberPopup } = await import("../src/lib/popup.ts");

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
