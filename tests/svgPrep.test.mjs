// Logic tests for the generic SVG-prep engine (src/lib/svgPrep): they pin its
// check / fix / group-by-colour / region-derivation behaviour so it can't
// regress silently. Uses @xmldom/xmldom for a DOM in Node; the browser wizard
// uses the platform DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

// serializeSvg()/prepareSvg() call the platform XMLSerializer; provide one.
globalThis.XMLSerializer = XMLSerializer;

import {
  analyze,
  applyFixes,
  canvasEntry,
  check,
  deriveLayers,
  displayColor,
  parseColor,
  deriveRegions,
  formatLayerSpec,
  formatLayers,
  groupByColor,
  isCanvasEntry,
  isRenderableColor,
  isUsableHeight,
  unusableHeightRegions,
  MAX_RELIABLE_REGIONS,
  parseLayersArg,
  parseLayerSpec,
  prepareSvg,
  parseSvg,
  serializeSvg,
} from "../src/lib/svgPrep/index.ts";

const parse = (svg) =>
  new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
const roundtrip = (root) => parse(serializeSvg(root));
const codes = (root, layers = []) => check(root, layers).map((f) => f.code);

test("check flags OpenSCAD's sharp edges (text, stroke-only, off-origin viewBox)", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50">
       <text x="5" y="5">hi</text>
       <rect x="0" y="0" width="10" height="10" fill="none" stroke="black"/>
     </svg>`,
  );
  const c = codes(root);
  assert.ok(c.includes("text"));
  assert.ok(c.includes("stroke-only"));
  assert.ok(c.includes("viewbox-origin"));
});

test("check errors when there is no importable geometry", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>x</text></svg>`,
  );
  assert.ok(codes(root).includes("no-geometry"));
});

test("check detects the Inkscape layer label != id trap", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg"
          xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
          viewBox="0 0 10 10">
       <g id="layer1" inkscape:groupmode="layer" inkscape:label="walls">
         <rect x="0" y="0" width="10" height="10" fill="gray"/>
       </g>
     </svg>`,
  );
  assert.ok(codes(root).includes("inkscape-trap"));
});

test("derives a layers string from named regions and their fills", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
       <g id="walls"><rect x="0" y="0" width="10" height="10" fill="gray"/></g>
       <g id="rooms"><rect x="10" y="0" width="10" height="10" fill="white"/></g>
     </svg>`,
  );
  assert.equal(formatLayers(deriveRegions(root)), "walls:gray, rooms:white");
  assert.ok(!codes(root, ["walls", "rooms"]).includes("region-missing"));
  assert.ok(codes(root, ["roads"]).includes("region-missing"));
});

test("safe fix normalises an off-origin viewBox by wrapping in a translate", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50">
       <rect x="10" y="20" width="100" height="50" fill="gray"/>
     </svg>`,
  );
  assert.match(applyFixes(root).join(" "), /re-centred the drawing/);
  const fixed = roundtrip(root);
  assert.equal(fixed.getAttribute("viewBox"), "0 0 100 50");
  assert.match(serializeSvg(fixed), /translate\(-10,-20\)/);
  assert.ok(!codes(fixed).includes("viewbox-origin"));
});

test("safe fix renames an Inkscape layer id to its label", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg"
          xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
          viewBox="0 0 10 10">
       <g id="layer1" inkscape:groupmode="layer" inkscape:label="walls">
         <rect x="0" y="0" width="10" height="10" fill="gray"/>
       </g>
     </svg>`,
  );
  applyFixes(root);
  const fixed = roundtrip(root);
  assert.ok(!codes(fixed, ["walls"]).includes("region-missing"));
  assert.ok(!codes(fixed).includes("inkscape-trap"));
});

test("group-by-colour wraps a flat drawing into one <g id> per fill colour", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
       <rect x="0" y="0" width="10" height="10" fill="gray"/>
       <rect x="10" y="0" width="10" height="10" fill="white"/>
     </svg>`,
  );
  assert.equal(groupByColor(root).error, null);
  assert.equal(formatLayers(deriveRegions(roundtrip(root))), "gray, white");
});

test("group-by-colour collapses c<hex> slug ids to bare tokens", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
       <rect x="0" y="0" width="10" height="10" fill="gray"/>
       <rect x="10" y="0" width="10" height="10" fill="#8b0000"/>
     </svg>`,
  );
  assert.equal(groupByColor(root).error, null);
  assert.equal(formatLayers(deriveRegions(roundtrip(root))), "gray, c8b0000");
});

test("group-by-colour is idempotent on already-named regions", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
       <g id="walls"><rect x="0" y="0" width="10" height="10" fill="gray"/></g>
       <g id="rooms"><rect x="10" y="0" width="10" height="10" fill="white"/></g>
     </svg>`,
  );
  const res = groupByColor(root);
  assert.equal(res.changes.length, 0);
  assert.match(res.error, /already in a named/);
  assert.equal(formatLayers(deriveRegions(root)), "walls:gray, rooms:white");
});

test("group-by-colour keeps a fill inherited from the group a shape is lifted from", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
       <g fill="gray"><rect x="0" y="0" width="10" height="10"/></g>
       <rect x="10" y="0" width="10" height="10" fill="white"/>
     </svg>`,
  );
  assert.equal(groupByColor(root).error, null);
  assert.equal(formatLayers(deriveRegions(roundtrip(root))), "gray, white");
});

