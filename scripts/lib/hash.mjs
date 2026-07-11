// hash.mjs — computeRenderHash: a content hash over everything that determines a
// render's STL output. Folded into schema.renderHash (the render cache key) so
// any of it changing in a deploy invalidates persisted geometry automatically.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// The render-contract manifest hashed below (H3) is:
//   - design ROUTING: the id -> file map (designRouting) — swapping which file
//     an id points at must invalidate a cache keyed by design id, even though
//     the set of mounted files is unchanged.
//   - mounted SOURCES: every design/dependency .scad's relative path + bytes
//     (scadFiles, read from SOURCE).
//   - FEATURES + FORMAT: the OpenSCAD --enable/--export-format flags.
//   - BINARY ASSETS: the bundled font bytes + fonts.conf, and (in a real
//     build) the pinned openscad.wasm AND openscad.js glue — both extracted
//     files the worker fetches and runs (M12 verifies both on disk; this
//     folds both into the cache key so a corrupted/updated glue file also
//     busts stale geometry).
//   - RENDERER CODE: every local (`./`, `../`) source file transitively
//     imported by src/openscad/worker.ts — derived by resolveWorkerDependencyClosure
//     (scripts/lib/worker-deps.mjs) rather than hand-maintained, so a new
//     import (e.g. a helper worker.ts starts pulling in) is automatically
//     covered without anyone remembering to add it here. See
//     tests/worker-deps.test.mjs for the guard that keeps this true.
// Recipe version bumped for H3 (routing map, closure-derived renderer files,
// and openscad.js glue are new hash inputs versus v2).
//
// Deliberately EXCLUDED — presentation-only, cannot affect exported geometry:
// title/description/help/notices/licenses/popup/colors/ui/logo/extraCss,
// param labels/help text/section names/collapsed state, design description/
// icon/doc, restOnGrid (viewer framing only), and wasmVersion itself (implied
// by the hashed wasm/glue bytes, not the version string).
export function computeRenderHash({
  SOURCE,
  scadFiles,
  features,
  format,
  fonts,
  designRouting = [],
  rendererFiles,
  outPublicDir,
}) {
  const h = createHash("sha256");
  h.update("renderhash-v3\n"); // version of this recipe itself
  // Design routing: id -> file. Sorted by id so key order never affects the hash.
  for (const { id, file } of [...designRouting].sort((a, b) => a.id.localeCompare(b.id))) {
    h.update(`route\0${id}\0${file}\0`);
  }
  for (const rel of [...scadFiles].sort()) {
    h.update(`scad\0${rel}\0`);
    try {
      h.update(readFileSync(join(SOURCE, rel)));
    } catch {
      /* unreadable source — its absence is itself part of the hash */
    }
  }
  h.update(`features\0${[...features].sort().join(",")}\0`);
  // The export format is an OpenSCAD output flag, so it changes the rendered
  // bytes — fold it in so switching format invalidates persisted geometry.
  h.update(`format\0${format}\0`);
  if (outPublicDir) {
    // The render contract lives in app code, not the schema: hashing the worker
    // source means a change to its OpenSCAD flags or mounting logic invalidates
    // stale geometry without a manual cache-version bump.
    for (const abs of [...(rendererFiles ?? [])].sort()) {
      h.update(`renderer\0${abs.split(/[\\/]/).pop()}\0`);
      try {
        h.update(readFileSync(abs));
      } catch {
        /* renderer source unavailable in this build context */
      }
    }
    for (const name of [...fonts].sort()) {
      h.update(`font\0${name}\0`);
      try {
        h.update(readFileSync(join(outPublicDir, "fonts", name)));
      } catch {
        /* font not bundled here */
      }
    }
    // fontconfig matching rules — they steer which glyphs the text() geometry uses.
    try {
      h.update("fonts.conf\0");
      h.update(readFileSync(join(outPublicDir, "fonts", "fonts.conf")));
    } catch {
      /* no bundled fonts.conf */
    }
    try {
      h.update(readFileSync(join(outPublicDir, "wasm", "openscad.wasm")));
    } catch {
      /* wasm fetched separately; absent during some builds */
    }
    // openscad.js: the Emscripten glue the worker dynamically imports
    // (loadFactory in worker.ts). It runs alongside the wasm binary and can
    // change the render contract (different flag handling, FS glue) even
    // when the .wasm itself is unchanged — see M12.
    try {
      h.update(readFileSync(join(outPublicDir, "wasm", "openscad.js")));
    } catch {
      /* glue fetched separately; absent during some builds */
    }
  }
  return h.digest("hex").slice(0, 16);
}
