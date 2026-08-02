// contactShadow.ts: a soft baked "contact shadow" under the model for the
// studio viewer style (config `viewer.style: "studio"`). Instead of a live
// shadow map (whose penumbra can't get this soft without VSM bleeding), the
// model's depth is rendered once per geometry change from an orthographic
// camera at the ground looking up, blurred in two passes, and displayed on a
// transparent ground plane: the technique of three.js's webgl_shadow_contact
// example, adapted to this viewer's Z-up world. Baking only on geometry swap
// keeps the per-frame cost at zero, so the invalidation-driven render loop
// (and the smoke test's idle render-count check) is unaffected.
//
// Being a flat texture, the shadow only reads as a shadow while the camera
// looks down onto the ground plane; orbiting under the model would otherwise
// leave a dark blob hanging in space. So the viewer feeds it a camera-elevation
// fade (setFade / shadowViewFade) alongside the theme's base strength
// (setOpacity), see applyOpacity below. The fade is recomputed only on the
// renders that already happen, never on a timer.
import * as THREE from "three";
import { HorizontalBlurShader } from "three/examples/jsm/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/examples/jsm/shaders/VerticalBlurShader.js";

// Shadow texture resolution. The result is blurred anyway, so modest is plenty.
const RT_SIZE = 512;
// The ground plane extends past the model footprint so the blur can fall off.
const FOOTPRINT_SCALE = 1.8;
// Blur radius (in the example's 1/256-UV units): a wide soft pass, then a
// second narrow pass that removes the first pass's sampling artifacts.
const BLUR_MAIN = 3.5;
const BLUR_CLEANUP = 1.4;
// Depth-to-darkness gain: 1 maps "touching the ground" to fully dark before
// the display plane's own opacity scales the whole shadow.
const DARKNESS = 1;
// The display plane sits a hair below the model's base to avoid z-fighting.
const GROUND_OFFSET = 0.05;
// The depth camera starts this far below the base: a model resting exactly on
// the ground would otherwise have its base faces (the main shadow casters)
// clipped away on the camera's near plane.
const CAM_EPSILON = 0.1;
// View-fade window, in degrees of camera elevation above the ground plane. A
// baked shadow is only convincing while it is seen as marking on a floor: at a
// grazing angle it foreshortens into a dark bar, and from below it is a blob
// hanging in mid-air. So it fades out over this band and is gone at or below
// the plane. The lower bound sits a touch above 0° so the shadow is already
// invisible by the time the camera crosses the plane.
const FADE_START_DEG = 4;
const FADE_FULL_DEG = 22;

/**
 * The shadow's view-fade factor (0…1) for a camera at `camera` looking at a
 * ground plane at z = `groundZ` under the shadow's centre (x = y = 0).
 * Smoothstep over the camera's angular elevation above that plane, so the
 * shadow is full-strength from any comfortably raised viewpoint, fades as the
 * view grazes the plane, and is fully gone from below it. Pure math, exported
 * for the viewer's per-render sync (and its tests).
 */
export function shadowViewFade(
  camera: { x: number; y: number; z: number },
  groundZ: number
): number {
  const dz = camera.z - groundZ;
  const dist = Math.hypot(camera.x, camera.y, dz);
  if (!(dist > 0)) return 0;
  const sin = Math.min(1, Math.max(-1, dz / dist));
  const deg = (Math.asin(sin) * 180) / Math.PI;
  const t = (deg - FADE_START_DEG) / (FADE_FULL_DEG - FADE_START_DEG);
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c); // smoothstep
}

