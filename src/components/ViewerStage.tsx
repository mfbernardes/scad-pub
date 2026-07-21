// ViewerStage.tsx — the viewer-wrap innards shared by both layouts: the lazy
// three.js Viewer, the loading overlay, the "preview out of date" banner, and
// the measurements panel. Only the *active* layout mounts the Viewer (`active`)
// so we never run two renderers at once; the single lazy factory lives here so
// both layouts share one chunk. Layout-specific floating controls (desktop's
// ActionCluster/HUD anchor inside the wrap) come through `children`.
import { lazy, Suspense, type ReactNode, type RefObject } from "react";
import type { Design, RenderResult, WorkerProgress } from "../openscad/types";
import type { Values } from "../lib/presets";
import type { ViewerHandle, Dimensions } from "./Viewer";
import type { ViewName } from "./views";
import type { ComputedInfo } from "../lib/computedInfo";
import { ErrorBoundary } from "./ErrorBoundary";
import { StaleBanner } from "./StaleBanner";
import { UpdatingChip } from "./UpdatingChip";
import { DimensionInfo } from "./DimensionInfo";
import { Spinner } from "./ui/spinner";
import { Progress } from "./ui/progress";
import { ViewerGestureHint } from "./ViewerGestureHint";
import { useAppActions } from "../lib/appActions";

const Viewer = lazy(() =>
  import("./Viewer").then((m) => ({ default: m.Viewer }))
);

interface Props {
  viewerRef: RefObject<ViewerHandle | null>;
  /** Mount the Viewer only in the active layout (the other is CSS-hidden). */
  active: boolean;
  design: Design;
  result: RenderResult | null;
  ready: boolean;
  rendering: boolean;
  /** The render worker's bootstrap-download progress; null once ready (or
   *  never set at all on a warm Cache Storage hit). Surfaced as a thin
   *  progress bar under the loading overlay's "Getting things ready…" text. */
  loadProgress: WorkerProgress | null;
  autoRender: boolean;
  stalePreview: boolean;
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
  children?: ReactNode;
}

export function ViewerStage({
  viewerRef,
  active,
  design,
  result,
  ready,
  rendering,
  loadProgress,
  autoRender,
  stalePreview,
  theme,
  selectedPreset,
  reframeOnPreset,
  showDimensions,
  view,
  onMeasure,
  measured,
  renderedValues,
  computedInfo,
  children,
}: Props) {
  const { render } = useAppActions();
  // "Updating…" chip: a re-render is running AND a previous result is still
  // on screen. Auto-render only — in manual mode StaleBanner already shows
  // its own "Updating…" state while `rendering` is true (see StaleBanner's
  // own early-return), so gating this on `autoRender` avoids saying the same
  // thing twice over the canvas.
  const showUpdatingChip = autoRender && rendering && !!result?.ok;
  return (
    <div className="viewer-wrap">
      <ErrorBoundary resetKey={result}>
        <Suspense fallback={null}>
          {active && (
            <Viewer
              ref={viewerRef}
              stl={result?.ok ? result.stl : null}
              theme={theme}
              designId={design.id}
              presetId={selectedPreset}
              reframeOnPreset={reframeOnPreset}
              showDimensions={showDimensions}
              view={view}
              onMeasure={onMeasure}
            />
          )}
        </Suspense>
      </ErrorBoundary>
      {(!ready || (rendering && !result)) && (
        <div className="viewer-overlay pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-[0.8rem] bg-(--overlay) text-[0.9rem] text-muted-foreground">
          <Spinner className="size-9 text-muted-foreground" />
          <p>{ready ? "Building your preview…" : "Getting things ready…"}</p>
          {/* Only ever set pre-ready (see useRenderPipeline's progress state) —
              a one-time ~10 MB WASM download on a cold Cache Storage miss.
              Warm reloads clear it before this overlay ever mounts, so it
              never flashes for an instant load. Indeterminate (no numeric
              value) when the response's total size isn't known — see
              WorkerProgress's own doc. */}
          {loadProgress && (
            <Progress
              value={loadProgress.total ? Math.round((loadProgress.loaded / loadProgress.total) * 100) : undefined}
              className="w-40"
              aria-label="Downloading the render engine"
            />
          )}
        </div>
      )}

      {/* "Preview out of date" alert — the manual-mode signal that the canvas
          no longer matches the controls. Top-centre, where the eye already is,
          instead of relying on a toolbar button. */}
      <StaleBanner
        autoRender={autoRender}
        rendering={rendering}
        stalePreview={stalePreview}
        onRender={render}
      />
      {showUpdatingChip && <UpdatingChip />}

      {/* One-time orbit/zoom gesture hint — only once a model has actually
          been shown, and only until the visitor interacts with the canvas or
          the timeout fades it (see ViewerGestureHint's own doc). */}
      <ViewerGestureHint resultOk={!!result?.ok} />

      {/* Measurements panel — top-left; shown only while dimensions are on: the
          bounding-box headline plus any per-design @info values. Measured from
          the mesh, never part of the export. */}
      {showDimensions && measured && (
        <DimensionInfo
          design={design}
          size={measured}
          values={renderedValues}
          stale={stalePreview}
          computed={computedInfo}
        />
      )}

      {children}
    </div>
  );
}
