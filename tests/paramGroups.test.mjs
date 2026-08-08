// Tests visibleGroups, the shared visible-section computation behind both the
// parameter form (ParamForm) and the "Jump to section" navigator
// (ParamPanel/SheetTabs), so the two can never disagree on which sections show.
import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleGroups, remapOpenSections } from "../src/lib/paramGroups.ts";

function param(name, section, overrides = {}) {
  return {
    name,
    section,
    description: name,
    help: name,
    type: "number",
    default: 0,
    ...overrides,
  };
}

function design(sections, params) {
  return { id: "d", label: "D", file: "d.scad", presets: [], sections, params };
}

test("visibleGroups: groups params by section, in declaration order", () => {
  const d = design(
    ["A", "B"],
    [param("a1", "A"), param("b1", "B"), param("a2", "A")]
  );
  const groups = visibleGroups(d, {});
  assert.deepEqual(
    groups.map((g) => g.section),
    ["A", "B"]
  );
  assert.deepEqual(
    groups[0].params.map((p) => p.name),
    ["a1", "a2"]
  );
});

test("visibleGroups: advanced params hidden when !showAdvanced", () => {
  const d = design(
    ["A", "B"],
    [param("a1", "A"), param("b1", "B", { advanced: true })]
  );
  // With advanced shown, both sections appear.
  assert.deepEqual(
    visibleGroups(d, {}, { showAdvanced: true }).map((g) => g.section),
    ["A", "B"]
  );
  // Hidden: B's only param is advanced, so the whole section drops out.
  assert.deepEqual(
    visibleGroups(d, {}, { showAdvanced: false }).map((g) => g.section),
    ["A"]
  );
});

test("visibleGroups: showIf-hidden params are dropped", () => {
  const d = design(
    ["A", "B"],
    [
      param("mode", "A", { type: "boolean", default: false }),
      param("tuning", "B", { showIf: "mode" }),
    ]
  );
  // mode off -> B's param hidden -> section B dropped.
  assert.deepEqual(
    visibleGroups(d, { mode: false }).map((g) => g.section),
    ["A"]
  );
  // mode on -> B visible again.
  assert.deepEqual(
    visibleGroups(d, { mode: true }).map((g) => g.section),
    ["A", "B"]
  );
});

test("visibleGroups: search filters by name, description, or help", () => {
  const d = design(
    ["A", "B", "C"],
    [
      param("width", "A", { description: "Overall width" }),
      param("depth", "B", { description: "Overall depth", help: "the widthwise depth" }),
      param("height", "C", { description: "Overall height" }),
    ]
  );
  // "width" matches A by name and B by help text; C has no match and drops.
  assert.deepEqual(
    visibleGroups(d, {}, { search: "width" }).map((g) => g.section),
    ["A", "B"]
  );
  // Case-insensitive.
  assert.deepEqual(
    visibleGroups(d, {}, { search: "HEIGHT" }).map((g) => g.section),
    ["C"]
  );
});

test("visibleGroups: empty groups are dropped", () => {
  // A section declared with no params (or none surviving the filter) never
  // appears in the result.
  const d = design(["A", "Empty", "B"], [param("a1", "A"), param("b1", "B")]);
  assert.deepEqual(
    visibleGroups(d, {}).map((g) => g.section),
    ["A", "B"]
  );
});

test("remapOpenSections: carries a section's open/closed state to its translated name at the same position", () => {
  const prev = { Main: true, Advanced: false };
  const next = remapOpenSections(["Haupt", "Erweitert"], ["Main", "Advanced"], prev, new Set());
  assert.deepEqual(next, { Haupt: true, Erweitert: false });
});

test("remapOpenSections: a position missing from the previous map falls back to defaultClosed", () => {
  // Simulates a fresh design with no prior state at all — every position is
  // 'missing', so every section should get its collapsed-default state.
  const next = remapOpenSections(["A", "B"], [], {}, new Set(["B"]));
  assert.deepEqual(next, { A: true, B: false });
});

test("remapOpenSections: an out-of-range position (fewer previous sections) falls back to defaultClosed", () => {
  const prev = { Main: false };
  const next = remapOpenSections(["Main", "Extra"], ["Main"], prev, new Set());
  assert.deepEqual(next, { Main: false, Extra: true });
});
