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

// Module-scope so useSyncExternalStore gets a referentially stable subscribe/
// getSnapshot/getServerSnapshot across renders — inline callbacks would make it
// tear down and re-add the listener on every render of every consumer.
function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getServerSnapshot(): boolean {
  return false;
}

export function useStandalone(): boolean {
  return useSyncExternalStore(subscribe, isStandalone, getServerSnapshot);
}
