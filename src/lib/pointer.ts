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

/** Radix's `onOpenAutoFocus` handler for a dialog CONTAINING A TEXT FIELD: on
 *  a touch device, don't let opening pull focus to it, which pops the on-screen
 *  keyboard over the dialog the visitor just opened. Focus still has to land
 *  SOMEWHERE inside the dialog, though (otherwise it's stranded on the
 *  now-hidden trigger and a screen reader never announces the dialog opened),
 *  so this focuses the event's target directly instead — Radix dispatches
 *  `onOpenAutoFocus` on its own focus-scope container, which already carries
 *  `tabIndex={-1}` for exactly this. A non-editable container doesn't summon
 *  the keyboard the way autofocusing the text field would.
 *
 *  Not for a dialog of buttons alone. There is no keyboard to pop there, and
 *  suppressing Radix's default focusFirst() strands a screen-reader or
 *  hardware-keyboard visitor behind the modal — which is how ConfirmDialog and
 *  ReviewDialog briefly acquired it, in the sweep that shared this helper. */
export function preventTouchAutoFocus(e: Event): void {
  if (!isCoarsePointer()) return;
  e.preventDefault();
  (e.target as HTMLElement | null)?.focus({ preventScroll: true });
}
