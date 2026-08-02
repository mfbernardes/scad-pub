// Viewer.tsx: three.js preview of the rendered model. Parses the OpenSCAD
// export and frames the model with orbit/zoom. There is no live OpenCSG preview
// in WASM, so this shows the F6-rendered mesh. The export format is fixed at
// build time (config -> __APP_FORMAT__): 3MF carries per-object colour from
// `color(...)`; STL is geometry-only and shown in the theme's model colour.
// Only the chosen format's loader is referenced, so the other tree-shakes out.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildDimensions, type DimensionsGroup } from "./dimensions";
import { shadowViewFade, type ContactShadow } from "./contactShadow";
import { attachModelPicking, buildStudioRig, buildPlainRig, studioEnvIntensity } from "./viewerRig";
import { VIEW_DIRECTIONS, DEFAULT_VIEW, type ViewName } from "./views";
import { toIndexedGeometry } from "@/lib/meshIndex";
import { Button } from "./ui/button";
import { t } from "../lib/i18n";
import {
  frameDistanceForBox,
  cameraBasis,
  edgeInset,
  singleEdgeInset,
  mergeInsets,
  clampInsets,
  insetFitFraction,
  aspectAwareFit,
  insetTargetOffset,
  refitPlan,
  DEFAULT_FIT_FRACTION,
  type Box3Like,
  type FitFraction,
  type Insets,
} from "./framing";

// The build-time model format (Vite define; see vite.config.ts). A literal, so
// the unused branch below (and its loader import) drop out of the bundle.
declare const __APP_FORMAT__: "3mf" | "stl";

// Build-time toggle (Vite define; see vite.config.ts / config
// `viewer.restOnGrid`). true rests the model's base on the z=0 grid; false
// (the default) centres it on the origin in all three axes. A literal, so
// the unused branch drops out.
declare const __APP_REST_ON_GRID__: boolean;

// The viewer presentation (a Vite define; see vite.config.ts / config
// `viewer.style`). "plain" (the default) is the classic CAD preview; "studio"
// adds image-based studio lighting, tone mapping, and a soft baked contact
// shadow. A literal, so the unused style branch, and, for "plain", the
// studio-only environment and contact-shadow modules: tree-shakes out of the
// bundle, like the loaders above. The reference grid is deliberately NOT a
// build-time choice: it is a runtime toggle the visitor owns (the `showGrid`
// prop, seeded by config `viewer.grid`, see src/lib/viewerPrefs.ts), and it
// is drawn in both styles.
declare const __APP_VIEWER_STYLE__: "plain" | "studio";

// The floating chrome the camera fit clears, see chromeInsets below for what
// qualifies and what deliberately doesn't.
//
// `edge` overrides framing.ts's "charge it to the side it intrudes from least"
// rule for an overlay that is a corner BOX rather than an edge band. The
// mobile HUD is one: collapsed, it is a single ~44px trigger in the top-right
// corner (ViewerHUD's `collapse` branch). Left to the default it reads as a
// right-edge band and charges its width across the canvas's whole height,
// shrinking the model for chrome that occupies one corner. Charging it to the
// top is the cheaper truthful answer: the top bar already reserves a band
// there, so the two merge instead of stacking, and it still keeps the model
// clear of the button, which is the point. The desktop HUD is a genuine
// right-edge column and keeps the default.
// The two HUD entries are mutually exclusive by construction: `:not()` on the
// general one, because insets MERGE by taking the deepest per edge. Letting a
// collapsed HUD match both would keep the right-edge band alongside the top
// charge and undo the whole point of the override.
const CHROME_OVERLAYS: { selector: string; edge?: keyof Insets }[] = [
  { selector: ".mobile-top-bar" },
  { selector: ".action-dock" },
  { selector: ".viewer-hud:not(.viewer-hud--collapsed)" },
  { selector: ".viewer-hud--collapsed", edge: "top" },
];

// Axis-aligned bounding-box size of the rendered model, in millimetres (the
// design's own units, kept 1:1 by the loaders). Reported via Viewer's onMeasure.
export interface Dimensions {
  x: number;
  y: number;
  z: number;
}

export interface ViewerHandle {
  /** A PNG data URL of the current view, or null if nothing is rendered. */
  snapshot: () => string | null;
  /** Re-frame the current model with the default orbit/zoom for the active view. */
  resetView: () => void;
  /** Snap the camera to a named standard view (re-applies even if unchanged). */
  setView: (view: ViewName) => void;
  /** Dolly the camera towards the orbit target. */
  zoomIn: () => void;
  /** Dolly the camera away from the orbit target. */
  zoomOut: () => void;
}

// Material whose colour follows the theme rather than the model's own colour.
type ThemedMaterial = THREE.MeshStandardMaterial | THREE.MeshPhongMaterial;

// Read a CSS custom property as a three.js colour (so the viewer follows theme).
function cssColor(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}

function studioShadowOpacity(): number {
  return document.documentElement.dataset.theme === "dark" ? 0.62 : 0.42;
}

// OpenSCAD's *automatic* object colours: the ones it writes into the 3MF for
// geometry the design didn't `color(...)` itself: the gold default for plain
// objects, and the green it assigns to an uncoloured `difference()` result.
// Geometry at one of these is treated as "uncoloured" and recoloured to the
// theme's model colour, so plain designs follow the light/dark theme;
// geometry the design coloured explicitly keeps
// its colour. Matched in the same sRGB space the 3MF loader uses (exact match).
const OPENSCAD_AUTO_COLORS = new Set(
  ["#f9d72c", "#9dcb51"].map((hex) =>
    new THREE.Color().setStyle(hex, THREE.SRGBColorSpace).getHex()
  )
);

// Recolour, in a per-vertex colour buffer, every vertex whose *original* colour
// was an OpenSCAD auto-colour to `theme` (leaving the design's explicit colours
// untouched). Reads from `original` so it's idempotent across theme switches.
// Returns whether any vertex matched. Buffer values are in three's working
// space; getHex() maps both sides through the same conversion, so the match is
// exact.
const _probe = new THREE.Color();
function retintAutoVertices(
  attr: THREE.BufferAttribute,
  original: Float32Array,
  theme: THREE.Color
): boolean {
  const arr = attr.array as Float32Array;
  let matched = false;
  for (let i = 0; i < original.length; i += 3) {
    _probe.setRGB(original[i], original[i + 1], original[i + 2]);
    if (OPENSCAD_AUTO_COLORS.has(_probe.getHex())) {
      arr[i] = theme.r;
      arr[i + 1] = theme.g;
      arr[i + 2] = theme.b;
      matched = true;
    }
  }
  if (matched) attr.needsUpdate = true;
  return matched;
}

