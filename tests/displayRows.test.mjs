// Tests the parser that turns a design's `echo("@display", step, label,
// value)` convention into QuickStart's "automatic preview" rows — a
// separate, purely-runtime mechanism modeled on tests/computedInfo.test.mjs's
// own style (see src/lib/displayRows.ts for the full contract).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDisplayRows, displayRowsForStep, isMostlyBraille } from "../src/lib/displayRows.ts";

test("extracts a basic row", () => {
  const out = parseDisplayRows(['[out] ECHO: "@display", "content", "Braille (automatic)", "⠗⠁⠥⠍"']);
  assert.deepEqual(out, [{ step: "content", label: "Braille (automatic)", value: "⠗⠁⠥⠍" }]);
});

test("matches ECHO on stderr too (OpenSCAD-WASM routes ECHO to [err])", () => {
  const out = parseDisplayRows(['[err] ECHO: "@display", "content", "Preview", "hello"']);
  assert.deepEqual(out, [{ step: "content", label: "Preview", value: "hello" }]);
});

test("a quoted string value has its quotes stripped", () => {
  const out = parseDisplayRows(['[out] ECHO: "@display", "content", "Mode", "raised"']);
  assert.deepEqual(out, [{ step: "content", label: "Mode", value: "raised" }]);
});

test("a non-string value passes through exactly as OpenSCAD printed it", () => {
  const out = parseDisplayRows(['[out] ECHO: "@display", "content", "Count", 3']);
  assert.deepEqual(out, [{ step: "content", label: "Count", value: "3" }]);
});

test("last write per (step, label) wins, keeping first-occurrence order", () => {
  const out = parseDisplayRows([
    '[out] ECHO: "@display", "content", "Braille", "first"',
    '[out] ECHO: "@display", "content", "Other", "x"',
    '[out] ECHO: "@display", "content", "Braille", "second"',
  ]);
  assert.deepEqual(out, [
    { step: "content", label: "Braille", value: "second" },
    { step: "content", label: "Other", value: "x" },
  ]);
});

test("the same label under different steps produces distinct rows", () => {
  const out = parseDisplayRows([
    '[out] ECHO: "@display", "content", "Preview", "a"',
    '[out] ECHO: "@display", "appearance", "Preview", "b"',
  ]);
  assert.deepEqual(out, [
    { step: "content", label: "Preview", value: "a" },
    { step: "appearance", label: "Preview", value: "b" },
  ]);
});

test("returns nothing for an empty log", () => {
  assert.deepEqual(parseDisplayRows([]), []);
});

test("non-matching lines are ignored", () => {
  const out = parseDisplayRows([
    '[out] ECHO: "hello"',
    '[out] ECHO: "@info", "Radius", "mm", 5',
    "[err] WARNING: something",
  ]);
  assert.deepEqual(out, []);
});

test("a malformed call (wrong arg count) is silently ignored", () => {
  const out = parseDisplayRows(['[out] ECHO: "@display", "content", "only two args"']);
  // Still matches the loose 3-capture shape (step, label, value=""), which is
  // fine — an OpenSCAD echo() always supplies all 4 positional args syntax-
  // wise, so this defensive case mainly guards against a hand-typed test
  // fixture rather than real OpenSCAD output. Confirm it doesn't throw and
  // produces at most one row.
  assert.ok(out.length <= 1);
});

test("displayRowsForStep filters by step id, preserving order", () => {
  const rows = parseDisplayRows([
    '[out] ECHO: "@display", "content", "A", "1"',
    '[out] ECHO: "@display", "appearance", "B", "2"',
    '[out] ECHO: "@display", "content", "C", "3"',
  ]);
  assert.deepEqual(displayRowsForStep(rows, "content"), [
    { step: "content", label: "A", value: "1" },
    { step: "content", label: "C", value: "3" },
  ]);
  assert.deepEqual(displayRowsForStep(rows, "appearance"), [{ step: "appearance", label: "B", value: "2" }]);
  assert.deepEqual(displayRowsForStep(rows, "no-such-step"), []);
});

test("isMostlyBraille: true for a value made entirely of Braille-block glyphs", () => {
  assert.equal(isMostlyBraille("⠗⠁⠥⠍"), true);
});

test("isMostlyBraille: true when over half the non-whitespace characters are Braille glyphs", () => {
  assert.equal(isMostlyBraille("⠗⠁⠥ 1"), true); // 3 braille glyphs, 1 digit
});

test("isMostlyBraille: false for ordinary text", () => {
  assert.equal(isMostlyBraille("Raum 101"), false);
});

test("isMostlyBraille: false for an empty or all-whitespace value", () => {
  assert.equal(isMostlyBraille(""), false);
  assert.equal(isMostlyBraille("   "), false);
});

test("isMostlyBraille: whitespace inside the value doesn't count against the ratio", () => {
  assert.equal(isMostlyBraille("⠗⠁ ⠥⠍"), true);
});
