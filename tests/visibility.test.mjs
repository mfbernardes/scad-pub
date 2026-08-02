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
  // scripts/lib/params.mjs is the primary gate: it rejects an unsupported
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
  // either, so (matching the build-time grammar in scripts/lib/params.mjs)
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

// ── the generator and the evaluator are one grammar ────────────────────────
// These are the pairing tests: whatever scripts/lib/params.mjs ACCEPTS, this
// module must evaluate as written. They drifted once already — the generator
// learned to split outside quotes and the evaluator did not — and the failure
// was invisible, because isVisible fails open: the control showed for every
// value, so the condition looked like it had simply never been written.

test("a quoted operator is one value to both ends, not a clause separator", () => {
  const V = { mode: "p||q", other: "x" };
  // Accepted by the generator (tests/gen-schema.test.mjs pins that), so it must
  // mean what it says here.
  assert.equal(evalShowIf('mode=="p||q"', V), true);
  assert.equal(evalShowIf('mode=="p||q"', { mode: "p" }), false);
  assert.equal(evalShowIf('mode=="p||q"', { mode: "other" }), false);
  // The same for `&&`, and for a single-quoted literal.
  assert.equal(evalShowIf('mode=="a&&b"', { mode: "a&&b" }), true);
  assert.equal(evalShowIf('mode=="a&&b"', { mode: "a" }), false);
  assert.equal(evalShowIf("mode=='p||q'", V), true);
});

test("a quoted operator does not fail open through isVisible", () => {
  // The specific production shape: the clause threw, the catch showed the
  // control, and a condition that was supposed to hide it never did. Assert
  // through isVisible, not evalShowIf, because the catch is what hid the bug.
  const param = { name: "detail", type: "number", default: 1, showIf: 'mode=="p||q"' };
  assert.equal(isVisible(param, { mode: "p||q" }), true);
  assert.equal(isVisible(param, { mode: "anything else" }), false);
});

test("every clause shape the generator accepts is evaluated, not thrown on", () => {
  // Drawn from the generator's own SHOWIF_BARE_RE / SHOWIF_CMP_RE grammar, so a
  // shape added there without a matching evaluator branch fails here.
  const V = { flag: true, off: false, n: 3, s: "yes", word: "bare" };
  for (const [expr, expected] of [
    ["flag", true],
    ["!off", true],
    ["n==3", true],
    ["n!=3", false],
    ["s==\"yes\"", true],
    ["s=='yes'", true],
    // A bare right-hand side is a VALUE, not a reference to another parameter
    // (docs/annotations.md: "a bare word, quoted string, number, or
    // true/false"). `word` here is the string "bare", and the clause below
    // compares against the literal `bare` rather than reading `values.word`.
    ["word==bare", true],
    ["word==s", false],
    ["n==-3", false],
    ["n==3.0", true],
    ["flag==true", true],
    ["off==false", true],
    ["flag && n==3", true],
    ["off || n==3", true],
    ["off && n==3 || s==\"yes\"", true],
  ]) {
    // Not through isVisible: its catch would turn a throw into `true` and hide
    // exactly the failure this test exists to find.
    assert.equal(evalShowIf(expr, V), expected, expr);
  }
});
