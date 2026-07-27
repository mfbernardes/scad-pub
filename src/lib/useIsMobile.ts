// useIsMobile — true below the 860px breakpoint (kept in sync with the CSS
// media query that toggles the mobile/desktop layouts). Used so only the active
// layout mounts a three.js Viewer instead of both running at once.
import { useSyncExternalStore } from "react";
import { subscribeMatchMedia } from "./matchMedia";

const QUERY = "(max-width: 860px)";

// Module scope keeps these referentially stable — see subscribeMatchMedia.
const subscribe = subscribeMatchMedia(QUERY);
const getSnapshot = (): boolean => window.matchMedia(QUERY).matches;
const getServerSnapshot = (): boolean => false;

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