export interface ContactShadow {
  /** The ground-plane group; add to the scene once. */
  group: THREE.Group;
  /** Fit the shadow plane under a model's bounds (mm) with its base at groundZ. */
  setFootprint(size: { x: number; y: number; z: number }, groundZ: number): void;
  /** Base shadow strength, e.g. per theme. Multiplied by the current fade. */
  setOpacity(opacity: number): void;
  /**
   * View-dependent multiplier on the base opacity (0…1, see shadowViewFade).
   * Kept separate from setOpacity so the theme effect and the per-render view
   * sync can each own their factor without overwriting the other's.
   */
  setFade(fade: number): void;
  /** Show/hide the shadow (hidden while no model is loaded). */
  setVisible(visible: boolean): void;
  /**
   * Re-render the shadow from the current scene. Call after the model is
   * positioned; `hide` lists non-model objects (grid, overlays) that must not
   * cast. Renders into internal targets only: the default framebuffer, and
   * therefore the viewer's render counter, are untouched.
   */
  bake(renderer: THREE.WebGLRenderer, scene: THREE.Scene, hide: (THREE.Object3D | null)[]): void;
  /** Free the render targets and GPU resources. */
  dispose(): void;
}

export function createContactShadow(): ContactShadow {
  const group = new THREE.Group();
  group.visible = false;

  // The display opacity is the product of two independently-owned factors: the
  // theme's base strength (setOpacity) and the camera-elevation fade
  // (setFade). Held separately so neither caller clobbers the other: the
  // theme effect and a geometry swap both re-assert the base while the view
  // fade is being driven every render.
  let baseOpacity = 0.42;
  let viewFade = 1;

  const shadowTarget = new THREE.WebGLRenderTarget(RT_SIZE, RT_SIZE);
  shadowTarget.texture.generateMipmaps = false;
  const blurTarget = new THREE.WebGLRenderTarget(RT_SIZE, RT_SIZE);
  blurTarget.texture.generateMipmaps = false;

  // A unit XY plane (already facing +Z in this Z-up world), scaled to the
  // model footprint by setFootprint. Y is mirrored because the shadow camera
  // below looks *up* (+Z): its view flips the Y axis relative to the plane's
  // UV layout, exactly as in the upstream example. DoubleSide keeps the
  // negative scale from culling the quad.
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const planeMat = new THREE.MeshBasicMaterial({
    map: shadowTarget.texture,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.renderOrder = 1;
  group.add(plane);

  const applyOpacity = () => {
    const eff = baseOpacity * viewFade;
    planeMat.opacity = eff;
    // Fully faded: skip the draw entirely rather than blending a no-op quad.
    plane.visible = eff > 0.001;
  };

  // Full-frustum quad the blur passes render through (shares the unit geometry;
  // scaled alongside the display plane so it always fills the shadow camera).
  const blurPlane = new THREE.Mesh(planeGeo);
  blurPlane.visible = false;
  group.add(blurPlane);
  // three gives a material-less Mesh a default MeshBasicMaterial. `blur()`
  // replaces it with the two blur shaders and nothing ever disposes this one,
  // so hold it for dispose(): one leaked program per viewer mount, and the
  // viewer remounts on every breakpoint flip.
  const blurPlaneInitialMaterial = blurPlane.material as THREE.Material;

  // Orthographic camera at the ground looking up +Z. Frustum extents are set
  // by setFootprint; far (the height above ground that still darkens) too.
  const shadowCam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
  shadowCam.rotation.x = Math.PI; // look along +Z (up)
  group.add(shadowCam);

  // Depth-as-darkness: near the ground → dark, fading with height. The
  // replaced line is pinned to the installed three's ShaderLib/depth output:
  // re-verify it on a three upgrade (a failed replace shows as a solid quad).
  const depthMat = new THREE.MeshDepthMaterial();
  depthMat.onBeforeCompile = (shader) => {
    shader.uniforms.darkness = { value: DARKNESS };
    shader.fragmentShader = /* glsl */ `
      uniform float darkness;
      ${shader.fragmentShader.replace(
        "gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );",
        "gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );"
      )}
    `;
  };
  depthMat.depthTest = false;
  depthMat.depthWrite = false;

  // DoubleSide because the up-looking shadow camera sees the +Z-facing blur
  // quad from behind, with default front-side culling the pass would draw
  // nothing and the ping-pong would erase the shadow instead of blurring it.
  const hBlur = new THREE.ShaderMaterial({
    ...HorizontalBlurShader,
    uniforms: THREE.UniformsUtils.clone(HorizontalBlurShader.uniforms),
    side: THREE.DoubleSide,
  });
  hBlur.depthTest = false;
  const vBlur = new THREE.ShaderMaterial({
    ...VerticalBlurShader,
    uniforms: THREE.UniformsUtils.clone(VerticalBlurShader.uniforms),
    side: THREE.DoubleSide,
  });
  vBlur.depthTest = false;

  // Two-target ping-pong blur of the shadow texture, rendered through the
  // blur quad with the same ortho camera.
  function blur(renderer: THREE.WebGLRenderer, amount: number) {
    blurPlane.visible = true;

    blurPlane.material = hBlur;
    hBlur.uniforms.tDiffuse.value = shadowTarget.texture;
    hBlur.uniforms.h.value = amount / 256;
    renderer.setRenderTarget(blurTarget);
    renderer.render(blurPlane, shadowCam);

    blurPlane.material = vBlur;
    vBlur.uniforms.tDiffuse.value = blurTarget.texture;
    vBlur.uniforms.v.value = amount / 256;
    renderer.setRenderTarget(shadowTarget);
    renderer.render(blurPlane, shadowCam);

    blurPlane.visible = false;
  }

  return {
    group,
    setFootprint(size, groundZ) {
      const w = Math.max(size.x * FOOTPRINT_SCALE, 1);
      const h = Math.max(size.y * FOOTPRINT_SCALE, 1);
      group.position.set(0, 0, groundZ);
      plane.scale.set(w, -h, 1);
      plane.position.z = -GROUND_OFFSET;
      blurPlane.scale.set(w, h, 1);
      shadowCam.left = -w / 2;
      shadowCam.right = w / 2;
      shadowCam.top = h / 2;
      shadowCam.bottom = -h / 2;
      // Darkness fades from the base (full) to the model's top (none), so a
      // flat plate reads as a solid soft blob while taller geometry grounds
      // only where it approaches the surface.
      shadowCam.position.z = -CAM_EPSILON;
      shadowCam.far = Math.max(size.z, 1) + 2 * CAM_EPSILON;
      shadowCam.updateProjectionMatrix();
    },
    setOpacity(opacity) {
      baseOpacity = opacity;
      applyOpacity();
    },
    setFade(fade) {
      const next = Math.min(1, Math.max(0, fade));
      if (next === viewFade) return; // no material churn while the camera idles
      viewFade = next;
      applyOpacity();
    },
    setVisible(visible) {
      group.visible = visible;
    },
    bake(renderer, scene, hide) {
      const restoreVisible: [THREE.Object3D, boolean][] = [[group, group.visible]];
      group.visible = false;
      for (const obj of hide) {
        if (!obj) continue;
        restoreVisible.push([obj, obj.visible]);
        obj.visible = false;
      }
      const bg = scene.background;
      scene.background = null;
      const env = scene.environment;
      scene.environment = null;
      scene.overrideMaterial = depthMat;
      const clearAlpha = renderer.getClearAlpha();
      renderer.setClearAlpha(0);
      const target = renderer.getRenderTarget();

      renderer.setRenderTarget(shadowTarget);
      renderer.render(scene, shadowCam);
      scene.overrideMaterial = null;

      blur(renderer, BLUR_MAIN);
      blur(renderer, BLUR_CLEANUP);

      renderer.setRenderTarget(target);
      renderer.setClearAlpha(clearAlpha);
      scene.background = bg;
      scene.environment = env;
      for (const [obj, visible] of restoreVisible) obj.visible = visible;
    },
    dispose() {
      shadowTarget.dispose();
      blurTarget.dispose();
      planeGeo.dispose();
      planeMat.dispose();
      depthMat.dispose();
      hBlur.dispose();
      vBlur.dispose();
      blurPlaneInitialMaterial.dispose();
    },
  };
}
