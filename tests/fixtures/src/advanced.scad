// Fixture exercising `// @advanced` / `// @essential` annotations at both
// parameter level and section level, including the "applies only to the
// occurrence it precedes" rule for a repeated section name.

/* [Basics] */
// Width in millimetres.
width = 10; // [1:1:50]

// Facet override, opt-in only.
// @advanced
facets = 0; // [0:1:64]

// @advanced
/* [Extras] */
// Demoted along with the rest of this section occurrence.
edge_style = "plain"; // [plain, reeded, milled]

// Overrides the section back to non-advanced for this one parameter.
// @essential
edge_depth = 0.6; // [0.1:0.1:2]

/* [More] */
// A no-op use of @essential: this section isn't advanced.
// @essential
note = "hi";

/* [Extras] */
// A second, unmarked occurrence of "Extras" — NOT advanced, unlike the first.
finish = "matte"; // [matte, glossy]
