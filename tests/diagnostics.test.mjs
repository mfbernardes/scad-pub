// Tests the advisory/warning/assert parser and badge counter that turn the raw
// OpenSCAD worker log into the friendly notices and count badges shown on the
// OpenSCAD output panel. Advisory categories are config-driven; warnings and
// assert failures are hardcoded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiagnostics, countBadges } from "../src/lib/diagnostics.ts";

// The default advisory category (what gen-schema emits when `advisories` is
// omitted): preserves the prior hardcoded "advisory" behaviour.
const DEFAULT = [{ marker: "advisory", label: "advisories" }];

test("extracts advisories and strips the marker", () => {
  const out = parseDiagnostics(
    [
      "[cmd] openscad /signage.scad ...",
      '[out] ECHO: "signage: advisory: tactile content sits 4.2 mm from the edge"',
      '[out] ECHO: "some unrelated echo"',
    ],
    DEFAULT
  );
  assert.deepEqual(out, [
    { level: "advisory", text: "signage: tactile content sits 4.2 mm from the edge" },
  ]);
});

test("advisory categories are config-driven (custom marker + colour)", () => {
  const advisories = [
    { marker: "note", label: "notes", color: "#3b82f6" },
    { marker: "advisory", label: "advisories" },
  ];
  const out = parseDiagnostics(
    [
      '[out] ECHO: "panel: note: prefer a wider margin"',
      '[out] ECHO: "panel: advisory: low contrast"',
    ],
    advisories
  );
  assert.deepEqual(out, [
    { level: "advisory", text: "panel: prefer a wider margin", color: "#3b82f6" },
    { level: "advisory", text: "panel: low contrast" },
  ]);
});

test("a marker only matches when configured", () => {
  const out = parseDiagnostics(
    ['[out] ECHO: "panel: note: prefer a wider margin"'],
    DEFAULT // no "note" category configured
  );
  assert.deepEqual(out, []);
});

test("captures WARNING lines from stdout or stderr (hardcoded)", () => {
  const out = parseDiagnostics(
    ["[err] WARNING: Can't open font 'DIN', using fallback"],
    DEFAULT
  );
  assert.deepEqual(out, [
    { level: "warning", text: "Can't open font 'DIN', using fallback" },
  ]);
});

test("captures assert failures as a hardcoded diagnostic", () => {
  const out = parseDiagnostics(
    ["[err] ERROR: Assertion 'width > 0' failed in file tag.scad, line 5"],
    DEFAULT
  );
  assert.deepEqual(out, [
    {
      level: "assert",
      text: "Assertion 'width > 0' failed in file tag.scad, line 5",
    },
  ]);
});

test("de-duplicates repeated notices", () => {
  const line = '[out] ECHO: "x: advisory: only 8 mm between modalities"';
  assert.equal(parseDiagnostics([line, line], DEFAULT).length, 1);
});

test("returns nothing for a clean log", () => {
  assert.deepEqual(
    parseDiagnostics(["[cmd] openscad", '[out] ECHO: "ok"'], DEFAULT),
    []
  );
});

test("countBadges tallies per category (raw counts, config order) plus asserts", () => {
  const advisories = [
    { marker: "advisory", label: "advisories", color: "#3b82f6" },
    { marker: "note", label: "notes" },
  ];
  const log = [
    '[out] ECHO: "a: advisory: one"',
    '[out] ECHO: "a: advisory: two"',
    '[out] ECHO: "b: note: three"',
    "[err] WARNING: ignored for badges",
    "[err] ERROR: Assertion 'x' failed in file f.scad, line 1",
  ];
  assert.deepEqual(countBadges(log, advisories), [
    { key: "advisory:advisory", label: "advisories", count: 2, color: "#3b82f6" },
    { key: "advisory:note", label: "notes", count: 1 },
    { key: "assert", label: "asserts", count: 1 },
  ]);
});

test("countBadges omits categories with no matches", () => {
  assert.deepEqual(
    countBadges(['[out] ECHO: "x: advisory: only one"'], DEFAULT),
    [{ key: "advisory:advisory", label: "advisories", count: 1 }]
  );
});