test("group-by-colour keeps regions registered under a shared transform wrapper", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
       <g transform="translate(1,1)">
         <rect x="0" y="0" width="10" height="10" fill="gray"/>
         <rect x="10" y="0" width="10" height="10" fill="white"/>
       </g>
     </svg>`,
  );
  assert.equal(groupByColor(root).error, null);
  const round = roundtrip(root);
  assert.equal(formatLayers(deriveRegions(round)), "gray, white");
  const outer = Array.from(round.getElementsByTagName("g")).find((g) =>
    g.getAttribute("transform"),
  );
  assert.ok(outer);
  assert.equal(outer.getElementsByTagName("g").length, 2);
});

test("group-by-colour refuses when a transform sits between container and shape", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
       <g transform="translate(1,1)">
         <rect x="0" y="0" width="10" height="10" fill="gray"/>
       </g>
       <rect x="10" y="0" width="10" height="10" fill="white"/>
     </svg>`,
  );
  assert.match(groupByColor(root).error, /transformed or clipped/);
});

test("a single colour derives a blank layers string (no per-region split)", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
       <rect x="0" y="0" width="20" height="10" fill="gray"/>
     </svg>`,
  );
  assert.equal(deriveLayers(root), "");
});

test("analyze bundles findings, regions and derived layers", () => {
  const a = analyze(
    parse(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
         <g id="walls"><rect x="0" y="0" width="10" height="10" fill="gray"/></g>
         <g id="rooms"><rect x="10" y="0" width="10" height="10" fill="white"/></g>
       </svg>`,
    ),
  );
  assert.equal(a.hasErrors, false);
  assert.equal(a.derivedLayers, "20x10, walls:gray, rooms:white");
  assert.deepEqual(a.regions.map((r) => r.id), ["walls", "rooms"]);
});

test("prepareSvg (host contract): derives layers for a multi-colour drawing", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
       <rect x="0" y="0" width="10" height="10" fill="gray"/>
       <rect x="10" y="0" width="10" height="10" fill="white"/>
     </svg>`,
  );
  const res = prepareSvg(root, { deriveColours: true });
  assert.equal(res.layers, "20x10, gray, white");
  assert.match(res.svg, /<g[^>]*id="gray"/);
  assert.ok(!res.findings.some((f) => f.level === "ERROR"));
});

test("prepareSvg: returns null layers when colours are not derived", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
       <rect x="0" y="0" width="10" height="10" fill="gray"/>
       <rect x="10" y="0" width="10" height="10" fill="white"/>
     </svg>`,
  );
  assert.equal(prepareSvg(root, { deriveColours: false }).layers, null);
});

test("prepareSvg: single-colour drawing yields a blank layers string", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
       <rect x="0" y="0" width="20" height="10" fill="gray"/>
     </svg>`,
  );
  assert.equal(prepareSvg(root, { deriveColours: true }).layers, "");
});

test("resolves simple CSS class fills so colour derivation isn't black", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
       <style>.a { fill: #ff0000 } .b { fill: #0000ff }</style>
       <g id="left"><rect class="a" x="0" y="0" width="10" height="10"/></g>
       <g id="right"><rect class="b" x="10" y="0" width="10" height="10"/></g>
     </svg>`,
  );
  applyFixes(root);
  assert.equal(formatLayers(deriveRegions(roundtrip(root))), "left:red, right:blue");
});

test("prepareSvg derives colours from a CSS-styled drawing", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
       <style>#l{fill:#008000}#r{fill:#ffa500}</style>
       <g id="l"><rect x="0" y="0" width="10" height="10"/></g>
       <g id="r"><rect x="10" y="0" width="10" height="10"/></g>
     </svg>`,
  );
  assert.equal(prepareSvg(root, { deriveColours: true }).layers, "20x10, l:green, r:orange");
});

test("a simple styled fill is resolved (no styled-fill warning after fixes)", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
       <style>.a{fill:red}</style>
       <rect class="a" x="0" y="0" width="10" height="10"/>
     </svg>`,
  );
  applyFixes(root);
  assert.ok(!codes(root).includes("styled-fill"));
});

test("an unresolved (compound-selector) styled fill is flagged", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
       <style>.wrap .a{fill:red}</style>
       <g class="wrap"><rect class="a" x="0" y="0" width="10" height="10"/></g>
     </svg>`,
  );
  applyFixes(root);
  assert.ok(codes(root).includes("styled-fill"));
});

test("prepareSvg surfaces a blocking ERROR when there is no importable geometry", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>x</text></svg>`,
  );
  const res = prepareSvg(root, { deriveColours: false });
  assert.ok(res.findings.some((f) => f.level === "ERROR" && f.code === "no-geometry"));
});

