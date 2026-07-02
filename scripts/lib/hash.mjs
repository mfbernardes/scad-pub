// hash.mjs — computeRenderHash: a content hash over everything that determines a
// render's STL output. Folded into schema.renderHash (the render cache key) so
// any of it changing in a deploy invalidates persisted geometry automatically.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// A content hash over everything that determines a render's STL output — the
// mounted .scad sources, the bundled fonts (glyph outlines drive text geometry),
// the always-on render features, the OpenSCAD wasm build, and the renderer's own
// source (worker.ts, which fixes the OpenSCAD CLI flags — backend, export
// format, etc.). Folded into the render cache key (schema.renderHash) so any of
// these changing in a deploy invalidates persisted geometry automatically,
// rather than relying on a manual CACHE_VERSION bump for renderer-code changes.
// Fonts/wasm/renderer are hashed only when outPublicDir is given (the real
// build); the fixture tests omit it and hash just the sources + features.
export function computeRenderHash({ SOURCE, scadFiles, features, format, fonts, rendererFiles, outPublicDir }) {
  const h = createHash("sha256");
  h.update("renderhash-v2\n"); // version of this recipe itself
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
  }
  return h.digest("hex").slice(0, 16);
}
