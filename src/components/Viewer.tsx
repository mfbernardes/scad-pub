// Viewer.tsx — three.js preview of the rendered STL mesh. Parses the OpenSCAD
// STL bytes, frames the model, and offers orbit/zoom. There is no live OpenCSG
// preview in WASM, so this shows the F6-rendered mesh.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface ViewerHandle {
  /** A PNG data URL of the current view, or null if nothing is rendered. */
  snapshot: () => string | null;
}

// Read a CSS custom property as a three.js colour (so the viewer follows theme).
function cssColor(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}

export const Viewer = forwardRef<
  ViewerHandle,
  { stl: Uint8Array | null; theme: string }
>(function Viewer({ stl, theme }, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const camRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);

  useImperativeHandle(ref, () => ({
    snapshot() {
      const r = rendererRef.current;
      const s = sceneRef.current;
      const c = camRef.current;
      if (!r || !s || !c || !meshRef.current) return null;
      r.render(s, c); // refresh the preserved buffer before reading it
      return r.domElement.toDataURL("image/png");
    },
  }));

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

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, cam);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h, false);
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
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
      // Recolour an already-loaded model so it follows a live theme switch.
      if (meshRef.current) {
        (meshRef.current.material as THREE.MeshStandardMaterial).color = cssColor(
          "--viewer-model",
          "#6f93ff"
        );
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [theme]);

  // Swap geometry when a new STL arrives.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (meshRef.current) {
      scene.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      (meshRef.current.material as THREE.Material).dispose();
      meshRef.current = null;
    }
    if (!stl || stl.length === 0) return;

    const geo = new STLLoader().parse(
      stl.buffer.slice(
        stl.byteOffset,
        stl.byteOffset + stl.byteLength
      ) as ArrayBuffer
    );
    geo.computeVertexNormals();
    geo.center();
    const mat = new THREE.MeshStandardMaterial({
      color: cssColor("--viewer-model", "#6f93ff"),
      metalness: 0.1,
      roughness: 0.7,
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    meshRef.current = mesh;

    // Frame the model.
    geo.computeBoundingSphere();
    const r = geo.boundingSphere?.radius ?? 50;
    const cam = camRef.current!;
    const controls = controlsRef.current!;
    const d = r * 2.6;
    cam.position.set(d * 0.6, -d, d * 0.7);
    controls.target.set(0, 0, 0);
    controls.update();
  }, [stl]);

  // The WebGL canvas conveys nothing to assistive tech; the textual render
  // status/log/advisories carry the meaning instead.
  return <div className="viewer" ref={mountRef} aria-hidden="true" />;
  }
);
