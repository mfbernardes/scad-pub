// destinations.mjs: a single ownership registry for every file gen-schema
// (and its helpers: assets.mjs, pwa-assets.mjs) writes into the served tree.
//
// H6: every planned destination is registered with a human label (what is
// writing it) BEFORE the bytes move, so a second write aimed at the same
// destination fails the build naming both owners instead of silently
// overwriting — the failure mode that let an `extraCss` basename clobber a
// design's .scad output while renderHash kept describing the original bytes.
// `outScadDir` is one flat namespace on disk, so it shares one registry; give
// every write a distinctive label so a collision message is actionable.
//
// M8: `outScadDir` is wiped and repopulated every run, so nothing there needs
// reconciliation. The public root and public/fonts mix generated files with
// files this tool must never touch, so they cannot be wiped wholesale —
// `reconcileGenerated` handles them, under the three guards and the
// relative-path containment rule docs/config-pipeline.md sets out.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, relative, resolve, isAbsolute, sep } from "node:path";

/** A fresh per-generate() destination registry (H6). */
export function createDestinationRegistry() {
  const owners = new Map(); // absPath -> label

  // Reserve `absPath` for `label`. Throws (naming both owners) if a
  // DIFFERENT owner already claimed it. Call this before writing, for every
  // generated file. Re-registering the same destination under the SAME label
  // is idempotent, not a collision: the label encodes the source (e.g.
  // `source file 'widget.scad'`), so an identical label means the identical
  // source copied to the identical destination. That happens for supported
  // configs where a catch-all re-includes a file already copied: e.g.
  // `assets: ["."]` or `assets: ["**/*.scad"]` picking up a design's own
  // .scad that buildDesigns already staged. Only a different owner writing the
  // same path is the silent-clobber this guard exists to catch.
  function register(absPath, label) {
    const existing = owners.get(absPath);
    if (existing !== undefined && existing !== label)
      throw new Error(
        `gen-schema: generated output collision at\n  ${absPath}\n` +
          `  already written by: ${existing}\n` +
          `  also requested by:  ${label}`
      );
    owners.set(absPath, label);
    return absPath;
  }

  return { register };
}

// Whether a path relative to some root leaves it. `..` is a path COMPONENT, so
// the test is component-aware: `startsWith("..")` also rejects the perfectly
// ordinary in-root name `..shot.png`, which is how such a file came to be
// copied on the first build and then orphaned forever — the manifest entry
// went, the file stayed, and no later build would reconcile it.
const escapes = (rel) => rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);

// Whether `abs` really lives under `root` once every symlink on the way is
// resolved. The lexical checks above only ever see the string.
//
// The PARENT is resolved rather than the path itself, so that a candidate which
// is itself a symlink is judged by where it sits, not by what it points at:
// removing a link inside the root removes the link and never its target. A
// parent that cannot be resolved (it does not exist) means there is nothing to
// delete, which is equally a reason to skip.
function containsReal(root, abs) {
  let realRoot;
  let realParent;
  try {
    realRoot = realpathSync(root);
    realParent = realpathSync(dirname(abs));
  } catch {
    return false;
  }
  if (realParent === realRoot) return true;
  return !escapes(relative(realRoot, realParent));
}

// Reconcile a set of paths this tool owns end-to-end (outside outScadDir,
// which is wiped wholesale) against what it wrote last time (M8). Entries are
// `{ path, sha256 }`, stored RELATIVE to `root` so a moved, copied or tampered
// manifest can never authorise a delete outside the current output root; a bare
// string is the pre-digest shape, still read so an older manifest cleans up
// after itself. A missing or corrupt manifest means "nothing to clean up", not
// a failure. `isProtected(abs)` vetoes a delete — gen-schema passes
// `isTrackedFile`, which cannot be imported here without a cycle. See
// docs/config-pipeline.md.
export function reconcileGenerated(manifestPath, root, currentAbsPaths, isProtected = () => false) {
  let prev = [];
  if (existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf-8"));
      if (Array.isArray(parsed))
        prev = parsed
          .map((e) =>
            typeof e === "string"
              ? { path: e, sha256: null }
              : e && typeof e.path === "string"
                ? { path: e.path, sha256: typeof e.sha256 === "string" ? e.sha256 : null }
                : null
          )
          .filter(Boolean);
    } catch {
      prev = [];
    }
  }
  const currentRel = new Set(currentAbsPaths.map((p) => relative(root, p)));
  for (const { path: rel, sha256 } of prev) {
    if (currentRel.has(rel)) continue;
    // Containment: never delete an entry that isn't a relative path strictly
    // inside `root`. The question is asked of the RESOLVED path, so `a/../..`
    // is caught as surely as a leading `..`, and asked per component, so a file
    // merely NAMED `..shot.png` is reconciled like any other.
    if (isAbsolute(rel)) continue;
    const abs = resolve(root, rel);
    if (escapes(relative(root, abs))) continue;
    // …and the same question again of the FILESYSTEM, not just of the string.
    // A directory symlink inside the root — `public/escape -> ../outside` —
    // makes `escape/victim.txt` resolve cleanly inside `root` while every
    // operation on it lands outside. Verified: the file outside was deleted.
    //
    // Checked BEFORE the digest and the isProtected veto below, because both
    // read through the link, and a digest that matches is not permission to
    // delete something that was never in the root to begin with.
    if (!containsReal(root, abs)) continue;
    // Belt and braces: only delete bytes this tool is still the author of. If
    // the file has been replaced since (a contributor committing a font that
    // happened to share a name with a transient copy, a hand edit), it is no
    // longer ours to remove.
    if (sha256 !== null && existsSync(abs) && digestOf(abs) !== sha256) {
      console.warn(
        `gen-schema: leaving ${rel} in place — it was generated by a previous run but has ` +
          `changed since, so it is no longer this tool's to remove. Delete it by hand if it ` +
          `really is stale.`
      );
      continue;
    }
    if (existsSync(abs) && isProtected(abs)) {
      console.warn(
        `gen-schema: leaving ${rel} in place — it was generated by a previous run but is now ` +
          `tracked by git, so removing it would delete a committed file. Delete it by hand if ` +
          `it really is stale.`
      );
      continue;
    }
    try {
      rmSync(abs, { force: true });
    } catch {
      /* already gone */
    }
  }
  mkdirSync(dirname(manifestPath), { recursive: true });
  const entries = [...currentRel]
    .sort()
    .map((rel) => ({ path: rel, sha256: digestOf(resolve(root, rel)) }));
  writeFileSync(manifestPath, JSON.stringify(entries, null, 2) + "\n");
}

function digestOf(abs) {
  try {
    return createHash("sha256").update(readFileSync(abs)).digest("hex");
  } catch {
    return null; // never written, or already gone: nothing to protect
  }
}
