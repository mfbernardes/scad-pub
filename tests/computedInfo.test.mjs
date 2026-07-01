// Tests the parser that turns OpenSCAD's `echo("@info", label, unit, value)`
// convention into "calculated value" rows for the measurements panel — a
// separate, purely-runtime mechanism from the comment-based `// @info`
// annotation (see gen-schema.mjs / diagnostics.test.mjs for that one).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComputedInfo } from "../src/lib/computedInfo.ts";

test("extracts a basic number value with a unit", () => {
  const out = parseComputedInfo(['[out] ECHO: "@info", "Dot height", "mm", 0.48']);
  assert.deepEqual(out, [{ label: "Dot height", unit: "mm", value: "0.48 mm" }]);
});

test("an empty unit produces no trailing space", () => {
  const out = parseComputedInfo(['[out] ECHO: "@info", "Count", "", 3']);
  assert.deepEqual(out, [{ label: "Count", unit: "", value: "3" }]);
});

test("a quoted string value has its quotes stripped", () => {
  const out = parseComputedInfo(['[out] ECHO: "@info", "Mode", "", "raised"']);
  assert.deepEqual(out, [{ label: "Mode", unit: "", value: "raised" }]);
});

test("non-string values pass through exactly as OpenSCAD printed them", () => {
  const out = parseComputedInfo([
    '[out] ECHO: "@info", "Engraved", "", true',
    '[out] ECHO: "@info", "Raised", "", false',
    '[out] ECHO: "@info", "Maybe", "", undef',
    '[out] ECHO: "@info", "Position", "mm", [1, 2, 3]',
  ]);
  assert.deepEqual(out, [
    { label: "Engraved", unit: "", value: "true" },
    { label: "Raised", unit: "", value: "false" },
    { label: "Maybe", unit: "", value: "undef" },
    { label: "Position", unit: "mm", value: "[1, 2, 3] mm" },
  ]);
});

test("matches ECHO on stderr too (OpenSCAD-WASM routes ECHO to [err])", () => {
  const out = parseComputedInfo(['[err] ECHO: "@info", "Radius", "mm", 25']);
  assert.deepEqual(out, [{ label: "Radius", unit: "mm", value: "25 mm" }]);
});

test("preserves log order across multiple echoes, not sorted/grouped", () => {
  const out = parseComputedInfo([
    '[out] ECHO: "@info", "B", "", 2',
    '[out] ECHO: "@info", "A", "", 1',
  ]);
  assert.deepEqual(out, [
    { label: "B", unit: "", value: "2" },
    { label: "A", unit: "", value: "1" },
  ]);
});

test("duplicate labels are NOT de-duplicated", () => {
  const out = parseComputedInfo([
    '[out] ECHO: "@info", "Width", "mm", 10',
    '[out] ECHO: "@info", "Width", "mm", 20',
  ]);
  assert.deepEqual(out, [
    { label: "Width", unit: "mm", value: "10 mm" },
    { label: "Width", unit: "mm", value: "20 mm" },
  ]);
});

test("returns nothing for an empty log", () => {
  assert.deepEqual(parseComputedInfo([]), []);
});

test("non-matching lines are ignored", () => {
  const out = parseComputedInfo([
    '[out] ECHO: "hello"',
    "[err] WARNING: something",
    "[cmd] openscad /coin.scad ...",
  ]);
  assert.deepEqual(out, []);
});

test("a single-arg echo merely containing the substring \"@info\" does not match", () => {
  const out = parseComputedInfo(['[out] ECHO: "@info: not the convention"']);
  assert.deepEqual(out, []);
});

test("a label or unit containing an embedded comma is handled correctly", () => {
  const out = parseComputedInfo(['[out] ECHO: "@info", "Width, height", "mm", 5']);
  assert.deepEqual(out, [{ label: "Width, height", unit: "mm", value: "5 mm" }]);
});
