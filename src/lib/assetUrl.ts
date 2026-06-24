// assetUrl.ts — build a base-path-aware absolute URL for a static asset. Works
// in both the main thread and the render worker (`location` resolves to either
// `window` or the worker global). `path` is relative to the deployed base
// (import.meta.env.BASE_URL), e.g. assetUrl("scad/lib/plate.scad").
export function assetUrl(path: string): string {
  return new URL(import.meta.env.BASE_URL + path, location.origin).href;
}
