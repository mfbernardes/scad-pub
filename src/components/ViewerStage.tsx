// ViewerStage.tsx — the viewer-wrap innards shared by both layouts: the lazy
// three.js Viewer, the loading overlay, the "preview out of date" banner, and
// the measurements panel. Only the *active* layout mounts the Viewer (`active`)
// so we never run two renderers at once; the single lazy factory lives here so
// both layouts share one chunk. Layout-specific floating controls (desktop's
// ActionCluster/HUD anchor inside the wrap) come through `children`.
import { lazy, Suspense, type ReactNode, type RefObject } from "react";
import type { Design, RenderResult, WorkerProgress } from "../openscad/types";
import type { Values } from "../lib/presets";
import type { PauseReason } from "../lib/renderState";
import type { ViewerHandle, Dimensions } from "./Viewer";
import type { ViewName } from "./views";
import type { ComputedInfo } from "../lib/computedInfo";
import { isMeasurementStale } from "../lib/renderState";
import { ErrorBoundary } from "./ErrorBoundary";
import { StaleBanner } from "./StaleBanner";
import { UpdatingChip } from "./UpdatingChip";
import { DimensionInfo } from "./DimensionInfo";
import { Spinner } from "./ui/spinner";
import { Progress } from "./ui/progress";
import { ViewerGestureHint } from "./ViewerGestureHint";
import { useAppActions } from "../lib/appActions";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";
import { derivePhase, engineProgressFraction, phaseCopy } from "../lib/loadPhase";

const Viewer = lazy(() =>
  import("./Viewer").then((m) => ({ default: m.Viewer }))
);

interface Props {
  viewerRef: RefObject<ViewerHandle | null>;
  /** Mount the Viewer only in the active layout (the other is CSS-hidden). */
  active: boolean;
  design: Design;
  result: RenderResult | null;
  /** The last successful render kept on display while the LATEST render
   *  failed (renderState.ts's retainedResultAfterFailure; null otherwise) —
   *  shown dimmed, so the stale model never reads as the failed settings'
   *  own output. resetForDesign clears the snapshot behind it, so a design
   *  switch can never show the previous design's geometry here. */
  retainedResult: RenderResult | null;
  ready: boolean;
  rendering: boolean;
  /** The render worker's bootstrap-download progress; null once ready (or
   *  never set at all on a warm Cache Storage hit — see loadPhase.ts). */
  loadProgress: WorkerProgress | null;
  /** Build-time size (bytes) of the pinned WASM binary, for the engine
   *  phase's "one-time download — about N MB" line. Absent in a dev build
   *  that ran before fetch-wasm.mjs populated public/wasm/. */
  engineBytes?: number;
  autoRender: boolean;
  stalePreview: boolean;
  /** Why live preview is paused, forwarded to StaleBanner's explanation line
   *  (see renderState.ts's PauseReason doc). */
  pauseReason: PauseReason;
  theme: "dark" | "light";
  selectedPreset: string;
  reframeOnPreset?: boolean;
  showDimensions: boolean;
  view: ViewName;
  onMeasure: (d: Dimensions | null) => void;
  /** The active viewer's measured bounding box (mm). */
  measured: Dimensions | null;
  /** Values behind the current render — what the measurements panel reads. */
  renderedValues: Values;
  computedInfo: ComputedInfo[];
  /** Whether the one-time viewer gesture hint (ViewerGestureHint) may show —
   *  resolved by the caller from experienceMode (guided only). */
  showGestureHint: boolean;
  children?: ReactNode;
}

