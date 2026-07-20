// Tests the pure production-readiness derivation behind PR13's attention
// surfacing (src/lib/readiness.ts): deriveAttention's font-fallback + flagged-
// notice detection, and readinessState's precedence. Mirrors
// tests/gettingStarted.test.mjs's own style (a synthetic baseline, overrides
// per test) — no DOM/React harness needed since this module is dependency-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAttention, readinessState, noticeAttentionCount } from "../src/lib/readiness.ts";

// A minimal font param, matching gen-schema's real shape closely enough for
// isVisible/familyOf/normalizeFamily to behave identically to production.
function fontParam(overrides = {}) {
  return {
    name: "font",
    section: "Text",
    description: "Font",
    help: "Font",
    type: "string",
    default: "Liberation Sans",
    isFont: true,
    ...overrides,
  };
}

const LOADED = new Set(["liberation sans", "dejavu sans"]);

test("deriveAttention: a loaded font family produces no attention item", () => {
  const items = deriveAttention({
    params: [fontParam()],
    values: { font: "Liberation Sans" },
    availableFontFamilies: LOADED,
    notices: [],
  });
  assert.deepEqual(items, []);
});

test("deriveAttention: an empty font value produces no attention item (a cleared control, not a missing font)", () => {
  const items = deriveAttention({
    params: [fontParam()],
    values: { font: "" },
    availableFontFamilies: LOADED,
    notices: [],
  });
  assert.deepEqual(items, []);
});

test("deriveAttention: a missing font family produces a font-fallback item naming the param and family", () => {
  const items = deriveAttention({
    params: [fontParam()],
    values: { font: "No Such Font" },
    availableFontFamilies: LOADED,
    notices: [],
  });
  assert.deepEqual(items, [{ kind: "font-fallback", param: "font", family: "No Such Font", fallback: null }]);
});

test("deriveAttention: a string font param's fallback grafts a provided fontSuggestion onto the current value", () => {
  const items = deriveAttention({
    params: [fontParam()],
    values: { font: "No Such Font:style=Bold" },
    availableFontFamilies: LOADED,
    fontSuggestion: "Liberation Sans",
    notices: [],
  });
  assert.deepEqual(items, [
    {
      kind: "font-fallback",
      param: "font",
      family: "No Such Font",
      fallback: { value: "Liberation Sans:style=Bold", label: "Liberation Sans" },
    },
  ]);
});

test("deriveAttention: family matching is case/space-insensitive (normalizeFamily)", () => {
  const items = deriveAttention({
    params: [fontParam()],
    values: { font: "  LIBERATION SANS  :style=Bold" },
    availableFontFamilies: LOADED,
    notices: [],
  });
  assert.deepEqual(items, []);
});

test("deriveAttention: multiple missing font params each produce their own item, in param order", () => {
  const items = deriveAttention({
    params: [
      fontParam({ name: "titleFont" }),
      fontParam({ name: "bodyFont" }),
    ],
    values: { titleFont: "Nope One", bodyFont: "Nope Two" },
    availableFontFamilies: LOADED,
    notices: [],
  });
  assert.deepEqual(items, [
    { kind: "font-fallback", param: "titleFont", family: "Nope One", fallback: null },
    { kind: "font-fallback", param: "bodyFont", family: "Nope Two", fallback: null },
  ]);
});

test("deriveAttention: a non-font param is never flagged, whatever its value", () => {
  const items = deriveAttention({
    params: [{ name: "label", section: "Text", description: "Label", help: "Label", type: "string", default: "" }],
    values: { label: "No Such Font" },
    availableFontFamilies: LOADED,
    notices: [],
  });
  assert.deepEqual(items, []);
});

