// tag.scad: a small, self-contained example design that exercises the whole
// configurator: Customizer sections, slider/checkbox/string parameters, a
// [Hidden] block, a `// @showIf` conditional control, and, importantly, both
// uploadable file kinds (its own notices stay quiet at the defaults;
// diagnostics.scad is the design that demonstrates the app's message
// reporting):
//   • text() uses a font (try the "Import file" button to add your own TTF/OTF,
//     then set `font` to its family name),
//   • import() extrudes an SVG (a default emblem.svg is bundled; upload your own
//     SVG and set `svg_file` to its filename to swap it).

// @description Personalised name tag with text.
// @icon tag-icon.svg
// @image tag-card.svg
// @reviewNote "The engraved or raised text keeps your capitalisation exactly as typed."

/* [Tag] */
// Width of the tag (mm).
width = 90; // [10:1:160]
// Height of the tag (mm).
height = 45; // [10:1:120]
// Thickness of the base plate (mm).
// @info Plate thickness | mm
thickness = 3; // [1:0.5:10]
// Corner radius; use 0 for square corners (mm).
// @info Corner radius | mm
corner_radius = 4; // [0:0.5:20]
// Colour of the plate itself. Set here rather than left to the viewer's own
// tint so the export, the preview and the design's card art all agree.
// @info Plate colour
plate_color = "white";

/* [Text] */
// Text to emboss on the tag. Leave empty for none.
// @info Engraved text
// @editOnModel
// @review "Text"
label = "ScadPub";
// Font height (mm).
// @info Text height | mm
text_size = 9; // [3:0.5:30]
// How far the text stands out from (or sinks into) the plate (mm).
// @advanced
text_depth = 1; // [0.4:0.1:3]
// Font family/style. Change to an uploaded font's family, e.g. "DejaVu Sans".
// @font
// @info Font
// @review "Typeface"
font = "Liberation Sans:style=Bold";
// Colour of the raised text: any OpenSCAD colour name or "#rrggbb". Exported
// into the 3MF so the viewer (and colour-capable slicers) show it.
// @info Text colour
text_color = "#e23b3b";
// Carve the text into the plate instead of raising it.
engrave_text = false;

/* [Emblem (SVG)] */
// Extrude an SVG emblem onto the tag.
show_emblem = true;
// SVG file to import. The bundled default is "emblem.svg"; drop in your own and
// the wizard checks and fixes it for OpenSCAD import.
// @showIf show_emblem
// @svg
svg_file = "emblem.svg";
// Target width of the emblem; height follows the SVG's aspect ratio (mm).
// @showIf show_emblem
emblem_size = 18; // [4:1:80]
// Colour of the raised emblem in the export, like the text colour above.
// @showIf show_emblem
// @info Emblem colour
emblem_color = "#2f55ff";
// How far the emblem stands out from the plate (mm).
// @showIf show_emblem
// @advanced
emblem_height = 1.5; // [0.4:0.1:5]

/* [Hanging hole] */
// Add a hole to hang or thread the tag.
hole = false;
// Hole diameter (mm). Only used when the hole is enabled.
// @showIf hole
// @info Hole diameter | mm
hole_diameter = 5; // [2:0.5:15]

// @collapsed
// @advanced
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

// Where the text and emblem sit: both centred on the plate's width, and when
// both are shown they split it into an upper and a lower half so they can't
// overlap. Each half's own centre is height/4 from the middle.
both = show_emblem && label != "";
text_y = both ? -height / 4 : 0;
emblem_y = both ? height / 4 : 0;

// Non-fatal design feedback, surfaced in the app's Messages panel as count
// badges. The app matches the `: <marker>:` echo convention, so the `alert`
// and `note` markers line up with the `notices` categories configured in
// scadpub.config.json. None of these hold at the shipped defaults — this design
// is quiet until you steer it somewhere questionable, and diagnostics.scad is
// the design that demonstrates the badges themselves. Each fires in a specific,
// parameter-driven case you can reach from the form:
//   • raise "Font height" past its half of the plate      -> an alert
//   • widen the emblem past half the tag width            -> an alert
//   • enable "Carve the text into the plate"              -> a note
//   • enlarge the hanging hole past a quarter the height  -> a note
if (label != "" && !engrave_text && text_size > (both ? height / 4 : height / 2))
  echo("tag: alert: the label text is tall for the space it has and may overflow the plate");
if (show_emblem && emblem_size > width / 2)
  echo("tag: alert: the emblem is wide relative to the tag and may reach the edges");
if (label != "" && engrave_text)
  echo("tag: note: the label is engraved into the plate rather than raised");
if (hole && hole_diameter > height / 4)
  echo("tag: note: the hanging hole is large and leaves little material at the corner");

// The review summary's "Text" row would otherwise show the raw stored string,
// which says nothing about an empty tag or a carved one. `echo("@review", …)`
// overrides that row's VALUE at render time (the `// @review "Text"` comment on
// `label` above sets its LABEL); see docs/annotations.md.
echo("@review", "label",
     label == "" ? "no text" : engrave_text ? str(label, " (engraved)") : label);

// A failed assert aborts the render with an `ERROR: Assertion …` (which the app
// counts on the "asserts" badge). These guard genuinely unbuildable
// combinations you can reach from the form; neither holds at the defaults:
//   • enable + deepen engraving past the plate thickness -> assert
//   • enlarge the hanging hole until it won't fit the tag -> assert
assert(!(engrave_text && label != "" && text_depth >= thickness),
       "engraved text is deeper than the plate is thick; reduce text depth or thicken the plate");
assert(!(hole && hole_diameter >= min(width, height) - 2 * corner_radius),
       "the hanging hole is too large to fit the tag; shrink the hole or enlarge the tag");

difference() {
  union() {
    color(plate_color)
      linear_extrude(thickness) rounded_rect(width, height, corner_radius);

    // Raised text and emblem stand on top of the plate, each in its own colour
    // so the export is multi-colour (the plate keeps OpenSCAD's default, which
    // the viewer tints to follow the theme).
    if (!engrave_text && label != "")
      color(text_color)
        translate([0, text_y, thickness])
          linear_extrude(text_depth)
            text(label, size = text_size, font = font,
                 halign = "center", valign = "center");

    if (show_emblem)
      color(emblem_color)
        translate([0, emblem_y, thickness])
          linear_extrude(emblem_height) emblem_2d();
  }

  // Engraved text is cut into the top face instead.
  if (engrave_text && label != "")
    translate([0, text_y, thickness - text_depth])
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