test("isRenderableColor accepts real colours and rejects nonsense", () => {
  // Understood by our parser (names, #rgb/#rrggbb, rgb()).
  for (const t of ["red", "gray", "#abc", "#a0b0c0", "rgb(1,2,3)"])
    assert.ok(isRenderableColor(t), `${t} should be renderable`);
  // CSS colour functions / extended hex the swatch can still paint.
  for (const t of ["rgba(0,0,0,0.5)", "hsl(200,50%,50%)", "#11223344"])
    assert.ok(isRenderableColor(t), `${t} should be renderable`);
  // Not a colour at all, and empty input.
  for (const t of ["notacolour", "", null, undefined])
    assert.ok(!isRenderableColor(t), `${JSON.stringify(t)} should not be renderable`);
});

test("many painted colours derive more regions than the reliable threshold", () => {
  const shapes = Array.from(
    { length: MAX_RELIABLE_REGIONS + 2 },
    (_, i) => `<rect x="${i}" y="0" width="1" height="1" fill="#${(i + 1).toString(16).padStart(6, "0")}"/>`,
  ).join("");
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 10">${shapes}</svg>`,
  );
  const res = prepareSvg(root, { deriveColours: true });
  assert.ok(
    res.regions.length > MAX_RELIABLE_REGIONS,
    `expected > ${MAX_RELIABLE_REGIONS} regions, got ${res.regions.length}`,
  );
});

// ── canvas entry + per-region heights ──────────────────────────────────────
// The layers string carries two things a consuming design cannot work out on
// its own: the drawing's canvas (regions are imported uncentred, so it has no
// way to measure them) and each region's own relief height.

test("the canvas entry is the drawing's viewBox size, and only that", () => {
  assert.equal(
    canvasEntry(parse('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"/>')),
    "120x80",
  );
  // A viewBox with a non-zero origin still reports its size (fixViewBoxOrigin
  // normalises the origin itself).
  assert.equal(
    canvasEntry(parse('<svg xmlns="http://www.w3.org/2000/svg" viewBox="5 5 60 40"/>')),
    "60x40",
  );
  // No viewBox, or a degenerate one => no entry, and the design falls back.
  assert.equal(canvasEntry(parse('<svg xmlns="http://www.w3.org/2000/svg"/>')), "");
  assert.equal(
    canvasEntry(parse('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 40"/>')),
    "",
  );
});

test("a canvas entry is told apart from a region, and never read as one", () => {
  assert.ok(isCanvasEntry("120x80"));
  assert.ok(isCanvasEntry(" 12.5x7.25 "));
  // A region always carries a colon; an id that merely contains an x does not
  // become a canvas.
  assert.ok(!isCanvasEntry("walls:gray"));
  assert.ok(!isCanvasEntry("xray"));
  assert.ok(!isCanvasEntry("120x80:gray"));
  // check() validates region names against the spec, so it must skip the canvas.
  assert.deepEqual(parseLayersArg("120x80, walls:gray, rooms:white:2"), ["walls", "rooms"]);
});

test("a layers spec round-trips through parse/format, heights and all", () => {
  const spec = parseLayerSpec("120x80, walls:gray:2.5, rooms:white, gray");
  assert.equal(spec.canvas, "120x80");
  assert.deepEqual(spec.entries, [
    { id: "walls", color: "gray", height: "2.5" },
    { id: "rooms", color: "white", height: "" },
    // A bare token is the shorthand for a region whose id already names its
    // colour, so it parses back into that colour rather than a blank one.
    { id: "gray", color: "gray", height: "" },
  ]);
  // A region with no height is written bare, so the all-defaults case reads
  // exactly as it did before heights existed.
  assert.equal(
    formatLayerSpec("120x80", [
      { id: "walls", color: "gray", height: "" },
      { id: "rooms", color: "white", height: "" },
    ]),
    "120x80, walls:gray, rooms:white",
  );
  assert.equal(
    formatLayerSpec("", [{ id: "walls", color: "gray", height: "2" }]),
    "walls:gray:2",
  );
  // The id-names-its-colour shorthand survives a round-trip.
  assert.equal(formatLayerSpec("", parseLayerSpec("gray, c8b0000").entries), "gray, c8b0000");
  assert.deepEqual(parseLayerSpec("c8b0000").entries, [
    { id: "c8b0000", color: "#8b0000", height: "" },
  ]);
});

test("formatLayers leads with the canvas only when the drawing declares one", () => {
  const regions = [
    { id: "walls", color: "gray", mixed: false, explicit: true, count: 1 },
    { id: "rooms", color: "white", mixed: false, explicit: true, count: 1 },
  ];
  assert.equal(formatLayers(regions, "120x80"), "120x80, walls:gray, rooms:white");
  assert.equal(formatLayers(regions), "walls:gray, rooms:white");
});

// ── the heights a consuming design can actually use ────────────────────────
// The wizard's height box is an <input type="number">, which accepts far more
// than a design's own parser does: 0, negatives and exponent syntax all pass the
// browser and then hard-fail the render. The wizard blocks completion on these.

