// diagnostics.scad: one switch per kind of message ScadPub can report, so the
// notice badges, the readiness pill, the Review dialog and the failure card can
// all be seen without editing a file. The other example designs are silent at
// their defaults; this is the one that talks. The plaque is deliberately
// trivial — what is on show here is the reporting, not the geometry.
//
// The `alert` and `note` markers below match the `notices` categories in
// scadpub.config.json (`: <marker>:` inside an echo); `alert` is flagged
// `attention`, so it also reaches the readiness pill. The warning and the
// assert are OpenSCAD's own, recognised by the app regardless of config.

// @description Every kind of message the app reports, each behind a switch.
// @icon diagnostics-icon.svg
// @image diagnostics-card.svg
// @reviewNote "This design exists to raise messages on purpose; the switches in Messages are what put them there."

/* [Messages] */
// Echo an `alert` notice. It counts on the amber badge in Messages, and
// because the category is flagged `attention` it also raises the readiness
// pill and gets a card in the pre-download Review dialog.
// @label "Raise an alert"
show_alert = true;
// Echo a `note`. It counts on the blue badge in Messages and is informational
// only: it never gates the download.
// @label "Raise a note"
show_note = true;
// Call a module that does not exist, which is how OpenSCAD's own
// `WARNING:` output is reached. The model still renders; the warning is
// reported and, like an alert, asks to be reviewed before downloading.
// @label "Raise an OpenSCAD warning"
show_warning = true;
// Fail an `assert()`. The render stops, the app shows the failure and an
// "asserts" badge, and there is nothing to download until this is off.
// @label "Fail an assert"
fail_assert = false;
// Lettering face. "Liberation Sans" is bundled and renders as typed; the other
// choice is deliberately not bundled, so picking it shows the "font isn't
// loaded" advisory with its import / switch-family fixes.
// @font
// @label "Font"
font = "Liberation Sans:style=Bold"; // ["Liberation Sans:style=Bold", "DejaVu Sans:style=Bold"]

/* [Plaque] */
// Width of the plaque (mm).
width = 90; // [40:1:180]
// Height of the plaque (mm).
height = 36; // [20:1:120]
// Thickness of the plaque (mm).
// @info Plate thickness | mm
thickness = 3; // [1:0.5:10]
// Corner radius; use 0 for square corners (mm).
corner_radius = 4; // [0:0.5:20]
// Text raised on the plaque.
// @review "Text"
label = "Messages";
// Font height (mm).
// @info Text height | mm
text_size = 10; // [3:0.5:30]
// How far the text stands out from the plaque (mm).
// @advanced
text_depth = 1; // [0.4:0.1:3]
// Colour of the plaque body.
plate_color = "white";
// Colour of the raised lettering.
text_color = "#e0a458";

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

if (show_alert)
  echo("diagnostics: alert: this is an attention notice; it counts on the amber badge and asks to be reviewed before you download");
if (show_note)
  echo("diagnostics: note: this is an informational notice; it counts on the blue badge and never gates the download");

// Nothing declares this module, so instantiating it is what OpenSCAD warns
// about. The call is inside the `if`, so the warning fires only while the
// switch is on.
if (show_warning)
  warning_demo_this_module_does_not_exist();

assert(!fail_assert,
       "the Fail an assert switch is on; turn it off under Messages to render the plaque");

module rounded_rect(w, h, r) {
  offset(r) offset(-r) square([w, h], center = true);
}

color(plate_color)
  linear_extrude(thickness) rounded_rect(width, height, corner_radius);

if (label != "")
  color(text_color)
    translate([0, 0, thickness])
      linear_extrude(text_depth)
        text(label, size = text_size, font = font,
             halign = "center", valign = "center");
