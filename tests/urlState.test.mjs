// Tests the shareable/persistent session state. urlState only touches `location`,
// `localStorage` and `history` inside its functions, so minimal stubs let it run
// under Node.
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
globalThis.location = { hash: "" };
globalThis.history = {
  replaceState(_s, _t, url) {
    globalThis.location.hash = String(url).startsWith("#")
      ? String(url)
      : new URL(url, "http://x/").hash;
  },
};

const { readInitialState, persistState } = await import("../src/lib/urlState.ts");

const param = (name, type, def) => ({
  name,
  section: "S",
  description: "",
  help: "",
  type,
  default: def,
});
const design = {
  id: "d",
  label: "D",
  file: "d.scad",
  presets: [],
  sections: ["S"],
  params: [
    param("text", "string", "hi"),
    param("n", "number", 2),
    param("b", "boolean", false),
  ],
};
const schema = {
  generatedFrom: ".",
  features: [],
  fonts: [],
  assets: [],
  designs: [design],
};
const DEFAULTS = { text: "hi", n: 2, b: false };

beforeEach(() => {
  globalThis.location.hash = "";
  globalThis.localStorage.clear();
});

test("hash round-trip restores the design and changed values", () => {
  const values = { text: "bye", n: 5, b: true };
  persistState(design, values);
  assert.match(globalThis.location.hash, /d=d/);
  const r = readInitialState(schema);
  assert.equal(r.designId, "d");
  assert.deepEqual(r.values, values);
});

test("only non-default values are encoded (defaults give a bare hash)", () => {
  persistState(design, { ...DEFAULTS });
  assert.ok(!globalThis.location.hash.includes("v="));
  assert.ok(!globalThis.location.hash.includes("p="));
  assert.deepEqual(readInitialState(schema).values, DEFAULTS);
});

test("the selected preset round-trips in the hash and store", () => {
  persistState(design, { text: "bye", n: 5, b: true }, "bundled:English (UEB)");
  assert.match(globalThis.location.hash, /p=/);
  assert.equal(readInitialState(schema).preset, "bundled:English (UEB)");
  // and from localStorage on a bare reload
  globalThis.location.hash = "";
  assert.equal(readInitialState(schema).preset, "bundled:English (UEB)");
});

test("no preset selected -> empty preset, no p= in the hash", () => {
  persistState(design, { text: "bye", n: 5, b: true });
  assert.ok(!globalThis.location.hash.includes("p="));
  assert.equal(readInitialState(schema).preset, "");
});

test("falls back to localStorage when there is no hash", () => {
  persistState(design, { text: "stored", n: 2, b: false });
  globalThis.location.hash = ""; // visiting the bare URL later
  const r = readInitialState(schema);
  assert.equal(r.designId, "d");
  assert.equal(r.values.text, "stored");
});

test("no hash and no store -> first design's defaults", () => {
  const r = readInitialState(schema);
  assert.equal(r.designId, "d");
  assert.deepEqual(r.values, DEFAULTS);
});

test("a tampered numeric value is coerced back to a number", () => {
  globalThis.location.hash = '#d=d&v=' + encodeURIComponent('{"n":"5"}');
  assert.equal(readInitialState(schema).values.n, 5);
});

test("malformed JSON in v param silently returns defaults", () => {
  globalThis.location.hash = '#d=d&v=' + encodeURIComponent('{not json}');
  const r = readInitialState(schema);
  assert.deepEqual(r.values, DEFAULTS);
});

test("unknown param keys in v diff are silently ignored", () => {
  globalThis.location.hash = '#d=d&v=' + encodeURIComponent('{"n":7,"bogus":"x"}');
  const r = readInitialState(schema);
  assert.equal(r.values.n, 7);
  assert.equal(r.values.text, "hi");
  assert.ok(!("bogus" in r.values));
});
