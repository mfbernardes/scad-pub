// Tests the notice/warning/assert parser and badge counter that turn the raw
// OpenSCAD worker log into the friendly notices and count badges shown on the
// OpenSCAD output panel. Notice categories are config-driven (off by default);
// warnings and assert failures are hardcoded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiagnostics, countBadges, badgeTextColor } from "../src/lib/diagnostics.ts";

// A sample notice config (what a consumer's `notices` key would produce).
const NOTICES = [
  { marker: "alert", label: "alerts", color: "#e0a458" },
  { marker: "note", label: "notes" },
];

test("extracts notices and strips the marker", () => {
  const out = parseDiagnostics(
    [
      "[cmd] openscad /tag.scad ...",
      '[out] ECHO: "tag: alert: the label text is tall and may overflow"',
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
      '[out] ECHO: "tag: alert: the emblem is wide"',
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
    ['[out] ECHO: "tag: alert: ignored when no categories are configured"'],
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
    ["[err] WARNING: Can't open font 'Brand Display', using fallback"],
    []
  );
  assert.deepEqual(out, [
    { level: "warning", text: "Can't open font 'Brand Display', using fallback", attention: true },
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
      attention: true,
    },
  ]);
});

test("de-duplicates repeated notices", () => {
  const line = '[out] ECHO: "x: alert: only 8 mm between modalities"';
  assert.equal(parseDiagnostics([line, line], NOTICES).length, 1);
});

test("a marker with regex metacharacters is matched literally, not as a pattern", () => {
  // Markers are config-supplied and interpolated into a RegExp; they must be
  // escaped so e.g. "a.b" matches "a.b" and not "axb", and "(note)" is literal.
  const markers = [{ marker: "a.b", label: "ab" }, { marker: "(note)", label: "n" }];
  assert.deepEqual(
    parseDiagnostics(['[out] ECHO: "tag: a.b: matched"'], markers),
    [{ level: "notice", text: "tag: matched" }]
  );
  // The metachar must be literal: "axb" must NOT match the "a.b" marker.
  assert.deepEqual(parseDiagnostics(['[out] ECHO: "tag: axb: nope"'], markers), []);
  // Parentheses in the marker are literal too.
  assert.deepEqual(
    parseDiagnostics(['[out] ECHO: "tag: (note): hi"'], markers),
    [{ level: "notice", text: "tag: hi" }]
  );
});

test("returns nothing for a clean log", () => {
  assert.deepEqual(
    parseDiagnostics(["[cmd] openscad", '[out] ECHO: "ok"'], NOTICES),
    []
  );
});

test("countBadges tallies per category (raw counts, config order) plus asserts", () => {
  const log = [
    '[out] ECHO: "a: alert: one"',
    '[out] ECHO: "a: alert: two"',
    '[out] ECHO: "b: note: three"',
    "[err] WARNING: ignored for badges",
    "[err] ERROR: Assertion 'x' failed in file f.scad, line 1",
  ];
  assert.deepEqual(countBadges(log, NOTICES), [
    { key: "notice:alert", label: "alerts", count: 2, attention: false, color: "#e0a458" },
    { key: "notice:note", label: "notes", count: 1, attention: false },
    { key: "assert", label: "asserts", count: 1, attention: true },
  ]);
});

test("countBadges omits categories with no matches", () => {
  assert.deepEqual(
    countBadges(['[out] ECHO: "x: note: only one"'], NOTICES),
    [{ key: "notice:note", label: "notes", count: 1, attention: false }]
  );
});

test("countBadges marks a category attention:true when config flags it, and the assert badge is always attention:true", () => {
  const notices = [
    { marker: "alert", label: "alerts", attention: true },
    { marker: "note", label: "notes" },
  ];
  const log = ['[out] ECHO: "a: alert: one"', '[out] ECHO: "b: note: two"'];
  assert.deepEqual(countBadges(log, notices), [
    { key: "notice:alert", label: "alerts", count: 1, attention: true },
    { key: "notice:note", label: "notes", count: 1, attention: false },
  ]);
});

test("badgeTextColor: white text on dark backgrounds", () => {
  assert.equal(badgeTextColor("#000000"), "#fff");
  assert.equal(badgeTextColor("#000"), "#fff");
  assert.equal(badgeTextColor("#1a1a2e"), "#fff");
  assert.equal(badgeTextColor("#e0a458"), "#000"); // amber — luminance > 0.4
});

test("badgeTextColor: black text on light backgrounds", () => {
  assert.equal(badgeTextColor("#ffffff"), "#000");
  assert.equal(badgeTextColor("#fff"), "#000");
  assert.equal(badgeTextColor("#f5f5f5"), "#000");
});

test("badgeTextColor: undefined/invalid input returns undefined", () => {
  assert.equal(badgeTextColor(undefined), undefined);
  assert.equal(badgeTextColor(""), undefined);
  assert.equal(badgeTextColor("red"), undefined);       // named colour
  assert.equal(badgeTextColor("rgb(0,0,0)"), undefined); // functional form
  assert.equal(badgeTextColor("#gggggg"), undefined);   // invalid hex digits
});

test("badgeTextColor: trims leading/trailing whitespace before parsing", () => {
  assert.equal(badgeTextColor("  #000  "), "#fff");
});
