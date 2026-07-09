// assets.mjs — resolving a design's shared .scad (and other) dependencies into
// the set of source-relative files gen-schema copies into public/scad. Two
// sources of truth: the config's `assets` list (files, whole directories, or
// globs) via `expandConfiguredAssets`, or — when that's omitted — each design's
// `use`/`include` graph via `collectDeps`. The helpers close over SOURCE, so
// they're built once per generate() run by `createAssetTools`.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative, sep } from "node:path";

// A `use <path>` / `include <path>` dependency directive.
const DEP_RE = /^\s*(?:use|include)\s*<([^>]+)>/;

/**
 * Build the SOURCE-bound asset resolution helpers used by generate().
 * @param {object} opts
 * @param {string} opts.SOURCE  Absolute path of the design source directory.
 * @param {string} opts.configPath  For error messages when an asset is missing.
 * @param {(abs: string, what: string) => string} opts.mustExist  Fail-fast existence check.
 */
export function createAssetTools({ SOURCE, configPath, mustExist }) {
  // A source-relative POSIX path (the key the renderer mounts files under).
  const relPosix = (absPath) => relative(SOURCE, absPath).split(sep).join("/");

  // Fail when a resolved path escapes SOURCE. copyAsset (gen-schema.mjs) copies
  // a dependency to `join(outScadDir, relPosix(abs))`, so an escaping path
  // (e.g. `use <../../secret.scad>`, or a config `assets`/`designs[].file`
  // entry doing the same) would otherwise write — or read — outside the
  // source root. `referencedFrom` names the file that pointed at `abs`.
  const checkContained = (abs, what, referencedFrom) => {
    const rel = relative(SOURCE, abs);
    if (rel === ".." || rel.startsWith(`..${sep}`))
      throw new Error(
        `gen-schema: ${what} escapes the source root:\n  ${abs}\n` +
          `  (source root: ${SOURCE})\n` +
          `  (referenced from ${referencedFrom})`
      );
    return abs;
  };

  // Every .scad under a directory (recursively), as source-relative POSIX paths.
  const scadFilesUnder = (absDir) => {
    const out = [];
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) out.push(...scadFilesUnder(abs));
      else if (entry.name.endsWith(".scad")) out.push(relPosix(abs));
    }
    return out;
  };

  // Every file under a directory (recursively), as source-relative POSIX paths.
  const filesUnder = (absDir) => {
    const out = [];
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) out.push(...filesUnder(abs));
      else out.push(relPosix(abs));
    }
    return out;
  };

  // A glob entry uses `*` or `?` wildcards rather than naming a concrete file or
  // directory. (`[`…`]` classes aren't supported — they'd be matched literally.)
  const isGlob = (entry) => /[*?]/.test(entry);

  // Compile one glob path-segment (no slashes) to an anchored RegExp: `*` spans
  // any run of non-separator characters, `?` a single one, everything else is a
  // literal (regex metacharacters escaped so a pattern can't inject regex).
  const segmentToRe = (seg) => {
    let re = "";
    for (const ch of seg) {
      if (ch === "*") re += "[^/]*";
      else if (ch === "?") re += "[^/]";
      else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${re}$`);
  };

  // Match files under SOURCE against a POSIX glob. `*`/`?` match within a single
  // path segment; `**` spans zero or more directories (so `lib/**/*.scad` reaches
  // nested files, `**/*.svg` every svg in the tree, `lib/**` every file under
  // lib). Only files match — directories are traversed, never emitted, mirroring
  // copyAsset which copies a file. Returns source-relative POSIX paths.
  const globAssets = (pattern) => {
    const segments = pattern.split("/").filter(Boolean);
    const out = [];
    const walk = (absDir, relParts, segIdx) => {
      const seg = segments[segIdx];
      const last = segIdx === segments.length - 1;
      if (seg === "**") {
        // Trailing `**`: every file at or below here. Otherwise `**` consumes
        // zero directories (match the rest right here) or one+ (descend, retry).
        if (last) {
          for (const f of filesUnder(absDir)) out.push(f);
          return;
        }
        walk(absDir, relParts, segIdx + 1);
        for (const entry of readdirSync(absDir, { withFileTypes: true }))
          if (entry.isDirectory())
            walk(join(absDir, entry.name), [...relParts, entry.name], segIdx);
        return;
      }
      const re = segmentToRe(seg);
      for (const entry of readdirSync(absDir, { withFileTypes: true })) {
        if (!re.test(entry.name)) continue;
        const parts = [...relParts, entry.name];
        if (last) {
          if (entry.isFile()) out.push(parts.join("/"));
        } else if (entry.isDirectory()) {
          walk(join(absDir, entry.name), parts, segIdx + 1);
        }
      }
    };
    walk(SOURCE, [], 0);
    return out;
  };

  // Expand the config's `assets`: a glob (`*`/`?`/`**`) contributes every file it
  // matches; a directory contributes all the .scad under it; a plain file is
  // taken as-is. So "lib" bundles lib/*.scad, "lib/*.scad" the same explicitly,
  // and "**/*.svg" every svg in the tree.
  const expandConfiguredAssets = (entries) => {
    const set = new Set();
    for (const entry of entries) {
      if (isGlob(entry)) {
        const matches = globAssets(entry);
        if (!matches.length)
          throw new Error(
            `gen-schema: asset pattern '${entry}' matched no files under ${SOURCE}\n` +
              `  (referenced from ${configPath} — check its 'assets' globs)`
          );
        for (const f of matches) set.add(f);
        continue;
      }
      const abs = mustExist(resolve(SOURCE, entry), `asset '${entry}'`);
      checkContained(abs, `asset '${entry}'`, configPath);
      if (statSync(abs).isDirectory()) {
        for (const f of scadFilesUnder(abs)) set.add(f);
      } else {
        set.add(relPosix(abs));
      }
    }
    return set;
  };

  // Walk the use/include graph from a design, returning every dependency's
  // source-relative POSIX path. Each `<path>` is resolved relative to the file
  // that references it, matching OpenSCAD. Used only when `assets` is omitted.
  const collectDeps = (designAbs) => {
    const deps = new Set();
    const visited = new Set([designAbs]);
    const queue = [designAbs];
    while (queue.length) {
      const cur = queue.shift();
      const curDir = dirname(cur);
      const text = readFileSync(cur, "utf-8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(DEP_RE);
        if (!m) continue;
        const depAbs = resolve(curDir, m[1].trim());
        if (visited.has(depAbs)) continue;
        visited.add(depAbs);
        checkContained(depAbs, `dependency '${m[1].trim()}'`, relPosix(cur));
        deps.add(relPosix(depAbs));
        queue.push(depAbs);
      }
    }
    return deps;
  };

  return { relPosix, expandConfiguredAssets, collectDeps, checkContained };
}
