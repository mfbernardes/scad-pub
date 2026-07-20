// Tests the pure step-derivation logic behind the QuickStart navigation
// (src/lib/quickStart.ts): which @step's are currently visible, which one
// should be "current" after the previous one disappears, the "Also
// available" un-stepped tail, and the top-level availability gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  visibleSteps,
  unsteppedSectionNames,
  hasVisibleUnstepped,
  resolveCurrentStep,
  quickStartAvailable,
  currentStepFromIntersections,
  REVIEW_STEP_ID,
} from "../src/lib/quickStart.ts";

function numberParam(name, { section = "Main", advanced, showIf, description = name, help = "" } = {}) {
  return { name, description, help, section, type: "number", default: 0, advanced, showIf };
}

// A minimal Design-shaped fixture: only the fields quickStart.ts actually
// reads (params, sections, steps) — structurally sufficient for these tests,
// which run untyped under node:test.
function design({ params, sections, steps }) {
  return {
    id: "fixture",
    label: "Fixture",
    file: "fixture.scad",
    presets: [],
    sections,
    steps,
    params,
  };
}

test("visibleSteps: a step whose only param is showIf-hidden is skipped entirely", () => {
  const d = design({
    sections: ["A", "B"],
    steps: [
      { id: "a", label: "A", sections: ["A"] },
      { id: "b", label: "B", sections: ["B"] },
    ],
    params: [
      numberParam("a1", { section: "A", showIf: "on" }),
      numberParam("b1", { section: "B" }),
    ],
  });
  const visible = visibleSteps(d, { on: false }, "essentials");
  assert.deepEqual(visible.map((s) => s.id), ["b"]);
});

test("visibleSteps: a value change reveals a previously all-hidden step", () => {
  const d = design({
    sections: ["A", "B"],
    steps: [
      { id: "a", label: "A", sections: ["A"] },
      { id: "b", label: "B", sections: ["B"] },
    ],
    params: [
      numberParam("a1", { section: "A", showIf: "on" }),
      numberParam("b1", { section: "B" }),
    ],
  });
  assert.deepEqual(visibleSteps(d, { on: false }, "essentials").map((s) => s.id), ["b"]);
  assert.deepEqual(visibleSteps(d, { on: true }, "essentials").map((s) => s.id), ["a", "b"]);
});

test("visibleSteps: a step whose only param is @advanced is hidden in essentials, shown in all", () => {
  const d = design({
    sections: ["A", "B"],
    steps: [
      { id: "a", label: "A", sections: ["A"] },
      { id: "b", label: "B", sections: ["B"] },
    ],
    params: [
      numberParam("a1", { section: "A", advanced: true }),
      numberParam("b1", { section: "B" }),
    ],
  });
  assert.deepEqual(visibleSteps(d, {}, "essentials").map((s) => s.id), ["b"]);
  assert.deepEqual(visibleSteps(d, {}, "all").map((s) => s.id), ["a", "b"]);
});

test("visibleSteps: a design with no @step at all yields no steps", () => {
  const d = design({ sections: ["Main"], steps: undefined, params: [numberParam("w")] });
  assert.deepEqual(visibleSteps(d, {}, "essentials"), []);
});

test("unsteppedSectionNames: sections not covered by any step, in design order", () => {
  const d = design({
    sections: ["A", "B", "C"],
    steps: [{ id: "a", label: "A", sections: ["A"] }],
    params: [],
  });
  assert.deepEqual(unsteppedSectionNames(d), ["B", "C"]);
});

test("hasVisibleUnstepped: false when every un-stepped section is fully @advanced in essentials", () => {
  const d = design({
    sections: ["A", "Quality"],
    steps: [{ id: "a", label: "A", sections: ["A"] }],
    params: [
      numberParam("a1", { section: "A" }),
      numberParam("facet", { section: "Quality", advanced: true }),
    ],
  });
  assert.equal(hasVisibleUnstepped(d, {}, "essentials"), false);
  assert.equal(hasVisibleUnstepped(d, {}, "all"), true);
});

test("hasVisibleUnstepped: true when an un-stepped section has a non-advanced, showIf-visible param", () => {
  const d = design({
    sections: ["A", "Extra"],
    steps: [{ id: "a", label: "A", sections: ["A"] }],
    params: [numberParam("a1", { section: "A" }), numberParam("e1", { section: "Extra" })],
  });
  assert.equal(hasVisibleUnstepped(d, {}, "essentials"), true);
});

test("resolveCurrentStep: the previously-current step stays current when it's still visible", () => {
  const d = design({
    sections: ["A", "B"],
    steps: [
      { id: "a", label: "A", sections: ["A"] },
      { id: "b", label: "B", sections: ["B"] },
    ],
    params: [numberParam("a1", { section: "A" }), numberParam("b1", { section: "B" })],
  });
  const visible = visibleSteps(d, {}, "essentials");
  assert.equal(resolveCurrentStep(d, visible, "b"), "b");
});

