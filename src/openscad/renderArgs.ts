// renderArgs.ts — pure helpers for the render worker (worker.ts). Extracted so
// the security-sensitive untrusted-filename handling, the source-relative FS
// mount-path computation, and the format -> OpenSCAD CLI-args mapping can be
// unit-tested without a browser/WASM module.
import type { ModelFormat } from "./types";

// A user file is treated as a font (mounted where fontconfig can find it) when
// its extension is one OpenSCAD/FreeType can load. Everything else is mounted at
// the FS root as a plain referenceable asset.
export function isFontFile(name: string): boolean {
  return /\.(ttf|otf|ttc)$/i.test(name);
}

// Strip any directory components from an untrusted upload name so it can't escape
// its mount dir: "../../etc/x" or "C:\\evil\\x" both collapse to "x". An empty
// result (a name that was nothing but separators) falls back to "file", as does
// a name that is only dots (".", "..") — not a security boundary (it can't
// escape the FS root), but "/.." resolves to the root directory itself, so
// userFileMountPath would try to mkdir/write over it and the mount would throw.
export function stripFilename(rawName: string): string {
  const stripped = rawName.replace(/^.*[\\/]/, "");
  // Empty (nothing but separators) or dot-only (".", "..") both fall back.
  return /^\.*$/.test(stripped) ? "file" : stripped;
}

// Absolute FS mount path for an untrusted user file: fonts go into /fonts (the
// only dir fontconfig scans), everything else at the FS root so a design can
// reference it by bare name (e.g. `import("logo.svg")`).
export function userFileMountPath(rawName: string): string {
  const name = stripFilename(rawName);
  return isFontFile(name) ? `/fonts/${name}` : `/${name}`;
}

// M10: two distinct raw upload names can sanitize (via stripFilename, above)
// to the same mount path — e.g. "a/logo.svg" and "b/logo.svg" both collapse to
// "/logo.svg", or "x.ttf" and "y/../x.ttf" both collapse to "/fonts/x.ttf".
// Mounting both would have the last one written (Object.entries iteration
// order, itself an unspecified detail of the caller's map) silently overwrite
// the other, with no signal to the user that one of their uploads never took
// effect. Returns, for each colliding mount path, every raw name that maps to
// it — only paths with 2+ contributing names are included (a path with one
// contributor isn't a collision). Empty object when there are no collisions.
export function detectMountCollisions(
  files: Record<string, Uint8Array> | undefined
): Record<string, string[]> {
  const byMount: Record<string, string[]> = {};
  for (const rawName of Object.keys(files ?? {})) {
    const mount = userFileMountPath(rawName);
    (byMount[mount] ??= []).push(rawName);
  }
  const collisions: Record<string, string[]> = {};
  for (const [mount, names] of Object.entries(byMount)) {
    if (names.length > 1) collisions[mount] = names;
  }
  return collisions;
}

// The chain of ancestor directories to create for `dir`, outermost first, each
// an absolute path — the pure half of `mkdir -p` (worker.ts's mkdirp wraps this
// with FS.mkdir + swallow-if-exists). A leading slash, empty segments, and a
// trailing slash are all tolerated; "", "/" and "//" yield [] (the FS root
// already exists, so there's nothing to make).
export function mkdirPaths(dir: string): string[] {
  const paths: string[] = [];
  let cur = "";
  for (const part of dir.split("/").filter(Boolean)) {
    cur += "/" + part;
    paths.push(cur);
  }
  return paths;
}

// The parent directory a source-relative file mounts into, as an absolute path,
// so its ancestors can be created before the file is written. "sub/lib.scad" ->
// "/sub"; a top-level "tag.scad" -> "" (the FS root, which always exists — mkdirp
// then makes nothing). Mirrors the `/${path}` mount target used in worker.ts.
export function mountDir(path: string): string {
  return `/${path}`.replace(/\/[^/]*$/, "");
}

export interface ExportSpec {
  /** OpenSCAD `--export-format` flag. */
  flag: string;
  /** Output path written by `-o`. */
  file: string;
  /** Extra `-O` export options (3MF colour encoding). */
  extra: string[];
}

// The export format is chosen at build time (config -> schema). 3MF carries
// per-object colour (manifold writes each `color(...)` into the file, which the
// viewer and downstream slicers read back); STL is geometry-only.
export function exportFor(format: ModelFormat): ExportSpec {
  return format === "stl"
    ? { flag: "binstl", file: "/out.stl", extra: [] }
    : {
        flag: "3mf",
        file: "/out.3mf",
        // Write per-object colour as a 3MF colour group (color-mode=model,
        // material-type=color) — the encoding BambuStudio / OrcaSlicer read.
        extra: [
          "-O",
          "export-3mf/color-mode=model",
          "-O",
          "export-3mf/material-type=color",
        ],
      };
}

/**
 * Build the full OpenSCAD command line for a render. `staleDefines` (names the
 * freshly-fetched source no longer declares — see orphanedDefines) are dropped
 * so OpenSCAD doesn't warn cryptically about unknown variables.
 */
export function buildOpenscadArgs(opts: {
  designFile: string;
  format: ModelFormat;
  features: readonly string[];
  defines: Record<string, string>;
  staleDefines?: readonly string[];
}): string[] {
  const { designFile, format, features, defines, staleDefines = [] } = opts;
  const exportSpec = exportFor(format);
  const featureArgs = features.map((f) => `--enable=${f}`);
  const defineArgs = Object.entries(defines).flatMap(([k, v]) =>
    staleDefines.includes(k) ? [] : ["-D", `${k}=${v}`]
  );
  return [
    `/${designFile}`,
    "--backend=manifold",
    `--export-format=${exportSpec.flag}`,
    ...exportSpec.extra,
    ...featureArgs,
    ...defineArgs,
    "-o",
    exportSpec.file,
  ];
}
