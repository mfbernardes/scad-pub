// worker.ts — runs OpenSCAD-WASM off the main thread. Keeps the UI responsive
// during renders (callMain is synchronous and CPU-bound). Fetches the WASM, the
// shared .scad dependency files, and the bundled fonts once, then instantiates a
// fresh module per render (the reliable pattern; Emscripten's exit state isn't
// meant to be reused). The compiled wasm bytes are cached so only the first
// render pays the download.

/// <reference lib="webworker" />
import schema from "../generated/designs.json";
import type { ModelFormat, RenderRequest, RenderResult } from "./types";
import { assetUrl as asset } from "../lib/assetUrl";
import { orphanedDefines } from "../lib/scad";
import { buildOpenscadArgs, exportFor, userFileMountPath } from "./renderArgs";

// Persistent cache for the big, version-pinned binaries (the ~10 MB WASM and
// the fonts), so reloads are instant and the app works offline. The cache name
// carries the pinned OpenSCAD version (single-sourced via schema.wasmVersion
// from scripts/wasm-version.mjs) — a WASM bump renames the cache so stale
// binaries are evicted. The small, build-volatile .scad sources are NOT cached
// here (they change every build).
// Neutral, NOT namespaced per config: the WASM binary is identical across
// deployments, so sharing this cache across configs on one origin avoids
// re-downloading ~10 MB. The service worker warms this same cache at install
// (see public/sw.js), so offline works even before the first render.
const BIN_CACHE = `openscad-wasm-bin-${
  (schema as { wasmVersion?: string }).wasmVersion ?? "2026.06.12"
}`;

async function cleanupOldCaches() {
  if (typeof caches === "undefined") return;
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((k) => k.startsWith("openscad-wasm-bin-") && k !== BIN_CACHE)
      .map((k) => caches.delete(k))
  );
}

// Cache-first fetch of an immutable binary into an ArrayBuffer.
async function cachedBuffer(url: string): Promise<ArrayBuffer> {
  if (typeof caches === "undefined") return (await fetch(url)).arrayBuffer();
  const cache = await caches.open(BIN_CACHE);
  const hit = await cache.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (res.ok) await cache.put(url, res.clone());
  return res.arrayBuffer();
}

// OpenSCAD WASM factory: default export of the snapshot's openscad.js.
type OpenSCADFactory = (opts: Record<string, unknown>) => Promise<OpenSCADInstance>;
interface OpenSCADInstance {
  callMain(args: string[]): number | undefined;
  FS: {
    mkdir(path: string): void;
    writeFile(path: string, data: string | Uint8Array): void;
    readFile(path: string): Uint8Array;
  };
}

let factoryPromise: Promise<OpenSCADFactory> | null = null;
let wasmBinary: ArrayBuffer | null = null;
let wasmModulePromise: Promise<WebAssembly.Module | null> | null = null;
// Shared .scad dependency files, keyed by their source-relative path.
let assetSources: Record<string, string> | null = null;
const designSources: Record<string, string> = {};
let fontFiles: Record<string, Uint8Array> | null = null;
let fontsConf: string | null = null;

async function loadFactory(): Promise<OpenSCADFactory> {
  const mod = await import(/* @vite-ignore */ asset("wasm/openscad.js"));
  return mod.default as OpenSCADFactory;
}

// One-shot, memoized asset load. The four independent downloads (WASM
// fetch+compile, shared .scad sources, fonts.conf, font binaries) run in
// parallel — serialized they made the cold first render pay each round-trip
// back to back. Memoizing the whole promise also makes concurrent callers
// share one load instead of racing the per-variable checks.
let assetsReady: Promise<void> | null = null;

function ensureAssets(): Promise<void> {
  return (assetsReady ??= (async () => {
    void cleanupOldCaches();
    factoryPromise = loadFactory();
    await Promise.all([
      (async () => {
        wasmBinary = await cachedBuffer(asset("wasm/openscad.wasm"));
        wasmModulePromise = WebAssembly.compile(wasmBinary).catch(() => null);
        await wasmModulePromise;
      })(),
      (async () => {
        const entries = await Promise.all(
          schema.assets.map(async (p) => [
            p,
            await (await fetch(asset(`scad/${p}`))).text(),
          ])
        );
        assetSources = Object.fromEntries(entries) as Record<string, string>;
      })(),
      (async () => {
        fontsConf = await (await fetch(asset("fonts/fonts.conf"))).text();
      })(),
      (async () => {
        const entries = await Promise.all(
          schema.fonts.map(async (n) => [
            n,
            new Uint8Array(await cachedBuffer(asset(`fonts/${n}`))),
          ])
        );
        fontFiles = Object.fromEntries(entries) as Record<string, Uint8Array>;
      })(),
    ]);
  })());
}

async function loadDesignSource(path: string): Promise<string> {
  if (!(path in designSources))
    designSources[path] = await (await fetch(asset(`scad/${path}`))).text();
  return designSources[path];
}

function mkdirp(FS: OpenSCADInstance["FS"], dir: string) {
  let cur = "";
  for (const part of dir.split("/").filter(Boolean)) {
    cur += "/" + part;
    try {
      FS.mkdir(cur);
    } catch {
      /* exists */
    }
  }
}

// Announce (once) that the renderer's assets are downloaded and ready, so the
// UI can drop its "loading renderer" state and show normal render progress.
let announcedReady = false;

