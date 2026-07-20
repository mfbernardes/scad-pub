// Tests src/lib/friendlyErrors.ts — the pure mapping from a failed
// RenderResult to friendly headline/body/technical-details copy. See
// src/lib/diagnostics.ts for the ASSERT_RE/WARNING_RE this reuses rather than
// duplicates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { friendlyRenderError } from "../src/lib/friendlyErrors.ts";

function ok(overrides = {}) {
  return { id: 1, ok: true, exitCode: 0, stl: new Uint8Array([1]), log: [], ms: 10, ...overrides };
}
function fail(overrides = {}) {
  return { id: 1, ok: false, exitCode: 1, stl: new Uint8Array(), log: [], ms: 5, ...overrides };
}

test("returns null for a successful result", () => {
  assert.equal(friendlyRenderError(ok()), null);
});

test("returns null for a null result (no completed render yet)", () => {
  assert.equal(friendlyRenderError(null), null);
});

test("a fatal bootstrap failure wins priority over everything else", () => {
  const result = fail({
    fatal: true,
    log: [
      "[error] fetch failed (500 Internal Server Error): wasm/openscad.wasm",
      // Even an assert line present alongside a fatal failure must not win —
      // bootstrap never got as far as running OpenSCAD in the first place.
      "[err] ERROR: Assertion 'x' failed in file f.scad, line 1",
    ],
  });
  const info = friendlyRenderError(result);
  assert.equal(info.title, "The 3D engine couldn't start — check your connection and try again.");
  assert.equal(info.body, null);
});

test("a failed assert with an authored message: title + verbatim, unquoted body", () => {
  const result = fail({
    log: [
      "[cmd] openscad ...",
      `[err] ERROR: Assertion '!((engrave_text && (label != "")) && (text_depth >= thickness))' failed: "engraved text is deeper than the plate is thick; reduce text depth or thicken the plate" in file /tag.scad, line 127`,
      "[err] TRACE: called by 'assert' in file /tag.scad, line 127",
    ],
  });
  const info = friendlyRenderError(result);
  assert.equal(info.title, "Preview could not be updated");
  assert.equal(
    info.body,
    "engraved text is deeper than the plate is thick; reduce text depth or thicken the plate"
  );
  // No surrounding quotation marks leaked into the body.
  assert.ok(!info.body.startsWith('"'));
  assert.ok(!info.body.endsWith('"'));
});

test("a failed assert with no message argument falls back to the raw assertion text", () => {
  const result = fail({
    log: ["[err] ERROR: Assertion 'width > 0' failed in file tag.scad, line 5"],
  });
  const info = friendlyRenderError(result);
  assert.equal(info.title, "Preview could not be updated");
  assert.equal(info.body, "Assertion 'width > 0' failed in file tag.scad, line 5");
});

test("OpenSCAD halts at the first assert: uses the first one's message as the body", () => {
  const result = fail({
    log: [
      '[err] ERROR: Assertion \'a\' failed: "first message" in file f.scad, line 1',
      '[err] ERROR: Assertion \'b\' failed: "second message" in file f.scad, line 2',
    ],
  });
  const info = friendlyRenderError(result);
  assert.equal(info.body, "first message");
});

test("technical collects further ERROR/WARNING lines, deduped, as a short tail", () => {
  const result = fail({
    log: [
      "[err] WARNING: Can't open font 'Brand Display', using fallback",
      '[err] ERROR: Assertion \'a\' failed: "first message" in file f.scad, line 1',
      '[err] ERROR: Assertion \'b\' failed: "second message" in file f.scad, line 2',
      // A repeat of the first warning must not duplicate in `technical`.
      "[err] WARNING: Can't open font 'Brand Display', using fallback",
    ],
  });
  const info = friendlyRenderError(result);
  assert.deepEqual(info.technical, [
    "Warning: Can't open font 'Brand Display', using fallback",
    "Assertion 'a' failed: \"first message\" in file f.scad, line 1",
    "Assertion 'b' failed: \"second message\" in file f.scad, line 2",
  ]);
});

test("technical is capped to a short tail (default 5), keeping the most recent lines", () => {
  const log = [];
  for (let i = 0; i < 8; i++) log.push(`[err] WARNING: distinct warning number ${i}`);
  const result = fail({ log: [...log, '[err] ERROR: Assertion \'x\' failed: "boom" in file f.scad, line 9'] });
  const info = friendlyRenderError(result);
  assert.equal(info.technical.length, 5);
  // The tail keeps the LAST 5 distinct lines, so the earliest warnings (0-3)
  // are dropped in favour of the later ones plus the assert line.
  assert.deepEqual(info.technical, [
    "Warning: distinct warning number 4",
    "Warning: distinct warning number 5",
    "Warning: distinct warning number 6",
    "Warning: distinct warning number 7",
    "Assertion 'x' failed: \"boom\" in file f.scad, line 9",
  ]);
});

test("maxTechnical option overrides the default cap", () => {
  const result = fail({
    log: ["[err] WARNING: one", "[err] WARNING: two", "[err] WARNING: three"],
  });
  const info = friendlyRenderError(result, { maxTechnical: 2 });
  assert.deepEqual(info.technical, ["Warning: two", "Warning: three"]);
});

test("any other nonzero exit (no assert, not fatal): generic toast-matching title, null body", () => {
  const result = fail({ log: ["[err] Current top level object is empty."] });
  const info = friendlyRenderError(result);
  assert.equal(info.title, "That combination of settings didn't work");
  assert.equal(info.body, null);
});