/** Cheap capability check, run before constructing a THREE.WebGLRenderer (which
 *  throws on a canvas that can't get a context at all): a disposable canvas
 *  never attached to the document, discarded either way.
 *
 *  The context is released explicitly. Dropping the canvas is NOT enough: a
 *  detached canvas can hold its context until GC runs, and browsers cap how
 *  many live WebGL contexts a page may have (Chromium ~16). This runs on every
 *  Viewer mount, and AppShell remounts the Viewer whenever the layout crosses
 *  the 860px breakpoint, so a few dozen resizes could exhaust the cap and make
 *  the REAL renderer fail — the probe reporting "unavailable" for a machine
 *  that is perfectly capable.
 *
 *  A SUCCESS is cached, because support cannot appear and then vanish within a
 *  session. A failure is not: it can be transient (a driver reset, a page that
 *  momentarily held too many contexts), and latching that would strand the
 *  viewer on the fallback for the rest of the session over one bad moment. */
let webglSupported = false;

function probeWebGL(): boolean {
  if (webglSupported) return true;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    // WEBGL_lose_context is the only portable way to hand a context back.
    (gl as WebGLRenderingContext | null)
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext();
    webglSupported = !!gl;
  } catch {
    webglSupported = false;
  }
  return webglSupported;
}

type WebglStatus = "ok" | "unavailable" | "lost";

export const Viewer = forwardRef<
  ViewerHandle,
  {
    stl: Uint8Array | null;
    theme: string;
    designId: string;
    presetId: string;
    /** Whether a preset change reframes the camera (desktop) or keeps it (mobile). */
    reframeOnPreset?: boolean;
    /** Overlay arrowed dimension lines (W × D × H) around the model's bounding box. */
    showDimensions?: boolean;
    /** The standard camera view to frame new models / Reset view with. */
    view?: ViewName;
    /** Whether the reference grid is drawn (default off). The HUD's grid
     *  toggle owns this; the config's `viewer.grid` only seeds its first-ever
     *  value, see src/lib/viewerPrefs.ts. */
    showGrid?: boolean;
    /** Reports the model's bounding-box size in mm (null when geometry clears). */
    onMeasure?: (size: Dimensions | null) => void;
    /** When true (design has an `@editOnModel` param and a model is shown), a
     *  click/tap on the mesh raycasts the model and reports the hit's
     *  screen-space position via `onModelPick`; orbit/pan/zoom are unaffected. */
    editable?: boolean;
    /** Called when a plain click/tap lands on the model mesh, with the hit's
     *  position (px) relative to the viewer's top-left. A miss does nothing. */
    onModelPick?: (pos: { x: number; y: number }) => void;
  }
