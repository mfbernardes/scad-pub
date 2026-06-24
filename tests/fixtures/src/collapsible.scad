// Fixture exercising `// @collapsed` section annotations. The annotation before
// the first section also covers the "section === null" edge in the parser.

// @collapsed
/* [Basics] */
// Width in millimetres.
width = 10; // [1:1:50]

/* [Shape] */
// Corner radius.
radius = 2; // [0:0.5:10]

// @collapsed
/* [Advanced] */
// Rarely-needed tweak.
tweak = 1; // [0:0.1:5]