test("deriveAttention: an enum font param is checked the same as a string one", () => {
  const items = deriveAttention({
    params: [
      {
        name: "font",
        section: "Text",
        description: "Font",
        help: "Font",
        type: "enum",
        default: "Liberation Sans",
        isFont: true,
        choices: [{ value: "Liberation Sans", label: "Liberation Sans" }, { value: "Nope", label: "Nope" }],
      },
    ],
    values: { font: "Nope" },
    availableFontFamilies: LOADED,
    notices: [],
  });
  // The enum's other loaded choice ("Liberation Sans") becomes the one-click
  // fallback target — fontChoices.ts's fontFallback picks the first listed
  // choice whose family is in the available set.
  assert.deepEqual(items, [
    {
      kind: "font-fallback",
      param: "font",
      family: "Nope",
      fallback: { value: "Liberation Sans", label: "Liberation Sans" },
    },
  ]);
});

test("deriveAttention: an empty availableFontFamilies set skips font checking entirely (we can't be authoritative)", () => {
  const items = deriveAttention({
    params: [fontParam()],
    values: { font: "No Such Font" },
    availableFontFamilies: new Set(),
    notices: [],
  });
  assert.deepEqual(items, []);
});

test("deriveAttention: a font param hidden by @showIf is never flagged", () => {
  const items = deriveAttention({
    params: [fontParam({ showIf: "show_text" })],
    values: { show_text: false, font: "No Such Font" },
    availableFontFamilies: LOADED,
    notices: [],
  });
  assert.deepEqual(items, []);
});

test("deriveAttention: a font param demoted to @advanced (essentials-hidden) is STILL flagged — the view doesn't decide visibility here", () => {
  // No `advanced` filtering happens in readiness.ts at all — see its own doc:
  // the essentials/all settings view is UI-only, the param's value is still
  // sent to OpenSCAD unchanged whichever view is showing.
  const items = deriveAttention({
    params: [fontParam({ advanced: true })],
    values: { font: "No Such Font" },
    availableFontFamilies: LOADED,
    notices: [],
  });
  assert.deepEqual(items, [{ kind: "font-fallback", param: "font", family: "No Such Font", fallback: null }]);
});

test("deriveAttention: a flagged notice category with a pending notice produces a notice item", () => {
  const items = deriveAttention({
    params: [],
    values: {},
    availableFontFamilies: new Set(),
    notices: [{ marker: "alert", label: "alerts", attention: true, count: 2 }],
  });
  assert.deepEqual(items, [{ kind: "notice", marker: "alert", label: "alerts", count: 2 }]);
});

test("deriveAttention: a notice item's label uses labelOne when the pending count is exactly 1", () => {
  const items = deriveAttention({
    params: [],
    values: {},
    availableFontFamilies: new Set(),
    notices: [{ marker: "alert", label: "alerts", labelOne: "alert", attention: true, count: 1 }],
  });
  assert.deepEqual(items, [{ kind: "notice", marker: "alert", label: "alert", count: 1 }]);
});

test("deriveAttention: a notice item's label stays plural when the pending count isn't 1, even with labelOne configured", () => {
  const items = deriveAttention({
    params: [],
    values: {},
    availableFontFamilies: new Set(),
    notices: [{ marker: "alert", label: "alerts", labelOne: "alert", attention: true, count: 3 }],
  });
  assert.deepEqual(items, [{ kind: "notice", marker: "alert", label: "alerts", count: 3 }]);
});

test("deriveAttention: an unflagged notice category is never surfaced, however many are pending", () => {
  const items = deriveAttention({
    params: [],
    values: {},
    availableFontFamilies: new Set(),
    notices: [{ marker: "note", label: "notes", attention: false, count: 5 }],
  });
  assert.deepEqual(items, []);
});

test("deriveAttention: a flagged category with nothing pending (count 0) is not surfaced", () => {
  const items = deriveAttention({
    params: [],
    values: {},
    availableFontFamilies: new Set(),
    notices: [{ marker: "alert", label: "alerts", attention: true, count: 0 }],
  });
  assert.deepEqual(items, []);
});

