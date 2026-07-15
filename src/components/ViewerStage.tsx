// ViewerStage.tsx — the viewer-wrap innards shared by both layouts: the lazy
// three.js Viewer, the loading overlay, the "preview out of date" banner, and
// the measurements panel. Only the *active* layout mounts the Viewer (`active`)
// so we never run two renderers at once; the single lazy factory lives here so
// both layouts share one chunk. Layout-specific floating controls (desktop's
// ActionCluster/HUD anchor inside the wrap) come through `children`.
import { lazy, Suspense, type ReactNode, type RefObject } from "react";
import type { Design, RenderResult } from "../openscad/types";
import type { Values } from "../lib/presets";
import type { ViewerHandle, Dimensions } from "./Viewer";
import type { ViewName } from "./views";
import type { ComputedInfo } from "../lib/computedInfo";
import { ErrorBoundary } from "./ErrorBoundary";
import { StaleBanner } from "./StaleBanner";
import { DimensionInfo } from "./DimensionInfo";
import { Spinner } from "./ui/spinner";
import { useAppActions } from "../lib/appActions";
import { t } from "../lib/i18n";

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
          <p>{ready ? t("viewer.building") : t("viewer.loading")}</p>
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
