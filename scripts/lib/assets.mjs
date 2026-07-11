// assets.mjs — resolving a design's shared .scad (and other) dependencies into
// the set of source-relative files gen-schema copies into public/scad. Two
// sources of truth: the config's `assets` list (files, whole directories, or
// globs) via `expandConfiguredAssets`, or — when that's omitted — each design's
// `use`/`include` graph via `collectDeps`. The helpers close over SOURCE, so
// they're built once per generate() run by `createAssetTools`.
//
// Symlink policy (H5): every path this module resolves is canonicalized with
// `realpathSync` and checked against the canonical SOURCE root — not just the
// lexical path, which a symlink can trivially point away from. A symlink
// (file or directory, anywhere in the tree — a design, an explicit asset, a
// directory/glob match, or a use/include target) is allowed only when its
// *resolved target* also stays under canonical SOURCE; one that escapes is
// rejected with the same "escapes the source root" diagnostic as a lexical
// `../` escape. This is a containment allowlist, not a "reject all symlinks"
// policy, so a design tree can still use symlinks for internal organisation.
// Destination paths (what gets written under public/scad/, and the mounted
// path the renderer's use/include sees) stay the *lexical* path — the
// symlink's own location in the tree — never the resolved target's location,
// so a design's use/include graph keeps resolving exactly as it does on disk.
// Symlink cycles (a link resolving back to one of its own ancestor
// directories) are caught explicitly during traversal and fail with a
// dedicated diagnostic instead of recursing indefinitely; a symlink chain long
// enough to trip the OS's own ELOOP is reported the same way.
//
// Config-owned paths (app icon, iconMaskable, screenshots, logo, extraCss —
// resolved relative to the config file's directory, CONFIG_DIR) are a
// separate trust boundary and are NOT checked against SOURCE here; they obey
// only `mustExist` (gen-schema.mjs / pwa-assets.mjs). The config author who
// controls CONFIG_DIR is assumed to also control what it points at.
import { readFileSync, readdirSync, statSync, realpathSync } from "node:fs";
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
  // Canonical source root. Resolved once; every containment check compares
  // against this rather than the (possibly symlinked) lexical SOURCE, so a
  // SOURCE directory that is itself reached through a symlink still gets a
  // stable root to check against.
  const REAL_SOURCE = realpathSync(SOURCE);

  // A source-relative POSIX path (the key the renderer mounts files under).
  // Lexical, by design (see module comment) — not the realpath.
  const relPosix = (absPath) => relative(SOURCE, absPath).split(sep).join("/");

  // Resolve an existing path to its canonical form and enforce the symlink
  // containment policy: the resolved target must remain under REAL_SOURCE,
  // exactly like a non-symlink path must remain under SOURCE lexically. A
  // symlink chain that loops back on itself surfaces from the OS as ELOOP;
  // reported with the same diagnostic shape as every other containment
  // failure rather than propagating a raw native error.
  const resolveReal = (abs, what, referencedFrom) => {
    let real;
    try {
      real = realpathSync(abs);
    } catch (err) {
      if (err.code === "ELOOP")
        throw new Error(
          `gen-schema: ${what} is a symlink cycle:\n  ${abs}\n` +
            `  (referenced from ${referencedFrom})`,
          { cause: err }
        );
      throw err;
    }
    const rel = relative(REAL_SOURCE, real);
    if (rel === ".." || rel.startsWith(`..${sep}`)) {
      const viaSymlink = real !== abs;
      throw new Error(
        `gen-schema: ${what} escapes the source root${viaSymlink ? " (symlink target)" : ""}:\n` +
          `  ${abs}${viaSymlink ? `\n  resolves to ${real}` : ""}\n` +
          `  (source root: ${SOURCE})\n` +
          `  (referenced from ${referencedFrom})`
      );
    }
    return real;
  };

  // Fail when a resolved path escapes SOURCE. copyAsset (gen-schema.mjs) copies
  // a dependency to `join(outScadDir, relPosix(abs))`, so an escaping path
  // (e.g. `use <../../secret.scad>`, a config `assets`/`designs[].file` entry
  // doing the same, or a symlink resolving outside SOURCE) would otherwise
  // write — or read — outside the source root. `referencedFrom` names the
  // file that pointed at `abs`.
  const checkContained = (abs, what, referencedFrom) => {
    resolveReal(abs, what, referencedFrom);
    return abs;
  };

  // List a directory's entries, resolving each symlink (file or directory)
  // against the containment policy above. A broken symlink is skipped rather
  // than failing the build — the same tolerance a plain missing file would
  // get from a bare `fs.existsSync` scan. Returns `{ name, real, isDir,
  // isFile }`; `real` is the canonical path used for cycle/dedupe tracking by
  // the walkers below (never for building destination paths — see module
  // comment).
  const listSafe = (absDir, referencedFrom) =>
    readdirSync(absDir, { withFileTypes: true }).flatMap((entry) => {
      const abs = join(absDir, entry.name);
      if (entry.isSymbolicLink()) {
        const real = resolveReal(abs, `symlink '${entry.name}'`, referencedFrom);
        let st;
        try {
          st = statSync(real);
        } catch {
          return []; // broken symlink target — ignore
        }
        return [{ name: entry.name, real, isDir: st.isDirectory(), isFile: st.isFile() }];
      }
      if (entry.isDirectory()) return [{ name: entry.name, real: abs, isDir: true, isFile: false }];
      if (entry.isFile()) return [{ name: entry.name, real: abs, isDir: false, isFile: true }];
      return []; // other types (fifo, socket, …) ignored
    });

  // Recursively visit every file under `absDir`, calling `onFile(relParts,
  // realAbs)` for each. `ancestors` is the set of canonical directory paths on
  // the current recursion stack: a directory (or a directory-resolving
  // symlink) that points back at one of them is a cycle and fails with a
  // diagnostic instead of recursing forever. `visited` dedupes distinct paths
  // that resolve to the same canonical directory (e.g. two symlinks pointing
  // at the same target) so they aren't walked twice.
  const walkFiles = (absDir, relParts, referencedFrom, onFile, ancestors, visited) => {
    for (const e of listSafe(absDir, referencedFrom)) {
      const nextRel = [...relParts, e.name];
      if (e.isDir) {
        if (ancestors.has(e.real))
          throw new Error(
            `gen-schema: symlink cycle: '${nextRel.join("/")}' resolves back to an ancestor directory\n` +
              `  (referenced from ${referencedFrom})`
          );
        if (visited.has(e.real)) continue;
        visited.add(e.real);
        ancestors.add(e.real);
        walkFiles(e.real, nextRel, referencedFrom, onFile, ancestors, visited);
        ancestors.delete(e.real);
      } else if (e.isFile) {
        onFile(nextRel, e.real);
      }
    }
  };

  // Start a walkFiles() traversal rooted at `absDir` (itself already
  // containment-checked by the caller), seeding the cycle/dedupe sets with its
  // own canonical path and the SOURCE-relative prefix so emitted relative
  // paths are rooted at SOURCE (matching relPosix), not at absDir.
  const collectFiles = (absDir, referencedFrom, onFile) => {
    const real0 = realpathSync(absDir);
    const initRel = relative(SOURCE, absDir).split(sep).filter(Boolean);
    walkFiles(absDir, initRel, referencedFrom, onFile, new Set([real0]), new Set([real0]));
  };

  // Every .scad under a directory (recursively), as source-relative POSIX paths.
  const scadFilesUnder = (absDir, referencedFrom) => {
    const out = [];
    collectFiles(absDir, referencedFrom, (relParts) => {
      if (relParts[relParts.length - 1].endsWith(".scad")) out.push(relParts.join("/"));
    });
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
  // copyAsset which copies a file. Returns source-relative POSIX paths. Symlinks
  // encountered during the walk obey the same containment/cycle policy as every
  // other traversal in this module.
  const globAssets = (pattern) => {
    const referencedFrom = `${configPath} (asset pattern '${pattern}')`;
    const segments = pattern.split("/").filter(Boolean);
    const out = [];
    const descend = (e, parts, cb, ancestors, visited) => {
      if (ancestors.has(e.real))
        throw new Error(
          `gen-schema: symlink cycle: '${parts.join("/")}' resolves back to an ancestor directory\n` +
            `  (referenced from ${referencedFrom})`
        );
      if (visited.has(e.real)) return;
      visited.add(e.real);
      ancestors.add(e.real);
      cb();
      ancestors.delete(e.real);
    };
    const walk = (absDir, relParts, segIdx, ancestors, visited) => {
      const seg = segments[segIdx];
      const last = segIdx === segments.length - 1;
      const entries = listSafe(absDir, referencedFrom);
      if (seg === "**") {
        if (last) {
          for (const e of entries) {
            const parts = [...relParts, e.name];
            if (e.isFile) out.push(parts.join("/"));
            else if (e.isDir)
              descend(
                e,
                parts,
                () => walkFiles(e.real, parts, referencedFrom, (rp) => out.push(rp.join("/")), ancestors, visited),
                ancestors,
                visited
              );
          }
          return;
        }
        walk(absDir, relParts, segIdx + 1, ancestors, visited);
        for (const e of entries) {
          if (e.isDir)
            descend(e, [...relParts, e.name], () => walk(e.real, [...relParts, e.name], segIdx, ancestors, visited), ancestors, visited);
        }
        return;
      }
      const re = segmentToRe(seg);
      for (const e of entries) {
        if (!re.test(e.name)) continue;
        const parts = [...relParts, e.name];
        if (last) {
          if (e.isFile) out.push(parts.join("/"));
        } else if (e.isDir) {
          descend(e, parts, () => walk(e.real, parts, segIdx + 1, ancestors, visited), ancestors, visited);
        }
      }
    };
    const real0 = realpathSync(SOURCE);
    walk(SOURCE, [], 0, new Set([real0]), new Set([real0]));
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
        for (const f of scadFilesUnder(abs, configPath)) set.add(f);
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
        try {
          statSync(depAbs);
        } catch {
          throw new Error(
            `gen-schema: dependency '${m[1].trim()}' not found:\n  ${depAbs}\n` +
              `  (referenced by ${relPosix(cur)})`
          );
        }
        checkContained(depAbs, `dependency '${m[1].trim()}'`, relPosix(cur));
        deps.add(relPosix(depAbs));
        queue.push(depAbs);
      }
    }
    return deps;
  };

  return { relPosix, expandConfiguredAssets, collectDeps, checkContained };
}
