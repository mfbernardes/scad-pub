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
globalThis.location = {
  hash: "",
  origin: "http://x",
  pathname: "/app/",
  search: "",
};
globalThis.history = {
  replaceState(_s, _t, url) {
    globalThis.location.hash = String(url).startsWith("#")
      ? String(url)
      : new URL(url, "http://x/").hash;
  },
};

const {
  readInitialState,
  persistState,
  buildShareUrl,
  parseHashState,
  sessionStateEquals,
  hashDesignIdMissing,
} = await import("../src/lib/urlState.ts");

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

test("the URL hash wins over a stored session when both are present", () => {
  // Persist one session to localStorage, then load with a *different* hash: the
  // shared-link hash must take precedence so a link reproduces its exact config.
  persistState(design, { text: "stored", n: 99, b: true });
  globalThis.location.hash = "#d=d&v=" + encodeURIComponent('{"text":"linked"}');
  const r = readInitialState(schema);
  assert.equal(r.values.text, "linked"); // from the hash
  assert.equal(r.values.n, 2); // hash diff didn't set n -> back to default, not the stored 99
});

test("a tampered numeric value is coerced back to a number", () => {
  globalThis.location.hash = '#d=d&v=' + encodeURIComponent('{"n":"5"}');
  assert.equal(readInitialState(schema).values.n, 5);
});

test("tampered boolean/string values are coerced to each param's type", () => {
  globalThis.location.hash =
    "#d=d&v=" + encodeURIComponent('{"b":"true","text":"x"}');
  const r = readInitialState(schema);
  assert.equal(r.values.b, true); // "true" -> boolean true
  assert.equal(typeof r.values.b, "boolean");
  assert.equal(r.values.text, "x");
});

