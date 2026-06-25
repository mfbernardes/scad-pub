// tag.scad — a small, self-contained example design that exercises the whole
// configurator: Customizer sections, slider/checkbox/string parameters, a
// [Hidden] block, a `// @showIf` conditional control — and, importantly, both
// uploadable file kinds:
//   • text() uses a font (try the "Import file" button to add your own TTF/OTF,
//     then set `font` to its family name),
//   • import() extrudes an SVG (a default emblem.svg is bundled; upload your own
//     SVG and set `svg_file` to its filename to swap it).

/* [Tag] */
// Width of the tag (mm).
width = 90; // [10:1:160]
// Height of the tag (mm).
height = 45; // [10:1:120]
// Thickness of the base plate (mm).
thickness = 3; // [1:0.5:10]
// Corner radius; use 0 for square corners (mm).
corner_radius = 4; // [0:0.5:20]

/* [Text] */
// Text to emboss on the tag. Leave empty for none.
label = "ScadPub";
// Font height (mm).
text_size = 9; // [3:0.5:30]
// How far the text stands out from (or sinks into) the plate (mm).
text_depth = 1; // [0.4:0.1:3]
// Font family/style. Change to an uploaded font's family, e.g. "DejaVu Sans".
font = "Liberation Sans:style=Bold";
// Carve the text into the plate instead of raising it.
engrave_text = false;

/* [Emblem (SVG)] */
// Extrude an SVG emblem onto the tag.
show_emblem = true;
// SVG file to import. The bundled default is "emblem.svg"; upload your own and
// set this to its filename to use it instead.
// @showIf show_emblem
svg_file = "emblem.svg";
// Target width of the emblem; height follows the SVG's aspect ratio (mm).
// @showIf show_emblem
emblem_size = 18; // [4:1:80]
// How far the emblem stands out from the plate (mm).
// @showIf show_emblem
emblem_height = 1.5; // [0.4:0.1:5]

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

// The SVG emblem, normalised to `emblem_size` wide (aspect ratio preserved) and
// centred on the origin, as a 2D shape ready to extrude.
module emblem_2d() {
  resize([emblem_size, 0], auto = true)
    import(svg_file, center = true);
}

// Where the text and emblem sit: emblem to the left when both are shown, so they
// don't overlap; otherwise each is centred.
both = show_emblem && label != "";
text_x = both ? emblem_size / 2 + 3 : 0;
emblem_x = both ? -(width / 2) + emblem_size / 2 + 6 : 0;

difference() {
  union() {
    linear_extrude(thickness) rounded_rect(width, height, corner_radius);

    // Raised text / emblem stand on top of the plate.
    if (!engrave_text && label != "")
      translate([text_x, 0, thickness])
        linear_extrude(text_depth)
          text(label, size = text_size, font = font,
               halign = "center", valign = "center");

    if (show_emblem)
      translate([emblem_x, 0, thickness])
        linear_extrude(emblem_height) emblem_2d();
  }

  // Engraved text is cut into the top face instead.
  if (engrave_text && label != "")
    translate([text_x, 0, thickness - text_depth])
      linear_extrude(text_depth + 0.01)
        text(label, size = text_size, font = font,
             halign = "center", valign = "center");

  // The hanging hole sits in the top-left corner, clear of the centred
  // text/emblem row so it never punches through them.
  if (hole)
    let (inset = max(hole_diameter, corner_radius) + 2)
      translate([-width / 2 + inset, height / 2 - inset, -1])
        linear_extrude(thickness + 2) circle(d = hole_diameter);
}
