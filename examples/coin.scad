// coin.scad — a parametric coin / medallion that pairs with tag.scad as a
// second example design. Exercises circular geometry, a border ring, raised /
// engraved text, and an optional hanging hole — a different parameter set
// from the rectangular tag so the design switcher feels meaningful.

// @stage shape | Shape
/* [Coin] */
// Diameter of the coin (mm).
diameter = 50; // [20:1:100]
// Thickness of the coin body (mm).
thickness = 2.5; // [1:0.5:8]
// Border ring width along the face (mm). Set to 0 for a plain disc.
border_width = 4; // [0:0.5:15]
// How far the border ring stands above the face (mm).
border_height = 0.8; // [0:0.2:3]

// @stage content | Content
/* [Text] */
// Text embossed on the face of the coin.
label = "ScadPub";
// Font height (mm).
text_size = 7; // [3:0.5:20]
// How far the text stands out from (or sinks into) the face (mm).
text_depth = 0.8; // [0.2:0.1:3]
// Font family / style. Defaults to a font ScadPub doesn't bundle, to
// demonstrate the "font isn't loaded" hint — import it (or click the bundled
// fallback the hint offers) to render the real face.
// @font
font = "DejaVu Sans:style=Bold";
// Colour of the raised text in the export.
text_color = "#e23b3b";
// Carve the text into the face instead of raising it.
engrave_text = false;

// @stage shape
/* [Hanging hole] */
// Add a hole at the top edge for hanging.
hole = true;
// Hole diameter (mm).
// @showIf hole
hole_diameter = 4; // [2:0.5:12]

// @collapsed
// @advanced
// @stage shape
/* [Quality] */
// Maximum facet angle; lower is smoother but slower.
facet_angle = 3; // [1:1:10]
// Maximum facet size (mm).
facet_size = 0.2; // [0.05:0.05:1]

/* [Hidden] */
$fa = facet_angle;
$fs = facet_size;

r = diameter / 2;
echo("@info", "Radius", "mm", r);

// Validate: engraved text must not be deeper than the body.
assert(!(engrave_text && label != "" && text_depth >= thickness),
       "engraved text is deeper than the coin body; reduce text depth or thicken the coin");
// Validate: hanging hole must physically fit.
assert(!(hole && hole_diameter >= diameter - 4),
       "hanging hole is too large for this diameter; shrink the hole or enlarge the coin");

difference() {
  union() {
    // Main disc body.
    cylinder(h = thickness, r = r);

    // Raised border ring — a hollow cylinder sitting on top of the face.
    if (border_width > 0 && border_height > 0)
      translate([0, 0, thickness])
        difference() {
          cylinder(h = border_height, r = r);
          cylinder(h = border_height + 0.01, r = r - border_width);
        }

    // Raised text sits on the face in its own colour so the 3MF export is
    // multi-colour and the viewer tints the body to follow the theme.
    if (!engrave_text && label != "")
      color(text_color)
        translate([0, 0, thickness])
          linear_extrude(text_depth)
            text(label, size = text_size, font = font,
                 halign = "center", valign = "center");
  }

  // Engraved text is subtracted from the top face.
  if (engrave_text && label != "")
    translate([0, 0, thickness - text_depth])
      linear_extrude(text_depth + 0.01)
        text(label, size = text_size, font = font,
             halign = "center", valign = "center");

  // Hanging hole centred at the top edge of the disc.
  if (hole)
    translate([0, r - hole_diameter / 2 - 1, -1])
      linear_extrude(thickness + 2)
        circle(d = hole_diameter);
}
