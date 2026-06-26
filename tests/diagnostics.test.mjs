// Tests the notice/warning/assert parser and badge counter that turn the raw
// OpenSCAD worker log into the friendly notices and count badges shown on the
// OpenSCAD output panel. Notice categories are config-driven (off by default);
// warnings and assert failures are hardcoded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiagnostics, countBadges } from "../src/lib/diagnostics.ts";

// A sample notice config (what a consumer's `notices` key would produce).
const NOTICES = [
  { marker: "advisory", label: "advisories", color: "#e0a458" },
  { marker: "note", label: "notes" },
];

test("extracts notices and strips the marker", () => {
  const out = parseDiagnostics(
    [
      "[cmd] openscad /tag.scad ...",
      '[out] ECHO: "tag: advisory: the label text is tall and may overflow"',
      '[out] ECHO: "some unrelated echo"',
    ],
    NOTICES
  );
  assert.deepEqual(out, [
    {
      level: "notice",
      text: "tag: the label text is tall and may overflow",
      color: "#e0a458",
    },
  ]);
});

test("notice categories are config-driven (multiple markers, first match wins)", () => {
  const out = parseDiagnostics(
    [
      '[out] ECHO: "tag: note: the label is engraved"',
      '[out] ECHO: "tag: advisory: the emblem is wide"',
    ],
    NOTICES
  );
  assert.deepEqual(out, [
    { level: "notice", text: "tag: the label is engraved" },
    { level: "notice", text: "tag: the emblem is wide", color: "#e0a458" },
  ]);
});

test("matches ECHO on stderr too (OpenSCAD-WASM routes ECHO to [err])", () => {
  const out = parseDiagnostics(
    ['[err] ECHO: "tag: note: the label is engraved"'],
    NOTICES
  );
  assert.deepEqual(out, [{ level: "notice", text: "tag: the label is engraved" }]);
});

test("notices are off when none are configured", () => {
  const out = parseDiagnostics(
    ['[out] ECHO: "tag: advisory: ignored when no categories are configured"'],
    []
  );
  assert.deepEqual(out, []);
});

test("a marker only matches when configured", () => {
  const out = parseDiagnostics(
    ['[out] ECHO: "tag: hint: not a configured marker"'],
    NOTICES
  );
  assert.deepEqual(out, []);
});

test("captures WARNING lines from stdout or stderr (hardcoded)", () => {
  const out = parseDiagnostics(
    ["[err] WARNING: Can't open font 'DIN', using fallback"],
    []
  );
  assert.deepEqual(out, [
    { level: "warning", text: "Can't open font 'DIN', using fallback" },
  ]);
});

test("captures assert failures as a hardcoded diagnostic", () => {
  const out = parseDiagnostics(
    ["[err] ERROR: Assertion 'width > 0' failed in file tag.scad, line 5"],
    []
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
  assert.equal(parseDiagnostics([line, line], NOTICES).length, 1);
});

test("returns nothing for a clean log", () => {
  assert.deepEqual(
    parseDiagnostics(["[cmd] openscad", '[out] ECHO: "ok"'], NOTICES),
    []
  );
});

test("countBadges tallies per category (raw counts, config order) plus asserts", () => {
  const log = [
    '[out] ECHO: "a: advisory: one"',
    '[out] ECHO: "a: advisory: two"',
    '[out] ECHO: "b: note: three"',
    "[err] WARNING: ignored for badges",
    "[err] ERROR: Assertion 'x' failed in file f.scad, line 1",
  ];
  assert.deepEqual(countBadges(log, NOTICES), [
    { key: "notice:advisory", label: "advisories", count: 2, color: "#e0a458" },
    { key: "notice:note", label: "notes", count: 1 },
    { key: "assert", label: "asserts", count: 1 },
  ]);
});

test("countBadges omits categories with no matches", () => {
  assert.deepEqual(
    countBadges(['[out] ECHO: "x: note: only one"'], NOTICES),
    [{ key: "notice:note", label: "notes", count: 1 }]
  );
});
