// worker.ts — runs OpenSCAD-WASM off the main thread. Keeps the UI responsive
// during renders (callMain is synchronous and CPU-bound). Fetches the WASM, the
// shared .scad dependency files, and the bundled fonts once, then instantiates a
// fresh module per render (the reliable pattern; Emscripten's exit state isn't
// meant to be reused). The compiled wasm bytes are cached so only the first
// render pays the download.

/// <reference lib="webworker" />
import schema from "../generated/designs.json";
import type { RenderRequest, RenderResult } from "./types";
import { assetUrl as asset } from "../lib/assetUrl";

// Persistent cache for the big, version-pinned binaries (the ~10 MB WASM and
// the fonts), so reloads are instant and the app works offline. The cache name
// carries the pinned OpenSCAD version (see scripts/fetch-wasm.mjs) — bump it when
// the WASM is bumped so stale binaries are evicted. The small, build-volatile
// .scad sources are NOT cached here (they change every build).
// Neutral, NOT namespaced per config: the WASM binary is identical across
// deployments, so sharing this cache across configs on one origin avoids
// re-downloading ~10 MB. The date suffix is the cache-bust key.
const BIN_CACHE = "openscad-wasm-bin-2026.06.12";

async function cleanupOldCaches() {
  if (typeof caches === "undefined") return;
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter(
        (k) =>
          (k.startsWith("openscad-wasm-bin-") || k.startsWith("taktildots-bin-")) &&
          k !== BIN_CACHE
      )
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
let designSources: Record<string, string> = {};
let fontFiles: Record<string, Uint8Array> | null = null;
let fontsConf: string | null = null;

async function loadFactory(): Promise<OpenSCADFactory> {
  const mod = await import(/* @vite-ignore */ asset("wasm/openscad.js"));
  return mod.default as OpenSCADFactory;
}

async function ensureAssets() {
  if (!factoryPromise) {
    void cleanupOldCaches();
    factoryPromise = loadFactory();
  }
  if (!wasmBinary) wasmBinary = await cachedBuffer(asset("wasm/openscad.wasm"));
  if (!wasmModulePromise) {
    wasmModulePromise = WebAssembly.compile(wasmBinary).catch(() => null);
  }
  await wasmModulePromise;
  if (!assetSources) {
    const entries = await Promise.all(
      schema.assets.map(async (p) => [
        p,
        await (await fetch(asset(`scad/${p}`))).text(),
      ])
    );
    assetSources = Object.fromEntries(entries) as Record<string, string>;
  }
  if (!fontsConf)
    fontsConf = await (await fetch(asset("fonts/fonts.conf"))).text();
  if (!fontFiles) {
    const entries = await Promise.all(
      schema.fonts.map(async (n) => [
        n,
        new Uint8Array(await cachedBuffer(asset(`fonts/${n}`))),
      ])
    );
    fontFiles = Object.fromEntries(entries) as Record<string, Uint8Array>;
  }
}

async function loadDesignSource(path: string): Promise<string> {
  if (!(path in designSources))
    designSources[path] = await (await fetch(asset(`scad/${path}`))).text();
  return designSources[path];
}

// A user file is treated as a font (mounted where fontconfig can find it) when
// its extension is one OpenSCAD/FreeType can load. Everything else is mounted at
// the FS root as a plain referenceable asset.
function isFontFile(name: string): boolean {
  return /\.(ttf|otf|ttc)$/i.test(name);
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
  for (const [rawName, bytes] of Object.entries(req.userFiles ?? {})) {
    const name = rawName.replace(/^.*[\\/]/, "") || "file";
    FS.writeFile(isFontFile(name) ? `/fonts/${name}` : `/${name}`, bytes);
  }

  // The selected design, mounted at its own source-relative path.
  const design = schema.designs.find((d) => d.id === req.design);
  if (!design) throw new Error(`unknown design: ${req.design}`);
  mount(design.file, await loadDesignSource(design.file));

  const defineArgs = Object.entries(req.defines).flatMap(([k, v]) => [
    "-D",
    `${k}=${v}`,
  ]);
  const featureArgs = schema.features.map((f) => `--enable=${f}`);
  const args = [
    `/${design.file}`,
    "--backend=manifold",
    "--export-format=binstl",
    ...featureArgs,
    ...defineArgs,
    "-o",
    "/out.stl",
  ];
  log.push(`[cmd] openscad ${args.join(" ")}`);

  let exitCode = 0;
  try {
    exitCode = instance.callMain(args) ?? 0;
  } catch (e) {
    log.push(`[throw] ${e instanceof Error ? e.message : String(e)}`);
    exitCode = typeof e === "number" ? e : 1;
  }

  let stl: Uint8Array = new Uint8Array(0);
  try {
    stl = FS.readFile("/out.stl");
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