test("a usable height is a plain positive decimal, nothing else", () => {
  for (const ok of ["2", "1.5", "0.4", ".5", "12.", "  3  "])
    assert.equal(isUsableHeight(ok), true, `${ok} should be usable`);
  // Zero and negatives: a design asserts a positive height.
  for (const bad of ["0", "0.0", "-1", "-0.5"])
    assert.equal(isUsableHeight(bad), false, `${bad} should be rejected`);
  // Exponent syntax: valid to the browser's number input, not to a design's
  // hand-written parser.
  for (const bad of ["1e3", "1E3", "1e-3", "+2"])
    assert.equal(isUsableHeight(bad), false, `${bad} should be rejected`);
  // Plain nonsense, and blank (blank means "inherit", checked by the caller).
  for (const bad of ["tall", "2mm", "1.2.3", ""])
    assert.equal(isUsableHeight(bad), false, `${bad} should be rejected`);
});

test("unusableHeightRegions names only the regions that wrote a bad height", () => {
  assert.deepEqual(
    unusableHeightRegions("120x80, walls:gray:2, rooms:white, roof:red:0, sky:blue:1e3"),
    ["roof", "sky"],
  );
  // Every height usable or omitted → nothing to block on.
  assert.deepEqual(unusableHeightRegions("120x80, walls:gray:2.5, rooms:white"), []);
  assert.deepEqual(unusableHeightRegions(""), []);
});

test("the canvas entry keeps a small viewBox's proportions, not a fixed scale", () => {
  // A viewBox is scale-free, so a fixed number of decimal places destroys a
  // small one: at four places 0.00001 rounds to 0 (losing the hint entirely)
  // and 0.00005 to 0.0001 (doubling the ratio the entry carries).
  assert.equal(
    canvasEntry(parse('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0.00001 0.00002"/>')),
    "0.00001x0.00002",
  );
  assert.equal(
    canvasEntry(parse('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0.00005 0.0001"/>')),
    "0.00005x0.0001",
  );
  // Across magnitudes, the emitted ratio matches the viewBox's to well within
  // the significant digits kept.
  for (const [w, h] of [
    [0.00001, 0.00002],
    [0.5, 0.25],
    [120, 80],
    [1234567, 7654321],
    [1e-15, 2e-15],
  ]) {
    const entry = canvasEntry(
      parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"/>`),
    );
    const [ew, eh] = entry.split("x").map(Number);
    assert.ok(ew > 0 && eh > 0, `${w}x${h} -> ${entry} must stay positive`);
    assert.ok(
      Math.abs(ew / eh - w / h) / (w / h) < 1e-5,
      `${w}x${h} -> ${entry} must preserve the aspect ratio`,
    );
  }
});

test("the canvas entry stays in the decimal notation its own reader accepts", () => {
  // %g-style formatting would render this as "1.00000e+6x500000", which
  // isCanvasEntry rejects: the entry would then be read back as a region id.
  const big = canvasEntry(
    parse('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000000 500000"/>'),
  );
  assert.equal(big, "1000000x500000");
  assert.equal(isCanvasEntry(big), true);
  // Fractional sizes keep their decimals, trimmed.
  assert.equal(
    canvasEntry(parse('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12.5 7.25"/>')),
    "12.5x7.25",
  );
  // Whatever the viewBox, an emitted entry always reads back as a canvas.
  for (const vb of ["0 0 1000000 500000", "0 0 0.001 0.002", "0 0 120 80", "0 0 1e7 1e7"]) {
    const entry = canvasEntry(
      parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"/>`),
    );
    if (entry !== "") assert.equal(isCanvasEntry(entry), true, `${vb} -> ${entry}`);
  }
});

// ── separators the layers spec cannot carry ────────────────────────────────
// The spec splits entries on "," and fields on ":", so any id or colour holding
// one is read back as several junk regions. A real-world `fill="rgba(255,0,0,.5)"`
// or an Inkscape label like "Ground floor, walls" both hit this.

test("functional colour notations parse instead of falling through as raw text", () => {
  assert.deepEqual(parseColor("rgba(255, 0, 0, 0.5)"), [255, 0, 0]);
  assert.deepEqual(parseColor("rgb(255 0 0 / 50%)"), [255, 0, 0]);
  assert.deepEqual(parseColor("rgb(100%, 0%, 0%)"), [255, 0, 0]);
  assert.deepEqual(parseColor("hsl(0, 100%, 50%)"), [255, 0, 0]);
  assert.deepEqual(parseColor("hsl(120 100% 25%)"), [0, 128, 0]);
  assert.deepEqual(parseColor("hsla(0, 0%, 100%, 0.2)"), [255, 255, 255]);
  assert.equal(parseColor("rgb(oops)"), null);
});

test("a hue carries its CSS angle unit, not just its number", () => {
  // All four are valid CSS and all four are cyan. isRenderableColor delegates
  // to CSS.supports, so a mis-read unit is never reported as invalid — the
  // region just comes out the wrong colour, which nothing downstream can catch.
  const CYAN = [0, 255, 255];
  assert.deepEqual(parseColor("hsl(180 100% 50%)"), CYAN, "bare number is degrees");
  assert.deepEqual(parseColor("hsl(180deg 100% 50%)"), CYAN);
  assert.deepEqual(parseColor("hsl(0.5turn 100% 50%)"), CYAN);
  assert.deepEqual(parseColor("hsl(.5turn 100% 50%)"), CYAN, "leading-dot number");
  assert.deepEqual(parseColor("hsl(200grad 100% 50%)"), CYAN);
  assert.deepEqual(parseColor("hsl(3.14159265rad 100% 50%)"), CYAN);
  // A full turn and none are the same hue, and a negative angle wraps.
  assert.deepEqual(parseColor("hsl(1turn 100% 50%)"), parseColor("hsl(0 100% 50%)"));
  assert.deepEqual(parseColor("hsl(-0.5turn 100% 50%)"), CYAN);
  // Only the hue is an angle: the other two stay percentages.
  assert.deepEqual(parseColor("hsl(0.25turn 100% 25%)"), parseColor("hsl(90 100% 25%)"));
  // And a hue that is not an angle is still no colour.
  assert.equal(parseColor("hsl(abc 100% 50%)"), null);
});