test("resolveCurrentStep: falls back to the nearest remaining step when the current one disappears", () => {
  const d = design({
    sections: ["A", "B", "C"],
    steps: [
      { id: "a", label: "A", sections: ["A"] },
      { id: "b", label: "B", sections: ["B"] },
      { id: "c", label: "C", sections: ["C"] },
    ],
    params: [
      numberParam("a1", { section: "A" }),
      numberParam("b1", { section: "B", showIf: "on" }), // will be hidden
      numberParam("c1", { section: "C" }),
    ],
  });
  // "b" (index 1) disappears; "a" (index 0) and "c" (index 2) are equidistant
  // (both 1 away) — the loop keeps the first one found, "a".
  const visible = visibleSteps(d, { on: false }, "essentials");
  assert.deepEqual(visible.map((s) => s.id), ["a", "c"]);
  assert.equal(resolveCurrentStep(d, visible, "b"), "a");
});

test("resolveCurrentStep: falls back to the nearest remaining step, favoring the closer side", () => {
  const d = design({
    sections: ["A", "B", "C", "D"],
    steps: [
      { id: "a", label: "A", sections: ["A"] },
      { id: "b", label: "B", sections: ["B"] },
      { id: "c", label: "C", sections: ["C"] },
      { id: "d", label: "D", sections: ["D"] },
    ],
    params: [
      numberParam("a1", { section: "A" }),
      numberParam("b1", { section: "B" }),
      numberParam("c1", { section: "C", showIf: "on" }), // will be hidden
      numberParam("d1", { section: "D" }),
    ],
  });
  const visible = visibleSteps(d, { on: false }, "essentials");
  assert.deepEqual(visible.map((s) => s.id), ["a", "b", "d"]);
  // "c" (index 2) disappears; "b" (index 1) is 1 away, "d" (index 3) is 1 away
  // too — still a tie, first-found ("b") wins, matching the loop order.
  assert.equal(resolveCurrentStep(d, visible, "c"), "b");
});

test("resolveCurrentStep: REVIEW_STEP_ID always stays current (the Review chip is never hidden)", () => {
  const d = design({
    sections: ["A"],
    steps: [{ id: "a", label: "A", sections: ["A"] }],
    params: [numberParam("a1", { section: "A" })],
  });
  const visible = visibleSteps(d, {}, "essentials");
  assert.equal(resolveCurrentStep(d, visible, REVIEW_STEP_ID), REVIEW_STEP_ID);
});

test("resolveCurrentStep: falls back to the Review chip when no step is visible at all", () => {
  const d = design({
    sections: ["A"],
    steps: [{ id: "a", label: "A", sections: ["A"] }],
    params: [numberParam("a1", { section: "A", showIf: "on" })],
  });
  const visible = visibleSteps(d, { on: false }, "essentials");
  assert.deepEqual(visible, []);
  assert.equal(resolveCurrentStep(d, visible, "a"), REVIEW_STEP_ID);
});

test("resolveCurrentStep: a null/stale currentId (e.g. first mount) lands on the first visible step", () => {
  const d = design({
    sections: ["A", "B"],
    steps: [
      { id: "a", label: "A", sections: ["A"] },
      { id: "b", label: "B", sections: ["B"] },
    ],
    params: [numberParam("a1", { section: "A" }), numberParam("b1", { section: "B" })],
  });
  const visible = visibleSteps(d, {}, "essentials");
  assert.equal(resolveCurrentStep(d, visible, null), "a");
  assert.equal(resolveCurrentStep(d, visible, "not-a-real-id"), "a");
});

test("currentStepFromIntersections: returns the last-in-order id that's intersecting", () => {
  const order = ["a", "b", "c", REVIEW_STEP_ID];
  assert.equal(currentStepFromIntersections(order, new Set(["a"])), "a");
  // "b" and "c" both intersecting the band at once (a short group can fit
  // entirely inside it) — the LATER one in declared order wins, matching the
  // step whose heading has scrolled furthest past the top.
  assert.equal(currentStepFromIntersections(order, new Set(["b", "c"])), "c");
  assert.equal(currentStepFromIntersections(order, new Set([REVIEW_STEP_ID, "a"])), REVIEW_STEP_ID);
});

test("currentStepFromIntersections: null when nothing intersects (caller keeps the previous current)", () => {
  assert.equal(currentStepFromIntersections(["a", "b"], new Set()), null);
  assert.equal(currentStepFromIntersections(["a", "b"], new Set(["not-in-order"])), null);
});

test("currentStepFromIntersections: an empty order always yields null", () => {
  assert.equal(currentStepFromIntersections([], new Set(["a"])), null);
});

test("quickStartAvailable: requires guided experience, essentials view, a stepped design, and ui.quickStart", () => {
  const stepped = design({
    sections: ["A"],
    steps: [{ id: "a", label: "A", sections: ["A"] }],
    params: [numberParam("a1", { section: "A" })],
  });
  const unstepped = design({ sections: ["A"], steps: undefined, params: [numberParam("a1")] });

  assert.equal(quickStartAvailable(stepped, "guided", "essentials", true), true);
  assert.equal(quickStartAvailable(stepped, "standard", "essentials", true), false, "standard experience never shows QuickStart");
  assert.equal(quickStartAvailable(stepped, "guided", "all", true), false, "All settings always shows the classic form");
  assert.equal(quickStartAvailable(unstepped, "guided", "essentials", true), false, "a design with no @step is never active");
  assert.equal(quickStartAvailable(stepped, "guided", "essentials", false), false, "ui.quickStart: false opts out");
});
