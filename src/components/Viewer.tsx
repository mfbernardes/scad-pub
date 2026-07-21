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
import { toIndexedGeometry } from "@/lib/meshIndex";
import {
  frameDistanceForBox,
  cameraBasis,
  insetHeightFraction,
  insetTargetShift,
  DEFAULT_FIT_FRACTION,
  type Box3Like,
} from "./framing";

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
// Geometry at one of these is treated as "uncoloured" and recoloured to the
// theme's model colour, so plain designs still follow the light/dark theme as
// they did on the old STL path; geometry the design coloured explicitly keeps
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
    /** Reports the model's bounding-box size in mm (null when geometry clears). */
    onMeasure?: (size: Dimensions | null) => void;
  }
>(function Viewer({ stl, theme, designId, presetId, reframeOnPreset = true, showDimensions = false, view = DEFAULT_VIEW, onMeasure }, ref) {
  // Latest selected view, read inside the [stl]-only reframe effect and the
  // imperative handle without re-running them.
  const viewRef = useRef(view);
  viewRef.current = view;
  // Keep the latest onMeasure without re-running the [stl]-only geometry effect.
  const onMeasureRef = useRef(onMeasure);
  onMeasureRef.current = onMeasure;
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
  // vertices that carried an OpenSCAD auto-colour.
  const themedVertexRef = useRef<{ attr: THREE.BufferAttribute; original: Float32Array }[]>([]);
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

  // The export dock (`.action-dock`) floats over the canvas via CSS
  // `position: absolute` — it does NOT shrink the canvas's own box the way
  // the mobile bottom sheet does (`.app-shell__mobile-viewer`'s `bottom:
  // var(--sheet-top)` already excludes the sheet from `mount`'s own
  // clientHeight, so that side needs no extra handling here). So the dock is
  // the one piece of floating chrome the camera fit has to account for
  // itself: how many pixels of `mount`'s own bottom edge it covers, measured
  // live from the DOM rather than duplicating its CSS geometry (gap/safe-area
  // constants) here. Only one `.action-dock` is ever in the document at a
  // time — AppShell mounts exactly one of the desktop/mobile layouts, never
  // both (see AppShell.tsx's M7) — so a plain, unscoped query is safe.
  function dockInsetPx(mount: HTMLElement): number {
    const dock = document.querySelector<HTMLElement>(".action-dock");
    if (!dock) return 0;
    const mountBottom = mount.getBoundingClientRect().bottom;
    const dockTop = dock.getBoundingClientRect().top;
    return Math.max(0, mountBottom - dockTop);
  }

  // Frame the orbit camera for the current model (modelSizeRef), from the
  // named standard view (default = the current one), fitting its actual
  // bounding BOX (see framing.ts) rather than a bounding-sphere radius — a
  // sphere over-estimates a flat/wide model's on-screen footprint, which
  // used to leave e.g. flat plates reading much smaller than intended. The
  // camera's up stays +Z for every view (set once at init), so OrbitControls
  // keeps orbiting correctly; only the look-from direction changes.
  function frameView(name: ViewName = viewRef.current) {
    const cam = camRef.current;
    const controls = controlsRef.current;
    const mount = mountRef.current;
    const size = modelSizeRef.current;
    if (!cam || !controls || !mount || !size) return;

    // Reconstruct the model's world-space bounding box from its size, in the
    // same two positioning modes the geometry-swap effect below applies
    // (both centred at target (0,0,0) in X/Y): centred on all three axes by
    // default, or — restOnGrid — resting its base on z=0 instead of being
    // vertically centred. Cheaper than re-measuring a live THREE.Box3, and
    // exactly reproduces that effect's own math (translation only, so `size`
    // alone is enough to reconstruct it).
    const halfX = size.x / 2;
    const halfY = size.y / 2;
    const box: Box3Like = __APP_REST_ON_GRID__
      ? { min: new THREE.Vector3(-halfX, -halfY, 0), max: new THREE.Vector3(halfX, halfY, size.z) }
      : { min: new THREE.Vector3(-halfX, -halfY, -size.z / 2), max: new THREE.Vector3(halfX, halfY, size.z / 2) };

    const [dx, dy, dz] = VIEW_DIRECTIONS[name];
    const direction = new THREE.Vector3(dx, dy, dz);
    const target = new THREE.Vector3(0, 0, 0);

    const w = mount.clientWidth || 1;
    const h = mount.clientHeight || 1;
    const aspect = w / h;

    // Leave room for the export dock: shrink the height target to the
    // USABLE strip above it, so the box-fit solve below asks for a distance
    // that fits the model into that strip, not the full canvas.
    const inset = dockInsetPx(mount);
    const fit = { width: DEFAULT_FIT_FRACTION.width, height: insetHeightFraction(DEFAULT_FIT_FRACTION.height, h, inset) };

    const distance = frameDistanceForBox(box, target, direction, aspect, cam.fov, fit);

    // Shift the orbit target opposite the screen "up" direction by half the
    // inset, in world units at this distance, so the (unmoved) model renders
    // centred in the usable strip above the dock instead of the full canvas
    // — see framing.ts's insetTargetShift for the sign/derivation.
    if (inset > 0) {
      const { up } = cameraBasis(direction);
      const shift = insetTargetShift(distance, cam.fov, h, inset);
      target.addScaledVector(up, -shift);
    }

    cam.position.copy(target).addScaledVector(direction.clone().normalize(), distance);
    controls.target.copy(target);
    controls.update();
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

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(1, -1, 2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-1, 1, 0.5);
    scene.add(fill);

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
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
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
      if (gridRef.current) {
        scene.remove(gridRef.current);
        gridRef.current.geometry.dispose();
        (gridRef.current.material as THREE.Material).dispose();
      }
      const grid = new THREE.GridHelper(
        200,
        20,
        cssColor("--viewer-grid", "#565f6e"),
        cssColor("--viewer-grid-2", "#20252e")
      );
      grid.rotateX(Math.PI / 2);
      scene.add(grid);
      gridRef.current = grid;
      // Recolour any uncoloured geometry so it follows a live theme switch; the
      // model's own explicit colours are left untouched.
      const model = cssColor("--viewer-model", "#6f93ff");
      for (const m of themedMaterialsRef.current) m.color.copy(model);
      for (const v of themedVertexRef.current)
        retintAutoVertices(v.attr, v.original, model);
      // Re-tint the dimension overlay too (rebuilt with the new --viewer-dim).
      syncDimensions(showDimensions);
      requestRenderRef.current(); // theme change doesn't move the camera — invalidate explicitly
    });
    return () => cancelAnimationFrame(raf);
    // showDimensions is read fresh on a theme change; its own effect handles toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Show/hide the dimension overlay on toggle (geometry stays put).
  useEffect(() => {
    syncDimensions(showDimensions);
    requestRenderRef.current();
  }, [showDimensions]);

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

    // Reframe when the design changed — and, on desktop (reframeOnPreset), when
    // the preset changed too — or on the first model. A re-render from the same
    // framing key (e.g. a parameter tweak, or a preset change on mobile) keeps
    // the user's current orbit/zoom so the view doesn't jump. designId/presetId
    // are read fresh here rather than via the dep array: a preset change doesn't
    // clear the old geometry, so reframing must wait for the new model to arrive
    // (this effect) and use *its* bounds, not the stale ones. frameView() reads
    // modelSizeRef (just set above) to fit the model's actual bounding box —
    // see framing.ts — rather than a bounding-sphere radius.
    const frameKey = reframeOnPreset ? `${designId}\n${presetId}` : designId;
    if (framedKeyRef.current !== frameKey) {
      frameView(); // moves the camera, which self-invalidates via controls' "change" event
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