test("an rgba() fill round-trips through derive → format → parse", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <g id="walls" fill="rgba(255,0,0,0.5)"><rect width="10" height="10"/></g>
       <g id="rooms" fill="rgb(0 0 255)"><rect width="10" height="10"/></g>
     </svg>`,
  );
  const spec = formatLayers(deriveRegions(root));
  assert.equal(spec, "walls:red, rooms:blue");
  assert.deepEqual(parseLayerSpec(spec).entries, [
    { id: "walls", color: "red", height: "" },
    { id: "rooms", color: "blue", height: "" },
  ]);
});

test("an unparseable paint is stripped of the spec's separators, keeping url() case", () => {
  // A gradient reference is case-sensitive and must survive verbatim apart from
  // the separators; anything else is normalised to lower case as before.
  assert.equal(displayColor(null, "url(#MyGradient)"), "url(#MyGradient)");
  assert.equal(displayColor(null, "color-mix(in srgb, red, blue)"), "color-mix(insrgbredblue)");
  assert.ok(!displayColor(null, "lab(50% 40 59.5 / 0.5)").match(/[,:]/));
  assert.equal(displayColor(null, " , : "), "black");
});

test("an Inkscape label with spaces or commas becomes a valid, spec-safe id", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 100 100">
       <g inkscape:groupmode="layer" inkscape:label="Ground floor, walls" id="layer1" fill="gray">
         <rect width="10" height="10"/>
       </g>
       <g inkscape:groupmode="layer" inkscape:label="Térreo" id="layer2" fill="white">
         <rect width="10" height="10"/>
       </g>
     </svg>`,
  );
  const changes = applyFixes(root);
  assert.ok(changes.some((c) => c.includes('named "Ground_floor__walls"')));
  const spec = formatLayers(deriveRegions(root));
  assert.equal(spec, "Ground_floor__walls:gray, Térreo:white");
  // Unicode letters are valid NCName characters: renaming them would mangle
  // every non-English layer for nothing.
  assert.deepEqual(parseLayersArg(spec), ["Ground_floor__walls", "Térreo"]);
});

test("formatLayerSpec refuses a field that would corrupt the spec", () => {
  assert.throws(
    () => formatLayerSpec("", [{ id: "walls", color: "rgba(255,0,0,0.5)", height: "" }]),
    /separate entries/,
  );
  assert.throws(
    () => formatLayerSpec("", [{ id: "ground floor, walls", color: "gray", height: "" }]),
    /separate entries/,
  );
});

// ── the wizard's own trust class ───────────────────────────────────────────
// A user-supplied drawing is the one SVG class ScadPub does not trust
// (docs/config.md's trust model). Nothing here is exploitable today — a
// prepared SVG is mounted into the WASM filesystem and never rendered in the
// DOM — and that is precisely why the pipeline has to say so rather than rely
// on it.

test("check reports scripts, animation and external style references", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
       <script>alert(1)</script>
       <style>@import url("http://evil.test/x.css");.a{fill:red}</style>
       <a><animate attributeName="href" values="javascript:alert(1)"/></a>
       <rect class="a" width="5" height="5"/>
     </svg>`,
  );
  const found = check(root).find((f) => f.code === "active-content");
  assert.ok(found, "active content is reported");
  assert.equal(found.level, "WARN");
  for (const tag of ["<script>", "<animate>", "<style>"])
    assert.ok(found.message.includes(tag), `${tag} named`);
});

test("applyFixes strips what executes and what fetches, keeping the colours", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
       <script>alert(1)</script>
       <style>@import url("http://evil.test/x.css");.a{fill:red;background:url(http://evil.test/p.png)}.b{fill:url(#g)}</style>
       <animate attributeName="href" values="javascript:alert(1)"/>
       <rect class="a" width="5" height="5"/>
     </svg>`,
  );
  applyFixes(root);
  const svg = serializeSvg(root);
  assert.doesNotMatch(svg, /<script/i);
  assert.doesNotMatch(svg, /<animate/i);
  assert.doesNotMatch(svg, /@import/i);
  assert.doesNotMatch(svg, /evil\.test/);
  // CSS cannot execute, so the stylesheet itself stays — resolveStyleFills has
  // to read it, and the post-fix styled-fill check depends on it being there.
  assert.match(svg, /url\(#g\)/, "a same-document reference survives");
  assert.match(svg, /fill="red"/, "the stylesheet's colour reached the shape");
  assert.ok(check(root).every((f) => f.code !== "active-content"), "re-check is clean");
});

