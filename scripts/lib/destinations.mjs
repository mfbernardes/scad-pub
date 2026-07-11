// destinations.mjs — a single ownership registry for every file gen-schema
// (and its helpers: assets.mjs, pwa-assets.mjs) writes into the served tree.
//
// H6 — collision guard: every planned destination is registered with a human
// label (what is writing it) BEFORE the bytes move. A second write aimed at
// the same destination fails the build immediately, naming both owners,
// instead of silently overwriting — the failure mode that let an `extraCss`
// basename clobber a design's .scad output while renderHash kept describing
// the original bytes. `outScadDir` (render sources, presets, per-design
// icons/docs, logos, extraCss) is one flat namespace on disk, so it shares
// one registry; callers give every write a distinctive label so a collision
// message is actionable.
//
// M8 — lifecycle: `outScadDir` itself is fully wiped and repopulated by
// gen-schema.mjs every run (see generate()), so nothing there needs
// reconciliation — a removed config entry can't leave an orphan. The public
// root and public/fonts are different: they mix files this tool generates
// with files it must never touch (Vite's own output, the tracked bundled
// .ttf, a contributor's hand-placed favicon, …), so they can't be wiped
// wholesale. Instead `reconcileGenerated` persists the list of paths THIS
// tool wrote on the previous run and deletes only ones that (a) it wrote
// before and (b) it did not write this run — never a path outside that
// remembered set. A first run (no manifest yet) deletes nothing.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/** A fresh per-generate() destination registry (H6). */
export function createDestinationRegistry() {
  const owners = new Map(); // absPath -> label

  // Reserve `absPath` for `label`. Throws — naming both owners — if something
  // already claimed it. Call this before writing, for every generated file.
  function register(absPath, label) {
    const existing = owners.get(absPath);
    if (existing)
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
// which is wiped wholesale) against what it wrote last time (M8). `manifestPath`
// stores the previous run's file list (JSON array of absolute paths);
// `currentAbsPaths` is every path this run actually wrote (including the
// manifest's own directory need not be created — callers pass real output
// paths only). A missing/corrupt manifest is treated as "nothing to clean up"
// (e.g. first run after this feature shipped) rather than a failure.
export function reconcileGenerated(manifestPath, currentAbsPaths) {
  let prev = [];
  if (existsSync(manifestPath)) {
    try {
      prev = JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch {
      prev = [];
    }
  }
  const current = new Set(currentAbsPaths);
  for (const f of prev) {
    if (!current.has(f)) {
      try {
        rmSync(f, { force: true });
      } catch {
        /* already gone */
      }
    }
  }
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify([...current].sort(), null, 2) + "\n");
}