async function render(req: RenderRequest): Promise<RenderResult> {
  await ensureAssets();
  if (!announcedReady) {
    announcedReady = true;
    (self as DedicatedWorkerGlobalScope).postMessage({ type: "ready" });
  }
  // Start timing only after the (one-time) asset download + WASM compile, so the
  // reported `ms` reflects actual render cost, not the first-load download. The
  // main thread uses this to decide a render is "heavy" and pause live updates;
  // counting the ~10 MB download would spuriously trip that brake on the first
  // render and silently stop parameter edits from re-rendering.
  const t0 = performance.now();
  const factory = await factoryPromise!;
  const log: string[] = [];
  const capture = (s: string) => (line: string) => log.push(`[${s}] ${line}`);
  const wasmModule = await wasmModulePromise;
  const opts: Record<string, unknown> = {
    noInitialRun: true,
    wasmBinary: wasmBinary!,
    locateFile: (path: string) => asset(`wasm/${path}`),
    print: capture("out"),
    printErr: capture("err"),
  };

  if (wasmModule) {
    opts.instantiateWasm = (
      imports: WebAssembly.Imports,
      receiveInstance: (instance: WebAssembly.Instance) => void
    ) => {
      receiveInstance(new WebAssembly.Instance(wasmModule, imports));
      return {};
    };
  }

  const instance = await factory(opts);
  const { FS } = instance;

  // Fonts (bundled Liberation) and a writable cache dir.
  mkdirp(FS, "/fonts");
  mkdirp(FS, "/fontconfig-cache");
  FS.writeFile("/fonts/fonts.conf", fontsConf!);
  for (const [name, bytes] of Object.entries(fontFiles!))
    FS.writeFile(`/fonts/${name}`, bytes);

  // Write a source-relative file into the FS, creating its parent directory.
  const mount = (path: string, src: string | Uint8Array) => {
    mkdirp(FS, `/${path}`.replace(/\/[^/]*$/, ""));
    FS.writeFile(`/${path}`, src);
  };

  // Shared dependency files at their source-relative paths, so each design's
  // `use`/`include` resolves exactly as it does in the source tree.
  for (const [path, src] of Object.entries(assetSources!)) mount(path, src);

  // User-supplied files, mounted AFTER the bundled assets so an upload can
  // override a default of the same name (e.g. swap the bundled emblem.svg).
  // Filenames are untrusted, so strip any path components (a name like "../x"
  // can't escape its mount dir). Fonts go into /fonts so fontconfig (which only
  // scans /fonts) picks them up for text(); every other file is mounted at the
  // FS root so a design can reference it by name, e.g. `import("logo.svg")`.
  for (const [rawName, bytes] of Object.entries(req.userFiles ?? {}))
    FS.writeFile(userFileMountPath(rawName), bytes);

  // The selected design, mounted at its own source-relative path.
  const design = schema.designs.find((d) => d.id === req.design);
  if (!design) throw new Error(`unknown design: ${req.design}`);
  const designSrc = await loadDesignSource(design.file);
  mount(design.file, designSrc);

  // Skew guard: a stale cached bundle may carry parameters the freshly-fetched
  // source has since dropped. Don't pass those to OpenSCAD (it'd warn cryptically
  // about an unknown variable); report them so the UI can prompt for a reload.
  const staleDefines = orphanedDefines(Object.keys(req.defines), designSrc);
  if (staleDefines.length)
    log.push(
      `[skew] this build is out of date — ignoring parameter(s) the design no ` +
        `longer defines: ${staleDefines.join(", ")}. Reload to update.`
    );

  // The cast widens the JSON's literal so the comparison is legal.
  const format = schema.format as ModelFormat;
  const EXPORT = exportFor(format);
  const args = buildOpenscadArgs({
    designFile: design.file,
    format,
    features: schema.features,
    defines: req.defines,
    staleDefines,
  });
  log.push(`[cmd] openscad ${args.join(" ")}`);

  let exitCode = 0;
  try {
    exitCode = instance.callMain(args) ?? 0;
  } catch (e) {
    log.push(`[throw] ${e instanceof Error ? e.message : String(e)}`);
    exitCode = typeof e === "number" ? e : 1;
  }

  // The exported model bytes (3MF or STL per schema.format). The field is named
  // `stl` for historical reasons across the worker/runner/cache protocol.
  let stl: Uint8Array = new Uint8Array(0);
  try {
    stl = FS.readFile(EXPORT.file);
  } catch {
    /* no output */
  }

  return {
    id: req.id,
    ok: exitCode === 0 && stl.length > 0,
    exitCode,
    stl,
    log,
    ms: Math.round(performance.now() - t0),
    ...(staleDefines.length ? { staleDefines } : {}),
  };
}

self.onmessage = async (e: MessageEvent<RenderRequest>) => {
  try {
    const result = await render(e.data);
    // Transfer the STL buffer to avoid a copy.
    (self as DedicatedWorkerGlobalScope).postMessage(result, [
      result.stl.buffer as ArrayBuffer,
    ]);
  } catch (err) {
    const result: RenderResult = {
      id: e.data.id,
      ok: false,
      exitCode: 1,
      stl: new Uint8Array(0),
      log: [`[error] ${err instanceof Error ? err.message : String(err)}`],
      ms: 0,
    };
    (self as DedicatedWorkerGlobalScope).postMessage(result);
  }
};
