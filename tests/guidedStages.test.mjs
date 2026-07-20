import test from "node:test";
import assert from "node:assert/strict";
import { guidedStages } from "../src/lib/guidedStages.ts";

const design = (stages, params = []) => ({ stages, params });

test("guidedStages keeps one generic Customize step without annotations", () => {
  assert.deepEqual(guidedStages(design([], [{ name: "label" }])), [
    { value: "params", label: "Customize", filter: undefined },
  ]);
});

test("guidedStages preserves declared order and section filters", () => {
  assert.deepEqual(
    guidedStages(
      design(
        [
          { id: "content", label: "Content" },
          { id: "shape", label: "Shape" },
        ],
        [{ name: "label", stage: "content" }, { name: "width", stage: "shape" }]
      )
    ),
    [
      { value: "stage:content", label: "Content", filter: "content" },
      { value: "stage:shape", label: "Shape", filter: "shape" },
    ]
  );
});

test("guidedStages retains unannotated parameters as Other settings", () => {
  assert.deepEqual(
    guidedStages(
      design([{ id: "content", label: "Content" }], [
        { name: "label", stage: "content" },
        { name: "quality" },
      ])
    ).at(-1),
    { value: "params", label: "Other settings", filter: null }
  );
});