>(function Viewer({ stl, theme, designId, presetId, reframeOnPreset = true, showDimensions = false, view = DEFAULT_VIEW, showGrid = false, onMeasure, editable = false, onModelPick }, ref) {
  // Latest selected view, read inside the [stl]-only reframe effect and the
  // imperative handle without re-running them.
  const viewRef = useRef(view);
  viewRef.current = view;
  // Keep the latest onMeasure without re-running the [stl]-only geometry effect.
  const onMeasureRef = useRef(onMeasure);
  onMeasureRef.current = onMeasure;
  // The resize re-fit, kept fresh for the ResizeObserver: the observer is
  // created once in the setup effect below, but refitView closes over refs and
  // props that change every render.
  const refitRef = useRef<() => void>(() => {});
  const frameRef = useRef<() => boolean>(() => false);
  // Latest on-model-edit props, read inside the one-time setup effect's pointer
  // handlers (which have no deps) without re-running setup.
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const onModelPickRef = useRef(onModelPick);
  onModelPickRef.current = onModelPick;
  const mountRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  // The design+preset whose geometry is currently framed. A new model from the
  // *same* design and preset (a parameter tweak) keeps the user's orbit/zoom; a
  // change of design or preset reframes from scratch. null until first framed.
  const framedKeyRef = useRef<string | null>(null);
  // The key the *current* geometry would be framed under, kept at render so the
  // ResizeObserver's first-framing path can commit it too. Without that, a model
  // framed there stayed uncommitted and the next render — a parameter tweak,
  // same design — reframed on top of the orbit the visitor had just set.
  const frameKeyRef = useRef<string>("");
  frameKeyRef.current = reframeOnPreset ? `${designId}\n${presetId}` : designId;
  // Single-material geometry that tracks the theme (the STL path's one mesh).
  const themedMaterialsRef = useRef<ThemedMaterial[]>([]);
  // Per-vertex-coloured geometry (the 3MF path): the live colour attribute plus
  // a copy of its original colours, so a theme switch can re-tint only the
  // vertices that carried an OpenSCAD auto-colour.
  const themedVertexRef = useRef<{ attr: THREE.BufferAttribute; original: Float32Array }[]>([]);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const camRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  // Studio style only: the baked contact shadow under the model.
  const shadowRef = useRef<ContactShadow | null>(null);
  // World z of the contact shadow's ground plane (0 when the model rests on the
  // grid, -size.z/2 when it is centred). The camera-elevation fade is measured
  // against this plane, not world zero.
  const shadowGroundZRef = useRef(0);
  // The current model's bounding-box size (mm), so the dimension overlay can be
  // rebuilt on a toggle/theme change without re-parsing geometry. null when empty.
  const modelSizeRef = useRef<THREE.Vector3 | null>(null);
  // The live dimension-annotation overlay (see dimensions.ts), or null when off.
  const dimGroupRef = useRef<DimensionsGroup | null>(null);

  // Every piece of floating chrome the camera fit has to account for itself.
  // All of these are CSS `position: absolute` overlays. They do NOT shrink
  // the canvas's own box the way the mobile bottom sheet does
  // (`.app-shell__mobile-viewer`'s `bottom: var(--sheet-top)` already excludes
  // the sheet from `mount`'s own clientHeight, so that side needs no handling
  // here), so a model fitted to the full canvas sits partly behind them.
  // Measured live from the DOM rather than duplicating their CSS geometry
  // (gap/safe-area constants) here. Only one of each is ever in the document
  // at a time. AppShell mounts exactly one of the desktop/mobile layouts,
  // never both (see AppShell.tsx's M7), so plain, unscoped queries are safe.
  //
  // Deliberately NOT listed: the transient chips (`.viewer-hint`,
  // `.sheet-hint`, the stale/updating banner), which come and go on their own
  // timers, so insetting for them would jog the camera when they appear, and
  // the measurements panel (`.dimension-info`), because the ruler must not
  // move the model AT ALL. The point of the ruler is reading the callouts on
  // the model at the size you were already looking at it; shrinking the model
  // to make room for the panel (or for the callouts, which are drawn outside
  // the mesh's own box) trades away the thing being measured for the label
  // about it. The panel stays clear of the model by being folded to a header
  // strip on mobile and transparent to pointers instead, see DimensionInfo.
  function chromeInsets(mount: HTMLElement): Insets {
    const canvas = mount.getBoundingClientRect();
    const insets: Insets[] = [];
    for (const { selector, edge } of CHROME_OVERLAYS) {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      insets.push(edge ? singleEdgeInset(rect, canvas, edge) : edgeInset(rect, canvas));
    }
    return clampInsets(mergeInsets(insets), canvas.width, canvas.height);
  }

  // Reconstruct the model's world-space bounding box from its size, in the
  // same two positioning modes the geometry-swap effect below applies (both
  // centred at target (0,0,0) in X/Y): centred on all three axes by default,
  // or (restOnGrid) resting its base on z=0 instead of being vertically
  // centred. Cheaper than re-measuring a live THREE.Box3, and exactly
  // reproduces that effect's own math (translation only, so `size` alone is
  // enough to reconstruct it).
  //
  // Always the mesh's own box: the dimension overlay's callouts are drawn
  // outside it and are deliberately NOT fitted (see chromeInsets), so the
  // model keeps its size whether the ruler is on or off.
  function framedBox(size: THREE.Vector3): Box3Like {
    const halfX = size.x / 2;
    const halfY = size.y / 2;
    return __APP_REST_ON_GRID__
      ? { min: new THREE.Vector3(-halfX, -halfY, 0), max: new THREE.Vector3(halfX, halfY, size.z) }
      : {
          min: new THREE.Vector3(-halfX, -halfY, -size.z / 2),
          max: new THREE.Vector3(halfX, halfY, size.z / 2),
        };
  }

  // What the last framing solved for: the fit distance, and the target it
  // centred on before any user pan. refitView reads these to carry the
  // visitor's own zoom and pan across a canvas resize instead of discarding
  // them. null until the first model is framed.
  const fitStateRef = useRef<{ distance: number; target: THREE.Vector3 } | null>(null);

  // The box the current framing was established for. refitIfOutgrown compares
  // the NEW geometry's requirement against THIS box's requirement, not against
  // where the camera happens to be: measured against the live camera, a single
  // zoom-in click made unchanged geometry look 25% overflowed, so the next
  // same-key render threw the visitor's zoom away. null until a model is framed.
  const framedBoxRef = useRef<Box3Like | null>(null);

  // The canvas size and fit fraction shared by applyFraming and
  // refitIfOutgrown. null for a zero-sized canvas (display:none, or a layout
  // not yet resolved), which can't be fitted to — callers leave the current
  // framing alone rather than solving against it. Two corrections feed the
  // fit fraction, in this order:
  //  1. aspectAwareFit: on a canvas far from square (a portrait phone, or
  //     the sheet's full-detent model strip) one axis provably can't bind,
  //     so raise the one that does. Otherwise the model reads small in a
  //     mostly-empty frame. A no-op at ordinary aspect ratios.
  //  2. insetFitFraction: shrink whatever that produced to the region the
  //     chrome leaves clear, so the solve fits the model into THAT rather
  //     than the full canvas. Second, so a corrected target still yields to
  //     the top bar/dock/HUD instead of sliding under them.
  function currentFit(mount: HTMLElement): { w: number; h: number; fit: FitFraction; insets: Insets } | null {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    if (w <= 0 || h <= 0) return null;
    const insets = chromeInsets(mount);
    const fit = insetFitFraction(aspectAwareFit(DEFAULT_FIT_FRACTION, w / h), w, h, insets);
    return { w, h, fit, insets };
  }

  // Solve and apply a framing for the current model, looking from
  // `direction`, at `zoomRatio` × the fit distance (1 = the fit itself) with
  // `pan` (world units, relative to the fitted target) carried over. Fits the
  // model's actual bounding BOX (see framing.ts) rather than a
  // bounding-sphere radius: a sphere over-estimates a flat/wide model's
  // on-screen footprint, leaving a flat plate reading much smaller than
  // intended. The camera's up stays +Z for every view (set once
  // at init), so OrbitControls keeps orbiting correctly; only the look-from
  // direction changes.
  //
  // Returns whether a framing was actually applied: a caller that records
  // "this model is framed" must not record it when it wasn't.
  function applyFraming(direction: THREE.Vector3, zoomRatio: number, pan: THREE.Vector3): boolean {
    const cam = camRef.current;
    const controls = controlsRef.current;
    const mount = mountRef.current;
    const size = modelSizeRef.current;
    if (!cam || !controls || !mount || !size) return false;

    // A zero-sized canvas (display:none, or a layout not yet resolved) can't
    // be fitted to, and solving against it would poison fitStateRef for the
    // resize that follows. Leave the current framing alone.
    const current = currentFit(mount);
    if (!current) return false;
    const { w, h, fit, insets } = current;

    const box = framedBox(size);

    const target = new THREE.Vector3(0, 0, 0);
    const distance = frameDistanceForBox(box, target, direction, w / h, cam.fov, fit);
    const applied = distance * zoomRatio;

    // Move the orbit target so the (unmoved) model renders centred in that
    // clear region rather than in the middle of the canvas. Measured at the
    // APPLIED distance, not the fit distance, so the on-screen centring holds
    // at whatever zoom the visitor is at, see framing.ts's insetTargetOffset
    // for the sign/derivation.
    const { dir, right, up } = cameraBasis(direction);
    const offset = insetTargetOffset(applied, cam.fov, h, insets);
    target.addScaledVector(right, offset.right).addScaledVector(up, offset.up);

    fitStateRef.current = { distance, target: target.clone() };

    target.add(pan);
    cam.position.copy(target).addScaledVector(dir, applied);
    controls.target.copy(target);
    controls.update();
    return true;
  }

  // Frame the orbit camera for the current model from the named standard view
  // (default = the current one), at the fit distance with no pan: the "reset
  // to a clean product shot" path, used for a new model and for Reset view.
  function frameView(name: ViewName = viewRef.current): boolean {
    const [dx, dy, dz] = VIEW_DIRECTIONS[name];
    return applyFraming(new THREE.Vector3(dx, dy, dz), 1, new THREE.Vector3());
  }

  // Re-fit the current model after the canvas changed shape: the mobile
  // bottom sheet sliding between detents is the big one, but the desktop
  // panel resize and an orientation change land here too. Without this the
  // camera kept its old distance while the canvas halved in height, and the
  // model shrank to a quarter of its area (the vertical FOV is fixed, so
  // pixels-per-world-unit follows the canvas height, and the widened aspect
  // halves it again horizontally).
  //
  // Not a plain frameView(): that would throw away the visitor's orbit, zoom
  // and pan. The orbit direction is read back off the camera, and the zoom is
  // carried as a RATIO against the last fit distance, so a model the visitor
  // had zoomed to twice its fitted size stays at twice its fitted size: the
  // apparent size holds across the resize instead of the camera snapping back
  // to a default.
  function refitView() {
    const cam = camRef.current;
    const controls = controlsRef.current;
    const fit = fitStateRef.current;
    if (!cam || !controls || !fit || !modelSizeRef.current) return;
    const direction = cam.position.clone().sub(controls.target);
    const distance = direction.length();
    if (!(distance > 0) || !(fit.distance > 0)) return;
    // Clamped so a pathological state (a stale fit against a collapsed
    // canvas, say) can't be amplified into a camera flung off to infinity.
    const zoomRatio = THREE.MathUtils.clamp(distance / fit.distance, 0.1, 10);
    applyFraming(direction, zoomRatio, controls.target.clone().sub(fit.target));
  }
  refitRef.current = refitView;
  frameRef.current = frameView;

  // A parameter tweak just rendered new geometry from the same design+preset
  // (frameKey unchanged, see the [stl] effect below), so the camera was left
  // where the visitor had it rather than reframed from scratch. If the new box
  // has grown past what that framing can show — long auto-sized text is the
  // case this exists for — refit like Reset view, but along the visitor's own
  // current orbit direction rather than snapping to the design's default view.
  //
  // "Grown" is measured between the two GEOMETRIES, both evaluated along the
  // camera's current direction and about the live orbit target (so a pan is
  // not itself mistaken for overflow): the previous box's requirement against
  // the new one's. It used to compare the new requirement against the camera's
  // live distance, which conflates growth with zoom — one Zoom in click puts
  // the camera at 80% of the fit distance, so unchanged geometry read as 25%
  // overflowed and the next render of the same design snapped the zoom away.
  //
  // And when it does refit, the visitor's zoom is carried across as a ratio
  // rather than reset: they asked to be this much closer than the frame, and
  // that is still what they want of a model that just got bigger. Left alone
  // on shrink.
  function refitIfOutgrown(box: Box3Like) {
    const cam = camRef.current;
    const controls = controlsRef.current;
    const mount = mountRef.current;
    const previous = framedBoxRef.current;
    if (!cam || !controls || !mount || !previous) return;
    const current = currentFit(mount);
    if (!current) return;
    const { w, h, fit } = current;

    const direction = cam.position.clone().sub(controls.target);
    const currentDistance = direction.length();
    const requiredFor = (b: Box3Like) =>
      frameDistanceForBox(b, controls.target, direction, w / h, cam.fov, fit);
    const plan = refitPlan(requiredFor(previous), requiredFor(box), currentDistance);
    if (plan) applyFraming(direction, plan.zoomRatio, new THREE.Vector3());
  }

  // Rebuild the dimension overlay from the current model size + theme, matching
  // the `show` flag: removes any existing overlay first (disposing its GPU
  // resources), then adds a fresh one when shown and a model is loaded. Cheap
  // line/sprite geometry, so a full rebuild on toggle/theme/resize is fine.
  function syncDimensions(show: boolean) {
    const scene = sceneRef.current;
    if (!scene) return;
    if (dimGroupRef.current) {
      scene.remove(dimGroupRef.current);
      dimGroupRef.current.dispose();
      dimGroupRef.current = null;
    }
    const size = modelSizeRef.current;
    if (!show || !size) return;
    const group = buildDimensions(size, cssColor("--viewer-dim", "#86a9ff"));
    // buildDimensions assumes a model centred on the origin (spanning [-s/2, +s/2]
    // on each axis). That matches the default centring, but when `restOnGrid` is
    // set the model is anchored with its base on z=0 (spanning [0, s.z]), so lift
    // the overlay by half its height to sit around the model instead of the origin.
    if (__APP_REST_ON_GRID__) group.position.z = size.z / 2;
    scene.add(group);
    dimGroupRef.current = group;
  }

  // Rebuild the reference grid from the current theme, matching the `show`
  // flag: removes any existing grid first (disposing its GPU resources), then
  // adds a fresh one (coloured from --viewer-grid/-2) when shown. Cheap line
  // geometry, so a full rebuild on toggle/theme change is fine. Both the HUD's
  // grid toggle and a live theme switch come through here.
  //
  // The grid is a scene decoration, not part of the model, so the studio
  // style's contact shadow must never see it: the bake's `hide` list carries
  // gridRef.current (see the bake call in the [stl] effect), which is why
  // toggling the grid needs no re-bake. The baked texture never contained it
  // either way. Toggling only has to invalidate a frame, which the [showGrid]
  // effect below does.
  function syncGrid(show: boolean) {
    const scene = sceneRef.current;
    if (!scene) return;
    if (gridRef.current) {
      scene.remove(gridRef.current);
      gridRef.current.geometry.dispose();
      (gridRef.current.material as THREE.Material).dispose();
      gridRef.current = null;
    }
    if (!show) return;
    const grid = new THREE.GridHelper(
      200,
      20,
      cssColor("--viewer-grid", "#565f6e"),
      cssColor("--viewer-grid-2", "#20252e")
    );
    grid.rotateX(Math.PI / 2);
    scene.add(grid);
    gridRef.current = grid;
  }

  // Studio style only: refresh the contact shadow's view fade from the current
  // camera. Called immediately before every render (the invalidation-driven
  // loop's renderNow, and snapshot()'s synchronous render) rather than from an
  // rAF of its own, so the picture always matches the camera that produced it
  // and an idle viewer still does no work at all. A few floats and, only when
  // the factor actually moves, one material opacity write.
  function syncShadowFade() {
    if (__APP_VIEWER_STYLE__ !== "studio") return;
    const shadow = shadowRef.current;
    const cam = camRef.current;
    if (!shadow || !cam) return;
    shadow.setFade(shadowViewFade(cam.position, shadowGroundZRef.current));
  }

  // Move the camera along its line of sight to the orbit target. factor < 1
  // dollies in (closer), > 1 dollies out, clamped to the controls' distance
  // bounds so we never cross through the target or fly off to infinity.
  function dolly(factor: number) {
    const cam = camRef.current;
    const controls = controlsRef.current;
    if (!cam || !controls) return;
    const offset = cam.position.clone().sub(controls.target);
    const dist = THREE.MathUtils.clamp(
      offset.length() * factor,
      controls.minDistance,
      controls.maxDistance
    );
    offset.setLength(dist);
    cam.position.copy(controls.target).add(offset);
    controls.update();
  }

  useImperativeHandle(ref, () => ({
    snapshot() {
      const r = rendererRef.current;
      const s = sceneRef.current;
      const c = camRef.current;
      if (!r || !s || !c || !modelRef.current) return null;
      // Explicit render-then-read: with rendering now invalidation-driven (and
      // preserveDrawingBuffer off, see the renderer setup below), the drawing
      // buffer isn't guaranteed to still hold a frame by the time this is
      // called. Render synchronously and read back the same buffer before
      // control returns to the browser: the UA only swaps/clears the default
      // framebuffer once the current task yields, so a same-task render then
      // toDataURL() is reliable without paying for a permanently preserved buffer.
      syncShadowFade(); // same view state the on-screen frame would show
      r.render(s, c);
      return r.domElement.toDataURL("image/png");
    },
    resetView() {
      if (modelSizeRef.current) frameView();
    },
    setView(name) {
      viewRef.current = name; // stick for the next new-model reframe
      if (modelSizeRef.current) frameView(name);
    },
    zoomIn() {
      dolly(0.8);
    },
    zoomOut() {
      dolly(1.25);
    },
  }));

  // Tracks whether the canvas is intersecting the viewport. Used to skip
  // renderer.render() calls when the viewer is off-screen (e.g. scrolled away,
  // or a background tab), saving GPU/battery. This is a *geometric*
  // intersection signal only: it does not detect the mobile bottom sheet
  // visually occluding the canvas at its full detent, since the sheet is a
  // separate overlay element and the viewer's own bounding box is unchanged.
  const visibleRef = useRef(true);
  // Tracks page visibility (backgrounded/minimised tab). Distinct from
  // visibleRef so both gates are independently inspectable/testable.
  const pageVisibleRef = useRef(!document.hidden);
  // Lets effects outside the one-time setup effect below (theme, dimension
  // toggle, new geometry) request a render without re-running setup. Sending
  // this through a ref rather than lifting the whole render loop keeps the
  // scene-setup effect independent of those effects' own deps.
  const requestRenderRef = useRef<() => void>(() => {});
  // Test/instrumentation hook: counts renderer.render() calls actually issued
  // (i.e. gated by visibility). Exposed on the DOM node so smoke/vis scripts
  // can assert idle frames stay bounded instead of climbing forever.
  const renderCountRef = useRef(0);

  // "unavailable": probeWebGL() failed before any renderer was ever built (no
  // context to lose or restore). "lost"/"ok" track a live
  // webglcontextlost/-restored pair on the canvas the setup effect owns.
  // Rendered as a friendly fallback in place of the canvas (see the return
  // below) instead of leaving three.js to throw into the ErrorBoundary.
  const [webglStatus, setWebglStatus] = useState<WebglStatus>(() =>
    probeWebGL() ? "ok" : "unavailable"
  );
  // Bumped to force the one-time setup effect to tear down and rebuild the
  // renderer/scene/camera from scratch: the "reload viewer" actions below, and
  // a webglcontextrestored (three.js gives no guarantee that a restored
  // context still owns its previous GPU resources, so re-creating is the safe
  // recovery rather than assuming it does). The theme and geometry effects
  // also depend on it, so a rebuilt scene gets its background/grid and its
  // model back without waiting on an unrelated prop to change.
  const [resetEpoch, setResetEpoch] = useState(0);
  // Re-probes and, if a context is available, forces the rebuild above.
  // Shared by the "unavailable" and "lost" fallbacks: from "unavailable" it's
  // a fresh capability check (the visitor may have just turned on hardware
  // acceleration); from "lost" it's a manual recovery for a context that
  // never fired webglcontextrestored on its own.
  const reloadViewer = () => {
    setWebglStatus(probeWebGL() ? "ok" : "unavailable");
    setResetEpoch((n) => n + 1);
  };

  // One-time scene setup (rebuilt from scratch whenever resetEpoch bumps, see
  // its own comment above). Skips entirely once probeWebGL() has said no
  // context is available: nothing here can succeed, and constructing
  // THREE.WebGLRenderer against an unavailable context throws.
  useEffect(() => {
    if (webglStatus === "unavailable") return;
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    sceneRef.current = scene; // background + grid are set by the theme effect

    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    cam.position.set(60, -80, 60);
    cam.up.set(0, 0, 1); // OpenSCAD is Z-up
    camRef.current = cam;

    // preserveDrawingBuffer is intentionally left off (the default): rendering
    // is now invalidation-driven rather than continuous, so keeping a
    // permanently preserved backbuffer around would cost memory/perf for no
    // benefit. PNG snapshots instead render-then-read synchronously, see the
    // imperative handle's snapshot() above.
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      // probeWebGL() passed but the real construction still failed (e.g. a
      // context lost between the two): same fallback as never having had one.
      sceneRef.current = null;
      setWebglStatus("unavailable");
      return;
    }
    // Bounded DPR: uncapped devicePixelRatio on 3x+ phones/Retina displays
    // multiplies fragment-shading cost for no visible benefit at this canvas
    // size.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    // The branch is on the build-time define, not on a value passed into the
    // rig, so a `plain` build prunes buildStudioRig and the PMREM/contact-shadow
    // code it reaches (vite.config.ts's `define`).
    let envTarget: THREE.WebGLRenderTarget | null = null;
    if (__APP_VIEWER_STYLE__ === "studio") {
      const studio = buildStudioRig(renderer, scene);
      envTarget = studio.envTarget;
      shadowRef.current = studio.shadow;
    } else {
      buildPlainRig(scene);
    }

    const controls = new OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    const canvasEl = renderer.domElement;
    const detachPicking = attachModelPicking(canvasEl, {
      cam,
      model: modelRef,
      editable: editableRef,
      onPick: onModelPickRef,
    });

    // A GPU process crash or driver reset fires this instead of throwing.
    // preventDefault() is required for the browser to ever attempt restoring
    // the context (see MDN's WebGL context loss guide); without it, this
    // context is gone for the page's lifetime. `contextLost` gates renderNow
    // below so a still-scheduled frame doesn't call into a dead context
    // between the event and the state update landing.
    let contextLost = false;
    const onContextLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
      setWebglStatus("lost");
    };
    const onContextRestored = () => {
      // Rebuild everything rather than trusting the restored context still
      // owns its previous textures/buffers (see resetEpoch's own comment).
      contextLost = true;
      setWebglStatus("ok");
      setResetEpoch((n) => n + 1);
    };
    canvasEl.addEventListener("webglcontextlost", onContextLost, false);
    canvasEl.addEventListener("webglcontextrestored", onContextRestored, false);

    const io = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry.isIntersecting;
        if (entry.isIntersecting) requestRender();
      },
      { threshold: 0 }
    );
    io.observe(mount);

    const onVisibilityChange = () => {
      pageVisibleRef.current = !document.hidden;
      if (!document.hidden) requestRender();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Invalidation-driven rendering: render only in response to something
    // that could change the picture (camera/controls movement, resize,
    // geometry/material/theme changes, initial mount) instead of every
    // animation frame at idle. `tick` re-arms itself via requestAnimationFrame
    // only while OrbitControls' damping is still settling (its update()
    // returns true while the camera is still moving); once the camera is
    // still, the loop stops until the next invalidation.
    let raf = 0;
    let looping = false;

    const renderNow = () => {
      if (!visibleRef.current || !pageVisibleRef.current || contextLost) return;
      // The contact shadow's strength depends on where the camera is, so it is
      // refreshed here, on the renders that already happen (controls "change",
      // damping tick, resize, explicit invalidation): instead of a loop of its
      // own. No camera movement, no work.
      syncShadowFade();
      renderer.render(scene, cam);
      renderCountRef.current++;
      // Test/instrumentation hook (smoke/vis): lets a script assert idle
      // render count stays flat instead of climbing every frame.
      mount.dataset.renderCount = String(renderCountRef.current);
    };

    const tick = () => {
      const stillMoving = controls.update(); // advances damping; true while settling
      renderNow();
      if (stillMoving && visibleRef.current && pageVisibleRef.current) {
        raf = requestAnimationFrame(tick);
      } else {
        looping = false;
        raf = 0;
      }
    };

    const requestRender = () => {
      if (looping) return; // a frame is already pending/looping
      if (!visibleRef.current || !pageVisibleRef.current) return; // resumes on visibility
      looping = true;
      raf = requestAnimationFrame(tick);
    };
    requestRenderRef.current = requestRender;

    // OrbitControls dispatches "change" both from our own tick() calling
    // update() (damping decay) and directly from pointer/wheel handlers
    // during user interaction (which call update() synchronously, outside
    // this loop), so listening here both keeps the damping loop alive and
    // wakes a stopped loop back up on the next user input.
    controls.addEventListener("change", requestRender);

    // ResizeObserver replaces per-frame layout polling. Resize + render
    // happen synchronously inside the same callback (rather than deferring to
    // the next rAF tick) so the drawing buffer is never left blank between a
    // setSize() clear and the next paint: this preserved the no-flicker
    // behaviour the previous per-frame-polling approach relied on, e.g. while
    // the mobile bottom sheet animates the viewer's height.
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h, false);
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
      // Re-fit before the frame is drawn, so the model holds its apparent
      // size (and its centring in the chrome-free region) instead of
      // shrinking with the canvas, see refitView. Cheap: eight corner
      // projections plus four getBoundingClientRect reads, which is fine
      // even at the per-frame rate a bottom-sheet drag produces.
      //
      // A model framed against a 0×0 canvas has no fit state at all, and
      // refitView early-returns on that: this is where it gets its first
      // framing once the canvas is measurable. Commit the key on success, the
      // same as the geometry effect does, so this framing counts as done.
      if (fitStateRef.current === null && modelSizeRef.current) {
        if (frameRef.current()) framedKeyRef.current = frameKeyRef.current;
      } else refitRef.current();
      renderNow();
    });
    ro.observe(mount);

    // Initial paint: ResizeObserver's first callback normally fires async
    // shortly after observe(), but request one explicitly too so the
    // first frame doesn't wait on it.
    requestRender();

    return () => {
      cancelAnimationFrame(raf);
      controls.removeEventListener("change", requestRender);
      canvasEl.removeEventListener("webglcontextlost", onContextLost);
      canvasEl.removeEventListener("webglcontextrestored", onContextRestored);
      detachPicking();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      requestRenderRef.current = () => {};
      controls.dispose();
      dimGroupRef.current?.dispose();
      // Release the current model's and grid's GPU resources too, not only on
      // replacement: a desktop⇄mobile breakpoint flip unmounts/remounts the
      // whole Viewer, leaking a live geometry + material set until GC. Dispose
      // before the renderer/context so nothing still references a torn-down GL
      // context.
      if (modelRef.current) disposeObject(modelRef.current);
      // Already disposed here; leaving the ref set would have the [stl] effect
      // dispose the same tree a second time after a remount.
      modelRef.current = null;
      if (gridRef.current) {
        gridRef.current.geometry.dispose();
        (gridRef.current.material as THREE.Material).dispose();
      }
      // Studio-only GPU resources: the contact shadow's render targets and the
      // PMREM environment texture (the model's materials are covered by
      // disposeObject above).
      shadowRef.current?.dispose();
      shadowRef.current = null;
      // Reset the framing bookkeeping alongside the scene refs. A StrictMode or
      // Fast-Refresh remount rebuilds the camera and the model, so a key left
      // behind from the torn-down scene would claim the new one is already
      // framed and dev would frame differently from prod.
      framedKeyRef.current = null;
      fitStateRef.current = null;
      // The render target, not scene.environment: the target owns that texture
      // and disposing it is what releases both (see viewerRig's studioEnvironment).
      envTarget?.dispose();
      renderer.dispose();
      // Explicitly free the WebGL context itself: dispose() alone frees GPU
      // objects (geometries/materials/textures) but keeps the context alive
      // until GC, so each breakpoint flip otherwise leaks a live context.
      renderer.forceContextLoss();
      mount.removeChild(renderer.domElement);
      // A resetEpoch rebuild normally reassigns these immediately, but a
      // rebuild that lands in the "unavailable" early-return above does not:
      // left set, snapshot() and the theme/geometry effects would write into
      // this torn-down scene/renderer instead of no-op'ing on their null
      // guards.
      sceneRef.current = null;
      camRef.current = null;
      controlsRef.current = null;
      rendererRef.current = null;
    };
    // resetEpoch alone: webglStatus is read once per run (a status change
    // without a matching resetEpoch bump is "lost", which intentionally does
    // NOT tear this down, only pauses renderNow above) and every other prop
    // this closes over is read fresh through a ref, as already documented at
    // each ref's declaration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetEpoch]);

  // Background + grid follow the active theme. The CSS variables are keyed off
  // <html data-theme>, which a parent effect sets *after* this child effect runs
  // in the same commit, so read them on the next frame, by which point the
  // attribute (and thus the resolved variables) is up to date.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const raf = requestAnimationFrame(() => {
      scene.background = cssColor("--viewer-bg", "#0f1115");
      // Rebuilt (not only recoloured) so a live theme switch picks up the new
      // --viewer-grid/-2 values. Read fresh from the closure, like
      // showDimensions below; the [showGrid] effect handles plain toggles.
      syncGrid(showGrid);
      // Recolour any uncoloured geometry so it follows a live theme switch; the
      // model's own explicit colours are left untouched.
      const model = cssColor("--viewer-model", "#6f93ff");
      for (const m of themedMaterialsRef.current) m.color.copy(model);
      for (const v of themedVertexRef.current)
        retintAutoVertices(v.attr, v.original, model);
      if (__APP_VIEWER_STYLE__ === "studio") {
        // Environment strength and shadow weight follow the theme too.
        scene.environmentIntensity = studioEnvIntensity();
        shadowRef.current?.setOpacity(studioShadowOpacity());
      }
      // Re-tint the dimension overlay too (rebuilt with the new --viewer-dim).
      syncDimensions(showDimensions);
      requestRenderRef.current(); // theme change doesn't move the camera: invalidate explicitly
    });
    return () => cancelAnimationFrame(raf);
    // showDimensions/showGrid are read fresh on a theme change; their own
    // effects below handle plain toggles. resetEpoch: a rebuilt scene (see
    // the setup effect) starts with none of this applied, and re-running
    // this effect is cheaper than duplicating it there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, resetEpoch]);

  // Show/hide the dimension overlay on toggle (geometry stays put, and so
  // does the camera: the ruler never re-frames, see chromeInsets).
  useEffect(() => {
    syncDimensions(showDimensions);
    requestRenderRef.current();
  }, [showDimensions]);

  // Show/hide the reference grid on toggle (geometry stays put). Invalidating a
  // frame is the whole cost: under the studio style the contact shadow is NOT
  // re-baked here, because the bake excludes the grid by construction (see
  // syncGrid), so the baked texture is identical either way.
  useEffect(() => {
    syncGrid(showGrid);
    requestRenderRef.current();
  }, [showGrid]);

  // Drop the on-model hover cursor the moment editing is no longer offered
  // (render failed, or the design has no `@editOnModel` param), so a stale
  // "pointer" cursor never lingers over an inert canvas. The pointermove
  // handler above re-applies it while editable.
  useEffect(() => {
    if (!editable) {
      const canvas = rendererRef.current?.domElement;
      if (canvas) canvas.style.cursor = "";
    }
  }, [editable]);

  // Swap geometry when a new model arrives.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (modelRef.current) {
      scene.remove(modelRef.current);
      disposeObject(modelRef.current);
      modelRef.current = null;
      themedMaterialsRef.current = [];
      themedVertexRef.current = [];
    }
    if (!stl || stl.length === 0) {
      modelSizeRef.current = null;
      syncDimensions(false); // drop any overlay when geometry clears
      shadowRef.current?.setVisible(false); // no model, no shadow
      onMeasureRef.current?.(null);
      requestRenderRef.current(); // redraw the now-empty scene
      return;
    }

    const buffer = stl.buffer.slice(
      stl.byteOffset,
      stl.byteOffset + stl.byteLength
    ) as ArrayBuffer;

    const themeColor = cssColor("--viewer-model", "#6f93ff");
    const themedMaterials: ThemedMaterial[] = [];
    const themedVertices: { attr: THREE.BufferAttribute; original: Float32Array }[] = [];
    let obj: THREE.Object3D;

    if (__APP_FORMAT__ === "stl") {
      // STL is geometry-only: one mesh in the theme's model colour, like before.
      const geo = new STLLoader().parse(buffer);
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: themeColor.clone(),
        metalness: 0.1,
        roughness: 0.7,
      });
      if (__APP_VIEWER_STYLE__ === "studio") {
        // Dielectric plastic under image-based lighting: the sheen comes
        // from the environment, not a metallic tint.
        mat.metalness = 0;
        mat.roughness = 0.5;
      }
      themedMaterials.push(mat);
      obj = new THREE.Mesh(geo, mat);
    } else {
      // 3MF carries per-object colour as a per-vertex colour buffer. Recolour
      // only the vertices left at an OpenSCAD auto-colour to the theme (keeping
      // a copy of the originals for theme switches); explicit colours are kept.
      obj = new ThreeMFLoader().parse(buffer);
      obj.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        // Re-index the loader's non-indexed geometry before reading its colour
        // buffer (see toIndexedGeometry): the recolour path below then mutates
        // the deduplicated buffer, and the ~6× smaller buffer avoids Safari's
        // large-non-indexed-buffer corruption (garbage spikes on big models).
        mesh.geometry = toIndexedGeometry(mesh.geometry);
        if (__APP_VIEWER_STYLE__ === "studio") {
          // Swap the loader's Phong material(s) for PBR standard ones so the
          // studio environment lights the mesh, copying the shading-relevant
          // fields. flatShading stays as the loader set it (these meshes carry
          // no normal attribute (see meshIndex.ts) and computing vertex
          // normals here would smooth across the crisp bevels of plates and
          // dots, so normals keep deriving per-fragment).
          const toStandard = (old: THREE.Material): THREE.Material => {
            const src = old as THREE.MeshPhongMaterial;
            const std = new THREE.MeshStandardMaterial({
              color: src.color.clone(),
              vertexColors: old.vertexColors,
              flatShading: src.flatShading === true,
              transparent: old.transparent,
              opacity: old.opacity,
              side: old.side,
              metalness: 0,
              roughness: 0.45,
            });
            old.dispose();
            return std;
          };
          mesh.material = Array.isArray(mesh.material)
            ? mesh.material.map(toStandard)
            : toStandard(mesh.material);
        }
        const attr = mesh.geometry.getAttribute("color") as
          | THREE.BufferAttribute
          | undefined;
        if (!attr) return;
        const original = Float32Array.from(attr.array as Float32Array);
        if (retintAutoVertices(attr, original, themeColor))
          themedVertices.push({ attr, original });
      });
    }
    themedMaterialsRef.current = themedMaterials;
    themedVertexRef.current = themedVertices;

    // Position the model. The export keeps the design's own coordinates, which
    // aren't centred. By default we centre on the origin in all three axes. When
    // the build opts in via `restOnGrid`, we instead centre in X/Y and anchor Z
    // to the model's lowest point so the base rests on the z=0 grid. OpenSCAD
    // designs are modelled with their base on z=0, and centring in Z sinks them
    // half-way through the grid.
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    if (__APP_REST_ON_GRID__) {
      obj.position.x -= center.x;
      obj.position.y -= center.y;
      obj.position.z -= box.min.z;
    } else {
      obj.position.sub(center);
    }
    scene.add(obj);
    modelRef.current = obj;

    // Report the printed bounding-box size (mm). Measured from the loaded mesh,
    // wholly downstream of the exported bytes, so it's informative only and never
    // part of the print. Translation-invariant, so the centring above is moot.
    const size = box.getSize(new THREE.Vector3());
    // The commonest edit by far — retyping a label, nudging a colour — produces
    // new geometry with the SAME bounds, and the dimension overlay is derived
    // from bounds alone, so rebuilding it there is three canvas-texture uploads
    // for an identical result. Compared BEFORE modelSizeRef is overwritten.
    const prevSize = modelSizeRef.current;
    const boundsChanged = !prevSize || !sizesEqual(prevSize, size);
    modelSizeRef.current = size.clone();
    if (boundsChanged) syncDimensions(showDimensions); // refresh the overlay for the new bounds
    onMeasureRef.current?.({ x: size.x, y: size.y, z: size.z });

    // Re-bake the contact shadow under the new geometry. Baking renders into
    // the shadow's own targets only, so the on-screen frame (and the idle
    // render counter) is untouched; the grid and overlays are hidden during
    // the bake so only the model casts.
    if (__APP_VIEWER_STYLE__ === "studio") {
      const shadow = shadowRef.current;
      const renderer = rendererRef.current;
      // NOT gated on boundsChanged. setFootprint below is bounds-derived, but
      // bake() renders the model's actual SILHOUETTE through a depth material
      // (contactShadow.ts), so same-bounds-different-geometry — retyping a
      // label at the same extent, the very case the gate targets — would keep
      // the previous model's shadow. This effect only fires on new geometry, so
      // there is nothing to skip.
      if (shadow && renderer) {
        const groundZ = __APP_REST_ON_GRID__ ? 0 : -size.z / 2;
        shadowGroundZRef.current = groundZ;
        shadow.setFootprint(size, groundZ);
        shadow.setOpacity(studioShadowOpacity());
        shadow.setVisible(true);
        syncShadowFade(); // the ground plane may have moved under a still camera
        shadow.bake(renderer, scene, [gridRef.current, dimGroupRef.current]);
      }
    }

    // Reframe when the design changed, and, on desktop (reframeOnPreset), when
    // the preset changed too, or on the first model. A re-render from the same
    // framing key (e.g. a parameter tweak, or a preset change on mobile) keeps
    // the user's current orbit/zoom so the view doesn't jump. designId/presetId
    // are read fresh here rather than via the dep array: a preset change doesn't
    // clear the old geometry, so reframing must wait for the new model to arrive
    // (this effect) and use *its* bounds, not the stale ones. frameView() reads
    // modelSizeRef (set above) to fit the model's actual bounding box,
    // see framing.ts: rather than a bounding-sphere radius.
    const frameKey = frameKeyRef.current;
    if (framedKeyRef.current !== frameKey) {
      // Only on success. A model that first arrives while the canvas measures
      // 0×0 (a background tab, a layout not yet resolved) leaves the key
      // uncommitted, so the ResizeObserver below reframes as soon as the
      // canvas has real dimensions instead of the camera staying where it was
      // mounted until the next design or preset change.
      if (frameView()) framedKeyRef.current = frameKey; // moves the camera, which self-invalidates via controls' "change" event
    } else {
      refitIfOutgrown(framedBox(size)); // grown past the current view? re-fit; a no-op otherwise
      requestRenderRef.current(); // same framing (e.g. a param tweak): camera didn't move, so invalidate explicitly
    }
    // Whatever happened above, THIS geometry is what the camera is framed for
    // now: the next same-key render measures its growth against this box.
    framedBoxRef.current = framedBox(size);
    // resetEpoch: a rebuilt scene (see the setup effect) starts with no
    // model, so this needs to reload the current `stl` into it even though
    // `stl` itself didn't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stl, resetEpoch]);

  // mountRef stays the exact `.viewer` node three.js appends its canvas into
  // (unchanged from before this fallback existed): smoke's idle-render-count
  // check and the CSS `.viewer canvas` rule both key off that element, and
  // splitting it into a wrapper + inner mount would silently orphan both. The
  // fallback below is a plain React child alongside the imperatively-managed
  // canvas — React only ever touches the child it rendered, never the canvas,
  // so the two coexist safely (see the setup effect's own DOM calls).
  //
  // The canvas conveys nothing to assistive tech; the textual render
  // status/log/notices carry the meaning instead. The fallback is the one
  // case the viewer itself has something to say, so aria-hidden lifts while
  // it's showing.
  return (
    <div
      className="viewer relative"
      ref={mountRef}
      aria-hidden={webglStatus === "ok" ? "true" : undefined}
    >
      {webglStatus !== "ok" && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card p-6 text-center text-foreground"
          role="alert"
        >
          <p className="text-[0.95rem] font-semibold">
            {webglStatus === "unavailable"
              ? t("viewer.webglUnavailableTitle")
              : t("viewer.webglLostTitle")}
          </p>
          <p className="max-w-sm text-[0.82rem] text-muted-foreground">
            {webglStatus === "unavailable"
              ? t("viewer.webglUnavailableBody")
              : t("viewer.webglLostBody")}
          </p>
          <Button size="sm" onClick={reloadViewer}>
            {webglStatus === "unavailable" ? t("viewer.webglRetry") : t("viewer.webglReload")}
          </Button>
        </div>
      )}
    </div>
  );
  }
);

/** Whether two measured bounding-box sizes are the same to within float noise.
 *  The mesh is re-parsed from freshly exported bytes each render, so an
 *  unchanged dimension can come back differing in the last bit. */
function sizesEqual(a: THREE.Vector3, b: THREE.Vector3): boolean {
  const eps = 1e-6 * Math.max(1, a.length());
  return (
    Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps
  );
}

// A mesh's material(s), always as an array.
function materialList(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

// Free the GPU resources of an object tree's meshes (geometries + materials).
//
// Deliberately does NOT walk a material's texture maps. Every loader on this
// path (3MF/STL) produces untextured meshes, so there is nothing to walk, and
// walking would mean deciding ownership for a texture that may be shared (the
// PMREM environment is exactly such a case, and is disposed by its own owner).
// If a textured loader is ever added, this is the function that has to grow
// with it — reusing it as-is would leak one texture per model.
function disposeObject(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const m of materialList(mesh.material)) materials.add(m);
  });
  for (const m of materials) m.dispose();
}
