// wasm-version.mjs — the single source of the pinned OpenSCAD WebAssembly
// snapshot version. Consumed by:
//   - scripts/fetch-wasm.mjs   (what to download + checksum-verify)
//   - scripts/gen-schema.mjs   (emitted as schema.wasmVersion, which names the
//     render worker's binary cache AND the service worker's warm target — see
//     src/openscad/worker.ts BIN_CACHE and public/sw.js)
// Bumping the version here re-pins everything in one edit. The checksum is
// only enforced when the version matches the pin (an env override skips it).

export const PINNED_WASM_VERSION = "2026.06.12";
export const WASM_VERSION = process.env.OPENSCAD_VERSION || PINNED_WASM_VERSION;
export const WASM_SHA256 =
  "509879dd6813f2c4e5cf2ce1da6420928ce9bb212cd08491ca5ec9d5bffc700b";
