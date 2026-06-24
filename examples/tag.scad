// tag.scad — a tiny, self-contained example design so the configurator builds
// and renders without any external library. It exercises the configurator's
// features: Customizer sections, slider/checkbox parameters, a [Hidden] block,
// and a `// @showIf` conditional control. No fonts or experimental features.

/* [Tag] */
// Width of the tag (mm).
width = 40; // [10:1:120]
// Height of the tag (mm).
height = 24; // [10:1:120]
// Thickness (mm).
thickness = 3; // [1:0.5:10]
// Corner radius; use 0 for square corners (mm).
corner_radius = 4; // [0:0.5:20]

/* [Hanging hole] */
// Add a hole to hang or thread the tag.
hole = true;
// Hole diameter (mm). Only used when the hole is enabled.
// @showIf hole
hole_diameter = 5; // [2:0.5:15]

// @collapsed
/* [Quality] */
// Maximum facet angle; lower is smoother but slower.
facet_angle = 4; // [1:1:12]
// Maximum facet size (mm); lower is smoother but slower.
facet_size = 0.3; // [0.1:0.1:1]

/* [Hidden] */
$fa = facet_angle;
$fs = facet_size;

module rounded_rect(w, h, r) {
  offset(r) offset(-r) square([w, h], center = true);
}

difference() {
  linear_extrude(thickness) rounded_rect(width, height, corner_radius);
  if (hole) {
    translate([-width / 2 + max(hole_diameter, corner_radius) + 1, 0, -1])
      linear_extrude(thickness + 2) circle(d = hole_diameter);
  }
}
