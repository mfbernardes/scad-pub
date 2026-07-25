// ViewerStage.tsx — the viewer-wrap innards shared by both layouts: the lazy
// three.js Viewer, the loading overlay, the "preview out of date" banner, and
// the measurements panel. Only the *active* layout mounts the Viewer (`active`)
// so we never run two renderers at once; the single lazy factory lives here so
// both layouts share one chunk. Layout-specific floating controls (desktop's
// ActionCluster/HUD anchor inside the wrap) come through `children`.
import { lazy, Suspense, useCallback, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Values } from "../lib/presets";
import type { ViewerHandle, Dimensions } from "./Viewer";
import type { ViewName } from "./views";
import type { ComputedInfo } from "../lib/computedInfo";
import { ErrorBoundary } from "./ErrorBoundary";
import { StaleBanner } from "./StaleBanner";
import { DimensionInfo } from "./DimensionInfo";
import { Spinner } from "./ui/spinner";
import { ViewerEditOnModel } from "./ViewerEditOnModel";
import { editOnModelParam, type Point } from "../lib/editOnModel";
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
  /** Live parameter values — the on-model editor prefills from these. */
  values: Values;
  computedInfo: ComputedInfo[];
  /** Mobile layout: the on-model editor anchors toward the top (keyboard). */
  mobile?: boolean;
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
  values,
  computedInfo,
  mobile = false,
  children,
}: Props) {
  const { render } = useAppActions();

  // ── On-model text editing ("type on the sign") ───────────────────────────
  // Active when the design declares an `@editOnModel` string param; the mesh
  // click is offered only once a model is shown (ready = last render ok), like
  // the HUD/gesture hint. The editor's open/anchor state lives here so it can
  // both receive the Viewer's mesh pick AND suppress the one-time gesture hint
  // while the editor is up (they'd otherwise overlap bottom-centre).
  const editParam = useMemo(() => editOnModelParam(design), [design]);
  const modelReady = !!result?.ok;
  const editable = !!editParam && modelReady;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editAnchor, setEditAnchor] = useState<Point | null>(null);
  const openEditAt = useCallback((pos: Point) => {
    setEditAnchor(pos);
    setEditOpen(true);
  }, []);
  const openEditCentered = useCallback(() => {
    setEditAnchor(null);
    setEditOpen(true);
  }, []);
  const closeEdit = useCallback(() => setEditOpen(false), []);
  const editValue = editParam ? String(values[editParam.name] ?? "") : "";
  return (
    <div className="viewer-wrap" ref={wrapRef}>
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
              editable={editable}
              onModelPick={openEditAt}
            />
          )}
        </Suspense>
      </ErrorBoundary>
      {(!ready || (rendering && !result)) && (
        <div className="viewer-overlay pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-[0.8rem] bg-(--overlay) text-[0.9rem] text-muted-foreground">
          <Spinner className="size-9 text-muted-foreground" />
          <p>{ready ? "Building your preview…" : "Getting things ready…"}</p>
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
          the timeout fades it (see ViewerGestureHint's own doc). Suppressed
          while the on-model editor is open (both sit bottom-/over-centre). */}
      <ViewerGestureHint resultOk={!!result?.ok} suppressed={editOpen} />

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

      {/* On-model text editing: the always-visible pencil chip (keyboard/AT
          path) plus the floating editor a mesh click or the chip opens. Only
          mounted for a design that declares an `@editOnModel` param — a
          design change can drop that param while the editor is open. */}
      {editParam ? (
        <ViewerEditOnModel
          param={editParam}
          value={editValue}
          ready={modelReady}
          open={editOpen}
          anchor={editAnchor}
          mobile={mobile}
          wrapRef={wrapRef}
          onOpenCentered={openEditCentered}
          onClose={closeEdit}
        />
      ) : null}

      {children}
    </div>
  );
}
