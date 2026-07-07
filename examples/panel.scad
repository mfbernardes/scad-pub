// panel.scad — extrude an SVG drawing as a relief on a base plate. Demonstrates
// the @svg field wizard's colour binding: drop a multi-colour SVG and the wizard
// reads each named region's colour into `svg_layers`; every region is then
// imported and coloured separately (per-region colour survives a 3MF export). A
// single-colour drawing leaves `svg_layers` blank and imports as one relief.
//
// @description An SVG extruded as a coloured relief panel (per-region colours).
// @icon panel-icon.svg

/* [Panel] */
// Panel width (mm).
panel_width = 120; // [40:1:250]
// Panel height (mm).
panel_height = 90; // [40:1:250]
// Base plate thickness (mm).
base_thickness = 2; // [1:0.5:6]
// How far the relief stands out from the plate (mm).
relief_height = 1.2; // [0.4:0.1:4]
// Plate corner radius (mm).
corner_radius = 4; // [0:0.5:20]
// Border between the drawing and the plate edge (mm).
margin = 6; // [0:1:40]
// Base plate colour.
base_color = "white";
// Colour of a single-colour (blank svg_layers) relief.
relief_color = "steelblue";

/* [SVG source] */
// The drawing to extrude. Drop in an SVG; the wizard checks and fixes it for
// OpenSCAD import, then reads its region colours into the list below.
// @svg layers=svg_layers
svg_file = "panel.svg";
// Per-region colours: one "id:colour" per named SVG region (e.g.
// "sky:skyblue, ground:yellowgreen"); a bare token names a region whose id is
// already its colour, and a "c<hex>" id expands to "#hex". Leave blank to
// extrude the whole drawing as one relief. Filled in by the SVG wizard.
// @filledBy svg_file
svg_layers = "sky:#87ceeb, ground:#9acd32, house:#cd5c5c";
// (Regions must not overlap — same-height overlapping regions conflict on colour.)

/* [Hidden] */
$fa = $preview ? 12 : 4;
$fs = $preview ? 2 : 0.4;

// ---- the "id:colour" layers-string contract --------------------------------
// A comma-separated list, one entry per named <g id> region: "id:colour" names
// the colour explicitly; a bare token is a region whose id already names its
// colour ("gray" == "gray:gray", "c8b0000" == "c8b0000:#8b0000"); blank means no
// per-region colour (single relief).

function _is_ws(c) = c == " " || c == "\t" || c == "\n" || c == "\r";
function _cat(lst, i = 0) = i >= len(lst) ? "" : str(lst[i], _cat(lst, i + 1));
function _slice(s, i, j) = i > j ? "" : _cat([for (k = [i:1:j]) s[k]]);
function _lstrip(s, i = 0) = i < len(s) && _is_ws(s[i]) ? _lstrip(s, i + 1) : i;
function _rstrip(s, j) = j >= 0 && _is_ws(s[j]) ? _rstrip(s, j - 1) : j;
function _trim(s) = let (a = _lstrip(s), b = _rstrip(s, len(s) - 1)) _slice(s, a, b);

function _split(s, sep, start = 0, i = 0, acc = []) =
  i >= len(s) ? concat(acc, [_slice(s, start, i - 1)])
  : s[i] == sep ? _split(s, sep, i + 1, i + 1, concat(acc, [_slice(s, start, i - 1)]))
  : _split(s, sep, start, i + 1, acc);

function _is_hex(c) =
  (c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
function _all_hex(s, i = 0) = len(s) == 0 ? false : i >= len(s) ? true : _is_hex(s[i]) && _all_hex(s, i + 1);
function _bare_colour(id) =
  let (body = _slice(id, 1, len(id) - 1))
  (len(id) == 7 || len(id) == 9) && id[0] == "c" && _all_hex(body) ? str("#", body) : id;
function _parse_token(tok) =
  let (parts = _split(tok, ":"))
  len(parts) > 1 ? [_trim(parts[0]), _trim(parts[1])]
  : let (id = _trim(parts[0])) [id, _bare_colour(id)];

// Parse the svg_layers field into a [[id, colour], …] list, skipping blanks.
function parse_layers(spec) =
  _trim(spec) == "" ? []
  : [for (tok = _split(spec, ",")) if (_trim(tok) != "") _parse_token(tok)];

// ---- geometry --------------------------------------------------------------

module rounded_rect(w, h, r) {
  if (r > 0) offset(r=r) offset(delta=-r) square([w, h]);
  else square([w, h]);
}

// The drawing fit to the usable area (inside the margin) and centred. A blank
// layers list extrudes the whole drawing in one colour; otherwise each region is
// imported by id and coloured, under one shared fit transform so they stay
// registered (import(id=…) keeps regions in the drawing's own coordinates).
module svg_relief(layers) {
  usable_w = panel_width - 2 * margin;
  usable_h = panel_height - 2 * margin;
  assert(usable_w > 0 && usable_h > 0, "margin leaves no room for the drawing");
  translate([margin, margin, base_thickness])
    resize([usable_w, usable_h, 0], auto=true)
      union() {
        if (len(layers) == 0)
          color(relief_color)
            linear_extrude(height=relief_height)
              import(file=svg_file, center=false);
        else
          for (lyr = layers)
            color(lyr[1])
              linear_extrude(height=relief_height)
                import(file=svg_file, id=lyr[0], center=false);
      }
}

module panel() {
  color(base_color)
    linear_extrude(height=base_thickness)
      rounded_rect(panel_width, panel_height, corner_radius);
  svg_relief(parse_layers(svg_layers));
}

panel();
