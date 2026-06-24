use <lib/core.scad>

/* [Main] */
// The label to engrave. Letters and digits are supported.
label = "hi";
// Plate thickness in millimetres. Thicker is sturdier but uses more material.
thickness = 2; // [1:0.5:6]
// Arrow direction.
arrow = "up"; // [up, down, left, right]
// Visual style.
style = "flat"; // [flat:Flat, raised:Raised]
// Font family.
font = "Sans"; // ["Sans", "Mono"]
// Add a mounting hole.
hole = false;
// Hole diameter in millimetres. Only relevant when a hole is added.
// @showIf hole
hole_d = 4; // [2:0.5:8]

/* [Hidden] */
secret = 3;
