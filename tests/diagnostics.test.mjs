// Tests the notice/warning/assert parser and badge counter that turn the raw
// OpenSCAD worker log into the friendly notices and count badges shown on the
// OpenSCAD output panel. Notice categories are config-driven (off by default);
// warnings and assert failures are hardcoded.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDiagnostics,
  countBadges,
  displayBadges,
  badgeTextColor,
  badgeVariant,
  noticeLabel,
  isCompactConsoleContent,
  cleanNoticeText,
  noticeCards,
} from "../src/lib/diagnostics.ts";

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
      marker: "alert",
      label: "alerts",
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
    { level: "notice", text: "tag: the label is engraved", marker: "note", label: "notes" },
    { level: "notice", text: "tag: the emblem is wide", color: "#e0a458", marker: "alert", label: "alerts" },
  ]);
});

test("matches ECHO on stderr too (OpenSCAD-WASM routes ECHO to [err])", () => {
  const out = parseDiagnostics(
    ['[err] ECHO: "tag: note: the label is engraved"'],
    NOTICES
  );
  assert.deepEqual(out, [
    { level: "notice", text: "tag: the label is engraved", marker: "note", label: "notes" },
  ]);
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
    { level: "warning", text: "Can't open font 'Brand Display', using fallback" },
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
  const line = '[out] ECHO: "x: alert: only 8 mm between modalities"';
  assert.equal(parseDiagnostics([line, line], NOTICES).length, 1);
});

