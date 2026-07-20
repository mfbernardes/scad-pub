// Viewer.tsx — three.js preview of the rendered model. Parses the OpenSCAD
// export and frames the model with orbit/zoom. There is no live OpenCSG preview
// in WASM, so this shows the F6-rendered mesh. The export format is fixed at
// build time (config -> __APP_FORMAT__): 3MF carries per-object colour from
// `color(...)`; STL is geometry-only and shown in the theme's model colour.
// Only the chosen format's loader is referenced, so the other tree-shakes out.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildDimensions, type DimensionsGroup } from "./dimensions";
import { VIEW_DIRECTIONS, DEFAULT_VIEW, type ViewName } from "./views";
import { frameDistanceForBoxWithInsets, insetViewOffset, ZERO_INSETS, type BoxHalfExtents, type Insets, type FitFraction } from "./framing";
import { toIndexedGeometry } from "@/lib/meshIndex";

// The build-time model format (Vite define; see vite.config.ts). A literal, so
// the unused branch below — and its loader import — drop out of the bundle.
declare const __APP_FORMAT__: "3mf" | "stl";

// Build-time toggle (Vite define; see vite.config.ts / config `restOnGrid`).
// true rests the model's base on the z=0 grid; false (the default) centres it
// on the origin in all three axes. A literal, so the unused branch drops out.
declare const __APP_REST_ON_GRID__: boolean;

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

// OpenSCAD's *automatic* object colours — the ones it writes into the 3MF for
// geometry the design didn't `color(...)` itself: the gold default for plain
// objects, and the green it assigns to an uncoloured `difference()` result.
// Geometry at one of these is treated as "uncoloured" and recoloured (see
// AUTO_COLOR_MAJORITY_THRESHOLD below for which colour); geometry the design
// coloured explicitly keeps its colour. Matched in the same sRGB space the
// 3MF loader uses (exact match).
const OPENSCAD_AUTO_COLORS = new Set(
  ["#f9d72c", "#9dcb51"].map((hex) =>
    new THREE.Color().setStyle(hex, THREE.SRGBColorSpace).getHex()
  )
);

// Visual-alignment round-3, item 3: a design that's wholly (or mostly)
// UNCOLOURED — e.g. a plain plate, never wrapped in `color(...)` — should
// still retint to the vivid --viewer-model accent, so it follows the
// light/dark theme like the old STL path did. But a design that's mostly
// EXPLICITLY coloured, with only a small stray patch left at OpenSCAD's own
// default (typically a through-hole's wall, cut by an uncoloured cutter
// object from an otherwise color()'d sign — OpenSCAD assigns per-facet
// colour by which source object generated each facet, and the cutter itself
// was never coloured) should NOT have that patch painted the bright accent:
// on an otherwise-coloured model it reads as an out-of-place highlight (a
// "blue dot"), not part of the design. The geometry-swap effect below judges
// this by vertex-count share of the WHOLE model (every mesh, not just the
// auto-coloured ones) crossing this threshold — comfortably past "a few
// stray triangles" but still catching a real majority-uncoloured design even
// if it has a couple of small explicitly-coloured accents.
const AUTO_COLOR_MAJORITY_THRESHOLD = 0.5;

// Recolour, in a per-vertex colour buffer, every vertex whose *original* colour
// was an OpenSCAD auto-colour to `target` (leaving the design's explicit colours
// untouched). Reads from `original` so it's idempotent across theme switches.
// Returns whether any vertex matched. Buffer values are in three's working
// space; getHex() maps both sides through the same conversion, so the match is
// exact.
const _probe = new THREE.Color();
function retintAutoVertices(
  attr: THREE.BufferAttribute,
  original: Float32Array,
  target: THREE.Color
): boolean {
  const arr = attr.array as Float32Array;
  let matched = false;
  for (let i = 0; i < original.length; i += 3) {
    _probe.setRGB(original[i], original[i + 1], original[i + 2]);
    if (OPENSCAD_AUTO_COLORS.has(_probe.getHex())) {
      arr[i] = target.r;
      arr[i + 1] = target.g;
      arr[i + 2] = target.b;
      matched = true;
    }
  }
  if (matched) attr.needsUpdate = true;
  return matched;
}

