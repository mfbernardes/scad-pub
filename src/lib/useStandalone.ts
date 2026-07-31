// useStandalone: true when the app runs as an installed PWA (its own window),
// via the standalone display-mode or iOS Safari's navigator.standalone. Used to
// hide affordances that only make sense in a browser tab (e.g. fullscreen).
import { useSyncExternalStore } from "react";
import { subscribeMatchMedia } from "./matchMedia";

const QUERY = "(display-mode: standalone)";

function isStandalone(): boolean {
  return (
    window.matchMedia?.(QUERY).matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// Module scope keeps these referentially stable, see subscribeMatchMedia.
const subscribe = subscribeMatchMedia(QUERY);
const getServerSnapshot = (): boolean => false;

export function useStandalone(): boolean {
  return useSyncExternalStore(subscribe, isStandalone, getServerSnapshot);
}
