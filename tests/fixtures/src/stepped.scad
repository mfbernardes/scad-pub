// Fixture exercising `// @step`: a shared step id across two non-adjacent
// sections (concatenating their params, in file order), a section-level
// `@step` with an explicit label, one with an omitted label (defaults to the
// section name), an all-`@advanced` section left un-stepped (no coverage
// warning), and an essential section left un-stepped (triggers the
// coverage warning / strictSteps error).

// @step tag | Tag details
/* [Text] */
// Text to emboss.
label = "Room 1";

// @step tag
/* [Size] */
// Width in millimetres.
width = 60; // [20:1:200]

// @step mounting
/* [Mounting] */
// Mounting style.
mounting = "none"; // [none, screw, countersunk]

/* [Advanced tweaks] */
// Facet override, opt-in only.
// @advanced
facets = 0; // [0:1:64]

/* [Extra] */
// Not part of any step — should surface in the coverage check.
note = "hi";
