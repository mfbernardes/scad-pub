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

test("isVisible: no condition is always visible", () => {
  assert.equal(isVisible({ name: "x", showIf: undefined }, V), true);
  assert.equal(isVisible({ name: "a", showIf: "back_pocket" }, V), false);
  assert.equal(isVisible({ name: "b", showIf: "string_hole" }, V), true);
});

test("isVisible: a genuinely malformed expression fails safe (control stays visible)", () => {
  // scripts/lib/params.mjs is the primary gate — it rejects an unsupported
  // clause shape at generate time, so a shipped schema.json's showIf strings
  // are always well-formed. This exercises the runtime's own defense-in-depth:
  // evalClause throws on a relational operator (an unsupported clause shape,
  // matching what generate time now rejects), and isVisible must catch that
  // and keep the control visible rather than propagate or hide it.
  assert.doesNotThrow(() => isVisible({ name: "a", showIf: "char_size > 10" }, V));
  assert.equal(isVisible({ name: "a", showIf: "char_size > 10" }, V), true);
  assert.equal(isVisible({ name: "a", showIf: "template ~= direction" }, V), true);
});

test("evalShowIf: param name absent from values is falsy", () => {
  // 'unknown_param' is not in V, so values[name] is undefined → falsy → false
  assert.equal(evalShowIf("unknown_param", V), false);
  assert.equal(evalShowIf("!unknown_param", V), true);
});

test("evalShowIf: relational operators (<, >, >=) are NOT supported — throws rather than reading as a falsy lookup", () => {
  // The evaluator only understands == / != / bare-bool / !. A relational
  // clause isn't a recognised comparison and isn't a bare identifier lookup
  // either, so — matching the build-time grammar in scripts/lib/params.mjs —
  // it throws instead of silently hiding the control. isVisible (above) is
  // what actually fails safe for a caller; evalShowIf itself surfaces the error.
  assert.throws(() => evalShowIf("char_size > 10", V), /unsupported @showIf clause/);
  assert.throws(() => evalShowIf("char_size >= 10", V), /unsupported @showIf clause/);
  assert.throws(() => evalShowIf("char_size < 99", V), /unsupported @showIf clause/);
});

test("evalShowIf: empty/whitespace clause is truthy (always visible)", () => {
  // An empty clause (e.g. from a trailing ||) must not hide the control.
  assert.equal(evalShowIf("", V), true);
  assert.equal(evalShowIf("   ", V), true);
});
