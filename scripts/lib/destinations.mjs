// destinations.mjs: a single ownership registry for every file gen-schema
// (and its helpers: assets.mjs, pwa-assets.mjs) writes into the served tree.
//
// H6: collision guard: every planned destination is registered with a human
// label (what is writing it) BEFORE the bytes move. A second write aimed at
// the same destination fails the build immediately, naming both owners,
// instead of silently overwriting: the failure mode that let an `extraCss`
// basename clobber a design's .scad output while renderHash kept describing
// the original bytes. `outScadDir` (render sources, presets, per-design
// icons/docs, logos, extraCss) is one flat namespace on disk, so it shares
// one registry; callers give every write a distinctive label so a collision
// message is actionable.
//
// M8: lifecycle: `outScadDir` itself is fully wiped and repopulated by
// gen-schema.mjs every run (see generate()), so nothing there needs
// reconciliation. A removed config entry can't leave an orphan. The public
// root and public/fonts are different: they mix files this tool generates
// with files it must never touch (Vite's own output, the tracked bundled
// .ttf, a contributor's hand-placed favicon, …), so they can't be wiped
// wholesale. Instead `reconcileGenerated` persists the list of paths THIS
// tool wrote on the previous run and deletes only ones that (a) it wrote
// before and (b) it did not write this run, never a path outside that
// remembered set. A first run (no manifest yet) deletes nothing.
//
// Two guards keep "it wrote before" from ever meaning "a tracked file with the
// same name". gen-schema refuses outright to stage a font copy over a
// git-tracked destination (a config font shadowing a bundled one is a real
// conflict, not something to overwrite silently), so such a path never enters
// the manifest. And each entry records the digest of the bytes this tool wrote:
// a path whose content has changed since is somebody else's file now, and is
// left alone with a warning.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, relative, resolve, isAbsolute } from "node:path";

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

// Reconcile a set of paths this tool owns end-to-end (outside outScadDir,
// which is wiped wholesale) against what it wrote last time (M8).
//
// Entries are stored and compared RELATIVE to `root` (the reconciliation
// boundary: e.g. public/), never as absolute host paths: absolute paths in
// the persisted manifest leaked the build-host checkout path into any copy of
// it and made it a stale/tampered manifest an authority to `rmSync` files
// anywhere on disk. Storing relative and re-resolving under `root`, plus a
// containment check before every delete: means a moved, copied, or hand-
// edited manifest can only ever remove files inside the current output root.
// The manifest file itself lives OUTSIDE `root` (see the caller) so it isn't
// swept up into the built site.
//
// `currentAbsPaths` is every path this run actually wrote. A missing/corrupt/
// non-array manifest is treated as "nothing to clean up" (e.g. first run after
// this feature shipped) rather than a failure.
//
// Entries are `{ path, sha256 }`. A bare string is the pre-digest shape, kept
// readable so an older manifest still cleans up its own copies; it just has no
// digest to check against.
export function reconcileGenerated(manifestPath, root, currentAbsPaths) {
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
    // inside `root`. `relative(root, resolve(root, rel))` starting with ".."
    // (or `rel` being absolute) means it escapes: skip it rather than trust it.
    if (isAbsolute(rel) || rel.startsWith("..")) continue;
    const abs = resolve(root, rel);
    if (relative(root, abs).startsWith("..")) continue;
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
