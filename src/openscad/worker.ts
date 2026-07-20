// worker.ts — runs OpenSCAD-WASM off the main thread. Keeps the UI responsive
// during renders (callMain is synchronous and CPU-bound). Fetches the WASM, the
// shared .scad dependency files, and the bundled fonts once per worker instance
// (memoized, not re-fetched per render — see ensureAssets/loadDesignSource),
// then instantiates a fresh module per render (the reliable pattern; Emscripten's
// exit state isn't meant to be reused). The compiled wasm bytes are cached in
// Cache Storage so only the first render of a session pays the download; the
// small, build-volatile .scad sources are only memoized in memory for this
// worker's lifetime, not persisted to Cache Storage.

/// <reference lib="webworker" />
import schema from "../generated/designs.json";
import type { ModelFormat, RenderRequest, RenderResult, WorkerProgress } from "./types";
import { assetUrl as asset, versionedAssetUrl } from "../lib/assetUrl";
import { orphanedDefines } from "../lib/scad";
import {
  buildOpenscadArgs,
  detectMountCollisions,
  exportFor,
  mkdirPaths,
  mountDir,
  userFileMountPath,
} from "./renderArgs";
import { binCacheName, staleBinaryCaches } from "./binCache";
import { retryableOnce } from "./retryableOnce";
import { makeProgressThrottle } from "./progressThrottle";

// Persistent Cache Storage entry for the big, version-pinned binaries (the
// ~10 MB WASM and the fonts), so reloads are instant and the app works offline.
// binCacheName keys it by the pinned OpenSCAD version (see binCache.ts for the
// naming + eviction rationale). The small, build-volatile .scad sources are NOT
// cached here (they change every build). The service worker warms this same
// cache at install (see public/sw.js), so offline works even before the first
// render.
const BIN_CACHE = binCacheName((schema as { wasmVersion?: string }).wasmVersion);

async function cleanupOldCaches() {
  if (typeof caches === "undefined") return;
  const keys = await caches.keys();
  await Promise.all(staleBinaryCaches(keys, BIN_CACHE).map((k) => caches.delete(k)));
}

