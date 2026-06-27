// renderArgs.ts — pure helpers for the render worker (worker.ts). Extracted so
// the security-sensitive untrusted-filename handling and the format -> OpenSCAD
// CLI-args mapping can be unit-tested without a browser/WASM module.
import type { ModelFormat } from "./types";

// A user file is treated as a font (mounted where fontconfig can find it) when
// its extension is one OpenSCAD/FreeType can load. Everything else is mounted at
// the FS root as a plain referenceable asset.
export function isFontFile(name: string): boolean {
  return /\.(ttf|otf|ttc)$/i.test(name);
}

// Strip any directory components from an untrusted upload name so it can't escape
// its mount dir: "../../etc/x" or "C:\\evil\\x" both collapse to "x". An empty
// result (a name that was nothing but separators) falls back to "file".
export function stripFilename(rawName: string): string {
  return rawName.replace(/^.*[\\/]/, "") || "file";
}

// Absolute FS mount path for an untrusted user file: fonts go into /fonts (the
// only dir fontconfig scans), everything else at the FS root so a design can
// reference it by bare name (e.g. `import("logo.svg")`).
export function userFileMountPath(rawName: string): string {
  const name = stripFilename(rawName);
  return isFontFile(name) ? `/fonts/${name}` : `/${name}`;
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
