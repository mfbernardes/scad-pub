// viewerRig.ts: the Viewer's scene furniture — the studio lighting rig and its
// procedural environment, and the on-model click/hover picking. Every constant
// below is tuned as one budget: see docs/viewer.md for the derivation, and
// recheck a plate's four walls against its top before shipping a new value.
import * as THREE from "three";
import { createContactShadow, type ContactShadow } from "./contactShadow";
import { isModelClick } from "@/lib/editOnModel";

// Read from the live document theme (the same source of truth the CSS variables
// key off) so scene setup and theme switches always agree. Drives
// `scene.environmentIntensity`, not the materials' `envMapIntensity`, which a
// scene-level environment makes inert.
export function studioEnvIntensity(): number {
  return document.documentElement.dataset.theme === "dark" ? 0.92 : 1.1;
}

// Radiance of the overhead field and of the uniform base beneath it; their
// balance sets the top-vs-side ratio the whole rig exists to produce.
const ENV_OVERHEAD = 0.9;
const ENV_BASE = 0.23;
// Angular softness of the field's edge, as cosines of the angle from "up".
const ENV_EDGE0 = 0.1;
const ENV_EDGE1 = 0.95;

// The environment is authored Y-up and mapped onto this Z-up world. This sign
// is the one that lands the bright pole on world +Z; three re-flips the Euler
// on its way to the shader, so verify by eye rather than by derivation.
const ENV_ROTATION_X = Math.PI / 2;
// Key + fill are the only azimuthally-aware lights in the rig: the environment
// is a function of elevation alone, so nothing else can separate a prismatic
// letter-stroke's two opposing ~45° bevels. Both sit off the camera's azimuth
// and low to the horizon.
const KEY_INTENSITY = 0.95;
const KEY_AZIMUTH_ELEVATION_DEG = { azimuth: 0, elevation: 14 }; // world +X, low and raking
const FILL_INTENSITY = 0.55;
const FILL_AZIMUTH_ELEVATION_DEG = { azimuth: -90, elevation: 10 }; // world −Y, low and raking

// Direction (azimuth/elevation in degrees, in the same world X/Y/Z the camera
// views use) to a THREE.DirectionalLight position. Distance is arbitrary for a
// directional light, so a fixed radius keeps the constants above readable as
// angles instead of raw XYZ.
function lightPosition(azimuthDeg: number, elevationDeg: number, radius = 200): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(
    radius * Math.cos(el) * Math.cos(az),
    radius * Math.cos(el) * Math.sin(az),
    radius * Math.sin(el)
  );
}

function studioEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        base: { value: ENV_BASE },
        overhead: { value: ENV_OVERHEAD },
        edge0: { value: ENV_EDGE0 },
        edge1: { value: ENV_EDGE1 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform float base, overhead, edge0, edge1;
        void main() {
          float up = normalize(vDir).y;
          gl_FragColor = vec4(vec3(base + overhead * smoothstep(edge0, edge1, up)), 1.0);
        }
      `,
    })
  );
  const scene = new THREE.Scene();
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  // fromScene returns the render TARGET, and the target OWNS the texture the
  // scene uses as its environment: WebGLTextures' deallocateRenderTarget walks
  // `renderTarget.textures` and deletes each one's GL texture. So disposing the
  // target here would hand back an environment map whose GPU allocation is
  // already gone — silently, since the key/fill lights and the contact shadow
  // keep the model lit and it reads as merely flat.
  //
  // The target is therefore what the caller holds and disposes at teardown; the
  // generator's own scratch is freed here, which is all `pmrem.dispose()` does.
  const target = pmrem.fromScene(scene);
  sky.geometry.dispose();
  (sky.material as THREE.Material).dispose();
  pmrem.dispose();
  return target;
}

// The studio style's scene: image-based lighting from a procedurally
// generated, PMREM-filtered gradient sky (balanced for top-vs-side separation,
// docs/viewer.md), two raking directional lights, and a contact shadow.
//
// Split from the plain rig rather than selected by a `style` argument, because
// the argument defeated the whole point: `__APP_VIEWER_STYLE__` is a build-time
// define so the unused branch — and with it the PMREM, environment and
// blur-shader code — drops out of a `plain` bundle (vite.config.ts's `define`).
// Passing the style in made the branch reachable at runtime, and every plain
// deployment shipped the studio rig it can never run.
//
// The environment comes back as its render TARGET, not as the bare texture:
// disposing the target is what frees the texture, so the two cannot be
// separated (see studioEnvironment).
export function buildStudioRig(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene
): { envTarget: THREE.WebGLRenderTarget; shadow: ContactShadow } {
  // Khronos PBR Neutral tone mapping stays near-identity for mid-tones so the
  // model's colours and the themed background survive; ACES would hue-shift
  // saturated colours.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  const envTarget = studioEnvironment(renderer);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = studioEnvIntensity();
  scene.environmentRotation.set(ENV_ROTATION_X, 0, 0);
  const key = new THREE.DirectionalLight(0xffffff, KEY_INTENSITY);
  key.position.copy(
    lightPosition(KEY_AZIMUTH_ELEVATION_DEG.azimuth, KEY_AZIMUTH_ELEVATION_DEG.elevation)
  );
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, FILL_INTENSITY);
  fill.position.copy(
    lightPosition(FILL_AZIMUTH_ELEVATION_DEG.azimuth, FILL_AZIMUTH_ELEVATION_DEG.elevation)
  );
  scene.add(fill);
  const shadow = createContactShadow();
  scene.add(shadow.group);
  return { envTarget, shadow };
}

// The plain style's scene, which owns nothing on the GPU the caller must
// dispose. A hemisphere light carries most of the fill so near-white surfaces
// read close to their true colour instead of collapsing to grey, while its
// mid-grey "ground" keeps side/under faces darker so the model still shows
// form. At +Z to match the OpenSCAD Z-up scene, so "sky" lands on top faces.
export function buildPlainRig(scene: THREE.Scene): void {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.0);
  hemi.position.set(0, 0, 1);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 0.5);
  key.position.set(1, -1, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25);
  fill.position.set(-1, 1, 0.5);
  scene.add(fill);
}

/** Minimum gap between editable-hover raycasts. Below the threshold at which a
 *  cursor change reads as laggy, far above pointermove's sampling rate. */
const HOVER_THROTTLE_MS = 30;

// On-model text editing: click/tap the mesh to open the inline editor. A plain
// click — a pointerdown→pointerup pair that moved under the click threshold,
// single pointer — raycasts the model and ONLY the model, never the grid/floor,
// and reports the hit's screen position so ViewerStage can float the editor
// there. Purely observational (no preventDefault/stopPropagation), so
// OrbitControls' orbit/pan/zoom on the same canvas is unaffected: a real drag
// moves past the threshold and never opens the editor. Live only while
// `refs.editable` is set. Returns its own teardown.
export function attachModelPicking(
  canvasEl: HTMLCanvasElement,
  refs: {
    cam: THREE.Camera;
    model: React.RefObject<THREE.Object3D | null>;
    editable: React.RefObject<boolean>;
    onPick: React.RefObject<((pos: { x: number; y: number }) => void) | undefined>;
  }
): () => void {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const activePointers = new Set<number>();
  let downPt: { x: number; y: number } | null = null;
  let multiTouch = false;

  const onPointerDown = (e: PointerEvent) => {
    activePointers.add(e.pointerId);
    if (activePointers.size > 1) {
      multiTouch = true; // a second finger landed: this is a pinch/rotate, not a tap
      downPt = null;
      return;
    }
    downPt = { x: e.clientX, y: e.clientY };
  };
  const clearPointer = (e: PointerEvent) => {
    activePointers.delete(e.pointerId);
    if (activePointers.size === 0) multiTouch = false;
  };
  const onPointerUp = (e: PointerEvent) => {
    const down = downPt;
    const wasMulti = multiTouch;
    clearPointer(e);
    downPt = null;
    const pick = refs.onPick.current;
    const model = refs.model.current;
    if (!refs.editable.current || !pick || !model) return;
    if (!isModelClick({ down, up: { x: e.clientX, y: e.clientY }, multiTouch: wasMulti })) return;
    const rect = canvasEl.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, refs.cam);
    if (raycaster.intersectObject(model, true).length === 0) return; // a miss does nothing
    pick({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };
  // Hover affordance: point the cursor while genuinely over the model (only
  // while editable and not mid-drag), so the on-model click is discoverable.
  // Throttled because pointermove fires at the pointer's full sampling rate —
  // 120+ Hz on a modern trackpad — and each event costs a layout flush plus a
  // full-tree raycast. The rect is read fresh every time rather than cached:
  // the sheet detent, the ParamPanel drag and HUD layout all move this canvas
  // without a window resize or scroll, so a cache would go stale silently.
  let lastHover = 0;
  const onPointerMove = (e: PointerEvent) => {
    if (!refs.editable.current || e.buttons !== 0) return;
    const now = e.timeStamp;
    if (now - lastHover < HOVER_THROTTLE_MS) return;
    lastHover = now;
    const model = refs.model.current;
    const rect = canvasEl.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, refs.cam);
    const over = !!model && raycaster.intersectObject(model, true).length > 0;
    canvasEl.style.cursor = over ? "pointer" : "";
  };
  canvasEl.addEventListener("pointerdown", onPointerDown);
  canvasEl.addEventListener("pointerup", onPointerUp);
  canvasEl.addEventListener("pointercancel", clearPointer);
  canvasEl.addEventListener("pointermove", onPointerMove);
  return () => {
    canvasEl.removeEventListener("pointerdown", onPointerDown);
    canvasEl.removeEventListener("pointerup", onPointerUp);
    canvasEl.removeEventListener("pointercancel", clearPointer);
    canvasEl.removeEventListener("pointermove", onPointerMove);
  };
}
