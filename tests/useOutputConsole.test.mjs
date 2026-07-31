// Tests the pure edge-detectors behind src/lib/useOutputConsole.ts's
// auto-open/auto-close policy: shouldAutoOpen (a new warning opens the
// console, but only while the mobile sheet sits at peek) and shouldAutoClose
// (notices clearing closes the console, but only one this machine itself
// opened).
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldAutoOpen, shouldAutoClose } from "../src/lib/useOutputConsole.ts";

test("shouldAutoOpen: opens on the false->true edge while the sheet is at peek", () => {
  assert.equal(shouldAutoOpen(true, false, true), true);
});

test("shouldAutoOpen: a persistent problem across edits doesn't re-open a dismissed console", () => {
  assert.equal(shouldAutoOpen(true, true, true), false);
});

test("shouldAutoOpen: no problem at all never opens", () => {
  assert.equal(shouldAutoOpen(false, false, true), false);
});

test("shouldAutoOpen: a new warning while the sheet is half/full is skipped entirely", () => {
  assert.equal(shouldAutoOpen(true, false, false), false);
});

test("shouldAutoClose: closes on the true->false edge for a console it opened", () => {
  assert.equal(shouldAutoClose(false, true, true), true);
});

test("shouldAutoClose: a console the visitor opened by hand stays open once notices clear", () => {
  assert.equal(shouldAutoClose(false, true, false), false);
});

test("shouldAutoClose: no transition (still empty, or still non-empty) never closes", () => {
  assert.equal(shouldAutoClose(false, false, true), false);
  assert.equal(shouldAutoClose(true, true, true), false);
});

test("shouldAutoClose: notices appearing (false->true) is not a close edge", () => {
  assert.equal(shouldAutoClose(true, false, true), false);
});