test("a corrupt stored session falls back to defaults (no throw)", () => {
  globalThis.localStorage.setItem("scadpub.session.v1", "{not json");
  globalThis.location.hash = "";
  const r = readInitialState(schema);
  assert.equal(r.designId, "d");
  assert.deepEqual(r.values, DEFAULTS);
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

test("buildShareUrl reflects the current values synchronously, without waiting on persistState's debounce", () => {
  // Simulate App.tsx: persistState is scheduled behind a 300ms setTimeout, but
  // Share must never depend on that timer having fired yet.
  persistState(design, { ...DEFAULTS }); // "pre-edit" state already persisted
  const edited = { text: "just typed", n: 2, b: false };
  // No persistState(edited, ...) call here — the debounce hasn't fired.
  const url = buildShareUrl(design, edited);
  assert.match(url, /v=/);
  const hash = new URL(url).hash;
  const params = new URLSearchParams(hash.slice(1));
  assert.deepEqual(JSON.parse(params.get("v")), { text: "just typed" });
  // The stale hash left behind by the last persistState call must NOT be what
  // got shared.
  assert.notEqual(globalThis.location.hash, hash);
});

test("buildShareUrl preserves origin/pathname/search and encodes design+preset", () => {
  const url = buildShareUrl(design, { text: "bye", n: 5, b: true }, "bundled:Foo");
  assert.ok(url.startsWith("http://x/app/#"));
  const params = new URLSearchParams(new URL(url).hash.slice(1));
  assert.equal(params.get("d"), "d");
  assert.equal(params.get("p"), "bundled:Foo");
  assert.deepEqual(JSON.parse(params.get("v")), { text: "bye", n: 5, b: true });
});

test("buildShareUrl omits v= for default-only values, like persistState", () => {
  const url = buildShareUrl(design, { ...DEFAULTS });
  assert.ok(!url.includes("v="));
  assert.ok(!url.includes("p="));
});

test("persistState survives a throttled history.replaceState (e.g. Safari)", () => {
  const original = globalThis.history.replaceState;
  globalThis.history.replaceState = () => {
    throw new DOMException("attempt exceeded", "SecurityError");
  };
  try {
    assert.doesNotThrow(() =>
      persistState(design, { text: "bye", n: 5, b: true })
    );
    // The localStorage mirror still ran despite the thrown replaceState, so a
    // bare reload (no hash) still restores the latest values.
    globalThis.location.hash = "";
    const r = readInitialState(schema);
    assert.equal(r.values.text, "bye");
    assert.equal(r.values.n, 5);
  } finally {
    globalThis.history.replaceState = original;
  }
});

// M4: App.tsx's external-navigation consumer (hashchange / launchQueue) needs
// to parse an arbitrary hash string — not just `location.hash` at module init
// — and needs a pure loop guard so applying a same-document hashchange (or a
// queued installed-app launch target) doesn't spin. Both pieces are pure
// helpers, tested directly here without mounting the App component.

test("parseHashState parses an arbitrary hash string, not just location.hash", () => {
  // Simulates a same-document `hashchange` event, which carries the new hash
  // on `location.hash` — but also a launchQueue target, which carries it as
  // part of a full target URL (`new URL(targetURL).hash`) that never touches
  // `location` at all.
  const hash = "#d=d&v=" + encodeURIComponent('{"text":"from-shortcut"}');
  const r = parseHashState(schema, hash);
  assert.equal(r.designId, "d");
  assert.equal(r.values.text, "from-shortcut");

  // Accepts both "#d=..." and a bare "d=..." (URL#hash already strips the
  // leading "#" in some call sites).
  const bare = parseHashState(schema, hash.slice(1));
  assert.deepEqual(bare, r);

  // As parsed out of a full launch target URL, e.g. "./#d=d".
  const target = new URL("https://x/app/#d=d&p=bundled%3AFoo");
  const fromLaunch = parseHashState(schema, target.hash);
  assert.equal(fromLaunch.designId, "d");
  assert.equal(fromLaunch.preset, "bundled:Foo");
});

test("parseHashState returns null for an empty hash or an unknown design", () => {
  assert.equal(parseHashState(schema, ""), null);
  assert.equal(parseHashState(schema, "#d=nonexistent"), null);
});

// PR7: App.tsx opens DesignPickerDialog once on load when the visit's deep
// link named a design id this build doesn't have — a stale/broken link. This
// is a distinct signal from parseHashState's own null return (which already
// covers "no hash" and "unknown design" the same way, for the ordinary
// fallback-to-defaults runtime behavior).
test("hashDesignIdMissing: true only for a d= naming an unknown design", () => {
  assert.equal(hashDesignIdMissing(schema, "#d=nonexistent"), true);
  assert.equal(hashDesignIdMissing(schema, "d=nonexistent"), true); // no leading '#'
  assert.equal(hashDesignIdMissing(schema, "#d=d"), false); // a real design
  assert.equal(hashDesignIdMissing(schema, "#d=d&v=%7B%7D"), false);
  assert.equal(hashDesignIdMissing(schema, ""), false); // no hash at all — not "broken"
  assert.equal(hashDesignIdMissing(schema, "#p=bundled:Foo"), false); // no d= param at all
  assert.equal(hashDesignIdMissing(schema, "#d="), true); // empty id still names no design
});

test("sessionStateEquals — the external-navigation loop guard", () => {
  const a = { designId: "d", values: { ...DEFAULTS }, preset: "" };
  const b = { designId: "d", values: { ...DEFAULTS }, preset: "" };
  // Same shape, different object identity — still equal (a no-op navigation
  // must not be treated as a state change).
  assert.equal(sessionStateEquals(a, b), true);

  assert.equal(
    sessionStateEquals(a, { ...b, designId: "other" }),
    false
  );
  assert.equal(
    sessionStateEquals(a, { ...b, preset: "bundled:Foo" }),
    false
  );
  assert.equal(
    sessionStateEquals(a, { ...b, values: { ...DEFAULTS, n: 99 } }),
    false
  );
});
