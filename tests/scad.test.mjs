// Tests for the OpenSCAD value <-> UI conversions (the -D expressions and the
// parameterSets string parsing). Escaping bugs here would silently corrupt
// renders, so they're worth pinning.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeScadString,
  toScadExpr,
  fromPresetString,
  orphanedDefines,
} from "../src/lib/scad.ts";

// Minimal param of a given type.
const P = (type, extra = {}) => ({
  name: "p",
  section: "S",
  description: "",
  help: "",
  type,
  ...extra,
});

test("escapeScadString escapes backslash, quote, newline and tab", () => {
  assert.equal(escapeScadString('a"b\\c\nd\te'), 'a\\"b\\\\c\\nd\\te');
});

test("toScadExpr quotes/escapes strings and enums, leaves numbers/bools bare", () => {
  assert.equal(toScadExpr(P("string"), 'hi "there"'), '"hi \\"there\\""');
  assert.equal(toScadExpr(P("enum"), "en-us"), '"en-us"');
  assert.equal(toScadExpr(P("number"), 2.5), "2.5");
  assert.equal(toScadExpr(P("boolean"), true), "true");
  assert.equal(toScadExpr(P("boolean"), false), "false");
});

test("toScadExpr falls back for non-finite numbers", () => {
  assert.equal(toScadExpr(P("number", { default: 7 }), NaN), "7");
  assert.equal(toScadExpr(P("number", { default: 7 }), Infinity), "7");
});

test("fromPresetString coerces back to the param's type", () => {
  assert.equal(fromPresetString(P("boolean"), "true"), true);
  assert.equal(fromPresetString(P("boolean"), "1"), true);
  assert.equal(fromPresetString(P("boolean"), "false"), false);
  assert.equal(fromPresetString(P("number"), "3.5"), 3.5);
  // invalid number falls back to the default
  assert.equal(fromPresetString(P("number", { default: 7 }), "nope"), 7);
  assert.equal(fromPresetString(P("enum"), "en-us"), "en-us");
  assert.equal(fromPresetString(P("string"), "hi"), "hi");
});

test("fromPresetString clamps numbers to the declared range", () => {
  const ranged = P("number", { default: 5, min: 0, max: 10 });
  assert.equal(fromPresetString(ranged, "50"), 10); // above max → clamped
  assert.equal(fromPresetString(ranged, "-5"), 0); //  below min → clamped
  assert.equal(fromPresetString(ranged, "7"), 7); //   in range → unchanged
  assert.equal(fromPresetString(P("number", { default: 5 }), "50"), 50); // no range → unchanged
});

test("fromPresetString rejects enum values outside the declared choices", () => {
  const choices = [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
  ];
  const e = P("enum", { default: "a", choices });
  assert.equal(fromPresetString(e, "b"), "b"); //   valid choice kept
  assert.equal(fromPresetString(e, "zzz"), "a"); // invalid → default
});

test("orphanedDefines flags only names the source no longer declares", () => {
  const src = [
    "/* [Main] */",
    "width = 10; // [1:100]",
    "  height = 5;", // indented assignment still counts as present
    "label = \"hi\";",
    "module box() { depth = width == 10 ? 1 : 2; }", // `==` is not a declaration
  ].join("\n");
  // present params (any order, any whitespace) are not flagged
  assert.deepEqual(orphanedDefines(["width", "height", "label"], src), []);
  // a removed param is flagged
  assert.deepEqual(orphanedDefines(["width", "legacyDepth"], src), ["legacyDepth"]);
  // a name that appears only in an `==` comparison isn't a declaration
  assert.deepEqual(orphanedDefines(["depth"], src), ["depth"]);
  // empty input is empty
  assert.deepEqual(orphanedDefines([], src), []);
});