export function ViewerStage({
  viewerRef,
  active,
  design,
  result,
  retainedResult,
  ready,
  rendering,
  loadProgress,
  engineBytes,
  autoRender,
  stalePreview,
  pauseReason,
  theme,
  selectedPreset,
  reframeOnPreset,
  showDimensions,
  view,
  onMeasure,
  measured,
  renderedValues,
  computedInfo,
  showGestureHint,
  children,
}: Props) {
  const { render } = useAppActions();

  // Pre-first-render lifecycle (see loadPhase.ts): "engine" while the worker
  // downloads/starts the WASM engine, "render" once it's up and building the
  // first preview, "done" once a first render (success or failure) has
  // landed — the overlay below is only shown for the first two.
  const phase = derivePhase({ ready, rendering, hasResult: !!result });
  const showOverlay = phase !== "done";
  const copy = phaseCopy(phase, loadProgress, engineBytes, t);
  const engineFraction = engineProgressFraction(loadProgress);

  // "Updating preview…" chip: a re-render is running AND a previous result is
  // still on screen. Auto-render only — in manual mode StaleBanner already
  // shows its own "Updating…" state while `rendering` is true, so gating this
  // on `autoRender` avoids saying the same thing twice over the canvas (see
  // UpdatingChip's doc comment for why the design-switch variant never fires
  // under the current render pipeline). Dim (never blur) the stale canvas
  // underneath so the chip's message is legible without hiding the geometry.
  const showUpdatingChip = autoRender && rendering && !!result?.ok;

  // The latest render failed but a previous same-design success is retained
  // (see the retainedResult prop doc): keep showing IT instead of clearing
  // the canvas, with the same dim treatment the UpdatingChip uses so the
  // stale geometry never reads as the failed settings' own output. The
  // failure toast + the Messages friendly-error card carry the explanation.
  const showRetained = !result?.ok && !!retainedResult;
  // What the viewer actually displays: the latest success, or the retained
  // last-good geometry after a failure, or nothing.
  const shownResult = result?.ok ? result : retainedResult;

  return (
    <div className="viewer-wrap">
      <ErrorBoundary resetKey={result}>
        <Suspense fallback={null}>
          {active && (
            <div
              className={cn(
                "flex flex-1 min-h-0",
                (showUpdatingChip || showRetained) && "opacity-55 transition-opacity duration-300"
              )}
            >
              <Viewer
                ref={viewerRef}
                stl={shownResult?.ok ? shownResult.stl : null}
                theme={theme}
                designId={design.id}
                presetId={selectedPreset}
                reframeOnPreset={reframeOnPreset}
                showDimensions={showDimensions}
                view={view}
                onMeasure={onMeasure}
              />
            </div>
          )}
        </Suspense>
      </ErrorBoundary>
      {showOverlay && (
        <div className="viewer-overlay pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-[0.8rem] bg-(--overlay) px-6 text-center text-[0.9rem] text-muted-foreground">
          <Spinner className="size-9 text-muted-foreground" />
          {/* role=status/aria-live=polite here (not a separate sr-only node)
              announces exactly once per phase transition — the text only
              changes when `phase` does, never on every throttled progress
              tick (the size line below is a static total, not a live
              count). */}
          <p role="status" aria-live="polite">{copy.title}</p>
          {phase === "engine" && (
            <div className="w-48 max-w-[70vw]">
              <Progress
                value={engineFraction === null ? undefined : Math.round(engineFraction * 100)}
              />
            </div>
          )}
          {copy.sizeLine && <p className="text-[0.78rem] text-muted-foreground/80">{copy.sizeLine}</p>}
        </div>
      )}

      {/* One-time orbit-gesture hint (guided experience, after the first
          successful render) — bottom-centre, above the action cluster. */}
      <ViewerGestureHint enabled={showGestureHint} resultOk={!!result?.ok} />

      {/* "Updating preview…" chip — the auto-render analogue of StaleBanner's
          manual-mode "Updating…" state (see the gating comment above). */}
      {showUpdatingChip && <UpdatingChip />}

      {/* "Preview out of date" alert — the manual-mode signal that the canvas
          no longer matches the controls. Top-centre, where the eye already is,
          instead of relying on a toolbar button. */}
      <StaleBanner
        autoRender={autoRender}
        rendering={rendering}
        stalePreview={stalePreview}
        pauseReason={pauseReason}
        onRender={render}
      />

      {/* Measurements panel — top-left; shown only while dimensions are on: the
          bounding-box headline plus any per-design @info values. Measured from
          the mesh, never part of the export. */}
      {showDimensions && measured && (
        <DimensionInfo
          design={design}
          size={measured}
          values={renderedValues}
          // Retained-after-failure geometry is stale by definition (it was
          // rendered from earlier values, not the failed controls), even
          // though stalePreview itself reads false once the failed attempt
          // completes for the current key — so its figures get the same
          // dim+italic treatment as an out-of-date preview. Shared with
          // QuickStart's Review stage via renderState.ts's isMeasurementStale
          // so the two "what will actually be produced" surfaces can never
          // disagree about staleness.
          stale={isMeasurementStale(stalePreview, result, retainedResult)}
          computed={computedInfo}
        />
      )}

      {children}
    </div>
  );
}