test("deriveAttention: font fallbacks come before flagged notices, and notices keep config order", () => {
  const items = deriveAttention({
    params: [fontParam()],
    values: { font: "No Such Font" },
    availableFontFamilies: LOADED,
    notices: [
      { marker: "alert", label: "alerts", attention: true, count: 1 },
      { marker: "warn", label: "warnings", attention: true, count: 3 },
    ],
  });
  assert.deepEqual(items.map((i) => i.kind), ["font-fallback", "notice", "notice"]);
  assert.deepEqual(items[1], { kind: "notice", marker: "alert", label: "alerts", count: 1 });
  assert.deepEqual(items[2], { kind: "notice", marker: "warn", label: "warnings", count: 3 });
});

// Wave 1 (round-5): `subsumedByFont` — a notice category marked as a
// SYMPTOM of a missing font is excluded from the attention list/count while
// a font-fallback item is also present, but counts normally once no font is
// missing. See src/lib/readiness.ts's deriveAttention own doc.
test("deriveAttention: a subsumedByFont notice is excluded from the list while a font-fallback item is also present", () => {
  const items = deriveAttention({
    params: [fontParam()],
    values: { font: "No Such Font" },
    availableFontFamilies: LOADED,
    notices: [{ marker: "spacing", label: "spacing notes", attention: true, count: 1, subsumedByFont: true }],
  });
  assert.deepEqual(items, [{ kind: "font-fallback", param: "font", family: "No Such Font", fallback: null }]);
});

test("deriveAttention: a subsumedByFont notice counts normally once no font-fallback item is present", () => {
  const items = deriveAttention({
    params: [fontParam()],
    values: { font: "Liberation Sans" }, // loaded — no font-fallback item
    availableFontFamilies: LOADED,
    notices: [{ marker: "spacing", label: "spacing notes", attention: true, count: 1, subsumedByFont: true }],
  });
  assert.deepEqual(items, [{ kind: "notice", marker: "spacing", label: "spacing notes", count: 1 }]);
});

test("deriveAttention: a subsumedByFont notice with no font param declared at all still counts (nothing to subsume it)", () => {
  const items = deriveAttention({
    params: [],
    values: {},
    availableFontFamilies: new Set(),
    notices: [{ marker: "spacing", label: "spacing notes", attention: true, count: 1, subsumedByFont: true }],
  });
  assert.deepEqual(items, [{ kind: "notice", marker: "spacing", label: "spacing notes", count: 1 }]);
});

test("deriveAttention: an unflagged-subsumedByFont notice is unaffected by a font-fallback item — both surface", () => {
  const items = deriveAttention({
    params: [fontParam()],
    values: { font: "No Such Font" },
    availableFontFamilies: LOADED,
    notices: [{ marker: "alert", label: "alerts", attention: true, count: 2 }],
  });
  assert.deepEqual(items, [
    { kind: "font-fallback", param: "font", family: "No Such Font", fallback: null },
    { kind: "notice", marker: "alert", label: "alerts", count: 2 },
  ]);
});

test("deriveAttention: subsumedByFont only excludes when the category is ALSO attention-flagged and pending — otherwise it's simply never surfaced anyway", () => {
  const items = deriveAttention({
    params: [fontParam()],
    values: { font: "No Such Font" },
    availableFontFamilies: LOADED,
    notices: [{ marker: "note", label: "notes", attention: false, count: 5, subsumedByFont: true }],
  });
  assert.deepEqual(items, [{ kind: "font-fallback", param: "font", family: "No Such Font", fallback: null }]);
});

// Round-5 review, functional item 10: a design with 2+ `@font` params can
// have one font resolved and a DIFFERENT one missing this render — subsuming
// a `subsumedByFont` notice in that case would hide a real gap about the
// resolved font behind an unrelated one's fallback. The guard only subsumes
// when there's no such ambiguity (see deriveAttention's own "UNAMBIGUOUS-
// SINGLE-FONT GUARD" doc): exactly one font-bearing param declared, OR
// exactly one font-fallback item actually produced this render.
test("deriveAttention: a subsumedByFont notice counts normally (NOT excluded) when 2+ font params are simultaneously missing — ambiguous which one the notice is about", () => {
  const items = deriveAttention({
    params: [fontParam({ name: "titleFont" }), fontParam({ name: "bodyFont" })],
    values: { titleFont: "Nope One", bodyFont: "Nope Two" },
    availableFontFamilies: LOADED,
    notices: [{ marker: "spacing", label: "spacing notes", attention: true, count: 1, subsumedByFont: true }],
  });
  assert.deepEqual(items, [
    { kind: "font-fallback", param: "titleFont", family: "Nope One", fallback: null },
    { kind: "font-fallback", param: "bodyFont", family: "Nope Two", fallback: null },
    { kind: "notice", marker: "spacing", label: "spacing notes", count: 1 },
  ]);
});

