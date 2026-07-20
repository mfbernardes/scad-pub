// Tests the parser that turns OpenSCAD's `echo("@review", param, value)`
// convention into a param-name -> rendered-value override map for the
// guided-workflow Review stage's curated summary — mirrors
// tests/computedInfo.test.mjs / tests/displayRows.test.mjs's own style.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReviewOverrides } from "../src/lib/reviewOverrides.ts";

test("extracts a basic override, keyed by param name", () => {
  const out = parseReviewOverrides(['[out] ECHO: "@review", "label", "RAUM 101"']);
  assert.deepEqual(out, new Map([["label", "RAUM 101"]]));
});

test("a quoted string value has its quotes stripped", () => {
  const out = parseReviewOverrides(['[out] ECHO: "@review", "label", "Hello"']);
  assert.equal(out.get("label"), "Hello");
});

test("a non-string value passes through exactly as OpenSCAD printed it", () => {
  const out = parseReviewOverrides(['[out] ECHO: "@review", "count", 3']);
  assert.equal(out.get("count"), "3");
});

test("matches ECHO on stderr too (OpenSCAD-WASM routes ECHO to [err])", () => {
  const out = parseReviewOverrides(['[err] ECHO: "@review", "label", "RAUM 101"']);
  assert.deepEqual(out, new Map([["label", "RAUM 101"]]));
});

test("multiple params each get their own entry", () => {
  const out = parseReviewOverrides([
    '[out] ECHO: "@review", "label", "RAUM 101"',
    '[out] ECHO: "@review", "font", "DIN 32986 Taktil Positiv"',
  ]);
  assert.deepEqual(
    out,
    new Map([
      ["label", "RAUM 101"],
      ["font", "DIN 32986 Taktil Positiv"],
    ])
  );
});

test("a later echo for the same param overwrites an earlier one (last write wins)", () => {
  const out = parseReviewOverrides([
    '[out] ECHO: "@review", "label", "Raum 101"',
    '[out] ECHO: "@review", "label", "RAUM 101"',
  ]);
  assert.deepEqual(out, new Map([["label", "RAUM 101"]]));
});

test("returns an empty map for an empty log", () => {
  assert.deepEqual(parseReviewOverrides([]), new Map());
});

test("non-matching lines are ignored", () => {
  const out = parseReviewOverrides([
    '[out] ECHO: "hello"',
    "[err] WARNING: something",
    '[out] ECHO: "@info", "Radius", "mm", 25',
    '[out] ECHO: "@display", "content", "Pattern", "value"',
  ]);
  assert.deepEqual(out, new Map());
});

test("a param name or value containing an embedded comma is handled correctly", () => {
  const out = parseReviewOverrides(['[out] ECHO: "@review", "label", "Room, 101"']);
  assert.deepEqual(out, new Map([["label", "Room, 101"]]));
});