// Count of `original`'s vertices that carry an OpenSCAD auto-colour (see
// retintAutoVertices above — same matching, read-only).
function countAutoColored(original: Float32Array): number {
  let count = 0;
  for (let i = 0; i < original.length; i += 3) {
    _probe.setRGB(original[i], original[i + 1], original[i + 2]);
    if (OPENSCAD_AUTO_COLORS.has(_probe.getHex())) count++;
  }
  return count;
}

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
    /** Whether the reference grid is drawn (default off — see ViewerHUD's grid
     *  toggle and docs/config.md's `ui.grid`; the "product stage" look has no
     *  visible grid by default). */
    showGrid?: boolean;
    /** Pixel margins (HUD strip, export dock, a small top banner allowance —
     *  see framing.ts's computeViewerInsets) excluded from the fit so the
     *  model is centred and sized against the actual UNOBSCURED viewport,
     *  never cropped or hidden under floating chrome (round-2 review item
     *  1). Defaults to no insets (fits the whole canvas, the old behaviour)
     *  so every other Viewer caller/test keeps working unchanged. */
    insets?: Insets;
    /** Round-5 Wave 2 (item 7): overrides the fit's target/cap fill
     *  fractions (framing.ts's TARGET_WIDTH_FRACTION/MAX_FILL_FRACTION) for
     *  THIS mount — guided workflow's Review stage tunes these down a touch
     *  (see AppShell's `fitFraction`/framing.ts's `GUIDED_REVIEW_FIT`) so
     *  the model reads at ~55-65% of the unobscured viewer there instead of
     *  Content/Appearance's ~60-70%. Undefined (every other caller) keeps
     *  the module defaults, unchanged. */
    fitFraction?: FitFraction;
    /** Reports the model's bounding-box size in mm (null when geometry clears). */
    onMeasure?: (size: Dimensions | null) => void;
  }
