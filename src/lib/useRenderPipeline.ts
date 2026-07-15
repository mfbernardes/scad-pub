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
import type { Design, RenderRequest, RenderResult, WorkerProgress } from "../openscad/types";
import {
  fileSignature,
  OpenSCADRunner,
  SupersededError,
} from "../openscad/runner";
import { toScadExpr } from "./scad";
import { defaultsFor, type Values } from "./presets";
import { changedParamLabels, emptyMetrics, recordRender, type RenderMetrics } from "./renderMetrics";
import { t } from "./i18n";
import {
  isSnapshotCurrent,
  isSnapshotExportable,
  isStaleEpoch,
  nextPauseReason,
  resolveRenderCommit,
  shouldFireInitialRender,
  type PauseReason,
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
  // The render worker's bootstrap-download progress (see WorkerProgress),
  // forwarded by the runner's onProgress. Cleared the moment `ready` fires —
  // once the worker is up, this stops meaning anything for the current
  // worker instance, and the runner itself suppresses any further/late
  // progress messages after ready (see runner.ts's onProgress doc), so this
  // never gets set again for that instance.
  const [loadProgress, setLoadProgress] = useState<WorkerProgress | null>(null);
  const [autoRender, setAutoRenderState] = useState(!design.heavy);
  // Mirrored on every render so async work (doRender) reads the latest value
  // without retriggering the effects that depend on it.
  const autoRenderRef = useRef(autoRender);
  autoRenderRef.current = autoRender;
  // Why live preview is currently off — see renderState.ts's PauseReason doc.
  // Seeded the same way a design switch resolves it (nextPauseReason's
  // "design-switch" branch ignores `current`, so seeding from `null` here is
  // equivalent to resetForDesign's own call below).
  const [pauseReason, setPauseReason] = useState<PauseReason>(() =>
    nextPauseReason(null, { type: "design-switch", heavy: !!design.heavy })
  );
  // The external setter (returned below, wired to the "Live preview" toggle):
  // wraps the raw setAutoRenderState so turning it back on always clears
  // pauseReason too — re-enabling live preview means whatever paused it no
  // longer applies, regardless of whether that was the heavy brake or a
  // heavy design's manual start.
  const setAutoRender = useCallback((next: boolean) => {
    setAutoRenderState(next);
    setPauseReason((prev) => nextPauseReason(prev, { type: "auto-render-toggle", enabled: next }));
  }, []);

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
  // The renderKey the live controls currently want, mirrored on every render so
  // an async completion can tell whether it is still what's on screen. epochRef
  // catches a design switch or render-input invalidation; this catches a plain
  // values *revert* to an already-rendered key, which those don't — see the
  // commit-time currency check in doRender.
  const renderKeyRef = useRef(renderKey);
  renderKeyRef.current = renderKey;

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
      // Guards a narrow window that should be unreachable in practice: the
      // runner-ownership effect below always runs (and populates runnerRef)
      // before any effect that can call doRender, because it's declared
      // first — see that effect's comment. Kept as a defensive no-op rather
      // than a non-null assertion so a future reordering fails safe instead
      // of throwing mid-render.
      const activeRunner = runnerRef.current;
      if (!activeRunner) return;
      const startEpoch = epochRef.current;
      const startDesignId = design.id;
      const startRenderKey = renderKey;
      const startValues = values;
      const startFileSig = fileSig;
      setRendering(true);
      try {
        const r = await activeRunner.render({
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
        const commit = resolveRenderCommit(epochRef.current, renderKeyRef.current, {
          startEpoch,
          renderKey: startRenderKey,
          designId: startDesignId,
          values: startValues,
          fileSig: startFileSig,
          result: r,
        });
        if (commit.discarded) {
          // A "superseded" discard (the controls reverted to an already-rendered
          // key while this render was in flight) leaves no other render running
          // — the runner is latest-wins — so this render still owns the spinner
          // and must clear it. An "epoch" discard is owned by a newer generation
          // that manages `rendering` itself; don't touch it here (see the catch
          // block's SupersededError note for the same reasoning).
          if (commit.reason === "superseded") setRendering(false);
          return;
        }
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
          toast.error(t("toast.renderFailed"), {
            id: "render-failed",
            description: t("toast.renderFailedDescription"),
          });
        if (r.staleDefines?.length) setBundleStale(true);
        setRendering(false);
        if (r.ok && !r.cached && r.ms > heavyMs && autoRenderRef.current) {
          setAutoRenderState(false);
          setPauseReason((prev) => nextPauseReason(prev, { type: "heavy-brake" }));
          setAnnouncement(
            t("toast.heavyRenderPaused", { seconds: (r.ms / 1000).toFixed(1) })
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

  // Worker ownership lives in an effect, not render (see
  // docs/architecture-review.md L1): constructing OpenSCADRunner spawns a
  // worker as a side effect, so that has to happen in an effect's setup, never
  // inline during the render body — a render-time `if (!runnerRef.current)
  // runnerRef.current = new OpenSCADRunner(...)` would spawn (and leak) a
  // second worker under Strict Mode's extra dev render pass, since that pass
  // is discarded without ever running effects/cleanup.
  //
  // Declared first among this hook's effects so it always runs (and populates
  // runnerRef) before the auto-render and initial-render effects below, which
  // call doRender and therefore need a live runner. React fires a component's
  // effects in declaration order within one commit, so ordering here is what
  // guarantees that — not a coincidence to preserve carelessly.
  //
  // Strict Mode's dev-only mount -> cleanup -> remount replay exercises this
  // effect twice on the same component instance (refs like runnerRef and
  // epochRef persist across the replay; only effects re-run): the first
  // runner is constructed, then synchronously disposed by cleanup before
  // remounting constructs a second one. Any render that got as far as calling
  // `activeRunner.render(...)` against the first runner has its promise
  // rejected with SupersededError by that dispose (OpenSCADRunner.dispose
  // rejects all pending renders) — doRender's catch block treats that as
  // "superseded, another render owns the spinner now" and returns without
  // touching state, so epoch/snapshot state can't be corrupted by the replay.
  // `initialRenderFiredRef` (a ref, so it also survives the replay) stops the
  // initial-render effect from firing a second time on remount. End state
  // after the replay: exactly one live worker (the second runner's), zero
  // leaked ones.
  useEffect(() => {
    const opts: RunnerCtorOptions = {
      onReady: () => {
        setReady(true);
        setLoadProgress(null);
      },
      onProgress: (p) => setLoadProgress(p),
      ...runner,
    };
    runnerRef.current = createRunner ? createRunner(opts) : new OpenSCADRunner(opts);
    return () => {
      runnerRef.current?.dispose();
      runnerRef.current = null;
      // Re-arm the initial-render one-shot: it was armed against the runner we
      // just disposed. Under Strict Mode's dev mount -> cleanup -> remount
      // replay, the first pass sets the flag and starts the initial render on
      // runner A; disposing A rejects that render with SupersededError (so it
      // never commits and `rendering` stays true), and without this reset the
      // remount's initial-render effect would skip — because the flag survived
      // the replay — leaving a manual-mode (heavy) design, whose ONLY render
      // trigger is that effect, stuck on the loading overlay. Resetting here
      // lets the replacement runner B get its own initial render. In production
      // (no replay) this cleanup runs only on real unmount, so the "exactly one
      // initial render per design view" guarantee is unchanged.
      initialRenderFiredRef.current = false;
    };
    // Intentionally mount-only: matches the previous lazy-ref-init's semantics
    // of constructing exactly one runner for the component's lifetime and
    // never reconstructing it when `runner`/`createRunner` identities change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setAutoRenderState(!next.heavy);
    setPauseReason((prev) => nextPauseReason(prev, { type: "design-switch", heavy: !!next.heavy }));
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
    loadProgress,
    renderedValues,
    renderMetrics,
    autoRender,
    setAutoRender,
    stalePreview,
    pauseReason,
    isCurrent,
    exportable,
    snapshot,
    bundleStale,
    doRender,
    invalidate,
    resetForDesign,
  };
}
