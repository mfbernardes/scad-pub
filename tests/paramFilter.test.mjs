// Tests the essentials/all settings-view filter (src/lib/paramFilter.ts):
// isShown's composition with @showIf visibility, and the hidden-count/
// hidden-diff/hidden-search-match helpers the Customize tab's chrome
// (CustomizeTab.tsx, ResetButton.tsx) reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isShown,
  hiddenAdvancedParams,
  hiddenAdvancedCount,
  hiddenAdvancedDiff,
  paramMatchesQuery,
  hiddenSearchMatches,
} from "../src/lib/paramFilter.ts";

function numberParam(name, { advanced, showIf, description = name, help = "", section = "Main" } = {}) {
  return { name, description, help, section, type: "number", default: 0, advanced, showIf };
}

test("isShown: a plain (non-advanced) param is shown in both views", () => {
  const p = numberParam("width");
  assert.equal(isShown(p, {}, "essentials"), true);
  assert.equal(isShown(p, {}, "all"), true);
});

test("isShown: an @advanced param is hidden in essentials, shown in all", () => {
  const p = numberParam("facet_angle", { advanced: true });
  assert.equal(isShown(p, {}, "essentials"), false);
  assert.equal(isShown(p, {}, "all"), true);
});

test("isShown: composes with @showIf — a showIf=false param stays hidden even in the all view", () => {
  const p = numberParam("hole_diameter", { showIf: "hole" });
  assert.equal(isShown(p, { hole: false }, "all"), false);
  assert.equal(isShown(p, { hole: true }, "all"), true);
});

test("isShown: an @advanced param whose @showIf is false is hidden in essentials for the showIf reason, not (only) the view", () => {
  const p = numberParam("advanced_conditional", { advanced: true, showIf: "on" });
  assert.equal(isShown(p, { on: false }, "essentials"), false);
  assert.equal(isShown(p, { on: false }, "all"), false);
  assert.equal(isShown(p, { on: true }, "essentials"), false); // still hidden — advanced
  assert.equal(isShown(p, { on: true }, "all"), true);
});

test("hiddenAdvancedParams: only @showIf-visible advanced params count as hidden BY THE VIEW", () => {
  const params = [
    numberParam("a", { advanced: true }),
    numberParam("b", { advanced: true, showIf: "on" }),
    numberParam("c"), // not advanced
  ];
  // "b" is advanced but its showIf is currently false — it's hidden for that
  // reason, not because of the view, so it must NOT be counted here.
  const hidden = hiddenAdvancedParams(params, { on: false }, "essentials");
  assert.deepEqual(hidden.map((p) => p.name), ["a"]);
});

test("hiddenAdvancedParams / hiddenAdvancedCount: always empty in the all view", () => {
  const params = [numberParam("a", { advanced: true }), numberParam("b", { advanced: true })];
  assert.deepEqual(hiddenAdvancedParams(params, {}, "all"), []);
  assert.equal(hiddenAdvancedCount(params, {}, "all"), 0);
});

test("hiddenAdvancedCount: counts hidden-by-view params in essentials", () => {
  const params = [
    numberParam("a", { advanced: true }),
    numberParam("b", { advanced: true }),
    numberParam("c"),
  ];
  assert.equal(hiddenAdvancedCount(params, {}, "essentials"), 2);
});

test("hiddenAdvancedDiff: only hidden params whose value differs from defaults", () => {
  const params = [
    numberParam("a", { advanced: true }),
    numberParam("b", { advanced: true }),
    numberParam("c"), // visible — never counted even if it differs
  ];
  const defaults = { a: 1, b: 2, c: 3 };
  const values = { a: 1, b: 5, c: 9 }; // a unchanged, b changed, c changed but not advanced
  const diff = hiddenAdvancedDiff(params, values, defaults, "essentials");
  assert.deepEqual(diff.map((p) => p.name), ["b"]);
});

test("hiddenAdvancedDiff: empty in the all view (nothing is hidden there)", () => {
  const params = [numberParam("a", { advanced: true })];
  const diff = hiddenAdvancedDiff(params, { a: 5 }, { a: 1 }, "all");
  assert.deepEqual(diff, []);
});

test("paramMatchesQuery: matches name, description or help against an already-lowercased query; empty query matches everything", () => {
  // The query is expected pre-lowercased (see the doc comment) — callers
  // normalise it once rather than re-lowercasing per param — so a mixed-case
  // param field (not the query) is what exercises the case-insensitivity.
  const p = numberParam("facet_angle", { description: "Max Facet Angle", help: "Lower is Smoother." });
  assert.equal(paramMatchesQuery(p, ""), true);
  assert.equal(paramMatchesQuery(p, "facet"), true);
  assert.equal(paramMatchesQuery(p, "smoother"), true);
  assert.equal(paramMatchesQuery(p, "nope"), false);
});

test("hiddenSearchMatches: hidden-by-view params that match the query, in essentials only", () => {
  const params = [
    numberParam("facet_angle", { advanced: true, description: "Max facet angle" }),
    numberParam("facet_size", { advanced: true, description: "Max facet size" }),
    numberParam("width", { description: "Width of the facet-free plate" }), // visible — never a "hidden match"
  ];
  const hits = hiddenSearchMatches(params, {}, "essentials", "facet");
  assert.deepEqual(hits.map((p) => p.name), ["facet_angle", "facet_size"]);
  assert.deepEqual(hiddenSearchMatches(params, {}, "all", "facet"), []);
  assert.deepEqual(hiddenSearchMatches(params, {}, "essentials", ""), []);
});
