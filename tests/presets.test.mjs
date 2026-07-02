// Tests for parsing OpenSCAD parameterSets files (the desktop-Customizer
// compatibility contract) and default extraction.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultsFor,
  toParameterSetsFile,
  parseParameterSetsFile,
  presetLabel,
} from "../src/lib/presets.ts";

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
