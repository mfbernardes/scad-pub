// assetUrl.ts — build a base-path-aware absolute URL for a static asset. Works
// in both the main thread and the render worker (`location` resolves to either
// `window` or the worker global). `path` is relative to the deployed base
// (import.meta.env.BASE_URL), e.g. assetUrl("scad/lib/plate.scad").
export function assetUrl(path: string): string {
  return new URL(import.meta.env.BASE_URL + path, location.origin).href;
}

// H4: append a `?v=<digest>` query so a binary asset's fetch/Cache-Storage
// identity is content-addressed, not just a stable filename. worker.ts uses
// this for every request it makes into its version-pinned BIN_CACHE (the wasm
// binary, bundled fonts); the digests come from schema.binAssets (see
// types.ts), computed at build time in scripts/lib/hash.mjs. The service
// worker's warm-up (public/sw.js) is handed the identical versioned URL
// string via precache-manifest.json's `bin.urls` — see gen-schema.mjs's
// versionedPath, the one-line mirror of this function used on that side.
// Undefined `digest` (a fixture/dev build with no binAssets entry) degrades to
// the plain unversioned URL rather than throwing.
export function versionedAssetUrl(path: string, digest?: string): string {
  const url = assetUrl(path);
  return digest ? `${url}?v=${digest}` : url;
}
