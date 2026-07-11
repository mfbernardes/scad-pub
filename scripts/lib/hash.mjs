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

// computeBinAssetVersions — per-file content digests for the render worker's
// big binary assets (H4). computeRenderHash above already folds these same
// bytes into ONE combined hash so a change invalidates persisted L2 geometry,
// but H4 found a separate problem: the *fetch/cache identity* (worker.ts's
// BIN_CACHE Cache Storage keys, and the service worker's warm-up URLs) is a
// stable filename ("fonts/<name>", "wasm/openscad.wasm"), unrelated to
// renderHash. Replacing a bundled font's bytes without renaming it changes
// renderHash but NOT that URL, so a browser with the old bytes already cached
// keeps serving them under the new hash, poisoning cache identity.
//
// Giving each binary its own short digest, appended as a `?v=` query on its
// fetch URL (see src/lib/assetUrl.ts's versionedAssetUrl, used identically by
// worker.ts and the URLs this file's caller writes into
// precache-manifest.json's `bin.urls`), makes the fetch identity itself
// content-addressed: same bytes -> same URL -> a Cache Storage hit is always
// correct bytes; different bytes -> a different URL -> the old cache entry
// can never be mistaken for the new one, independent of whether wasmVersion
// changed.
export function computeBinAssetVersions({ fonts, outPublicDir }) {
  const digestFile = (abs) => {
    try {
      return createHash("sha256").update(readFileSync(abs)).digest("hex").slice(0, 16);
    } catch {
      return undefined; // asset not present in this build context (e.g. a fixture build)
    }
  };
  const result = {
    wasm: digestFile(join(outPublicDir, "wasm", "openscad.wasm")),
    // The Emscripten glue the worker dynamically imports alongside the wasm
    // binary (see M12/H3) — versioned too so a glue-only change also busts
    // any stale copy a browser had cached.
    glue: digestFile(join(outPublicDir, "wasm", "openscad.js")),
    fontsConf: digestFile(join(outPublicDir, "fonts", "fonts.conf")),
    fonts: {},
  };
  for (const name of [...fonts].sort()) {
    const d = digestFile(join(outPublicDir, "fonts", name));
    if (d) result.fonts[name] = d;
  }
  return result;
}
