// Tests the pure first-visit resolution behind src/lib/sheetPolicy.ts:
// initialSheetDetent's viewport-driven choice (landscape → peek; tall portrait
// → half; short portrait → peek), including the exact TALL_MIN boundary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialSheetDetent } from "../src/lib/sheetPolicy.ts";

test("initialSheetDetent: a tall portrait viewport opens to half", () => {
  assert.equal(initialSheetDetent(844, false), "half");
});

test("initialSheetDetent: a short portrait viewport opens to peek", () => {
  assert.equal(initialSheetDetent(667, false), "peek");
});

test("initialSheetDetent: landscape always opens to peek, regardless of height", () => {
  assert.equal(initialSheetDetent(844, true), "peek"); // tall, but landscape
  assert.equal(initialSheetDetent(667, true), "peek");
  assert.equal(initialSheetDetent(1400, true), "peek");
});

test("initialSheetDetent: the tall/short boundary (TALL_MIN = 720) is inclusive of the tall side", () => {
  assert.equal(initialSheetDetent(720, false), "half"); // exactly TALL_MIN → half
  assert.equal(initialSheetDetent(719, false), "peek"); // one below → peek
});
