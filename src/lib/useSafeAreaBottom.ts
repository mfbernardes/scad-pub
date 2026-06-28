// useSafeAreaBottom — the iOS home-indicator / gesture-bar inset in px (the CSS
// env(safe-area-inset-bottom)). env() can't be read from JS directly, so it's
// measured off a hidden, fixed probe and refreshed on resize/orientation change.
// The mobile bottom sheet needs this so its JS-computed geometry (height + the
// `bottom` it sits at) agrees with the CSS footer that reserves the same inset —
// otherwise the sheet and the fixed footer overlap on devices with an inset.
import { useLayoutEffect, useState } from "react";

function readInset(): number {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  // Measure --safe-area-bottom (defined in index.css as env(safe-area-inset-bottom))
  // rather than env() directly, so the CSS layout and this JS read one source of
  // truth — and a test can override the var to simulate a device inset.
  probe.style.cssText =
    "position:fixed;left:0;bottom:0;width:0;height:var(--safe-area-bottom,env(safe-area-inset-bottom,0px));visibility:hidden;pointer-events:none;";
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return Math.round(px);
}

export function useSafeAreaBottom(): number {
  const [inset, setInset] = useState(0);
  useLayoutEffect(() => {
    const measure = () => setInset(readInset());
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);
  return inset;
}