test("a marker with regex metacharacters is matched literally, not as a pattern", () => {
  // Markers are config-supplied and interpolated into a RegExp; they must be
  // escaped so e.g. "a.b" matches "a.b" and not "axb", and "(note)" is literal.
  const markers = [{ marker: "a.b", label: "ab" }, { marker: "(note)", label: "n" }];
  assert.deepEqual(
    parseDiagnostics(['[out] ECHO: "tag: a.b: matched"'], markers),
    [{ level: "notice", text: "tag: matched", marker: "a.b", label: "ab" }]
  );
  // The metachar must be literal: "axb" must NOT match the "a.b" marker.
  assert.deepEqual(parseDiagnostics(['[out] ECHO: "tag: axb: nope"'], markers), []);
  // Parentheses in the marker are literal too.
  assert.deepEqual(
    parseDiagnostics(['[out] ECHO: "tag: (note): hi"'], markers),
    [{ level: "notice", text: "tag: hi", marker: "(note)", label: "n" }]
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
    { key: "notice:alert", label: "alerts", count: 2, color: "#e0a458" },
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

test("countBadges carries labelOne through when configured", () => {
  const notices = [{ marker: "alert", label: "alerts", labelOne: "alert", color: "#e0a458" }];
  assert.deepEqual(countBadges(['[out] ECHO: "x: alert: one"'], notices), [
    { key: "notice:alert", label: "alerts", count: 1, labelOne: "alert", color: "#e0a458" },
  ]);
});

test("countBadges carries subsumedByFont through only when the category is also attention-flagged", () => {
  const notices = [
    { marker: "overflow", label: "overflow warnings", attention: true, subsumedByFont: true },
    { marker: "note", label: "notes", subsumedByFont: true }, // no `attention` — must be ignored per NoticeCategory's own doc
  ];
  const out = countBadges(
    ['[out] ECHO: "x: overflow: text may overflow"', '[out] ECHO: "x: note: fyi"'],
    notices
  );
  assert.deepEqual(out, [
    { key: "notice:overflow", label: "overflow warnings", count: 1, attention: true, subsumedByFont: true },
    { key: "notice:note", label: "notes", count: 1 },
  ]);
});

test("countBadges carries attention through only when the category is flagged (4.2)", () => {
  const notices = [
    { marker: "alert", label: "alerts", attention: true },
    { marker: "note", label: "notes" }, // no `attention` — omitted, matching subsumedByFont's convention
  ];
  const out = countBadges(
    ['[out] ECHO: "x: alert: one"', '[out] ECHO: "x: note: fyi"'],
    notices
  );
  assert.deepEqual(out, [
    { key: "notice:alert", label: "alerts", count: 1, attention: true },
    { key: "notice:note", label: "notes", count: 1 },
  ]);
});

// FIX 1 regression coverage: a `subsumedByFont` category's badge must never
// show a non-zero count with no corresponding visible notice. `displayBadges`
// is the filter OutputConsole applies before rendering CountBadges, keyed off
// the same markers backing the curated attention cards (readiness.ts's
// deriveAttention) — see diagnostics.ts's own doc for the full story.
test("displayBadges: a subsumed category's badge is hidden when its notice isn't in the visible set", () => {
  const badges = [
    { key: "notice:overflow", label: "overflow warnings", count: 1, subsumedByFont: true },
    { key: "assert", label: "asserts", count: 1 },
  ];
  // Simulates: a font-fallback item covers the "overflow" notice this
  // render, so deriveAttention excluded it from `attention` — no
  // "notice:overflow" key ends up in the visible set.
  const visible = displayBadges(badges, new Set());
  assert.deepEqual(visible, [{ key: "assert", label: "asserts", count: 1 }]);
  // The required outcome, restated as an invariant: every remaining badge's
  // key has a matching visible notice — count > 0 always corresponds to
  // something actually shown, never a phantom "Notices 1" with nothing
  // behind it.
  assert.ok(visible.every((b) => !b.subsumedByFont));
});

test("displayBadges: a subsumed category's badge stays visible once its notice is (still genuinely its own issue)", () => {
  const badges = [{ key: "notice:overflow", label: "overflow warnings", count: 1, subsumedByFont: true }];
  // No font-fallback present this render (or deriveAttention's ambiguity
  // guard kept the notice its own issue) — the marker IS in the visible set.
  const visible = displayBadges(badges, new Set(["notice:overflow"]));
  assert.deepEqual(visible, badges);
});

test("displayBadges: non-subsumed badges (plain categories, asserts) always pass through", () => {
  const badges = [
    { key: "notice:note", label: "notes", count: 3 },
    { key: "assert", label: "asserts", count: 1 },
  ];
  assert.deepEqual(displayBadges(badges, new Set()), badges);
});

test("noticeLabel: uses labelOne only when count is exactly 1 and one was configured", () => {
  assert.equal(noticeLabel("alerts", 1, "alert"), "alert");
  assert.equal(noticeLabel("alerts", 2, "alert"), "alerts");
  assert.equal(noticeLabel("alerts", 0, "alert"), "alerts");
  assert.equal(noticeLabel("alerts", 1, undefined), "alerts");
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

// UX plan item 4.2: an amber "Notices N" badge must not sit next to Review's
// "no unresolved issues" for a purely informational notice. `badgeVariant` is
// the single source of truth CountBadges renders from — these tests exercise
// it directly against realistic countBadges() output rather than rendering
// (this repo has no DOM test harness — see errorBoundary.test.mjs's own doc).
test("badgeVariant: all-non-attention notices render neutral (secondary), not amber", () => {
  const notices = [{ marker: "fontnote", label: "notes" }]; // no `attention: true` in config
  const [badge] = countBadges(['[out] ECHO: "x: fontnote: using a fallback font"'], notices);
  assert.deepEqual(badge, { key: "notice:fontnote", label: "notes", count: 1 });
  assert.equal(badgeVariant(badge), "secondary");
});

test("badgeVariant: an attention-flagged notice renders amber (warn)", () => {
  const notices = [{ marker: "overflow", label: "overflow warnings", attention: true }];
  const [badge] = countBadges(['[out] ECHO: "x: overflow: text may overflow"'], notices);
  assert.deepEqual(badge, { key: "notice:overflow", label: "overflow warnings", count: 1, attention: true });
  assert.equal(badgeVariant(badge), "warn");
});

test("badgeVariant: a mix renders each badge on its own honest colour, not one blanket verdict", () => {
  const notices = [
    { marker: "overflow", label: "overflow warnings", attention: true },
    { marker: "fontnote", label: "notes" },
  ];
  const badges = countBadges(
    ['[out] ECHO: "x: overflow: text may overflow"', '[out] ECHO: "x: fontnote: using a fallback font"'],
    notices
  );
  assert.deepEqual(badges.map(badgeVariant), ["warn", "secondary"]);
});

test("badgeVariant: an assert badge is always destructive, regardless of the attention field", () => {
  assert.equal(badgeVariant({ key: "assert", label: "asserts", count: 1 }), "destructive");
});

// UX plan item 5.1b: a short console (no failure, few VISIBLE cards — the
// attention + plain-notice card totals actually shown, not the raw
// diagnostics list) opens compact on mobile instead of full-screen.
test("isCompactConsoleContent: true for a short, uneventful render", () => {
  assert.equal(
    isCompactConsoleContent({ hasFriendlyError: false, attentionCount: 0, noticeCardCount: 1 }),
    true
  );
  // Zero visible cards (e.g. "no unresolved issues") is short too.
  assert.equal(
    isCompactConsoleContent({ hasFriendlyError: false, attentionCount: 0, noticeCardCount: 0 }),
    true
  );
  // Split across both card kinds, still short (≤ 2 total).
  assert.equal(
    isCompactConsoleContent({ hasFriendlyError: false, attentionCount: 1, noticeCardCount: 1 }),
    true
  );
});

test("isCompactConsoleContent: false once there's a failure or the visible cards add up past 2", () => {
  assert.equal(
    isCompactConsoleContent({ hasFriendlyError: true, attentionCount: 0, noticeCardCount: 1 }),
    false
  );
  assert.equal(
    isCompactConsoleContent({ hasFriendlyError: false, attentionCount: 3, noticeCardCount: 0 }),
    false
  );
  assert.equal(
    isCompactConsoleContent({ hasFriendlyError: false, attentionCount: 0, noticeCardCount: 3 }),
    false
  );
});

// "Notices surface" directive: raw notice text (still carrying the
// classify()-stripped echo's own design-id context and any Fontconfig
// `:style=…` wire-format properties) must become plain language before it
// reaches the primary Notices card — see cleanNoticeText's own doc.
test("cleanNoticeText: strips the leading internal design-id prefix", () => {
  assert.equal(
    cleanNoticeText("door_sign: the label text is tall and may overflow"),
    "the label text is tall and may overflow"
  );
});

test("cleanNoticeText: reduces a quoted Fontconfig family to just its name", () => {
  assert.equal(
    cleanNoticeText("font 'Atkinson Hyperlegible:style=Regular' is a fallback"),
    "font 'Atkinson Hyperlegible' is a fallback"
  );
  // Double-quoted, and chained properties (:style=...:weight=...).
  assert.equal(
    cleanNoticeText('using "DIN 32986 Taktil Positiv:style=Regular:weight=Bold" instead'),
    'using "DIN 32986 Taktil Positiv" instead'
  );
});

test("cleanNoticeText: strips the design-id prefix AND Fontconfig properties together", () => {
  assert.equal(
    cleanNoticeText(
      "door_sign: font 'Atkinson Hyperlegible:style=Regular' is a fallback, not the DIN profile face 'DIN 32986 Taktil Positiv:style=Regular'"
    ),
    "font 'Atkinson Hyperlegible' is a fallback, not the DIN profile face 'DIN 32986 Taktil Positiv'"
  );
});

test("cleanNoticeText: a plain font name with no Fontconfig properties is untouched", () => {
  assert.equal(cleanNoticeText("font 'Atkinson Hyperlegible' is fine"), "font 'Atkinson Hyperlegible' is fine");
});

test("cleanNoticeText: text with no design-id prefix (nothing to strip) is unchanged", () => {
  assert.equal(cleanNoticeText("no leading identifier here"), "no leading identifier here");
});

// noticeCards: the plain-language cards the Notices tab's primary surface
// renders — one per unique notice NOT already covered by an AttentionItems
// card (i.e. its category isn't `attention`-flagged).
test("noticeCards: a non-attention category becomes a plain, cleaned card", () => {
  const notices = [{ marker: "fontnote", label: "font notes" }];
  const diagnostics = parseDiagnostics(
    ['[out] ECHO: "door_sign: fontnote: font \'Atkinson Hyperlegible:style=Regular\' is a fallback"'],
    notices
  );
  const badges = countBadges(
    ['[out] ECHO: "door_sign: fontnote: font \'Atkinson Hyperlegible:style=Regular\' is a fallback"'],
    notices
  );
  assert.deepEqual(noticeCards(diagnostics, badges), [
    { marker: "fontnote", label: "font notes", text: "font 'Atkinson Hyperlegible' is a fallback" },
  ]);
});

test("noticeCards: an attention-flagged category is excluded (AttentionItems already covers it)", () => {
  const notices = [{ marker: "overflow", label: "overflow warnings", attention: true }];
  const diagnostics = parseDiagnostics(['[out] ECHO: "x: overflow: text may overflow"'], notices);
  const badges = countBadges(['[out] ECHO: "x: overflow: text may overflow"'], notices);
  assert.deepEqual(noticeCards(diagnostics, badges), []);
});

test("noticeCards: warnings and asserts never become plain notice cards", () => {
  const diagnostics = parseDiagnostics(
    ["[err] WARNING: Can't open font 'Brand Display', using fallback", "[err] ERROR: Assertion 'x' failed"],
    []
  );
  assert.deepEqual(noticeCards(diagnostics, []), []);
});

// THE core guarantee (round: "Notices surface" directive, requirement 3): a
// non-zero notice badge is never shown over an empty primary surface. Mixed
// render — one attention category, one plain one — both badges non-zero;
// the attention one is backed by an `attention` list entry (simulated here
// the same way OutputConsole derives it — see diagnostics.ts's own doc on
// why that's always in sync), the plain one by a `noticeCards` card.
test("guarantee: every non-zero, currently-displayed notice badge is backed by a visible card", () => {
  const notices = [
    { marker: "overflow", label: "overflow warnings", attention: true },
    { marker: "fontnote", label: "font notes" },
  ];
  const log = [
    '[out] ECHO: "door_sign: overflow: text may overflow"',
    '[out] ECHO: "door_sign: fontnote: font \'Atkinson Hyperlegible:style=Regular\' is a fallback"',
  ];
  const diagnostics = parseDiagnostics(log, notices);
  const rawBadges = countBadges(log, notices);
  // OutputConsole builds `attention` from readiness.ts's deriveAttention;
  // simulate its one relevant guarantee here — every attention-flagged,
  // pending, non-subsumed category gets an `attention` list entry.
  const attention = rawBadges.filter((b) => b.attention).map((b) => ({ kind: "notice", marker: b.key.slice(7) }));
  const visibleNoticeKeys = new Set(attention.map((a) => `notice:${a.marker}`));
  const badges = displayBadges(rawBadges, visibleNoticeKeys);
  const cards = noticeCards(diagnostics, rawBadges);

  for (const b of badges) {
    if (b.key === "assert" || b.count <= 0) continue;
    const backedByAttention = attention.some((a) => `notice:${a.marker}` === b.key);
    const backedByCard = cards.some((c) => `notice:${c.marker}` === b.key);
    assert.ok(
      backedByAttention || backedByCard,
      `badge ${b.key} (count ${b.count}) has no visible card backing it`
    );
  }
  // Concretely for this fixture: two non-zero badges, two visible cards
  // between the two surfaces (one attention item, one plain notice card).
  assert.equal(badges.filter((b) => b.count > 0).length, 2);
  assert.equal(attention.length + cards.length, 2);
});