test("deriveAttention: a subsumedByFont notice IS still excluded when the design has 2+ font params but only ONE has a fallback item this render (unambiguous — only one candidate)", () => {
  const items = deriveAttention({
    params: [fontParam({ name: "titleFont" }), fontParam({ name: "bodyFont" })],
    values: { titleFont: "No Such Font", bodyFont: "Liberation Sans" }, // bodyFont resolved
    availableFontFamilies: LOADED,
    notices: [{ marker: "spacing", label: "spacing notes", attention: true, count: 1, subsumedByFont: true }],
  });
  assert.deepEqual(items, [{ kind: "font-fallback", param: "titleFont", family: "No Such Font", fallback: null }]);
});

test("deriveAttention: exactly one declared font param stays unambiguous (matches pre-existing single-font behavior)", () => {
  const items = deriveAttention({
    params: [fontParam()],
    values: { font: "No Such Font" },
    availableFontFamilies: LOADED,
    notices: [{ marker: "spacing", label: "spacing notes", attention: true, count: 1, subsumedByFont: true }],
  });
  assert.deepEqual(items, [{ kind: "font-fallback", param: "font", family: "No Such Font", fallback: null }]);
});

test("readinessState: null renderOk (nothing landed yet) reads 'building', regardless of attention", () => {
  assert.equal(readinessState(null, []), "building");
  assert.equal(readinessState(null, [{ kind: "notice", marker: "a", label: "a", count: 1 }]), "building");
});

test("readinessState: a failed render reads 'failed' even with no attention items", () => {
  assert.equal(readinessState(false, []), "failed");
});

test("readinessState: precedence — failed beats attention", () => {
  assert.equal(readinessState(false, [{ kind: "notice", marker: "a", label: "a", count: 1 }]), "failed");
});

test("readinessState: a successful render with attention items reads 'attention', not 'ready'", () => {
  assert.equal(
    readinessState(true, [{ kind: "font-fallback", param: "font", family: "X" }]),
    "attention"
  );
});

test("readinessState: a successful render with no attention items reads 'ready'", () => {
  assert.equal(readinessState(true, []), "ready");
});

// Round-6, item 5: noticeAttentionCount() — the header notice bell's own
// count, decoupled from readiness/attention entirely (the Review chip's dot
// is the sole readiness indicator; this counts genuine notice CARDS only).
test("noticeAttentionCount: an empty attention list counts 0", () => {
  assert.equal(noticeAttentionCount([]), 0);
});

test("noticeAttentionCount: a font-fallback item alone (the readiness-only case) counts 0, not 1 — the bell must read neutral for a font problem the Review dot already carries", () => {
  assert.equal(noticeAttentionCount([{ kind: "font-fallback", param: "font", family: "X", fallback: null }]), 0);
});

test("noticeAttentionCount: a notice item counts 1", () => {
  assert.equal(noticeAttentionCount([{ kind: "notice", marker: "alert", label: "1 alert", count: 1 }]), 1);
});

test("noticeAttentionCount: counts ONLY notice-kind items, ignoring font-fallback items mixed in", () => {
  assert.equal(
    noticeAttentionCount([
      { kind: "font-fallback", param: "font", family: "X", fallback: null },
      { kind: "notice", marker: "alert", label: "1 alert", count: 1 },
      { kind: "notice", marker: "note", label: "1 note", count: 1 },
    ]),
    2
  );
});
