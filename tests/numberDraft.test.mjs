// Tests the pure logic behind ParamForm's NumberControl: how a numeric
// input's typed text maps to a committed value, in particular
// typedCommitValue's while-typing commit gate (the fix for a partial
// keystroke committing a clamped, not-yet-intended value).
import { test } from "node:test";
import assert from "node:assert/strict";
import { clampNumber, committedNumber, finiteDraft, typedCommitValue } from "../src/lib/numberDraft.ts";

function numberParam(overrides = {}) {
  return {
    name: "n",
    section: "General",
    description: "n",
    help: "n",
    type: "number",
    default: 0,
    ...overrides,
  };
}

test("typedCommitValue: commits a draft already within [min, max]", () => {
  const p = numberParam({ min: 10, max: 50, default: 10 });
  assert.equal(typedCommitValue(p, "25"), 25);
  assert.equal(typedCommitValue(p, "10"), 10);
  assert.equal(typedCommitValue(p, "50"), 50);
});

test("typedCommitValue: a partial keystroke below min commits nothing (not clamped)", () => {
  const p = numberParam({ min: 10, max: 50, default: 10 });
  // Typing "25" one digit at a time: "2" is below min and must not commit 10.
  assert.equal(typedCommitValue(p, "2"), null);
});

test("typedCommitValue: a value above max commits nothing (not clamped)", () => {
  const p = numberParam({ min: 0, max: 100, default: 0 });
  assert.equal(typedCommitValue(p, "999"), null);
});

test("typedCommitValue: blank or non-numeric draft commits nothing", () => {
  const p = numberParam({ min: 0, max: 100, default: 0 });
  assert.equal(typedCommitValue(p, ""), null);
  assert.equal(typedCommitValue(p, "-"), null);
  assert.equal(typedCommitValue(p, "abc"), null);
});

test("typedCommitValue: no min/max means every finite draft commits", () => {
  const p = numberParam({ default: 0 });
  assert.equal(typedCommitValue(p, "-5"), -5);
  assert.equal(typedCommitValue(p, "12345"), 12345);
});

test("typedCommitValue: a one-sided bound (min only) still gates", () => {
  const p = numberParam({ min: 10, default: 10 });
  assert.equal(typedCommitValue(p, "5"), null);
  assert.equal(typedCommitValue(p, "10"), 10);
  assert.equal(typedCommitValue(p, "999"), 999);
});

test("clampNumber: clamps into [min, max]", () => {
  const p = numberParam({ min: 10, max: 50 });
  assert.equal(clampNumber(p, 2), 10);
  assert.equal(clampNumber(p, 999), 50);
  assert.equal(clampNumber(p, 25), 25);
});

test("finiteDraft: parses finite numbers, null for blank/NaN text", () => {
  assert.equal(finiteDraft("25"), 25);
  assert.equal(finiteDraft(""), null);
  assert.equal(finiteDraft("   "), null);
  assert.equal(finiteDraft("abc"), null);
});

test("committedNumber: falls back to the param default for a non-finite value", () => {
  const p = numberParam({ default: 7 });
  assert.equal(committedNumber(p, 12), 12);
  assert.equal(committedNumber(p, undefined), 7);
  assert.equal(committedNumber(p, "not a number"), 7);
});
