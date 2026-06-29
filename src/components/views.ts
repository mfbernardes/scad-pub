// views.ts — the standard camera presets offered by the viewer's view picker.
// OpenSCAD is Z-up, so every preset keeps the camera's up vector at +Z and only
// varies the direction it looks from. Top/Bottom would put the up vector on the
// line of sight (gimbal lock) and changing the up vector mid-session breaks
// OrbitControls, so those two are nudged slightly off-axis instead — close
// enough to read as a plan view while keeping a stable +Z up and orbiting.
export type ViewName =
  | "isometric"
  | "top"
  | "bottom"
  | "front"
  | "back"
  | "left"
  | "right";

export interface ViewOption {
  id: ViewName;
  label: string;
}

// Order shown in the picker dropdown.
export const VIEW_OPTIONS: ViewOption[] = [
  { id: "isometric", label: "Isometric" },
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
  { id: "front", label: "Front" },
  { id: "back", label: "Back" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
];

// Unit-ish direction from the model centre to the camera for each preset. The
// magnitude doesn't matter (the viewer normalises and scales to fit). Top/Bottom
// carry a small −Y tilt to dodge gimbal lock; the rest are exact axes. Isometric
// matches the long-standing default three-quarter framing.
export const VIEW_DIRECTIONS: Record<ViewName, [number, number, number]> = {
  isometric: [0.6, -1, 0.7],
  top: [0, -0.12, 1],
  bottom: [0, -0.12, -1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
};

export const DEFAULT_VIEW: ViewName = "isometric";
