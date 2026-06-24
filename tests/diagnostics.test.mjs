// Tests the advisory/warning parser that turns the raw OpenSCAD worker log into
// the friendly notices shown under the preview.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiagnostics } from "../src/lib/diagnostics.ts";

test("extracts advisories and strips the 'advisory:' marker", () => {
  const out = parseDiagnostics([
    "[cmd] openscad /signage.scad ...",
    '[out] ECHO: "signage: advisory: tactile content sits 4.2 mm from the edge"',
    '[out] ECHO: "some unrelated echo"',
  ]);
  assert.deepEqual(out, [
    { level: "advisory", text: "signage: tactile content sits 4.2 mm from the edge" },
  ]);
});

test("captures WARNING lines from stdout or stderr", () => {
  const out = parseDiagnostics([
    "[err] WARNING: Can't open font 'DIN', using fallback",
  ]);
  assert.deepEqual(out, [
    { level: "warning", text: "Can't open font 'DIN', using fallback" },
  ]);
});

test("de-duplicates repeated notices", () => {
  const line = '[out] ECHO: "x: advisory: only 8 mm between modalities"';
  assert.equal(parseDiagnostics([line, line]).length, 1);
});

test("returns nothing for a clean log", () => {
  assert.deepEqual(parseDiagnostics(["[cmd] openscad", "[out] ECHO: \"ok\""]), []);
});
