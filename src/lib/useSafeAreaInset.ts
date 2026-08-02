// useSafeAreaInset: a device safe-area inset in px (the CSS
// env(safe-area-inset-*)), for the two edges the mobile bottom sheet's geometry
// depends on. env() can't be read from JS directly, so it's measured off a
// hidden, fixed probe and refreshed on resize/orientation change.
//
//  • bottom. The iOS home-indicator / gesture bar. The sheet needs it so its
//    JS-computed geometry (height + the `bottom` it sits at) agrees with the
//    CSS that reserves the same inset; otherwise the two disagree by the inset
//    on devices that have one.
//  • top: the notch / dynamic island. The sheet's Full detent stops short of
//    the top edge to leave a live model strip (BottomSheet's FULL_TOP_GAP),
//    and this keeps a notch from eating into that strip.
//
// One probe helper for both edges rather than a hand-rolled read per caller:
// the measurement is fiddly (it must go through the SAME custom property the
// stylesheet uses, so CSS and JS can't drift and a test can override the var to
// simulate a device inset) and it is exactly the sort of thing that gets
// subtly re-implemented.
//
// Read it ONCE per mount and on viewport change, never per event. The value
// only changes with orientation/viewport, but the probe appends to
// document.body and then reads a rect, which forces a synchronous layout of
// the whole document; calling it from a pointermove handler would thrash
// layout on the app's most latency-sensitive gesture.
import { useLayoutEffect, useState } from "react";

export type SafeAreaEdge = "top" | "bottom";

/** One-shot measurement. Same warning as above: it forces a synchronous layout,
 *  so don't put it on a hot path. */
function readSafeAreaInset(edge: SafeAreaEdge): number {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  // Measure --safe-area-top / --safe-area-bottom (both defined in index.css
  // from env()) rather than env() directly, so the CSS layout and this JS read
  // one source of truth.
  probe.style.cssText =
    `position:fixed;left:0;${edge}:0;width:0;` +
    `height:var(--safe-area-${edge},env(safe-area-inset-${edge},0px));` +
    "visibility:hidden;pointer-events:none;";
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return Math.round(px);
}

/** The named edge's inset, measured on mount and refreshed on
 *  resize/orientationchange. 0 until the first measurement lands. */
export function useSafeAreaInset(edge: SafeAreaEdge): number {
  const [inset, setInset] = useState(0);
  useLayoutEffect(() => {
    const measure = () => setInset(readSafeAreaInset(edge));
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [edge]);
  return inset;
}

/** The iOS home-indicator / gesture-bar inset. Named wrapper kept because it
 *  reads better at AppShell's call site than the edge string does. */
export function useSafeAreaBottom(): number {
  return useSafeAreaInset("bottom");
}
