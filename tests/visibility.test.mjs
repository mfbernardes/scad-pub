// Tests the @showIf evaluator that drives conditional parameter visibility.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evalShowIf, isVisible } from "../src/lib/visibility.ts";

const V = {
  template: "direction",
  back_pocket: false,
  engrave_letter: false,
  string_hole: true,
  char_size: 14,
};

test("equality against an enum value", () => {
  assert.equal(evalShowIf("template == direction", V), true);
  assert.equal(evalShowIf("template == room", V), false);
  assert.equal(evalShowIf("template != room", V), true);
});

test("bare boolean and negation", () => {
  assert.equal(evalShowIf("string_hole", V), true);
  assert.equal(evalShowIf("back_pocket", V), false);
  assert.equal(evalShowIf("!engrave_letter", V), true);
  assert.equal(evalShowIf("!string_hole", V), false);
});

test("numeric comparison and truthiness", () => {
  assert.equal(evalShowIf("char_size == 14", V), true);
  assert.equal(evalShowIf("char_size == 99", V), false);
  assert.equal(evalShowIf("char_size", V), true);
});

test("&& / || combinations", () => {
  assert.equal(evalShowIf("template == direction && string_hole", V), true);
  assert.equal(evalShowIf("template == direction && back_pocket", V), false);
  assert.equal(evalShowIf("back_pocket || string_hole", V), true);
  assert.equal(evalShowIf("back_pocket || engrave_letter", V), false);
});

test("isVisible: no condition is always visible; malformed fails safe", () => {
  assert.equal(isVisible({ name: "x", showIf: undefined }, V), true);
  assert.equal(isVisible({ name: "a", showIf: "back_pocket" }, V), false);
  assert.equal(isVisible({ name: "b", showIf: "string_hole" }, V), true);
});

test("evalShowIf: param name absent from values is falsy", () => {
  // 'unknown_param' is not in V, so values[name] is undefined → falsy → false
  assert.equal(evalShowIf("unknown_param", V), false);
  assert.equal(evalShowIf("!unknown_param", V), true);
});

test("evalShowIf: empty/whitespace clause is truthy (always visible)", () => {
  // An empty clause (e.g. from a trailing ||) must not hide the control.
  assert.equal(evalShowIf("", V), true);
  assert.equal(evalShowIf("   ", V), true);
});