// ── the check codes nothing asserted ───────────────────────────────────────
// Several codes were only ever asserted as ABSENT (a Category A fixture raising
// no WARN), so a check that stopped firing entirely would have looked like a
// pass everywhere.

test("open-paths counts unclosed subpaths", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <path fill="black" d="M10,10 L90,10 L90,90"/>
       <path fill="black" d="M10,20 L20,20 Z"/>
     </svg>`,
  );
  const finding = check(root).find((f) => f.code === "open-paths");
  assert.ok(finding, "the unclosed path is reported");
  assert.match(finding.message, /1 unclosed path/);
});

test("region-is-label is an ERROR naming a layer requested by its label", () => {
  // The visitor asked for "walls", which exists as an inkscape:label but not as
  // an id — OpenSCAD selects by id, so the request resolves to nothing.
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 100 100">
       <g id="layer1" inkscape:groupmode="layer" inkscape:label="walls" fill="gray">
         <rect width="10" height="10"/>
       </g>
     </svg>`,
  );
  const finding = check(root, ["walls"]).find((f) => f.code === "region-is-label");
  assert.ok(finding);
  assert.equal(finding.level, "ERROR");
});

test("regions-available advertises only ids derivation can emit", () => {
  // `outer` wraps two id-groups and `empty` holds no shapes: neither becomes a
  // region, so neither may be advertised as one.
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <g id="outer">
         <g id="walls" fill="gray"><rect width="5" height="5"/></g>
         <g id="rooms" fill="white"><rect width="5" height="5"/></g>
       </g>
       <g id="empty"/>
     </svg>`,
  );
  const finding = check(root).find((f) => f.code === "regions-available");
  assert.ok(finding);
  assert.match(finding.message, /rooms, walls/);
  assert.ok(!finding.message.includes("outer"), "a wrapper group is not a region");
  assert.ok(!finding.message.includes("empty"), "a shapeless group is not a region");
  assert.deepEqual(
    deriveRegions(root).map((r) => r.id).sort(),
    ["rooms", "walls"],
    "and derivation agrees"
  );
});

test("too-many-regions cautions non-wizard consumers too", () => {
  // The caution used to live only in the wizard's JSX, so `check`'s other
  // consumers never saw it.
  const groups = Array.from(
    { length: MAX_RELIABLE_REGIONS + 1 },
    (_, i) => `<g id="r${i}" fill="gray"><rect width="2" height="2"/></g>`
  ).join("");
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${groups}</svg>`,
  );
  const finding = check(root).find((f) => f.code === "too-many-regions");
  assert.ok(finding);
  assert.equal(finding.level, "WARN");
});

test("shapes outside every region are reported rather than vanishing", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <g id="walls" fill="gray"><rect width="5" height="5"/></g>
       <g id="rooms" fill="white"><rect width="5" height="5"/></g>
       <circle cx="50" cy="50" r="4" fill="black"/>
     </svg>`,
  );
  const finding = check(root).find((f) => f.code === "shapes-outside-regions");
  assert.ok(finding, "the loose circle is reported");
  assert.match(finding.message, /1 shape/);
  // With no regions at all there is nothing to be outside of.
  const plain = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle r="4" fill="black"/></svg>`,
  );
  assert.ok(check(plain).every((f) => f.code !== "shapes-outside-regions"));
});

test("Region.mixed and .explicit describe how a region got its colour", () => {
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <g id="mixed"><rect width="5" height="5" fill="red"/><rect width="5" height="5" fill="red"/><rect width="5" height="5" fill="blue"/></g>
       <g id="implicit"><rect width="5" height="5"/></g>
     </svg>`,
  );
  const by = Object.fromEntries(deriveRegions(root).map((r) => [r.id, r]));
  // The dominant fill wins, and `mixed` records that it wasn't unanimous.
  assert.equal(by.mixed.color, "red");
  assert.equal(by.mixed.mixed, true);
  assert.equal(by.mixed.explicit, true);
  assert.equal(by.mixed.count, 3);
  // Nothing painted it: black by SVG default, and `explicit` says so.
  assert.equal(by.implicit.explicit, false);
  assert.equal(by.implicit.mixed, false);
});

test("parseSvg rejects what isn't a usable SVG — the wizard's only terminal error", () => {
  // The wizard has exactly one unrecoverable state, and this is what puts it
  // there. Nothing asserted it before.
  globalThis.DOMParser = DOMParser;
  for (const bad of ["", "   ", "not xml at all", "<html><body>hi</body></html>"]) {
    assert.throws(() => parseSvg(bad), JSON.stringify(bad));
  }
  assert.ok(parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>`));
});