>(function Viewer({ stl, theme, designId, presetId, reframeOnPreset = true, showDimensions = false, view = DEFAULT_VIEW, showGrid = false, insets = ZERO_INSETS, fitFraction, onMeasure }, ref) {
  // Latest selected view, read inside the [stl]-only reframe effect and the
  // imperative handle without re-running them.
  const viewRef = useRef(view);
  viewRef.current = view;
  // Keep the latest onMeasure without re-running the [stl]-only geometry effect.
  const onMeasureRef = useRef(onMeasure);
  onMeasureRef.current = onMeasure;
  // Keep the latest showGrid without re-running the [theme]-only effect below
  // (mirrors showDimensions' own dedicated toggle effect further down).
  const showGridRef = useRef(showGrid);
  showGridRef.current = showGrid;
  // Keep the latest insets for the resize observer and the dedicated
  // insets-change effect below (both call refit(), which reads this fresh
  // rather than closing over a stale prop value).
  const insetsRef = useRef(insets);
  insetsRef.current = insets;
  // Round-5 Wave 2 (item 7): mirrors insetsRef's own "read fresh, refit on
  // change" pattern for the optional per-mount fill-fraction override — see
  // applyFraming() and the dedicated refit effect below.
  const fitFractionRef = useRef(fitFraction);
  fitFractionRef.current = fitFraction;
  const mountRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  // The design+preset whose geometry is currently framed. A new model from the
  // *same* design and preset (a parameter tweak) keeps the user's orbit/zoom; a
  // change of design or preset reframes from scratch. null until first framed.
  const framedKeyRef = useRef<string | null>(null);
  // Single-material geometry that tracks the theme (the STL path's one mesh).
  const themedMaterialsRef = useRef<ThemedMaterial[]>([]);
  // Per-vertex-coloured geometry (the 3MF path): the live colour attribute plus
  // a copy of its original colours, so a theme switch can re-tint just the
  // vertices that carried an OpenSCAD auto-colour. `mode` is decided once per
  // model load (see AUTO_COLOR_MAJORITY_THRESHOLD) and carried through theme
  // switches so a live switch keeps recolouring to the SAME target (the vivid
  // --viewer-model accent for a mostly-uncoloured design, the neutral
  // --viewer-recess tone for a stray auto-coloured patch on an otherwise
  // explicitly coloured one) rather than re-judging majority share every time.
  const themedVertexRef = useRef<
    { attr: THREE.BufferAttribute; original: Float32Array; mode: "accent" | "recess" }[]
  >([]);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const camRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  // The current model's bounding-box size (mm), so the dimension overlay can be
  // rebuilt on a toggle/theme change without re-parsing geometry. null when empty.
  const modelSizeRef = useRef<THREE.Vector3 | null>(null);
  // The live dimension-annotation overlay (see dimensions.ts), or null when off.
  const dimGroupRef = useRef<DimensionsGroup | null>(null);
  // Half-extents of the framed model's axis-aligned bounding box, so "Reset
  // view" can reproduce the default framing on demand and refit() can re-fit
  // at a new box/insets shape. null until the first model is framed.
  // Replaced the old bounding-SPHERE radius (visual-alignment round-3, item
  // 1): a sphere is a conservative circumscribing proxy that drastically
  // over-estimates a flat, wide plate's actual on-screen footprint — see
  // framing.ts's "PROJECTED-BOUNDING-BOX FIT" section for the full
  // derivation of why the box's own projected corners are used instead.
  const frameBoxRef = useRef<BoxHalfExtents | null>(null);

  // Core framing step, shared by frameView() (a fresh model / a named-view
  // snap — orientation CHANGES) and refit() (insets or the canvas box
  // changed — orientation is PRESERVED): given the model's bounding-box
  // `half`-extents and a unit `direction` from the orbit target to the
  // camera, position the camera along it at the distance framing.ts's
  // frameDistanceForBoxWithInsets() computes for the current mount size +
  // insets, then re-point the projection at the insets-reduced rect's centre
  // via setViewOffset (see framing.ts's derivation comment) so the model
  // reads centred and sized against the actual UNOBSCURED viewport, not the
  // raw canvas underneath the HUD/export dock/banners (round-2 review item
  // 1). `direction` isn't renormalised here — callers already hand over a
  // unit vector.
  function applyFraming(half: BoxHalfExtents, direction: THREE.Vector3) {
    const cam = camRef.current;
    const controls = controlsRef.current;
    const mount = mountRef.current;
    if (!cam || !controls || !mount) return;
    const w = mount.clientWidth || 1;
    const h = mount.clientHeight || 1;
    const insets = insetsRef.current;
    const d = frameDistanceForBoxWithInsets(half, direction, w, h, insets, cam.fov, fitFractionRef.current);
    cam.position.copy(controls.target).addScaledVector(direction, d);
    const vo = insetViewOffset(w, h, insets);
    cam.setViewOffset(vo.fullWidth, vo.fullHeight, vo.offsetX, vo.offsetY, w, h);
    controls.update();
  }

  // Frame the orbit camera for a model of the given bounding-box half-extents,
  // from the named standard view (default = the current one) — resets BOTH
  // the orbit target (back to the model's own centre) and the look-from
  // direction, unlike refit() below. The camera's up stays +Z for every view
  // (set once at init), so OrbitControls keeps orbiting correctly; only the
  // look-from direction changes.
  function frameView(half: BoxHalfExtents, name: ViewName = viewRef.current) {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.target.set(0, 0, 0);
    const [x, y, z] = VIEW_DIRECTIONS[name];
    applyFraming(half, new THREE.Vector3(x, y, z).normalize());
  }

  // Re-fit the CURRENT model at its CURRENT orbit orientation — used when the
  // unobscured viewport itself changes shape (a resize, or the HUD/export
  // dock/insets changing) rather than when the model or the chosen view does.
  // Preserves exactly what the user last did with the camera (both the orbit
  // angle and any pan away from the target — OrbitControls' default RIGHT-drag/
  // two-finger pan is enabled) by deriving `direction` from the camera's
  // current position instead of a named view's, and leaving controls.target
  // untouched. A no-op before any model has ever been framed
  // (frameBoxRef.current is null pre-first-render). Called from the resize
  // observer (every geometry change to the mount box — including the mobile
  // sheet dragging the viewer's own height) and the insets-change effect below,
  // so "the model must never be cropped when the sheet changes detent" (round-2
  // review item 1) holds continuously, not just at the moment of the last
  // reframe.
  function refit() {
    const half = frameBoxRef.current;
    const cam = camRef.current;
    const controls = controlsRef.current;
    if (half == null || !cam || !controls) return;
    const direction = cam.position.clone().sub(controls.target).normalize();
    // A degenerate (zero-length) offset — camera sitting exactly on the
    // target — has no direction to preserve; bail rather than feed NaN into
    // applyFraming (this should never actually happen: the camera is always
    // placed at a positive frameDistance away).
    if (!Number.isFinite(direction.x) || direction.lengthSq() === 0) return;
    applyFraming(half, direction);
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
    scene.add(group);
    dimGroupRef.current = group;
  }

  // Rebuild the reference grid from the current theme, matching the `show`
  // flag: removes any existing grid first (disposing its GPU resources), then
  // adds a fresh one — coloured from --viewer-grid/-2 — when shown. Off by
  // default (the "product stage" look has no visible CAD grid); the HUD's
  // grid toggle and a live theme switch both call this.
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
      // control returns to the browser — the UA only swaps/clears the default
      // framebuffer once the current task yields, so a same-task render then
      // toDataURL() is reliable without paying for a permanently preserved buffer.
      r.render(s, c);
      return r.domElement.toDataURL("image/png");
    },
    resetView() {
      if (frameBoxRef.current != null) frameView(frameBoxRef.current);
    },
    setView(name) {
      viewRef.current = name; // stick for the next new-model reframe
      if (frameBoxRef.current != null) frameView(frameBoxRef.current, name);
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
  // intersection signal only — it does not detect the mobile bottom sheet
  // visually occluding the canvas at its full detent, since the sheet is a
  // separate overlay element and the viewer's own bounding box is unchanged.
  const visibleRef = useRef(true);
  // Tracks page visibility (backgrounded/minimised tab). Distinct from
  // visibleRef so both gates are independently inspectable/testable.
  const pageVisibleRef = useRef(!document.hidden);
  // Lets effects outside the one-time setup effect below (theme, dimension
  // toggle, new geometry) request a render without re-running setup. Sending
  // this through a ref rather than lifting the whole render loop keeps the
  // scene-setup effect's dependency array empty, as before.
  const requestRenderRef = useRef<() => void>(() => {});
  // Test/instrumentation hook: counts renderer.render() calls actually issued
  // (i.e. gated by visibility). Exposed on the DOM node so smoke/vis scripts
  // can assert idle frames stay bounded instead of climbing forever.
  const renderCountRef = useRef(0);

  // One-time scene setup.
  useEffect(() => {
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
    // benefit. PNG snapshots instead render-then-read synchronously — see the
    // imperative handle's snapshot() above.
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    // Bounded DPR: uncapped devicePixelRatio on 3x+ phones/Retina displays
    // multiplies fragment-shading cost for no visible benefit at this canvas
    // size.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    // Studio-style rig, tuned to read millimetre-scale RELIEF (this app's
    // signature content is often a near-white part with ~1-1.5mm raised
    // dots/lettering) rather than just shade a smooth CAD shape. A rig whose
    // key light rides near the camera's own angle is effectively an
    // on-axis "flash photo": every surface normal near the silhouette sees
    // almost the same angle of incidence the camera does, so a small bump's
    // lit cap and its surrounding shadow fall at nearly the same brightness
    // and the relief disappears into a near-white haze — exactly the
    // "faintest smudge" failure this rig replaces. Two changes fix that:
    // (1) the key is lowered to a RAKING elevation (~25° above the surface,
    // down from the previous ~53°) and swung well off the camera's own
    // azimuth, so a 1-2mm dome throws a shadow several times its own height
    // — long enough to actually resolve at product-shot framing — in a
    // direction the camera can see (not hidden behind the bump or aimed
    // straight back at the lens); (2) ambient is cut roughly in half so the
    // shadow the key just carved isn't immediately re-filled to the same
    // brightness as the lit cap. Fill stays soft and off-axis from the key
    // (never zero — a fully black shadow reads as a hole, not a dot) and rim
    // keeps its old low back/below role, picking out the model's lower edge
    // against the background.
    //
    // Intensities here are well above what they'd look like as flat 0-1
    // "brightness" multipliers: three's Phong/Standard materials run a
    // physically-based BRDF whose direct AND indirect diffuse terms are both
    // scaled by 1/PI (see BRDF_Lambert in three's shader chunks) before the
    // renderer's sRGB output conversion. A light intensity of, say, 0.7 only
    // contributes ~0.22 of on-screen linear brightness once that 1/PI factor
    // lands — which is what previously turned a near-white color()'d part
    // into a flat mid-grey slab. Roughly PI× the values a naive "0.6
    // ambient" reading suggests restores the intended overall exposure (a
    // near-white part still reads near-white, not grey) while the elevation/
    // azimuth changes above — not the intensities alone — are what actually
    // restores contrast on the relief itself.
    scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(1, 0.28, 0.55); // ~25° elevation, swung off the product camera's own azimuth
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.55);
    fill.position.set(-0.9, -0.5, 0.85);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.55);
    rim.position.set(0.3, -1, -0.7);
    scene.add(rim);

    const controls = new OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

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
      if (!visibleRef.current || !pageVisibleRef.current) return;
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
    // this loop) — so listening here both keeps the damping loop alive and
    // wakes a stopped loop back up on the next user input.
    controls.addEventListener("change", requestRender);

    // ResizeObserver replaces per-frame layout polling. Resize + render
    // happen synchronously inside the same callback (rather than deferring to
    // the next rAF tick) so the drawing buffer is never left blank between a
    // setSize() clear and the next paint — this preserved the no-flicker
    // behaviour the previous per-frame-polling approach relied on, e.g. while
    // the mobile bottom sheet animates the viewer's height.
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h, false);
      // Once a model has been framed, re-fit it (preserving orientation) at
      // the new box size — this is what keeps the model correctly framed
      // (never cropped, never off-centre) as the mount's own aspect changes,
      // e.g. the mobile sheet dragging the viewer's box shorter/taller. Before
      // any model exists there's nothing to re-fit; just keep the camera's
      // aspect in sync the old way so a first model still frames correctly.
      if (frameBoxRef.current != null) {
        refit();
      } else {
        cam.aspect = w / Math.max(1, h);
        cam.updateProjectionMatrix();
      }
      renderNow();
    });
    ro.observe(mount);

    // Initial paint: ResizeObserver's first callback normally fires async
    // shortly after observe(), but request one explicitly too so the very
    // first frame doesn't wait on it.
    requestRender();

    return () => {
      cancelAnimationFrame(raf);
      controls.removeEventListener("change", requestRender);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      requestRenderRef.current = () => {};
      controls.dispose();
      dimGroupRef.current?.dispose();
      // Release the current model's and grid's GPU resources too — previously
      // only disposed on replacement, so a desktop⇄mobile breakpoint flip
      // (which unmounts/remounts the whole Viewer) leaked a live geometry +
      // material set until GC. Dispose before the renderer/context so nothing
      // still references a torn-down GL context.
      if (modelRef.current) disposeObject(modelRef.current);
      if (gridRef.current) {
        gridRef.current.geometry.dispose();
        (gridRef.current.material as THREE.Material).dispose();
      }
      renderer.dispose();
      // Explicitly free the WebGL context itself — dispose() alone frees GPU
      // objects (geometries/materials/textures) but keeps the context alive
      // until GC, so each breakpoint flip otherwise leaks a live context.
      renderer.forceContextLoss();
      mount.removeChild(renderer.domElement);
    };
    // refit() (called from the ResizeObserver above) is a plain function
    // re-created every render, but its body only ever reads through stable
    // refs (camRef/controlsRef/mountRef/frameBoxRef/insetsRef) — never a
    // captured prop/state value — so the closure this one-time setup effect
    // captures at mount stays behaviorally identical to a "fresh" one on
    // every later call; only the refs' *current* contents matter, and those
    // are read at call time regardless of which render's closure is running.
    // Mirrors the theme effect's own eslint-disable a little further up, for
    // the same "reads fresh via refs, not deps" reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background + grid follow the active theme. The CSS variables are keyed off
  // <html data-theme>, which a parent effect sets *after* this child effect runs
  // in the same commit — so read them on the next frame, by which point the
  // attribute (and thus the resolved variables) is up to date.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const raf = requestAnimationFrame(() => {
      scene.background = cssColor("--viewer-bg", "#0f1115");
      // Rebuilt (not just recoloured) so a live theme switch picks up the new
      // --viewer-grid/-2 values; syncGrid reads showGridRef so this effect
      // itself doesn't need showGrid in its deps.
      syncGrid(showGridRef.current);
      // Recolour any uncoloured geometry so it follows a live theme switch; the
      // model's own explicit colours are left untouched. Each vertex-coloured
      // entry keeps its load-time accent/recess `mode` (see themedVertexRef's
      // doc) rather than re-judging majority share here.
      const model = cssColor("--viewer-model", "#8eaaff");
      const recess = cssColor("--viewer-recess", "#6b7280");
      for (const m of themedMaterialsRef.current) m.color.copy(model);
      for (const v of themedVertexRef.current)
        retintAutoVertices(v.attr, v.original, v.mode === "accent" ? model : recess);
      // Re-tint the dimension overlay too (rebuilt with the new --viewer-dim).
      syncDimensions(showDimensions);
      requestRenderRef.current(); // theme change doesn't move the camera — invalidate explicitly
    });
    return () => cancelAnimationFrame(raf);
    // showDimensions/showGrid are read fresh on a theme change; their own
    // toggle effects (below) handle plain toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Show/hide the dimension overlay on toggle (geometry stays put).
  useEffect(() => {
    syncDimensions(showDimensions);
    requestRenderRef.current();
  }, [showDimensions]);

  // Show/hide the reference grid on toggle.
  useEffect(() => {
    syncGrid(showGrid);
    requestRenderRef.current();
  }, [showGrid]);

  // Re-fit whenever the caller's insets (or, round-5 Wave 2 item 7, its
  // fitFraction target) change shape — the HUD appearing/disappearing, the
  // export dock's measured height changing (an ExportSuccess card riding
  // above the cluster), a mobile/desktop breakpoint flip, or
  // guided workflow's Content/Appearance <-> Review stage switch changing
  // which fill-fraction target applies (AppShell's own `fitFraction`, tied
  // to `activeStepId`). Orientation-preserving (see refit()'s own doc), so
  // this never yanks the camera back to a named view — only the distance/
  // centring adapts to the newly-unobscured area or new target. A no-op
  // before any model exists (refit() itself guards on frameBoxRef). Keyed on
  // the primitive edges, not the `insets`/`fitFraction` objects' identity,
  // so this doesn't depend on the caller memoizing them.
  useEffect(() => {
    refit();
    requestRenderRef.current(); // insets/fitFraction change doesn't otherwise self-invalidate
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insets.top, insets.right, insets.bottom, insets.left, fitFraction?.width, fitFraction?.height]);

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
      onMeasureRef.current?.(null);
      requestRenderRef.current(); // redraw the now-empty scene
      return;
    }

    const buffer = stl.buffer.slice(
      stl.byteOffset,
      stl.byteOffset + stl.byteLength
    ) as ArrayBuffer;

    const themeColor = cssColor("--viewer-model", "#8eaaff");
    const themedMaterials: ThemedMaterial[] = [];
    const themedVertices: { attr: THREE.BufferAttribute; original: Float32Array; mode: "accent" | "recess" }[] = [];
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
      themedMaterials.push(mat);
      obj = new THREE.Mesh(geo, mat);
    } else {
      // 3MF carries per-object colour as a per-vertex colour buffer. First
      // pass: index every mesh's geometry (see toIndexedGeometry) and tally,
      // across the WHOLE model, how many vertices are OpenSCAD auto-coloured
      // vs. explicitly coloured by the design — deciding the majority/minority
      // retint target (AUTO_COLOR_MAJORITY_THRESHOLD) needs the full-model
      // share before any single mesh can be recoloured.
      obj = new ThreeMFLoader().parse(buffer);
      let totalVerts = 0;
      const autoColored: { attr: THREE.BufferAttribute; original: Float32Array; autoCount: number }[] = [];
      obj.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        // Re-index the loader's non-indexed geometry before reading its colour
        // buffer: the recolour pass below then mutates the deduplicated
        // buffer, and the ~6× smaller buffer avoids Safari's large-non-indexed-
        // buffer corruption (garbage spikes on big models).
        mesh.geometry = toIndexedGeometry(mesh.geometry);
        totalVerts += mesh.geometry.getAttribute("position")?.count ?? 0;
        const attr = mesh.geometry.getAttribute("color") as
          | THREE.BufferAttribute
          | undefined;
        if (!attr) return;
        const original = Float32Array.from(attr.array as Float32Array);
        const autoCount = countAutoColored(original);
        if (autoCount > 0) autoColored.push({ attr, original, autoCount });
      });
      const autoVerts = autoColored.reduce((sum, m) => sum + m.autoCount, 0);
      const majority = totalVerts > 0 && autoVerts / totalVerts >= AUTO_COLOR_MAJORITY_THRESHOLD;
      const mode: "accent" | "recess" = majority ? "accent" : "recess";
      const target = majority ? themeColor : cssColor("--viewer-recess", "#6b7280");
      for (const m of autoColored) {
        retintAutoVertices(m.attr, m.original, target);
        themedVertices.push({ attr: m.attr, original: m.original, mode });
      }
    }
    themedMaterialsRef.current = themedMaterials;
    themedVertexRef.current = themedVertices;

    // Position the model. The export keeps the design's own coordinates, which
    // aren't centred. By default we centre on the origin in all three axes. When
    // the build opts in via `restOnGrid`, we instead centre in X/Y and anchor Z
    // to the model's lowest point so the base rests on the z=0 grid — OpenSCAD
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
    modelSizeRef.current = size.clone();
    syncDimensions(showDimensions); // refresh the overlay for the new bounds
    onMeasureRef.current?.({ x: size.x, y: size.y, z: size.z });

    // Remember the model's bounding-box half-extents so "Reset view" can
    // reproduce this framing even after the user has orbited or zoomed away.
    // A degenerate (zero-size) box — e.g. a single-point/empty mesh — falls
    // back to a small cube rather than framing at zero size.
    const half: BoxHalfExtents =
      size.x > 0 || size.y > 0 || size.z > 0
        ? { x: size.x / 2, y: size.y / 2, z: size.z / 2 }
        : { x: 25, y: 25, z: 25 };
    frameBoxRef.current = half;

    // Reframe when the design changed — and, on desktop (reframeOnPreset), when
    // the preset changed too — or on the first model. A re-render from the same
    // framing key (e.g. a parameter tweak, or a preset change on mobile) keeps
    // the user's current orbit/zoom so the view doesn't jump. designId/presetId
    // are read fresh here rather than via the dep array: a preset change doesn't
    // clear the old geometry, so reframing must wait for the new model to arrive
    // (this effect) and use *its* bounds, not the stale ones.
    const frameKey = reframeOnPreset ? `${designId}\n${presetId}` : designId;
    if (framedKeyRef.current !== frameKey) {
      frameView(half); // moves the camera, which self-invalidates via controls' "change" event
      framedKeyRef.current = frameKey;
    } else {
      requestRenderRef.current(); // same framing (e.g. a param tweak) — camera didn't move, so invalidate explicitly
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stl]);

  // The WebGL canvas conveys nothing to assistive tech; the textual render
  // status/log/notices carry the meaning instead.
  return <div className="viewer" ref={mountRef} aria-hidden="true" />;
  }
);

// A mesh's material(s), always as an array.
function materialList(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

// Free the GPU resources of an object tree's meshes (geometries + materials).
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
