// Tests for parsing OpenSCAD parameterSets files (the desktop-Customizer
// compatibility contract) and default extraction.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  defaultsFor,
  toParameterSetsFile,
  parseParameterSetsFile,
  presetLabel,
  parsePresetId,
  listPresets,
  savePreset,
  loadPreset,
} from "../src/lib/presets.ts";

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
const STORE_KEY = "scadpub.presets.v1";

beforeEach(() => {
  globalThis.localStorage.clear();
});

const p = (name, type, def, extra = {}) => ({
  name,
  section: "S",
  description: "",
  help: "",
  type,
  default: def,
  ...extra,
});

const design = {
  id: "d",
  label: "D",
  file: "d.scad",
  presets: [],
  sections: ["S"],
  params: [
    p("text", "string", "hi"),
    p("thk", "number", 2),
    p("flag", "boolean", false),
    p("lang", "enum", "de", {
      choices: [
        { value: "de", label: "de" },
        { value: "en", label: "en" },
      ],
    }),
  ],
};

test("defaultsFor returns each parameter's default", () => {
  assert.deepEqual(defaultsFor(design), {
    text: "hi",
    thk: 2,
    flag: false,
    lang: "de",
  });
});

test("toParameterSetsFile writes many named sets as OpenSCAD-format strings", () => {
  const file = toParameterSetsFile(design, {
    Small: { text: "s", thk: 1, flag: false, lang: "de" },
    Big: { text: "b", thk: 9, flag: true, lang: "en" },
  });
  assert.equal(file.fileFormatVersion, "1");
  // Every value is a plain string on disk (OpenSCAD's format).
  assert.deepEqual(file.parameterSets.Small, { text: "s", thk: "1", flag: "false", lang: "de" });
  assert.deepEqual(file.parameterSets.Big, { text: "b", thk: "9", flag: "true", lang: "en" });
});

test("toParameterSetsFile → parseParameterSetsFile round-trips typed values", () => {
  const sets = { Mine: { text: "hello", thk: 4, flag: true, lang: "en" } };
  const text = JSON.stringify(toParameterSetsFile(design, sets));
  const parsed = parseParameterSetsFile(design, text);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "Mine");
  assert.deepEqual(parsed[0].values, sets.Mine);
});

test("parameterSets strings parse back to typed values", () => {
  // On disk everything is a string — OpenSCAD's own format.
  const file = {
    fileFormatVersion: "1",
    parameterSets: {
      "My set": { text: "hello", thk: "4", flag: "true", lang: "en" },
    },
  };
  const parsed = parseParameterSetsFile(design, JSON.stringify(file));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "My set");
  assert.deepEqual(parsed[0].values, {
    text: "hello",
    thk: 4,
    flag: true,
    lang: "en",
  });
});

test("parse overlays defaults and ignores unknown keys", () => {
  const text = JSON.stringify({
    fileFormatVersion: "1",
    parameterSets: { Some: { thk: "9", bogus: "x" } },
  });
  const [set] = parseParameterSetsFile(design, text);
  assert.deepEqual(set.values, { text: "hi", thk: 9, flag: false, lang: "de" });
});

test("parse rejects a file without parameterSets", () => {
  assert.throws(() => parseParameterSetsFile(design, "{}"), /parameterSets/);
});

test("presetLabel extracts the name from type:designId:name", () => {
  assert.equal(presetLabel("bundled:d:My Preset"), "My Preset");
  assert.equal(presetLabel("user:tag:Small"), "Small");
});

test("presetLabel preserves colons within the name", () => {
  assert.equal(presetLabel("user:d:a:b"), "a:b");
});

test("presetLabel falls back to the full id when there is no second colon", () => {
  assert.equal(presetLabel("nocolon"), "nocolon");
  assert.equal(presetLabel("type:d"), "type:d");
});

test("parsePresetId parses the bundled form", () => {
  assert.deepEqual(parsePresetId("bundled:d:Compact"), {
    kind: "bundled",
    designId: "d",
    name: "Compact",
  });
});

test("parsePresetId parses the user form", () => {
  assert.deepEqual(parsePresetId("user:d:Small"), {
    kind: "user",
    designId: "d",
    name: "Small",
  });
});

test("parsePresetId keeps colons within the name", () => {
  assert.deepEqual(parsePresetId("user:d:a:b"), {
    kind: "user",
    designId: "d",
    name: "a:b",
  });
});

test("parsePresetId returns null for an empty string", () => {
  assert.equal(parsePresetId(""), null);
});

test("parsePresetId returns null for a malformed id", () => {
  assert.equal(parsePresetId("nocolon"), null);
  assert.equal(parsePresetId("type:d"), null);
  assert.equal(parsePresetId("bogus:d:Name"), null);
  assert.equal(parsePresetId("bundled::Name"), null);
});

test("listPresets tolerates valid-JSON-wrong-shape local storage (null)", () => {
  globalThis.localStorage.setItem(STORE_KEY, "null");
  assert.deepEqual(listPresets("d"), []);
});

test("listPresets tolerates a bare number in local storage", () => {
  globalThis.localStorage.setItem(STORE_KEY, "5");
  assert.deepEqual(listPresets("d"), []);
});

test("listPresets tolerates an array in local storage", () => {
  globalThis.localStorage.setItem(STORE_KEY, "[1,2,3]");
  assert.deepEqual(listPresets("d"), []);
});

test("listPresets tolerates malformed JSON in local storage", () => {
  globalThis.localStorage.setItem(STORE_KEY, "{not json");
  assert.deepEqual(listPresets("d"), []);
});

test("loadPreset returns null when local storage has an invalid shape", () => {
  globalThis.localStorage.setItem(STORE_KEY, '"a string"');
  assert.equal(loadPreset("d", "Some"), null);
});

test("savePreset recovers from corrupted local storage instead of throwing", () => {
  globalThis.localStorage.setItem(STORE_KEY, "null");
  assert.doesNotThrow(() => savePreset("d", "Mine", { text: "hi" }));
  assert.deepEqual(listPresets("d"), ["Mine"]);
  assert.deepEqual(loadPreset("d", "Mine"), { text: "hi" });
});
