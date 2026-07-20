// views.ts — the standard camera presets offered by the viewer's view picker.
// OpenSCAD is Z-up, so every preset keeps the camera's up vector at +Z and only
// varies the direction it looks from. Top/Bottom would put the up vector on the
// line of sight (gimbal lock) and changing the up vector mid-session breaks
// OrbitControls, so those two are nudged slightly off-axis instead — close
// enough to read as a plan view while keeping a stable +Z up and orbiting.
export type ViewName =
  | "product"
  | "isometric"
  | "top"
  | "bottom"
  | "front"
  | "back"
  | "left"
  | "right";

export interface ViewOption {
  id: ViewName;
  /** i18n catalogue key (src/locales/*.json) for the display label — resolved
   *  with t() at render time in ViewPicker.tsx, not baked in here. */
  labelKey: string;
}

// Order shown in the picker dropdown — the default "product" framing leads,
// matching what a fresh load and Reset view actually show.
export const VIEW_OPTIONS: ViewOption[] = [
  { id: "product", labelKey: "view.product" },
  { id: "isometric", labelKey: "view.isometric" },
  { id: "top", labelKey: "view.top" },
  { id: "bottom", labelKey: "view.bottom" },
  { id: "front", labelKey: "view.front" },
  { id: "back", labelKey: "view.back" },
  { id: "left", labelKey: "view.left" },
  { id: "right", labelKey: "view.right" },
];

// Unit-ish direction from the model centre to the camera for each preset. The
// magnitude doesn't matter — frameView() (Viewer.tsx) normalises and scales
// every one of these through framing.ts's frameDistance() to fit the
// viewport, not just the default. Top/Bottom carry a small −Y tilt to dodge
// gimbal lock; the rest are exact axes.
export const VIEW_DIRECTIONS: Record<ViewName, [number, number, number]> = {
  // The default "product stage" framing: turned ~25° off dead-front and
  // elevated ~50°, like a studio product photo looking down onto the
  // model's face rather than a CAD isometric. Many designs of this kind
  // are thin plates lying flat in the XY plane (their "face" — text/relief
  // — is the top, +Z, face), so the elevation matters far more than for a
  // boxy/tall model: the previous [0.55,-1,0.4] direction (elevation ~19°)
  // looked almost edge-on for that common case, foreshortening the face to
  // a thin ribbon. ~50° elevation reads the face clearly while still
  // showing enough of the front/side edges to look three-dimensional; a
  // tall shape (e.g. a narrow piece standing upright) still reads fine at this
  // angle since only the elevation moved, not the turn — see
  // views.test.mjs's elevation/azimuth checks, and framing.test.mjs for the
  // viewport-fill math this direction is scaled through.
  product: [0.32, -0.67, 0.88],
  isometric: [0.6, -1, 0.7],
  top: [0, -0.12, 1],
  bottom: [0, -0.12, -1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
};

export const DEFAULT_VIEW: ViewName = "product";
