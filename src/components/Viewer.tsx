// Viewer.tsx — three.js preview of the rendered model. Parses the OpenSCAD
// export and frames the model with orbit/zoom. There is no live OpenCSG preview
// in WASM, so this shows the F6-rendered mesh. The export format is fixed at
// build time (config -> __APP_FORMAT__): 3MF carries per-object colour from
// `color(...)`; STL is geometry-only and shown in the theme's model colour.
// Only the chosen format's loader is referenced, so the other tree-shakes out.
import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildDimensions, type DimensionsGroup } from "./dimensions";
import { VIEW_DIRECTIONS, DEFAULT_VIEW, type ViewName } from "./views";

// The build-time model format (Vite define; see vite.config.ts). A literal, so
// the unused branch below — and its loader import — drop out of the bundle.
declare const __APP_FORMAT__: "3mf" | "stl";

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

export const Viewer = memo(forwardRef<
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
  // Bounding-sphere radius of the framed model, so "Reset view" can reproduce
  // the default framing on demand. null until the first model is framed.
  const frameRadiusRef = useRef<number | null>(null);

  // Frame the orbit camera for a model of the given bounding-sphere radius, from
  // the named standard view (default = the current one). The camera's up stays
  // +Z for every view (set once at init), so OrbitControls keeps orbiting
  // correctly; only the look-from direction changes.
  function frameView(radius: number, name: ViewName = viewRef.current) {
    const cam = camRef.current;
    const controls = controlsRef.current;
    if (!cam || !controls) return;
    if (name === "isometric") {
      // The long-standing default three-quarter framing, kept pixel-exact.
      const d = radius * 2.6;
      cam.position.set(d * 0.6, -d, d * 0.7);
    } else {
      const [x, y, z] = VIEW_DIRECTIONS[name];
      cam.position
        .set(x, y, z)
        .normalize()
        .multiplyScalar(radius * 3.4);
    }
    controls.target.set(0, 0, 0);
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
      r.render(s, c); // refresh the preserved buffer before reading it
      return r.domElement.toDataURL("image/png");
    },
    resetView() {
      if (frameRadiusRef.current != null) frameView(frameRadiusRef.current);
    },
    setView(name) {
      viewRef.current = name; // stick for the next new-model reframe
      if (frameRadiusRef.current != null) frameView(frameRadiusRef.current, name);
    },
    zoomIn() {
      dolly(0.8);
    },
    zoomOut() {
      dolly(1.25);
    },
  }));

  // Tracks whether the canvas is intersecting the viewport. Used to skip
  // renderer.render() calls when the viewer is off-screen (e.g. bottom sheet
  // at full detent, or a background tab), saving GPU/battery.
  const visibleRef = useRef(true);

  // One-time scene setup.
  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    sceneRef.current = scene; // background + grid are set by the theme effect

    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    cam.position.set(60, -80, 60);
    cam.up.set(0, 0, 1); // OpenSCAD is Z-up
    camRef.current = cam;

    // preserveDrawingBuffer lets us read the canvas back as a PNG snapshot.
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
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
      ([entry]) => { visibleRef.current = entry.isIntersecting; },
      { threshold: 0 }
    );
    io.observe(mount);

    // Resize from inside the RAF loop so the drawing buffer is resized and
    // re-rendered in the same frame: setSize() clears the canvas, and resizing
    // out-of-band (e.g. an async ResizeObserver) left a blank frame before the
    // next render, which flickered while the bottom sheet animated the viewer's
    // height. Polling the mount size each frame is cheap — the read only forces
    // layout when something actually changed it (e.g. a sheet drag).
    let lastW = 0;
    let lastH = 0;
    let raf = 0;
    const animate = () => {
      controls.update();
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w !== lastW || h !== lastH) {
        renderer.setSize(w, h, false);
        cam.aspect = w / Math.max(1, h);
        cam.updateProjectionMatrix();
        lastW = w;
        lastH = h;
      }
      if (visibleRef.current) renderer.render(scene, cam);
      raf = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      controls.dispose();
      dimGroupRef.current?.dispose();
      renderer.dispose();
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
    });
    return () => cancelAnimationFrame(raf);
    // showDimensions is read fresh on a theme change; its own effect handles toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Show/hide the dimension overlay on toggle (geometry stays put).
  useEffect(() => {
    syncDimensions(showDimensions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // Centre the model on the origin (the export keeps the design's own
    // coordinates, which aren't centred).
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center);
    scene.add(obj);
    modelRef.current = obj;

    // Report the printed bounding-box size (mm). Measured from the loaded mesh,
    // wholly downstream of the exported bytes, so it's informative only and never
    // part of the print. Translation-invariant, so the centring above is moot.
    const size = box.getSize(new THREE.Vector3());
    modelSizeRef.current = size.clone();
    syncDimensions(showDimensions); // refresh the overlay for the new bounds
    onMeasureRef.current?.({ x: size.x, y: size.y, z: size.z });

    // Remember the model's size so "Reset view" can reproduce this framing even
    // after the user has orbited or zoomed away.
    const r = box.getBoundingSphere(new THREE.Sphere()).radius || 50;
    frameRadiusRef.current = r;

    // Reframe when the design changed — and, on desktop (reframeOnPreset), when
    // the preset changed too — or on the first model. A re-render from the same
    // framing key (e.g. a parameter tweak, or a preset change on mobile) keeps
    // the user's current orbit/zoom so the view doesn't jump. designId/presetId
    // are read fresh here rather than via the dep array: a preset change doesn't
    // clear the old geometry, so reframing must wait for the new model to arrive
    // (this effect) and use *its* bounds, not the stale ones.
    const frameKey = reframeOnPreset ? `${designId}\n${presetId}` : designId;
    if (framedKeyRef.current !== frameKey) {
      frameView(r);
      framedKeyRef.current = frameKey;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stl]);

  // The WebGL canvas conveys nothing to assistive tech; the textual render
  // status/log/notices carry the meaning instead.
  return <div className="viewer" ref={mountRef} aria-hidden="true" />;
  }
));

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
