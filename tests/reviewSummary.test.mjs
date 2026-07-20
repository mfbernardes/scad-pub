import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewDimensions, reviewRows } from "../src/lib/reviewSummary.ts";

const design = {
  id: "sample",
  label: "Sample",
  file: "sample.scad",
  presets: [],
  sections: ["Main", "Details"],
  params: [
    { name: "label", section: "Main", type: "string", default: "Hello", description: "Label", help: "Label" },
    { name: "shape", section: "Main", type: "enum", default: "round", description: "Shape", help: "Shape", choices: [{ value: "round", label: "Round" }, { value: "square", label: "Square" }] },
    { name: "diameter", section: "Details", type: "number", default: 20, description: "Diameter", help: "Diameter", showIf: "shape == round" },
    { name: "segments", section: "Details", type: "number", default: 32, description: "Segments", help: "Segments", advanced: true },
  ],
};

test("reviewRows includes visible essential values with friendly labels", () => {
  assert.deepEqual(reviewRows(design, { label: "Token", shape: "round", diameter: 24, segments: 64 }), [
    { name: "label", label: "Label", value: "Token" },
    { name: "shape", label: "Shape", value: "Round" },
    { name: "diameter", label: "Diameter", value: "24" },
  ]);
});

test("reviewRows omits conditional and advanced values", () => {
  assert.deepEqual(reviewRows(design, { label: "Token", shape: "square", diameter: 24 }), [
    { name: "label", label: "Label", value: "Token" },
    { name: "shape", label: "Shape", value: "Square" },
  ]);
});

test("reviewDimensions formats millimetres consistently", () => {
  assert.equal(reviewDimensions(null), null);
  assert.equal(reviewDimensions({ x: 12, y: 3.26, z: 0.04 }), "12.0 × 3.3 × 0.0 mm");
});
