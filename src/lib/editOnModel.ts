// editOnModel.ts — pure, DOM-free helpers for the "type on the sign" feature:
// direct on-model text editing. A design marks one plain string param
// `// @editOnModel` (see docs/annotations.md); the viewer then lets the user
// edit that value by clicking the rendered mesh, which opens a floating inline
// text editor (ViewerEditOnModel.tsx). These helpers hold the two bits of math
// worth testing without a browser: the click-vs-drag threshold and the editor
// position clamping. Everything three.js / React lives in the components.
import type { Design, Param } from "../openscad/types";

/** Movement (px) at or below which a pointerdown→pointerup pair counts as a
 *  click/tap rather than an orbit/pan drag. Small enough that a deliberate
 *  drag never opens the editor, generous enough that a shaky tap still does. */
export const CLICK_MOVE_THRESHOLD_PX = 5;

/** Gap (px) kept between the editor card and the viewer edges when clamping. */
export const EDITOR_MARGIN_PX = 8;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * The design's on-model editable text parameter, or null when it declares none.
 * gen-schema guarantees at most one param carries `editOnModel`, so the first
 * match is the only match.
 */
export function editOnModelParam(design: Design): Param | null {
  return design.params.find((p) => p.type === "string" && p.editOnModel === true) ?? null;
}

/**
 * Whether a pointerdown→pointerup pair is a click (tap) rather than a drag: a
 * single pointer whose travel is within `threshold` px. A multi-touch gesture
 * (pinch/rotate) is never a click, and a missing `down` (e.g. a pointerup with
 * no matching down this session) is treated as not-a-click. Pure so the viewer's
 * gesture gate can be unit-tested without a DOM.
 */
export function isModelClick({
  down,
  up,
  multiTouch = false,
  threshold = CLICK_MOVE_THRESHOLD_PX,
}: {
  down: Point | null;
  up: Point;
  multiTouch?: boolean;
  threshold?: number;
}): boolean {
  if (multiTouch || !down) return false;
  return Math.hypot(up.x - down.x, up.y - down.y) <= threshold;
}

/**
 * Clamp the floating editor's top-left corner so the whole card stays inside the
 * viewer, keeping a `margin` gap from every edge. `hit` is the click's position
 * within the viewer (null = no hit point, i.e. opened from the pencil chip, so
 * centre it). On mobile the card is pinned toward the TOP of the viewer, because
 * the on-screen keyboard covers the lower half and would otherwise hide it. Pure
 * (numbers in, numbers out) so the positioning math is unit-testable.
 */
export function clampEditorPosition(
  hit: Point | null,
  bounds: Size,
  editor: Size,
  { mobile = false, margin = EDITOR_MARGIN_PX }: { mobile?: boolean; margin?: number } = {}
): { left: number; top: number } {
  const maxLeft = Math.max(margin, bounds.width - editor.width - margin);
  const maxTop = Math.max(margin, bounds.height - editor.height - margin);

  let left: number;
  let top: number;
  if (hit) {
    // Centre the card horizontally on the hit; sit it just below the hit on
    // desktop (so the pointer/finger isn't over the input on open).
    left = hit.x - editor.width / 2;
    top = mobile ? margin : hit.y + margin;
  } else {
    left = (bounds.width - editor.width) / 2;
    top = mobile ? margin : (bounds.height - editor.height) / 2;
  }

  // On mobile keep the card within the top ~40% of the viewer so the keyboard
  // (which eats the bottom half) can never cover it.
  const topCap = mobile ? Math.max(margin, Math.min(maxTop, bounds.height * 0.4)) : maxTop;

  return {
    left: Math.min(Math.max(left, margin), maxLeft),
    top: Math.min(Math.max(top, margin), topCap),
  };
}