test("the origin-fix wrapper doesn't blind the post-fix re-check", () => {
  // fixViewBoxOrigin wraps the drawing in a translate, and the coordinate
  // checks used to refuse to measure through ANY transform — so after the fix
  // ran they could no longer report a covering background or an
  // outside-the-viewBox overflow at all. contentBbox composes the transforms it
  // can (translate/scale) instead, so the re-check measures in the root frame.
  const root = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50">
       <title>A plan</title>
       <rect x="10" y="20" width="100" height="50" fill="white"/>
       <circle cx="50" cy="40" r="5" fill="black"/>
     </svg>`,
  );
  applyFixes(root);
  const fixed = roundtrip(root);
  assert.equal(fixed.getAttribute("viewBox"), "0 0 100 50");
  // The background was dropped on the way through, so a re-check is clean —
  // and clean because it looked, not because it was blinded.
  assert.ok(!codes(fixed).includes("covers-canvas"));

  // Re-introduce one under the wrapper, in the wrapper's own frame: the
  // translate is -10,-20, so a canvas-covering rect is at 10,20 locally.
  const wrapper = Array.from(fixed.getElementsByTagName("g"))[0];
  assert.ok(wrapper?.getAttribute("transform")?.includes("translate"), "the wrapper is a translate");
  const bg = fixed.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect");
  for (const [k, v] of [["x", "10"], ["y", "20"], ["width", "100"], ["height", "50"], ["fill", "white"]])
    bg.setAttribute(k, v);
  wrapper.appendChild(bg);
  assert.ok(codes(fixed).includes("covers-canvas"), "a background under the wrapper is still found");

  // <title> is the drawing's accessible name and belongs to <svg>, not to a
  // group a level down.
  const titles = Array.from(fixed.childNodes).filter(
    (n) => n.nodeType === 1 && n.localName === "title",
  );
  assert.equal(titles.length, 1, "<title> stayed a direct child of <svg>");
});

test("coordinate checks measure through composable transforms, and refuse others", () => {
  // The Illustrator shape: the whole drawing under one <g transform="translate">.
  // Refusing to measure through it meant this overflow was never reported.
  const shifted = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <g transform="translate(200,0)"><rect width="10" height="10" fill="black"/></g>
     </svg>`,
  );
  assert.ok(codes(shifted).includes("content-outside-viewbox"));

  // Content wholly inside an off-origin canvas must NOT be reported as outside
  // it once the origin fix has run — the frame the coordinates are read in has
  // to follow the frame the viewBox is written in.
  const inside = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50">
       <rect x="60" y="30" width="45" height="35" fill="black"/>
     </svg>`,
  );
  assert.ok(!codes(inside).includes("content-outside-viewbox"));
  applyFixes(inside);
  assert.ok(!codes(inside).includes("content-outside-viewbox"), "still inside after the fix");

  // A rotation does not map an axis-aligned box to one, so the honest answer is
  // still "cannot measure" rather than a wrong box.
  const rotated = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <g transform="rotate(45)"><rect width="10" height="10" fill="black"/></g>
     </svg>`,
  );
  assert.ok(!codes(rotated).includes("content-outside-viewbox"));
});

// --- Branches the suite exercised only in passing (item 24) ----------------
// Each of these was reachable but never asserted, so a rule could be inverted
// and the suite would stay green.

test("undersized fires on a drawing that fills under half its canvas, and not otherwise", () => {
  // A 30x30 shape on a 100x100 canvas is 9% of the area.
  const small = parse(
    `<svg viewBox="0 0 100 100"><rect x="10" y="10" width="30" height="30" fill="#f00"/></svg>`
  );
  assert.ok(codes(small).includes("undersized"), "a small drawing is flagged");
  // 80x80 is 64%: over the half-the-canvas line, so nothing is said.
  const big = parse(
    `<svg viewBox="0 0 100 100"><rect x="5" y="5" width="80" height="80" fill="#f00"/></svg>`
  );
  assert.ok(!codes(big).includes("undersized"), "a drawing that fills the canvas is not");
});

test("a background rectangle is recognised through percentage width/height", () => {
  // Editors emit `width="100%"`; read as a bare number it is 100 user units on
  // any canvas, which is right by accident at 100x100 and wrong everywhere else.
  const root = parse(
    `<svg viewBox="0 0 400 200">` +
      `<rect width="100%" height="100%" fill="#fff"/>` +
      `<circle cx="50" cy="50" r="10" fill="#f00"/>` +
      `</svg>`
  );
  assert.ok(codes(root).includes("covers-canvas"), "the percentage artboard is found");
});

test("a lone full-canvas rectangle is a solid tile, not a background", () => {
  // Nothing is buried, so there is nothing to warn about — dropping it would
  // leave an empty drawing.
  const root = parse(
    `<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#fff"/></svg>`
  );
  assert.ok(!codes(root).includes("covers-canvas"));
  const before = serializeSvg(root);
  applyFixes(root);
  assert.equal(serializeSvg(root), before, "and the Fix step leaves it alone");
});

test("the canvas-coverage threshold is a real boundary, not a coincidence", () => {
  const withRect = (w, h) =>
    parse(
      `<svg viewBox="0 0 100 100">` +
        `<rect x="0" y="0" width="${w}" height="${h}" fill="#fff"/>` +
        `<circle cx="50" cy="50" r="5" fill="#f00"/>` +
        `</svg>`
    );
  // COVER_FRAC is 0.9 on BOTH axes, and the box must also reach within 5% of
  // each edge.
  assert.ok(codes(withRect(96, 96)).includes("covers-canvas"), "96% x 96% covers");
  assert.ok(!codes(withRect(96, 80)).includes("covers-canvas"), "80% on one axis does not");
});

