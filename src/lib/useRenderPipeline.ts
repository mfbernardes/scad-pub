// useRenderPipeline.ts — the render orchestration extracted from App.tsx: owns
// the OpenSCAD runner, the content-stable render key, the debounced
// auto-render loop, the heavy-render brake, and everything a render produces
// (result, rendered values snapshot). App composes it with useFileImports
// (file imports call invalidate()) and forwards the returned state to
// AppShell; nothing here renders UI.
//
// Render provenance (see docs/architecture-review.md H1): every render
// attempt is stamped with the pipeline's current `epoch`, a generation
// counter bumped by resetForDesign (design switch) and invalidate
// (render-input invalidation, e.g. a file import). A completion is only
// committed to state if its epoch is still current — an older epoch's async
// completion is silently discarded, even if the runner itself never rejected
// it with SupersededError (that only fires when a *newer render call* on the
// same runner preempts an in-flight one; a design switch with auto-render off
// may not issue a new call for a while, leaving the stale completion nothing
// but the epoch check to catch). A successful, on-epoch completion becomes the
// pipeline's `snapshot` (see renderState.ts) — the only thing exportable, and
// only while it stays current per `isSnapshotCurrent`.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Design, RenderRequest, RenderResult } from "../openscad/types";
import {
  fileSignature,
  OpenSCADRunner,
  SupersededError,
} from "../openscad/runner";
import { toScadExpr } from "./scad";
import { defaultsFor, type Values } from "./presets";
import { changedParamLabels, emptyMetrics, recordRender, type RenderMetrics } from "./renderMetrics";
import {
  isSnapshotCurrent,
  isSnapshotExportable,
  isStaleEpoch,
  resolveRenderCommit,
  shouldFireInitialRender,
  type RenderSnapshot,
} from "./renderState";

/** The subset of OpenSCADRunner's API the pipeline depends on — narrow enough
 * that tests can inject a fake runner without a real worker/WASM/IndexedDB. */
export interface RunnerLike {
  render(req: Omit<RenderRequest, "id">): Promise<RenderResult>;
  clearCache(): void;
  dispose(): void;
}

type RunnerCtorOptions = ConstructorParameters<typeof OpenSCADRunner>[0];

export interface RenderPipelineArgs {
  design: Design;
  values: Values;
  userFiles: Record<string, Uint8Array>;
  /** Values snapshot shown before the first render lands (initial URL state). */
  initialValues: Values;
  /** A successful uncached render slower than this pauses auto-render. */
  heavyMs: number;
  /** Runner construction options (content-hash cache version + sizing). */
  runner: {
    cacheVersion?: string;
    cacheSize?: number;
    cacheBytes?: number;
    maxCacheEntryBytes?: number;
    persistentCache?: boolean;
  };
  setAnnouncement: (msg: string) => void;
  /** Test injection point: build the runner instead of constructing a real
   * OpenSCADRunner (which spawns a worker). Defaults to `new OpenSCADRunner`. */
  createRunner?: (opts: RunnerCtorOptions) => RunnerLike;
}

