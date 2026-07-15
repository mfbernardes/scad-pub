// Tests the namespaced preference / once-flag utility (src/lib/prefs.ts). It
// only touches `localStorage`, so a minimal in-memory stub lets it run under
// Node — mirrors tests/popup.test.mjs, which exercises the same storage shape.
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

// A storage stub whose writes always throw, simulating private mode / quota /
// storage-blocking policies — exercises the fail-open path.
class BlockedStorage {
  getItem() {
    return null;
  }
  setItem() {
    throw new Error("blocked");
  }
  removeItem() {}
  clear() {}
}

globalThis.localStorage = new MemStorage();

const { readPref, writePref, makeOnceFlag, contentHash } = await import("../src/lib/prefs.ts");

beforeEach(() => {
  globalThis.localStorage = new MemStorage();
});

test("readPref/writePref round-trip through namespaced storage", () => {
  assert.equal(readPref("experience.v1"), null);
  assert.equal(writePref("experience.v1", "guided"), true);
  assert.equal(readPref("experience.v1"), "guided");
  // Namespaced under the app id, not the bare key.
  assert.equal(globalThis.localStorage.getItem("experience.v1"), null);
});

test("blocked storage fails open: writePref false, read stays null", () => {
  globalThis.localStorage = new BlockedStorage();
  assert.equal(writePref("experience.v1", "guided"), false);
  assert.equal(readPref("experience.v1"), null);
});

test("makeOnceFlag: unseen until remembered", () => {
  const flag = makeOnceFlag("tour.v1");
  assert.equal(flag.seen(), false);
  assert.equal(flag.remember(), true);
  assert.equal(flag.seen(), true);
});

test("makeOnceFlag: independent keys don't interfere", () => {
  const a = makeOnceFlag("a.v1");
  const b = makeOnceFlag("b.v1");
  a.remember();
  assert.equal(a.seen(), true);
  assert.equal(b.seen(), false);
});

test("makeOnceFlag: blocked storage fails open (remember false, seen stays false)", () => {
  globalThis.localStorage = new BlockedStorage();
  const flag = makeOnceFlag("tour.v1");
  assert.equal(flag.seen(), false);
  assert.doesNotThrow(() => {
    assert.equal(flag.remember(), false);
  });
  assert.equal(flag.seen(), false);
});

test("contentHash is stable for identical input", () => {
  assert.equal(contentHash("hello"), contentHash("hello"));
});

test("contentHash differs for different input", () => {
  assert.notEqual(contentHash("hello"), contentHash("world"));
});

test("contentHash returns a non-empty string", () => {
  const h = contentHash("");
  assert.equal(typeof h, "string");
  assert.ok(h.length > 0);
});