test("only a hole-free rectangle counts as a background", () => {
  const canvas = (shape) =>
    parse(
      `<svg viewBox="0 0 100 100">${shape}<circle cx="50" cy="50" r="5" fill="#f00"/></svg>`
    );
  const rectPolygon = `<polygon points="0,0 100,0 100,100 0,100" fill="#fff"/>`;
  assert.ok(codes(canvas(rectPolygon)).includes("covers-canvas"), "a rectangular polygon");
  const triangle = `<polygon points="0,0 100,0 50,100" fill="#fff"/>`;
  assert.ok(!codes(canvas(triangle)).includes("covers-canvas"), "a triangle is artwork");
  // Two subpaths is a frame with a hole: real artwork, never an artboard.
  const frame = `<path d="M0 0 H100 V100 H0 Z M10 10 H90 V90 H10 Z" fill="#fff"/>`;
  assert.ok(!codes(canvas(frame)).includes("covers-canvas"), "a frame is artwork");
});

test("stylesheet fills resolve by specificity: id beats class beats tag", () => {
  const root = parse(
    `<svg viewBox="0 0 10 10">` +
      `<style>rect { fill: #001; } .c { fill: #002; } #d { fill: #003; }</style>` +
      `<rect id="d" class="c" width="1" height="1"/>` +
      `<rect id="e" class="c" width="1" height="1"/>` +
      `<rect id="f" width="1" height="1"/>` +
      `</svg>`
  );
  applyFixes(root);
  const fillOf = (id) =>
    [...root.getElementsByTagName("rect")].find((r) => r.getAttribute("id") === id)
      ?.getAttribute("fill");
  assert.equal(fillOf("d"), "#003", "the id rule wins");
  assert.equal(fillOf("e"), "#002", "the class rule beats the tag rule");
  assert.equal(fillOf("f"), "#001", "the tag rule applies when nothing else does");
});

test("a later rule of the same specificity wins the tie", () => {
  const root = parse(
    `<svg viewBox="0 0 10 10">` +
      `<style>.c { fill: #001; } .c { fill: #002; }</style>` +
      `<rect class="c" width="1" height="1"/>` +
      `</svg>`
  );
  applyFixes(root);
  assert.equal(root.getElementsByTagName("rect")[0].getAttribute("fill"), "#002");
});

test("group-by-colour prunes the groups it empties", () => {
  // The shapes are lifted out of their original wrappers; leaving those behind
  // as empty <g id> elements would advertise regions that hold nothing.
  const root = parse(
    `<svg viewBox="0 0 10 10">` +
      `<g id="old"><rect width="1" height="1" fill="#f00"/><rect width="1" height="1" fill="#0f0"/></g>` +
      `</svg>`
  );
  // `old` is a named region, so nothing is loose: grouping refuses.
  assert.match(groupByColor(root).error, /already in a named/);

  const loose = parse(
    `<svg viewBox="0 0 10 10">` +
      `<g><g><rect width="1" height="1" fill="#f00"/></g><g><rect width="1" height="1" fill="#0f0"/></g></g>` +
      `</svg>`
  );
  assert.equal(groupByColor(loose).error, null);
  // Counted off the serialised output rather than a live NodeList: xmldom's
  // getElementsByTagName is live, and iterating one while the tree is being
  // read back is not something a test should depend on.
  assert.ok(
    !/<g[^>]*\/>|<g[^>]*>\s*<\/g>/.test(serializeSvg(loose)),
    "no empty group is left behind"
  );
  assert.equal(deriveRegions(loose).length, 2, "and the two colour regions derive");
});

test("a half-grouped drawing whose loose remainder is one colour is still grouped", () => {
  // The refusal is `order.length < 2 && shapes.length === allShapes.length`.
  // Dropping the second conjunct turns this into "only one colour found" and
  // the loose remainder never becomes a region.
  const root = parse(
    `<svg viewBox="0 0 10 10">` +
      `<g id="done"><rect width="1" height="1" fill="#00f"/></g>` +
      `<rect width="1" height="1" fill="#f00"/>` +
      `<rect width="1" height="1" fill="#f00"/>` +
      `</svg>`
  );
  const res = groupByColor(root);
  assert.equal(res.error, null, "not refused as single-colour");
  assert.equal(deriveRegions(root).length, 2, "the remainder became its own region");
});

test("check and applyFixes agree on which Inkscape layers are trapped", () => {
  // One rule, one scan (dom.ts's trappedLayers). Two independent scans is how
  // check reports a trap applyFixes no longer renames.
  const svg =
    `<svg viewBox="0 0 10 10" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">` +
    `<g id="layer1" inkscape:groupmode="layer" inkscape:label="walls"><rect width="1" height="1" fill="#f00"/></g>` +
    `<g id="roof" inkscape:groupmode="layer" inkscape:label="roof"><rect width="1" height="1" fill="#0f0"/></g>` +
    `</svg>`;
  const root = parse(svg);
  assert.ok(codes(root).includes("inkscape-trap"), "the id/label mismatch is reported");
  const changes = applyFixes(root);
  assert.ok(changes.some((c) => c.includes("walls")), "and renamed");
  assert.ok(!changes.some((c) => c.includes('"roof"')), "the already-named layer is untouched");
  assert.ok(!codes(root).includes("inkscape-trap"), "nothing is left trapped after the fix");
});
