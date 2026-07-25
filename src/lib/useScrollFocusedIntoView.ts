// useScrollFocusedIntoView.ts — keep a focused field clear of the on-screen
// keyboard on touch devices. When a text/number/select field inside a scroll
// container gains focus, scroll it to the vertical centre of its scroller so
// the software keyboard can't occlude it. iOS in particular does not shrink
// window.innerHeight / dvh when the keyboard appears, so a field low in a
// bottom sheet or modal would otherwise sit behind it.
//
// Generic and dependency-free. Gated to coarse-pointer (touch) devices so it
// never fires on desktop — no layout or visual-baseline impact there.
import { useEffect, type RefObject } from "react";
import { isCoarsePointer } from "./pointer";

// The input types a keyboard actually pops for. Buttons/checkboxes/sliders are
// intentionally excluded — they don't summon a keyboard.
const FIELD_SELECTOR = "input, textarea, select";
// Let the keyboard begin animating in (and the browser settle any layout) before
// we scroll, so the centring lands against the final viewport.
const SETTLE_MS = 300;

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
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }, SETTLE_MS);
    };
    el.addEventListener("focusin", onFocusIn);
    return () => el.removeEventListener("focusin", onFocusIn);
  }, [ref]);
}
