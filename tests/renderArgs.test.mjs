// Tests the render worker's pure helpers (src/openscad/renderArgs.ts): the
// untrusted-filename handling (a security boundary — uploads must not escape
// their mount dir) and the build-time format -> OpenSCAD CLI-args mapping. These
// run in the real worker (worker.ts) but were unreachable from `npm test` until
// they were extracted here.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isFontFile,
  stripFilename,
  userFileMountPath,
  exportFor,
  buildOpenscadArgs,
} from "../src/openscad/renderArgs.ts";

test("isFontFile matches font extensions case-insensitively only", () => {
  for (const f of ["a.ttf", "A.OTF", "x.ttc", "Liberation.TtF"])
    assert.equal(isFontFile(f), true, f);
  for (const f of ["a.svg", "logo.png", "data.json", "noext", "font.ttf.txt"])
    assert.equal(isFontFile(f), false, f);
});

test("stripFilename drops every directory component (POSIX and Windows)", () => {
  assert.equal(stripFilename("plain.ttf"), "plain.ttf");
  assert.equal(stripFilename("dir/sub/file.svg"), "file.svg");
  assert.equal(stripFilename("C:\\Users\\me\\evil.ttf"), "evil.ttf");
  assert.equal(stripFilename("mixed\\path/to\\x.otf"), "x.otf");
});

test("stripFilename neutralises path-traversal upload names", () => {
  // The security contract: a crafted name must not be able to write outside the
  // mount dir. After stripping, only the final segment survives.
  assert.equal(stripFilename("../../../etc/passwd"), "passwd");
  assert.equal(stripFilename("../../fonts/x.ttf"), "x.ttf");
  // A name that is nothing but separators leaves no segment -> safe fallback.
  assert.equal(stripFilename("/"), "file");
  assert.equal(stripFilename("../../"), "file");
  assert.equal(stripFilename(""), "file");
});

test("userFileMountPath routes fonts to /fonts and everything else to root", () => {
  assert.equal(userFileMountPath("MyFont.ttf"), "/fonts/MyFont.ttf");
  assert.equal(userFileMountPath("emblem.svg"), "/emblem.svg");
  // Traversal + routing combined: still confined under the intended dir.
  assert.equal(userFileMountPath("../../sneaky.ttf"), "/fonts/sneaky.ttf");
  assert.equal(userFileMountPath("../../sneaky.svg"), "/sneaky.svg");
  assert.equal(userFileMountPath("/"), "/file");
});

test("exportFor: 3mf carries the colour-group options, stl is geometry-only", () => {
  assert.deepEqual(exportFor("3mf"), {
    flag: "3mf",
    file: "/out.3mf",
    extra: [
      "-O",
      "export-3mf/color-mode=model",
      "-O",
      "export-3mf/material-type=color",
    ],
  });
  assert.deepEqual(exportFor("stl"), { flag: "binstl", file: "/out.stl", extra: [] });
});

test("buildOpenscadArgs emits the design, backend, format, features and defines", () => {
  const args = buildOpenscadArgs({
    designFile: "widget.scad",
    format: "3mf",
    features: ["textmetrics", "lazy-union"],
    defines: { width: "10", label: '"hi"' },
  });
  assert.deepEqual(args, [
    "/widget.scad",
    "--backend=manifold",
    "--export-format=3mf",
    "-O",
    "export-3mf/color-mode=model",
    "-O",
    "export-3mf/material-type=color",
    "--enable=textmetrics",
    "--enable=lazy-union",
    "-D",
    "width=10",
    "-D",
    'label="hi"',
    "-o",
    "/out.3mf",
  ]);
});

test("buildOpenscadArgs drops stale defines but keeps the rest", () => {
  const args = buildOpenscadArgs({
    designFile: "d.scad",
    format: "stl",
    features: [],
    defines: { keep: "1", gone: "2", also: "3" },
    staleDefines: ["gone"],
  });
  // The stale define and its value are both absent...
  assert.ok(!args.includes("gone=2"));
  // ...while the surviving defines are still passed.
  assert.ok(args.includes("keep=1"));
  assert.ok(args.includes("also=3"));
  // STL output, no 3MF colour options.
  assert.equal(args.at(-1), "/out.stl");
  assert.ok(!args.includes("export-3mf/color-mode=model"));
});
