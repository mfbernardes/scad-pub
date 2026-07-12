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
  detectMountCollisions,
  mkdirPaths,
  mountDir,
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

test("stripFilename falls back for names that are only dots", () => {
  // Not a security boundary (dots can't escape the FS root), but "." and ".."
  // are directory names themselves: mounting there would try to overwrite the
  // FS root and throw. Neutralise them the same way as an empty name.
  assert.equal(stripFilename("."), "file");
  assert.equal(stripFilename(".."), "file");
  assert.equal(stripFilename("..."), "file");
  assert.equal(stripFilename("dir/.."), "file");
  assert.equal(stripFilename("dir/."), "file");
});

test("userFileMountPath routes fonts to /fonts and everything else to root", () => {
  assert.equal(userFileMountPath("MyFont.ttf"), "/fonts/MyFont.ttf");
  assert.equal(userFileMountPath("emblem.svg"), "/emblem.svg");
  // Traversal + routing combined: still confined under the intended dir.
  assert.equal(userFileMountPath("../../sneaky.ttf"), "/fonts/sneaky.ttf");
  assert.equal(userFileMountPath("../../sneaky.svg"), "/sneaky.svg");
  assert.equal(userFileMountPath("/"), "/file");
  // A dot-only name would otherwise mount at "/.." (the FS root) and the
  // write would throw; it must resolve to the same safe fallback as "/".
  assert.equal(userFileMountPath(".."), "/file");
  assert.equal(userFileMountPath("."), "/file");
});

// ---- M10: sanitized mount-path collisions ----

test("detectMountCollisions is empty for distinct sanitized names", () => {
  const files = {
    "a/logo.svg": new Uint8Array(),
    "b/other.svg": new Uint8Array(),
    "font.ttf": new Uint8Array(),
  };
  assert.deepEqual(detectMountCollisions(files), {});
});

test("detectMountCollisions finds two raw names that sanitize to the same path", () => {
  const files = {
    "a/logo.svg": new Uint8Array(),
    "b/logo.svg": new Uint8Array(), // both strip to "/logo.svg"
  };
  const collisions = detectMountCollisions(files);
  assert.deepEqual(Object.keys(collisions), ["/logo.svg"]);
  assert.deepEqual(collisions["/logo.svg"].sort(), ["a/logo.svg", "b/logo.svg"]);
});

test("detectMountCollisions finds font aliases colliding under /fonts", () => {
  const files = {
    "x.ttf": new Uint8Array(),
    "sub/x.ttf": new Uint8Array(), // both strip to "/fonts/x.ttf"
  };
  const collisions = detectMountCollisions(files);
  assert.deepEqual(Object.keys(collisions), ["/fonts/x.ttf"]);
});

test("detectMountCollisions can report multiple independent collisions", () => {
  const files = {
    "a/logo.svg": new Uint8Array(),
    "b/logo.svg": new Uint8Array(),
    "x.ttf": new Uint8Array(),
    "y/x.ttf": new Uint8Array(),
    "unique.svg": new Uint8Array(),
  };
  const collisions = detectMountCollisions(files);
  assert.deepEqual(Object.keys(collisions).sort(), ["/fonts/x.ttf", "/logo.svg"]);
});

test("detectMountCollisions handles undefined/empty file sets", () => {
  assert.deepEqual(detectMountCollisions(undefined), {});
  assert.deepEqual(detectMountCollisions({}), {});
});

test("mkdirPaths returns each ancestor dir outermost-first, absolute", () => {
  assert.deepEqual(mkdirPaths("a/b/c"), ["/a", "/a/b", "/a/b/c"]);
  assert.deepEqual(mkdirPaths("/fonts"), ["/fonts"]);
  assert.deepEqual(mkdirPaths("/fontconfig-cache"), ["/fontconfig-cache"]);
});

test("mkdirPaths tolerates leading/trailing/double slashes and blanks", () => {
  // Nothing to create for the root (or an empty path): the FS root always exists.
  assert.deepEqual(mkdirPaths(""), []);
  assert.deepEqual(mkdirPaths("/"), []);
  assert.deepEqual(mkdirPaths("//"), []);
  // A leading slash and a trailing slash both collapse to the same segments.
  assert.deepEqual(mkdirPaths("/a/b/"), ["/a", "/a/b"]);
  assert.deepEqual(mkdirPaths("a//b"), ["/a", "/a/b"]);
});

test("mountDir yields the parent dir of a source-relative mount path", () => {
  assert.equal(mountDir("sub/lib.scad"), "/sub");
  assert.equal(mountDir("a/b/c.scad"), "/a/b");
  // A top-level file mounts at the FS root, whose parent is "" (mkdirp makes
  // nothing) — the invariant worker.ts relies on for its default design.
  assert.equal(mountDir("tag.scad"), "");
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
