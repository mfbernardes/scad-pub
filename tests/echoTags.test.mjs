// Tests the shared echo("@tag", …) parsing core (src/lib/echoTags.ts) that
// computedInfo.ts/reviewOverrides.ts each build their own public parser on
// top of — see those two's own test files for the end-to-end behavior (dedup
// semantics, public shapes) this module doesn't own itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEchoTag, formatEchoValue } from "../src/lib/echoTags.ts";

test("parseEchoTag: extracts quoted args plus the raw final argument", () => {
  const out = parseEchoTag(['[out] ECHO: "@info", "Dot height", "mm", 0.48'], "@info", 2);
  assert.deepEqual(out, [["Dot height", "mm", "0.48"]]);
});

test("parseEchoTag: matches ECHO on stderr too (OpenSCAD-WASM routes ECHO to [err])", () => {
  const out = parseEchoTag(['[err] ECHO: "@review", "label", "RAUM 101"'], "@review", 1);
  assert.deepEqual(out, [["label", '"RAUM 101"']]);
});

test("parseEchoTag: a different tag name is ignored", () => {
  const out = parseEchoTag(['[out] ECHO: "@display", "content", "Preview", "x"'], "@info", 2);
  assert.deepEqual(out, []);
});

test("parseEchoTag: quotedArgCount controls how many leading quoted args are required", () => {
  const out = parseEchoTag(['[out] ECHO: "@review", "label", "value"'], "@review", 1);
  assert.deepEqual(out, [["label", '"value"']]);
});

test("parseEchoTag: preserves log order across multiple matches", () => {
  const out = parseEchoTag(
    ['[out] ECHO: "@info", "B", "", 2', '[out] ECHO: "@info", "A", "", 1'],
    "@info",
    2
  );
  assert.deepEqual(out, [
    ["B", "", "2"],
    ["A", "", "1"],
  ]);
});

test("parseEchoTag: a comma embedded in a quoted arg or the raw value is handled correctly", () => {
  const out = parseEchoTag(['[out] ECHO: "@review", "label", "Room, 101"'], "@review", 1);
  assert.deepEqual(out, [["label", '"Room, 101"']]);
});

test("parseEchoTag: a tag name containing regex-special characters is matched literally", () => {
  const out = parseEchoTag(['[out] ECHO: "@a.b", "x", 1'], "@a.b", 1);
  assert.deepEqual(out, [["x", "1"]]);
  // A literal dot in the tag must NOT act as a regex wildcard.
  assert.deepEqual(parseEchoTag(['[out] ECHO: "@aXb", "x", 1'], "@a.b", 1), []);
});

test("parseEchoTag: returns nothing for an empty log", () => {
  assert.deepEqual(parseEchoTag([], "@info", 2), []);
});

test("formatEchoValue: strips quotes from a quoted string", () => {
  assert.equal(formatEchoValue('"Hello"'), "Hello");
});

test("formatEchoValue: passes a non-string value through exactly as OpenSCAD printed it", () => {
  assert.equal(formatEchoValue("true"), "true");
  assert.equal(formatEchoValue("undef"), "undef");
  assert.equal(formatEchoValue("[1, 2, 3]"), "[1, 2, 3]");
});

test("formatEchoValue: trims surrounding whitespace before checking for quotes", () => {
  assert.equal(formatEchoValue('  "Hello"  '), "Hello");
});
