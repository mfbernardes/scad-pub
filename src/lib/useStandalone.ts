// useStandalone — true when the app runs as an installed PWA (its own window),
// via the standalone display-mode or iOS Safari's navigator.standalone. Used to
// hide affordances that only make sense in a browser tab (e.g. fullscreen).
import { useSyncExternalStore } from "react";

const QUERY = "(display-mode: standalone)";

function isStandalone(): boolean {
  return (
    window.matchMedia?.(QUERY).matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function useStandalone(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    isStandalone,
    () => false
  );
}
