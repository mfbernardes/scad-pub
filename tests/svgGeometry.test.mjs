// Direct tests for the path scanner behind src/lib/svgPrep/geometry.ts. It is
// what contentBbox reads, so a segment it drops shows up as a wrong "fills the
// canvas" / "outside the viewBox" verdict rather than as an error — the class
// of bug this file exists to pin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "@xmldom/xmldom";

import { contentBbox, gFormat, numbers, pathPoints } from "../src/lib/svgPrep/geometry.ts";

const parse = (svg) =>
  new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
const bbox = (pts) => [
  Math.min(...pts.map((p) => p[0])),
  Math.min(...pts.map((p) => p[1])),
  Math.max(...pts.map((p) => p[0])),
  Math.max(...pts.map((p) => p[1])),
];

test("absolute commands each contribute their endpoints and control points", () => {
  assert.deepEqual(pathPoints("M10 20 L30 40"), [
    [10, 20],
    [30, 40],
  ]);
  assert.deepEqual(pathPoints("M0 0 H50"), [
    [0, 0],
    [50, 0],
  ]);
  assert.deepEqual(pathPoints("M0 0 V50"), [
    [0, 0],
    [0, 50],
  ]);
  assert.deepEqual(pathPoints("M0 0 C1 2 3 4 5 6"), [
    [0, 0],
    [1, 2],
    [3, 4],
    [5, 6],
  ]);
  assert.deepEqual(pathPoints("M0 0 Q1 2 3 4"), [
    [0, 0],
    [1, 2],
    [3, 4],
  ]);
  assert.deepEqual(pathPoints("M0 0 S1 2 3 4"), [
    [0, 0],
    [1, 2],
    [3, 4],
  ]);
  assert.deepEqual(pathPoints("M0 0 L1 1 T5 5"), [
    [0, 0],
    [1, 1],
    [5, 5],
  ]);
});

test("relative commands accumulate, and Z returns to the subpath start", () => {
  assert.deepEqual(pathPoints("m10 10 l5 0 l0 5 z l1 1"), [
    [10, 10],
    [15, 10],
    [15, 15],
    [11, 11],
  ]);
  // Every coordinate of a relative curve is relative to the segment's start,
  // not to the previous control point.
  assert.deepEqual(pathPoints("M10 10 c1 1 2 2 3 3"), [
    [10, 10],
    [11, 11],
    [12, 12],
    [13, 13],
  ]);
});

test("a moveto's implicit repetition is a lineto", () => {
  // "M0 0 5 5 10 10" is M then two L, so the two later points are absolute
  // linetos rather than further movetos.
  assert.deepEqual(pathPoints("M0 0 5 5 10 10"), [
    [0, 0],
    [5, 5],
    [10, 10],
  ]);
  assert.deepEqual(pathPoints("m0 0 5 5 10 10"), [
    [0, 0],
    [5, 5],
    [15, 15],
  ]);
});

test("compact arc flags parse the same as space-separated ones", () => {
  // `a5 5 0 0110 0` is rx=5 ry=5 rot=0 large-arc=0 sweep=1 x=10 y=0: the two
  // flags are single characters, written unseparated from the x that follows.
  // Reading them as number tokens yields `0110` and shifts every later
  // argument, which used to abandon the rest of the path.
  assert.deepEqual(pathPoints("M0 0 a5 5 0 0110 0"), pathPoints("M0 0 a5 5 0 0 1 10 0"));
  assert.deepEqual(pathPoints("M0 0 a5 5 0 0110 0"), [
    [0, 0],
    [10, 0],
  ]);
  assert.deepEqual(pathPoints("M0 0 A5 5 0 1130 40"), [
    [0, 0],
    [30, 40],
  ]);
  // Implicit repetition of an arc, both flags merged with their neighbours.
  assert.deepEqual(pathPoints("M0 0 a5 5 0 0110 0 5 5 0 0110 10"), [
    [0, 0],
    [10, 0],
    [20, 10],
  ]);
});

test("a compact-flag path measures the same as its space-separated equivalent", () => {
  const compact = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <path d="M10,10 a20 20 0 0140 0 l0 30 z"/>
     </svg>`,
  );
  const spaced = parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <path d="M10,10 a20 20 0 0 1 40 0 l0 30 z"/>
     </svg>`,
  );
  assert.deepEqual(contentBbox(compact), contentBbox(spaced));
  assert.deepEqual(contentBbox(compact), [10, 10, 50, 40]);
});

test("a malformed segment costs that segment, not the rest of the path", () => {
  // The far corner is what a canvas-coverage or outside-the-viewBox check
  // depends on; dropping everything after the bad segment silently shrank it.
  const pts = pathPoints("M0 0 L10 10 L oops L90 90");
  assert.deepEqual(bbox(pts), [0, 0, 90, 90]);
  // A partial segment contributes nothing, and leaves the current point where
  // it was rather than at NaN.
  assert.deepEqual(pathPoints("M0 0 C1 1 2 2 l5 5"), [
    [0, 0],
    [5, 5],
  ]);
  assert.deepEqual(pathPoints("M0 0 a5 5 0 9 1 10 10 L4 4"), [
    [0, 0],
    [4, 4],
  ]);
  assert.deepEqual(pathPoints(""), []);
  assert.deepEqual(pathPoints("nonsense"), []);
});

test("numbers() reads a plain coordinate list, exponents included", () => {
  assert.deepEqual(numbers("0 0 100 50"), [0, 0, 100, 50]);
  assert.deepEqual(numbers("-1.5,2e3 .5"), [-1.5, 2000, 0.5]);
  assert.deepEqual(numbers(null), []);
});

test("gFormat writes ~6 significant digits, and switches to exponent notation above them", () => {
  assert.equal(gFormat(0), "0");
  assert.equal(gFormat(1.5), "1.5");
  assert.equal(gFormat(1 / 3), "0.333333");
  assert.equal(gFormat(-42), "-42");
  // Pinned deliberately: an exponent is acceptable here (gFormat writes SVG
  // transform/viewBox values, which accept it) but NOT in a layers spec, which
  // is why regions.ts formats its canvas entry with its own decimalFormat.
  assert.equal(gFormat(1e7), "1.00000e+7");
});
