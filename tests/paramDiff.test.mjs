// Tests the pure param-diff helpers (paramLabel, changedParams, displayValue)
// shared by renderMetrics telemetry and the Parameters tab's preset-diff UI
// (PresetDiffBar + ParamForm's per-field markers).
import { test } from "node:test";
import assert from "node:assert/strict";
import { paramLabel, changedParams, displayValue } from "../src/lib/paramDiff.ts";

function numberParam(name, description, def) {
  return { name, description, help: "", section: "", type: "number", default: def };
}

test("changedParams: detects a changed param, ignores unchanged, preserves declaration order", () => {
  const params = [
    numberParam("width", "Width (mm)", 10),
    numberParam("height", "Height (mm)", 20),
    numberParam("depth", "Depth (mm)", 30),
  ];
  const prev = { width: 10, height: 20, depth: 30 };
  const next = { width: 15, height: 20, depth: 25 };
  const changed = changedParams(params, prev, next);
  assert.deepEqual(changed.map((p) => p.name), ["width", "depth"]);
});

test("changedParams: a missing key falls back to the param default for comparison", () => {
  const params = [numberParam("width", "Width (mm)", 10)];
  assert.deepEqual(changedParams(params, {}, { width: 10 }), []);
  assert.deepEqual(changedParams(params, {}, { width: 11 }).map((p) => p.name), ["width"]);
});

test("paramLabel: uses description when present", () => {
  assert.equal(paramLabel(numberParam("w", "Width (mm)", 10)), "Width (mm)");
});

test("paramLabel: falls back to the variable name when description is empty", () => {
  assert.equal(paramLabel(numberParam("w", "", 10)), "w");
});

test("displayValue: boolean renders on/off", () => {
  const p = { name: "flag", description: "Flag", help: "", section: "", type: "boolean", default: false };
  assert.equal(displayValue(p, true), "on");
  assert.equal(displayValue(p, false), "off");
});

test("displayValue: enum resolves to the matching choice's label", () => {
  const p = {
    name: "lang",
    description: "Language",
    help: "",
    section: "",
    type: "enum",
    default: "de",
    choices: [
      { value: "de", label: "Deutsch" },
      { value: "en", label: "English" },
    ],
  };
  assert.equal(displayValue(p, "en"), "English");
});

test("displayValue: enum falls back to the raw value when no choice matches", () => {
  const p = {
    name: "lang",
    description: "Language",
    help: "",
    section: "",
    type: "enum",
    default: "de",
    choices: [{ value: "de", label: "Deutsch" }],
  };
  assert.equal(displayValue(p, "fr"), "fr");
});

test("displayValue: number/string values stringify plainly", () => {
  const num = numberParam("w", "Width (mm)", 10);
  assert.equal(displayValue(num, 12.5), "12.5");
  const str = { name: "s", description: "S", help: "", section: "", type: "string", default: "a" };
  assert.equal(displayValue(str, "hello"), "hello");
});