// Fetch that throws a descriptive error naming the URL on a non-ok response, so
// a 404/500 error page is never mistaken for real asset bytes (WASM, .scad
// source, fonts.conf, or a font binary) and silently mounted/executed as such.
async function checkedFetch(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed (${res.status} ${res.statusText}): ${url}`);
  return res;
}

// Cache-first fetch of an immutable binary into an ArrayBuffer.
async function cachedBuffer(url: string): Promise<ArrayBuffer> {
  if (typeof caches === "undefined") return (await checkedFetch(url)).arrayBuffer();
  const cache = await caches.open(BIN_CACHE);
  const hit = await cache.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await checkedFetch(url);
  // M1: a Cache Storage write failure (quota, private browsing, a blocked
  // storage backend) must degrade to uncached bytes for THIS render rather
  // than fail bootstrap outright — the fetch itself already succeeded, and
  // failing to persist it just means the next worker/session pays the
  // download again, not that this render can't proceed.
  try {
    await cache.put(url, res.clone());
  } catch {
    /* degrade to uncached: the bytes below are still returned and used */
  }
  return res.arrayBuffer();
}

// Post an "engine" progress update, throttled to ~5/sec and only on ≥1%
// change (see progressThrottle.ts) — the caller's `report` closure is built
// fresh per download so each cachedBufferWithProgress call gets its own
// throttle state.
function postProgress(loaded: number, total: number | null) {
  (self as DedicatedWorkerGlobalScope).postMessage({
    type: "progress",
    stage: "engine",
    loaded,
    total,
  } satisfies WorkerProgress);
}

// Drain a Response's body via its stream reader, invoking `onProgress` after
// every chunk (throttling, if any, is the caller's concern — see
// makeProgressThrottle). Falls back to a plain buffered read (no progress) for
// an environment/response with no readable stream, e.g. an opaque response or
// a test double — additive, never a hard requirement.
async function readWithProgress(
  res: Response,
  onProgress: (loaded: number, total: number | null) => void
): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());

  // A compressing intermediary (gzip/br) reports the WIRE size in
  // Content-Length, not the decoded byte count the reader actually yields —
  // trust the header only when the response declares no content-encoding.
  const totalHeader = res.headers.get("content-length");
  const total =
    totalHeader && !res.headers.get("content-encoding") ? Number(totalHeader) : null;

  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, Number.isFinite(total) ? total : null);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// Cache-first fetch of an immutable binary into an ArrayBuffer, additionally
// streaming download progress on a cache MISS — used ONLY for the wasm
// binary (~10 MB and dominates a cold first render; the other cachedBuffer()
// callers below are small enough that instrumenting them isn't worth it). A
// cache HIT posts nothing, same as cachedBuffer — there's no download
// happening for the UI to report on.
async function cachedBufferWithProgress(url: string): Promise<ArrayBuffer> {
  if (typeof caches === "undefined") return (await checkedFetch(url)).arrayBuffer();
  const cache = await caches.open(BIN_CACHE);
  const hit = await cache.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await checkedFetch(url);
  const report = makeProgressThrottle(postProgress);
  const bytes = await readWithProgress(res, report);
  // M1: same degrade-on-failure contract as cachedBuffer above — a Cache
  // Storage write failure must not fail bootstrap, just cost the next
  // worker/session a re-download. The Response is rebuilt from the
  // accumulated bytes (the original's body has already been drained by the
  // streaming read, so it can't be cloned/reused directly).
  try {
    await cache.put(url, new Response(bytes.buffer as ArrayBuffer, { headers: res.headers }));
  } catch {
    /* degrade to uncached: the bytes below are still returned and used */
  }
  return bytes.buffer as ArrayBuffer;
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
// M10: the untrusted user-file set most recently sent by the runner, kept
// across renders (this module-level state — unlike the WASM instance — DOES
// survive from one render to the next; only the Emscripten module itself is
// re-instantiated per render). runner.ts omits `userFiles` from a render
// request entirely when it's unchanged since the last message THIS worker
// instance received, to avoid re-cloning the bytes across the thread boundary
// on every param-only render; when that happens this cached copy is reused.
let cachedUserFiles: Record<string, Uint8Array> = {};
let fontFiles: Record<string, Uint8Array> | null = null;
let fontsConf: string | null = null;

async function loadFactory(): Promise<OpenSCADFactory> {
  // H3/M12: content-address the WASM glue (openscad.js) by schema.binAssets.glue,
  // exactly as the wasm binary and fonts are below. The glue is a render input
  // folded into renderHash, so a deploy that changes it MUST change its fetch
  // URL — otherwise the service worker's stale-while-revalidate route can serve
  // the old glue to the new bundle and persist that geometry under the new
  // renderHash. `?v=<digest>` makes each build's glue a distinct URL.
  const mod = await import(
    /* @vite-ignore */ versionedAssetUrl(
      "wasm/openscad.js",
      (schema as { binAssets?: { glue?: string } }).binAssets?.glue
    )
  );
  return mod.default as OpenSCADFactory;
}

// M1: a bootstrap (asset-loading) failure is categorically different from a
// model failure (bad OpenSCAD source/parameters) — it means the render
// pipeline itself never got off the ground, so the UI shouldn't say "that
// combination of settings didn't work" about it, and a retry means re-running
// bootstrap, not re-running OpenSCAD with different defines. Thrown out of
// ensureAssets() and tagged onto the failed RenderResult (see self.onmessage)
// as `fatal: true` so a caller (runner/pipeline) can tell the two apart.
class BootstrapError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "BootstrapError";
    this.cause = cause;
  }
}

// One-shot, memoized asset load. The four independent downloads (WASM
// fetch+compile, shared .scad sources, fonts.conf, font binaries) run in
// parallel — serialized they made the cold first render pay each round-trip
// back to back. Memoizing the whole promise also makes concurrent callers
// share one load instead of racing the per-variable checks.
//
// M1: this is now genuinely ONE atomic bootstrap transaction, via
// retryableOnce (retryableOnce.ts) — a rejected attempt is NOT memoized, so
// the very next render() call re-attempts the entire bootstrap from scratch.
// Previously `factoryPromise = loadFactory()` was assigned but never awaited
// as part of the Promise.all below, so a rejected dynamic import (e.g. a bad
// deploy, a network blip on the glue file) was invisible here: the load
// resolved successfully anyway, the memoized promise stayed resolved forever,
// and every later render's `await factoryPromise!` in render() threw the SAME
// stale rejection — an ordinary-looking failed render that could never
// recover without a full page reload. Awaiting factoryPromise as part of the
// same Promise.all means its rejection now propagates like every other
// bootstrap input, through retryableOnce's built-in reset, so the very next
// render() call re-attempts the ENTIRE bootstrap (factory import included),
// not just the pieces that used to be tracked.
//
// Every variable this load populates (factoryPromise, wasmBinary,
// wasmModulePromise, assetSources, fontsConf, fontFiles) is unconditionally
// reassigned at the top of the next attempt, so the only state that must be
// unwound on failure is the memoized promise itself — which retryableOnce
// handles generically.
const ensureAssets = retryableOnce(async () => {
  void cleanupOldCaches();
  factoryPromise = loadFactory();
  try {
    await Promise.all([
      // M1: included directly (not just assigned above) so its rejection is
      // part of THIS Promise.all and reaches the catch below.
      factoryPromise,
      (async () => {
        // H4: versioned by schema.binAssets.wasm so a rebuild that changes the
        // pinned wasm bytes without a wasmVersion bump (or a same-name font
        // swap, below) can never be served from a stale Cache Storage entry —
        // see versionedAssetUrl's comment. cachedBufferWithProgress (not the
        // plain cachedBuffer other assets use below) streams "engine" progress
        // messages to the main thread while this ~10 MB binary downloads on a
        // cache miss; a cache hit posts nothing, same as before.
        wasmBinary = await cachedBufferWithProgress(
          versionedAssetUrl("wasm/openscad.wasm", (schema as { binAssets?: { wasm?: string } }).binAssets?.wasm)
        );
        wasmModulePromise = WebAssembly.compile(wasmBinary).catch(() => null);
        await wasmModulePromise;
      })(),
      (async () => {
        const entries = await Promise.all(
          schema.assets.map(async (p) => [
            p,
            await (await checkedFetch(asset(`scad/${p}`))).text(),
          ])
        );
        assetSources = Object.fromEntries(entries) as Record<string, string>;
      })(),
      (async () => {
        // H3: content-address fonts.conf by schema.binAssets.fontsConf for the
        // same reason as the wasm/glue/font binaries — Fontconfig rules are a
        // render input folded into renderHash, so a change must not be served
        // stale under an unchanged URL by the service worker's SWR route.
        fontsConf = await (
          await checkedFetch(
            versionedAssetUrl(
              "fonts/fonts.conf",
              (schema as { binAssets?: { fontsConf?: string } }).binAssets?.fontsConf
            )
          )
        ).text();
      })(),
      (async () => {
        // H4: same content-addressed treatment as the wasm binary above — a
        // font swapped in without renaming gets a new digest, hence a new URL,
        // so the old bytes already in Cache Storage are never mistaken for it.
        const fontDigests = (schema as { binAssets?: { fonts?: Record<string, string> } }).binAssets
          ?.fonts;
        const entries = await Promise.all(
          schema.fonts.map(async (n) => [
            n,
            new Uint8Array(await cachedBuffer(versionedAssetUrl(`fonts/${n}`, fontDigests?.[n]))),
          ])
        );
        fontFiles = Object.fromEntries(entries) as Record<string, Uint8Array>;
      })(),
    ]);
  } catch (err) {
    throw new BootstrapError(err);
  }
});

async function loadDesignSource(path: string): Promise<string> {
  if (!(path in designSources))
    designSources[path] = await (await checkedFetch(asset(`scad/${path}`))).text();
  return designSources[path];
}

function mkdirp(FS: OpenSCADInstance["FS"], dir: string) {
  for (const path of mkdirPaths(dir)) {
    try {
      FS.mkdir(path);
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
    mkdirp(FS, mountDir(path));
    FS.writeFile(`/${path}`, src);
  };

  // Shared dependency files at their source-relative paths, so each design's
  // `use`/`include` resolves exactly as it does in the source tree.
  for (const [path, src] of Object.entries(assetSources!)) mount(path, src);

  // M10: `req.userFiles` present means the runner is sending a (possibly
  // updated) file set — replace the cache; absent means "unchanged, reuse
  // what you already have" (see cachedUserFiles's comment).
  if (req.userFiles) cachedUserFiles = req.userFiles;

  // M10: reject a request whose sanitized mount paths collide (two raw names
  // that strip down to the same FS path) instead of silently letting
  // whichever one iterates last overwrite the other with no signal to the
  // user that one of their uploads never took effect.
  const collisions = detectMountCollisions(cachedUserFiles);
  if (Object.keys(collisions).length > 0) {
    const detail = Object.entries(collisions)
      .map(([mount, names]) => `${mount} <- ${names.join(", ")}`)
      .join("; ");
    throw new Error(`user files collide after sanitizing to the same mount path: ${detail}`);
  }

  // User-supplied files, mounted AFTER the bundled assets so an upload can
  // override a default of the same name (e.g. swap the bundled emblem.svg).
  // Filenames are untrusted, so strip any path components (a name like "../x"
  // can't escape its mount dir). Fonts go into /fonts so fontconfig (which only
  // scans /fonts) picks them up for text(); every other file is mounted at the
  // FS root so a design can reference it by name, e.g. `import("logo.svg")`.
  for (const [rawName, bytes] of Object.entries(cachedUserFiles))
    FS.writeFile(userFileMountPath(rawName), bytes);

  // The selected design, mounted at its own source-relative path.
  const design = schema.designs.find((d) => d.id === req.design);
  if (!design) throw new Error(`unknown design: ${req.design}`);
  const designSrc = await loadDesignSource(design.file);
  mount(design.file, designSrc);

  // Skew guard: a stale cached bundle may carry parameters this worker's loaded
  // source (loadDesignSource, memoized for the worker's lifetime) has since
  // dropped. Don't pass those to OpenSCAD (it'd warn cryptically about an
  // unknown variable); report them so the UI can prompt for a reload.
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

  let exitCode: number;
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
    // M1: a BootstrapError means asset loading itself failed — never even got
    // to running OpenSCAD — as opposed to an ordinary model failure (bad
    // source/parameters). `fatal: true` lets a caller tell those apart (e.g.
    // to avoid an "that combination of settings didn't work" message about a
    // renderer that never started) rather than looking identical to a normal
    // failed render. ensureAssets()'s memoized promise was already reset by
    // retryableOnce (retryableOnce.ts), so the very next render() call
    // retries bootstrap from scratch — no worker respawn is needed for the
    // retry to happen.
    const fatal = err instanceof Error && err.name === "BootstrapError";
    const result: RenderResult = {
      id: e.data.id,
      ok: false,
      exitCode: 1,
      stl: new Uint8Array(0),
      log: [`[error] ${err instanceof Error ? err.message : String(err)}`],
      ms: 0,
      ...(fatal ? { fatal: true } : {}),
    };
    (self as DedicatedWorkerGlobalScope).postMessage(result);
  }
};
