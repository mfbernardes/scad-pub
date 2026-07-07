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
  check,
  deriveLayers,
  deriveRegions,
  formatLayers,
  groupByColor,
  parseLayersArg,
  prepareSvg,
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
  assert.match(applyFixes(root).join(" "), /normalised viewBox origin/);
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
  assert.match(res.error, /already inside a named/);
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
  assert.match(groupByColor(root).error, /transform\/clip\/mask/);
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
  assert.equal(a.derivedLayers, "walls:gray, rooms:white");
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
  assert.equal(res.layers, "gray, white");
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
  assert.equal(prepareSvg(root, { deriveColours: true }).layers, "l:green, r:orange");
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
