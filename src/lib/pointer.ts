// pointer.ts: one-shot coarse-pointer test (touch-primary devices), shared by
// the touch-gated behaviours: dialogs that shouldn't steal focus / pop the
// mobile keyboard on open, the viewer gesture hint's touch wording, and the
// scroll-focused-into-view keyboard avoidance. A plain snapshot (not reactive
// like useIsMobile) because every caller reads it once, at an event/effect.
export function isCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}
