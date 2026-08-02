// useScrollFocusedIntoView.ts: keep a focused field clear of the on-screen
// keyboard on touch devices. When a text/number/select field inside a scroll
// container gains focus, scroll it to the vertical centre of its scroller so
// the software keyboard can't occlude it. iOS in particular does not shrink
// window.innerHeight / dvh when the keyboard appears, so a field low in a
// bottom sheet or modal would otherwise sit behind it.
//
// It scrolls THAT SCROLLER AND NOTHING ELSE, by assigning its scrollTop
// directly. `Element.scrollIntoView()` (which this used to call) walks up and
// scrolls every scrollable ancestor including the layout viewport, and on iOS
// that is a trap: while the keyboard is up the visual viewport is shorter than
// the layout viewport, so the document becomes scrollable and gets scrolled;
// when the keyboard dismisses the visual viewport grows back, but that document
// scroll offset stays. The whole fixed-height app shell then sits shifted up:
// the model clipped off the top, a band of page background exposed below the
// sheet, for a shell that is never meant to scroll at all.
//
// Generic and dependency-free. Gated to coarse-pointer (touch) devices so it
// never fires on desktop: no layout or visual-baseline impact there.
import { useEffect, type RefObject } from "react";
import { isCoarsePointer } from "./pointer";
import { isScrollableY } from "./scrollParent";

// The input types a keyboard actually pops for. Buttons/checkboxes/sliders are
// intentionally excluded: they don't summon a keyboard.
const FIELD_SELECTOR = "input, textarea, select";
// Let the keyboard begin animating in (and the browser settle any layout) before
// we scroll, so the centring lands against the final viewport.
const SETTLE_MS = 300;

/**
 * The nearest vertically-scrollable ancestor of `el`, searched no further up
 * than `root`. Returns null when the field isn't inside one: in which case
 * there is nothing this hook may scroll, and it does nothing rather than
 * falling back to the document.
 */
export function scrollParentWithin(el: HTMLElement, root: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (isScrollableY(node) && node.scrollHeight > node.clientHeight) return node;
    if (node === root) return null;
  }
  return null;
}

/**
 * How far `scroller` must scroll to centre `field` in it, clamped to the
 * scroller's own range. Pure geometry (two rects and three numbers), so
 * tests/scrollFocusedIntoView.test.mjs can exercise the clamping without a DOM.
 */
export function centeringScrollTop(
  field: { top: number; height: number },
  scroller: { top: number; height: number },
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number
): number {
  const delta = field.top + field.height / 2 - (scroller.top + scroller.height / 2);
  const max = Math.max(0, scrollHeight - clientHeight);
  return Math.max(0, Math.min(max, scrollTop + delta));
}

export function useScrollFocusedIntoView(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!isCoarsePointer()) return;
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || typeof target.matches !== "function") return;
      if (!target.matches(FIELD_SELECTOR)) return;
      window.setTimeout(() => {
        // Re-resolve at fire time: 300ms of keyboard animation is long enough
        // for the field to have been unmounted (a preset applied, a design
        // switched) and for its scroller's geometry to have settled.
        if (!target.isConnected) return;
        const scroller = scrollParentWithin(target, el);
        if (!scroller) return;
        const next = centeringScrollTop(
          target.getBoundingClientRect(),
          scroller.getBoundingClientRect(),
          scroller.scrollTop,
          scroller.scrollHeight,
          scroller.clientHeight
        );
        scroller.scrollTo({ top: next, behavior: "smooth" });
      }, SETTLE_MS);
    };
    el.addEventListener("focusin", onFocusIn);
    return () => el.removeEventListener("focusin", onFocusIn);
  }, [ref]);
}