export function useRenderPipeline({
  design,
  values,
  userFiles,
  initialValues,
  heavyMs,
  runner,
  setAnnouncement,
  createRunner,
}: RenderPipelineArgs) {
  const [result, setResult] = useState<RenderResult | null>(null);
  // The renderKey `result` was produced for (success OR failure) — distinct
  // from `renderedKey` below (success-only). Used only to compute
  // `stalePreview`: a *fresh* failure for the current key must read as
  // "Failed", not "stale", so staleness has to mean "no completed attempt
  // (of either outcome) exists for the current controls yet", not "no
  // successful one does" — otherwise a failed render for unchanged controls
  // would perpetually and incorrectly read as an out-of-date preview.
  const [resultKey, setResultKey] = useState("");
  const [rendering, setRendering] = useState(false);
  const [bundleStale, setBundleStale] = useState(false);
  // The last *successful* render's full provenance (epoch, renderKey, designId,
  // values, file signature, result). renderedValues below is derived from it
  // rather than tracked as separate state, so there is exactly one place a
  // successful commit can happen.
  const [snapshot, setSnapshot] = useState<RenderSnapshot | null>(null);
  // The parameter values behind the *current* render, captured when it finishes.
  // The viewer's measurements panel reads these (not the live controls) so its
  // figures only change once a render lands, in step with the measured geometry.
  const renderedValues = snapshot?.values ?? initialValues;
  // Local-only render performance telemetry (see renderMetrics.ts) surfaced by
  // the Output console's Metrics tab. Never persisted, never sent anywhere.
  const [renderMetrics, setRenderMetrics] = useState<RenderMetrics>(emptyMetrics);
  // The values snapshot behind the *previous* render, used only to compute
  // which params changed for the metrics above. Deliberately NOT a doRender
  // dependency (see the comment on doRender's useCallback below) — updated
  // imperatively inside doRender instead, so adding it can't recreate the
  // callback and disturb the debounce/auto-render invariants.
  const prevRenderedValuesRef = useRef<Values>(initialValues);
  const [ready, setReady] = useState(false);
  const [autoRender, setAutoRender] = useState(!design.heavy);
  // Mirrored on every render so async work (doRender) reads the latest value
  // without retriggering the effects that depend on it.
  const autoRenderRef = useRef(autoRender);
  autoRenderRef.current = autoRender;

  // Bumped by resetForDesign (design switch) and invalidate (render-input
  // invalidation). doRender captures the epoch at render start and compares it
  // at commit time — a mismatch means a newer generation has begun and this
  // completion must never touch state (see file header).
  const epochRef = useRef(0);
  // Guarantees "exactly one" initial automatic render per design view for
  // designs that start in manual mode (see the initial-render effect below and
  // docs/architecture-review.md M15). Reset by resetForDesign.
  const initialRenderFiredRef = useRef(false);

  const runnerRef = useRef<RunnerLike | null>(null);
  const lastKeyRef = useRef("");
  if (!runnerRef.current) {
    const opts: RunnerCtorOptions = { onReady: () => setReady(true), ...runner };
    runnerRef.current = createRunner ? createRunner(opts) : new OpenSCADRunner(opts);
  }

  const defines = useMemo(() => {
    const d: Record<string, string> = {};
    for (const p of design.params)
      d[p.name] = toScadExpr(p, values[p.name] ?? p.default);
    return d;
  }, [design, values]);
  // Hash user files only when they change, not on every param edit (it scans
  // every uploaded byte), then fold the cheap signature into the render key.
  const fileSig = useMemo(() => fileSignature(userFiles), [userFiles]);
  const renderKey = useMemo(
    () => JSON.stringify({ d: design.id, defines, f: fileSig }),
    [design.id, defines, fileSig]
  );

  // Freshness is now reported the same way in both auto and manual mode: no
  // completed attempt — success or failure — exists yet for the live
  // controls. (Previously gated on `!autoRender`, which meant a stale result
  // was reported as current during the whole 400 ms auto-render debounce.)
  const stalePreview = renderKey !== resultKey;
  const isCurrent = isSnapshotCurrent(snapshot, renderKey, design.id);
  // The only thing Download/Image may ever act on: a successful render that
  // still matches the live controls. Never true for a stale or failed result.
  const exportable = isSnapshotExportable(snapshot, renderKey, design.id);

  const doRender = useCallback(
    async () => {
      if (renderKey === lastKeyRef.current) return;
      const startEpoch = epochRef.current;
      const startDesignId = design.id;
      const startRenderKey = renderKey;
      const startValues = values;
      const startFileSig = fileSig;
      setRendering(true);
      try {
        const r = await runnerRef.current!.render({
          design: design.id,
          defines,
          userFiles,
        });
        // The single decision point for whether this completion may touch
        // state at all: a design switch or render-input invalidation while
        // this render was in flight bumps the epoch, and `resolveRenderCommit`
        // discards anything no longer on the current one. A discarded outcome
        // must not touch `result`, `rendering`, or the snapshot — whichever
        // render started the current epoch owns that state now.
        const commit = resolveRenderCommit(epochRef.current, {
          startEpoch,
          renderKey: startRenderKey,
          designId: startDesignId,
          values: startValues,
          fileSig: startFileSig,
          result: r,
        });
        if (commit.discarded) return;
        lastKeyRef.current = commit.ok ? startRenderKey : "";
        if (commit.ok) {
          setReady(true);
          setSnapshot(commit.snapshot);
          // Diff against the previous render's snapshot (not the dep array —
          // see prevRenderedValuesRef above) to attribute the metric to
          // whichever params actually changed since last time. Only a fresh
          // render can become `slowest` (the only place `changed` is shown), so
          // skip the per-param diff on cache hits — the hottest render path.
          const changed = r.cached
            ? []
            : changedParamLabels(design.params, prevRenderedValuesRef.current, values);
          setRenderMetrics((m) => recordRender(m, { ms: r.ms, cached: !!r.cached, changed }));
          prevRenderedValuesRef.current = values;
        }
        setResult(r);
        setResultKey(startRenderKey);
        if (!r.ok)
          toast.error("That combination of settings didn't work", {
            id: "render-failed",
            description: "Open Messages (the bell in the top bar) for details.",
          });
        if (r.staleDefines?.length) setBundleStale(true);
        setRendering(false);
        if (r.ok && !r.cached && r.ms > heavyMs && autoRenderRef.current) {
          setAutoRender(false);
          setAnnouncement(
            `This design takes a while to build (${(r.ms / 1000).toFixed(1)} s), so live preview is paused — press "Update" after making changes.`
          );
        }
      } catch (e) {
        if (isStaleEpoch(startEpoch, epochRef.current)) return;
        // Superseded: a newer render is already in flight and now owns the
        // spinner state — deliberately do NOT setRendering(false) here, or the
        // indicator would flicker off under the render that replaced this one.
        if (e instanceof SupersededError) return;
        // A hard failure (worker crash, message error) rejects instead of
        // resolving with ok:false — surface it like a failed render rather
        // than silently stopping the spinner over a stale model.
        lastKeyRef.current = "";
        setRendering(false);
        toast.error("The preview couldn't be built", {
          id: "render-failed",
          description:
            e instanceof Error ? e.message : "Unexpected renderer error.",
        });
      }
    },
    [design.id, design.params, defines, userFiles, renderKey, values, fileSig, heavyMs, setAnnouncement]
  );

  useEffect(() => {
    if (!autoRender) return;
    const t = setTimeout(doRender, 400);
    return () => clearTimeout(t);
  }, [doRender, autoRender]);

  // First view of a design always renders exactly once, even when auto-render
  // is off (heavy designs start in manual mode) — so the user never faces an
  // empty canvas stuck on "Getting things ready...". Deliberately does NOT
  // wait on `ready`: the worker only emits ready once a render begins, so
  // gating the first render on readiness is circular and never fires (see
  // docs/architecture-review.md M15). `initialRenderFiredRef` (reset by
  // resetForDesign) guarantees this fires at most once per design view;
  // doRender's own epoch check makes a mid-flight design switch safe.
  useEffect(() => {
    // shouldFireInitialRender deliberately takes no `ready` argument — see
    // its doc comment and docs/architecture-review.md M15.
    if (!shouldFireInitialRender(initialRenderFiredRef.current, autoRenderRef.current)) return;
    initialRenderFiredRef.current = true;
    doRender();
  }, [design.id, doRender]);

  useEffect(() => () => runnerRef.current?.dispose(), []);

  // Imported-file changes alter render inputs the key can't fully capture in
  // the persisted tiers: drop both cache tiers, forget the last key so the
  // next doRender always reaches the worker, and advance the epoch so a
  // render already in flight against the old file set can never land.
  const invalidate = useCallback(() => {
    epochRef.current += 1;
    runnerRef.current?.clearCache();
    lastKeyRef.current = "";
    setRendering(false);
    setResultKey("");
  }, []);

  // A design switch resets everything render-scoped (App resets the
  // value/preset state in the same event). Advancing the epoch here is what
  // makes an in-flight render for the design being left behind unable to ever
  // commit under the new one, regardless of whether the runner itself
  // preempted it.
  const resetForDesign = useCallback((next: Design) => {
    epochRef.current += 1;
    setResult(null);
    setResultKey("");
    setSnapshot(null);
    setRendering(false);
    lastKeyRef.current = "";
    setAutoRender(!next.heavy);
    setRenderMetrics(emptyMetrics);
    initialRenderFiredRef.current = false;
    // Seed the diff baseline with the new design's defaults — what App resets
    // `values` to on a switch — so the first render after a switch reports no
    // "changed" params (mirrors how the initial mount seeds initialValues),
    // rather than spuriously attributing the previous design's params.
    prevRenderedValuesRef.current = defaultsFor(next);
  }, []);

  return {
    result,
    rendering,
    ready,
    renderedValues,
    renderMetrics,
    autoRender,
    setAutoRender,
    stalePreview,
    isCurrent,
    exportable,
    snapshot,
    bundleStale,
    doRender,
    invalidate,
    resetForDesign,
  };
}
