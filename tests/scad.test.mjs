// Tests for the OpenSCAD value <-> UI conversions (the -D expressions and the
// parameterSets string round-trip). Escaping bugs here would silently corrupt
// renders, so they're worth pinning.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeScadString,
  toScadExpr,
  toPresetString,
  fromPresetString,
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

test("toPresetString stores every value as a plain string", () => {
  assert.equal(toPresetString(P("boolean"), true), "true");
  assert.equal(toPresetString(P("boolean"), false), "false");
  assert.equal(toPresetString(P("number"), 4), "4");
  assert.equal(toPresetString(P("string"), "hi"), "hi");
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
