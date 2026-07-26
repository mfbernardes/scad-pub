// panel.scad — extrude an SVG drawing as a relief on a base plate. Demonstrates
// the @svg field wizard's colour binding: drop a multi-colour SVG and the wizard
// reads each named region's colour into `svg_layers`; every region is then
// imported and coloured separately (per-region colour survives a 3MF export). A
// single-colour drawing leaves `svg_layers` blank and imports as one relief.
//
// @description An SVG extruded as a coloured relief panel (per-region colours).
// @icon panel-icon.svg
// @doc panel.md

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
// @svg layers=svg_layers height=relief_height
svg_file = "panel.svg";
// Per-region colours and heights: one "id:colour" per named SVG region (e.g.
// "sky:skyblue, ground:yellowgreen"); a bare token names a region whose id is
// already its colour, and a "c<hex>" id expands to "#hex". A third field raises
// that region to its own height ("house:#cd5c5c:2"); without one it uses
// relief_height. A leading "WxH" entry names the drawing's canvas, which is what
// lets the regions be centred. Leave blank to extrude the whole drawing as one
// relief. Filled in by the SVG wizard.
// @filledBy svg_file
svg_layers = "120x90, sky:#87ceeb, ground:#9acd32, house:#cd5c5c";
// (Regions must not overlap — same-height overlapping regions conflict on colour.)

/* [Hidden] */
$fa = $preview ? 12 : 4;
$fs = $preview ? 2 : 0.4;

// ---- the layers-string contract --------------------------------------------
// A comma-separated list. Each region entry is "id:colour[:height]": "id:colour"
// names the colour explicitly; a bare token is a region whose id already names
// its colour ("gray" == "gray:gray", "c8b0000" == "c8b0000:#8b0000"); a third
// field is that region's own relief height in mm, and without one the region
// uses relief_height. One further entry, "<width>x<height>", names the drawing's
// own canvas (its viewBox size) — see svg_relief for why that is needed. Blank
// means no per-region colour (single relief).

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
function _is_digit(c) = c >= "0" && c <= "9";
// A decimal number, or undef — OpenSCAD has no atof(), and both the height and
// the canvas fields are numbers inside a string. All digits go into one integer
// and the point is applied once at the end, so "2.5" comes back exactly.
function _num(s, i = 0, acc = 0, dec = -1, seen = false) =
  i >= len(s) ? (seen ? acc / pow(10, max(dec, 0)) : undef)
  : s[i] == "." ? (dec >= 0 ? undef : _num(s, i + 1, acc, 0, seen))
  : !_is_digit(s[i]) ? undef
  : _num(s, i + 1, acc * 10 + search(s[i], "0123456789")[0], dec < 0 ? -1 : dec + 1, true);

// A canvas entry carries no colon, which is what tells it apart from a region.
function _is_canvas(tok) = len(_split(tok, ":")) == 1 && len(_split(tok, "x")) == 2;

function _parse_token(tok) =
  let (parts = _split(tok, ":"), id = _trim(parts[0]))
  [
    id,
    len(parts) > 1 ? _trim(parts[1]) : _bare_colour(id),
    len(parts) > 2 && _trim(parts[2]) != "" ? _num(_trim(parts[2])) : undef,
  ];

// Parse the svg_layers field into a [[id, colour, height], …] list, skipping
// blanks and the canvas entry.
function parse_layers(spec) =
  _trim(spec) == "" ? []
  : [
    for (tok = _split(spec, ","))
      if (_trim(tok) != "" && !_is_canvas(_trim(tok))) _parse_token(tok),
  ];

// The drawing's [width, height] canvas, or undef when the spec names none. Only
// the ratio is used, so the units do not matter.
function parse_canvas(spec) =
  let (toks = [for (tok = _split(spec, ",")) if (_is_canvas(_trim(tok))) _trim(tok)])
  len(toks) == 0 ? undef
  : let (parts = _split(toks[0], "x"), w = _num(_trim(parts[0])), h = _num(_trim(parts[1])))
    is_undef(w) || is_undef(h) || w <= 0 || h <= 0 ? undef : [w, h];

// ---- geometry --------------------------------------------------------------

module rounded_rect(w, h, r) {
  if (r > 0) offset(r=r) offset(delta=-r) square([w, h]);
  else square([w, h]);
}

// The drawing fit inside the usable area (inside the margin), preserving its
// aspect ratio — scaled to the box's smaller side so resizing the panel scales
// the drawing proportionally instead of stretching it, then clipped so nothing
// runs off the plate. resize() with two non-zero axes would stretch each to fill
// the box (distorting the drawing), so only one axis is driven and the other
// follows.
//
// A blank layers list extrudes the whole drawing in one colour, centred on its
// own bounding box. Otherwise each region is imported by id and coloured under
// one shared fit transform so they stay registered — import(center=true) centres
// on the imported geometry's OWN bounding box, so using it per region would pull
// the drawing apart, and the drawing must instead fill its "0 0 W H" viewBox.
// That also leaves OpenSCAD with no way to measure the fitted drawing, which is
// what `canvas` is for: with it the group is centred on the panel, without it it
// is corner-anchored and only lands centred when the drawing's proportions match
// the panel's. resize() scales z along with x/y, so the tallest region's height
// is pinned in the fit — otherwise every relief height would be multiplied by the
// fit factor.
module svg_relief(layers, canvas) {
  usable_w = panel_width - 2 * margin;
  usable_h = panel_height - 2 * margin;
  assert(usable_w > 0 && usable_h > 0, "margin leaves no room for the drawing");
  // Fit to the smaller side, preserving aspect (never stretched).
  fit = usable_w >= usable_h ? [0, usable_h, 0] : [usable_w, 0, 0];
  aspect = is_undef(canvas) ? undef : canvas[0] / canvas[1];
  drawn_h = is_undef(aspect) ? usable_h : min(usable_h, usable_w / aspect);
  drawn_w = is_undef(aspect) ? usable_w : drawn_h * aspect;
  tallest =
    len(layers) == 0 ? relief_height : max([for (lyr = layers) is_undef(lyr[2]) ? relief_height : lyr[2]]);
  if (len(layers) == 0)
    // Single relief: centre the whole drawing and clip it to the usable box.
    translate([panel_width / 2, panel_height / 2, base_thickness])
      color(relief_color)
        linear_extrude(height=relief_height)
          intersection() {
            resize(fit, auto=true) import(file=svg_file, center=true);
            square([usable_w, usable_h], center=true);
          }
  else
    // Per-region colours and heights: one shared resize keeps the regions
    // registered, placed from the drawing's canvas when it names one.
    translate(
      [
        panel_width / 2 - drawn_w / 2,
        panel_height / 2 - drawn_h / 2,
        base_thickness,
      ]
    )
      resize(
        is_undef(aspect) ? [fit[0], fit[1], tallest] : [drawn_w, drawn_h, tallest],
        auto=true
      )
        union() {
          for (lyr = layers)
            color(lyr[1])
              linear_extrude(height=is_undef(lyr[2]) ? relief_height : lyr[2])
                import(file=svg_file, id=lyr[0], center=false);
        }
}

module panel() {
  color(base_color)
    linear_extrude(height=base_thickness)
      rounded_rect(panel_width, panel_height, corner_radius);
  svg_relief(parse_layers(svg_layers), parse_canvas(svg_layers));
}

panel();
