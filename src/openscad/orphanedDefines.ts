// orphanedDefines.ts: the render worker's bundle-vs-sources skew guard.
//
// Lives here, not in lib/scad.ts with the rest of the -D conversion, for one
// reason: worker.ts imports it, and worker-deps.mjs hashes worker.ts's whole
// import closure into renderHash. scad.ts's other exports need the full `Param`
// union, so keeping this there dragged every parameter-annotation change (and
// numberDraft.ts, and types.ts) into the render cache's key. This function
// needs no types at all.

/**
 * Skew guard. The parameter *schema* is compiled into the JS bundle, but each
 * design's `.scad` source is fetched fresh at runtime. A stale cached bundle
 * (e.g. a service worker that hasn't picked up a deploy) can ask OpenSCAD to
 * `-D` a parameter the current source no longer declares, which OpenSCAD
 * reports as a confusing "unknown variable" warning. Return the define names
 * that don't appear as a top-level assignment in the source so the caller can
 * drop them and prompt the user to reload instead.
 *
 * Customizer parameters are top-level `name = …;` assignments whose name follows
 * OpenSCAD's identifier grammar (so the name needs no regex escaping). The
 * negative lookahead avoids matching an `==` comparison, and matching at any
 * indentation only errs toward "present", i.e. we flag a define only when its
 * name is genuinely absent.
 */
export function orphanedDefines(
  defineNames: Iterable<string>,
  source: string
): string[] {
  return [...defineNames].filter(
    (name) => !new RegExp(`^\\s*${name}\\s*=(?!=)`, "m").test(source)
  );
}
