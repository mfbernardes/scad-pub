// protocol.ts: the render worker's contract — the message shapes the runner and
// the worker exchange, and the model format they agree on. Nothing else.
//
// This file is deliberately small and deliberately separate from types.ts,
// because scripts/lib/worker-deps.mjs walks worker.ts's local import graph to
// build renderHash: every byte in this file's closure is part of the persisted
// render cache's key, so a comment edit here evicts every deployment's stored
// geometry. types.ts used to sit in that closure and changed 25 times in a year
// for reasons — a viewer option, a help-modal field — that could not affect a
// single triangle.
//
// The rule that follows: only the worker's own helpers and this file are
// hashed. Anything app-facing belongs in types.ts, which re-exports everything
// below so no app import site cares where a type lives.

export type ParamValue = number | string | boolean;

/**
 * The model format OpenSCAD exports (and the viewer parses). Chosen at build
 * time in the config; "3mf" carries per-object colour from `color(...)`, "stl"
 * is geometry-only. Defaults to "3mf".
 */
export type ModelFormat = "3mf" | "stl";

export interface RenderRequest {
  id: number;
  design: string; // a design id, e.g. "nameplate"
  /** Parameter overrides as { name: scadValue }. Strings already quoted. */
  defines: Record<string, string>;
  /**
   * Extra user-supplied files to mount, keyed by filename -> bytes. Fonts
   * (.ttf/.otf/.ttc) are mounted into the renderer's font dir so OpenSCAD's
   * `text()` can use them; every other file is mounted at the FS root so a
   * design can reference it by name (e.g. `import("logo.svg")`).
   */
  userFiles?: Record<string, Uint8Array>;
}

export interface RenderResult {
  id: number;
  ok: boolean;
  exitCode: number;
  stl: Uint8Array; // empty on failure
  log: string[];
  ms: number;
  /** True when served from a cache (in-memory or persistent) rather than freshly rendered. */
  cached?: boolean;
  /**
   * Parameter names the request tried to define but the freshly-fetched `.scad`
   * source no longer declares: a sign this JS bundle is stale relative to the
   * deployed sources (see `orphanedDefines`). Present only when non-empty; the
   * UI uses it to prompt the user to reload.
   */
  staleDefines?: string[];
  /**
   * True when this failure means the renderer's asset bootstrap (WASM/glue
   * import, shared sources, fonts) never completed, as opposed to an
   * ordinary model failure (bad OpenSCAD source/parameters). See M1: the
   * worker resets its bootstrap state on such a failure, so the next
   * render() call retries the whole bootstrap automatically. A caller may use
   * this to avoid presenting a "that combination of settings didn't work"
   * message about a renderer that never started, or to surface a distinct
   * "renderer failed to start, retrying…" state. Absent on ordinary results
   * (successes and model failures alike).
   */
  fatal?: boolean;
}

/**
 * A throttled progress update posted by the render worker while it downloads
 * a large bootstrap asset (currently only the ~10 MB WASM binary, on a Cache
 * Storage miss, see worker.ts's resolveWasmModule). Never posted on a
 * cache hit (nothing to report progress on), and never once the worker's
 * `{ type: "ready" }` message has fired for this worker instance, see
 * runner.ts's `onProgress` doc.
 */
export interface WorkerProgress {
  type: "progress";
  /** Bytes downloaded so far. */
  loaded: number;
  /**
   * Total bytes from the response's `Content-Length`, when present and the
   * response isn't compressed in a way that makes that header unreliable
   * (see worker.ts's `readWithProgress`); null when unknown, in which case a
   * consumer should render an indeterminate progress indicator rather than a
   * percentage.
   */
  total: number | null;
}

/**
 * Worker -> runner: sent once a render worker has compiled a
 * WebAssembly.Module ITSELF (never sent for a module the worker instead
 * received from the runner, see `WorkerCommand`'s "module" case and
 * worker.ts's `postModuleOnce`). The runner keeps it and hands it to the
 * NEXT worker it spawns (see runner.ts's `spawn()`), so a respawn after
 * latest-wins cancellation costs only re-instantiation, not a repeat
 * fetch+compile of the ~10 MB wasm binary. Posted at most once per worker
 * instance.
 */
export interface WorkerModuleMessage {
  type: "module";
  module: WebAssembly.Module;
}

/**
 * Runner -> worker control messages, posted once immediately after spawn():
 * before the first render request, and safely before the worker's module
 * script has necessarily finished evaluating (a module worker queues
 * messages until it installs its onmessage handler). `RenderRequest` carries
 * no `type` field, so `"type" in data` remains the discriminator between a
 * command and an actual render on both sides of the protocol.
 *  - "module": reuse a WebAssembly.Module a PREVIOUS worker instance (in
 *    this runner's lifetime) compiled, instead of re-fetching/recompiling
 *    the wasm binary from scratch.
 *  - "warmup": nothing to reuse yet (the runner's first-ever worker, or a
 *    browser that can't structured-clone a WebAssembly.Module), still
 *    starts asset bootstrap at spawn time rather than waiting for the first
 *    (400ms-debounced) render message.
 */
export type WorkerCommand = WorkerModuleMessage | { type: "warmup" };
