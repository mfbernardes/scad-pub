// widget-review-annot.scad — a tiny fixture design exercising the
// `// @review` / `// @reviewNote` annotations (tests/gen-schema.test.mjs).
// @reviewNote "Prints exactly as typed."

/* [Main] */
// The label to engrave.
// @review "Text"
label = "hi";
// Plate thickness in millimetres.
// @review "Thickness"
thickness = 2; // [1:0.5:6]
// Wall thickness in millimetres; deliberately carries no @review annotation,
// so a config `review.labels.wall` entry can be tested as config-only.
wall = 1;
