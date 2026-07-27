// useIsMobile — true below the 860px breakpoint (kept in sync with the CSS
// media query that toggles the mobile/desktop layouts). Used so only the active
// layout mounts a three.js Viewer instead of both running at once.
import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 860px)";

// Module-scope so useSyncExternalStore gets a referentially stable subscribe/
// getSnapshot/getServerSnapshot across renders — inline callbacks would make it
// tear down and re-add the listener on every render of every consumer. Kept as
// plain functions (not top-level `window.matchMedia(QUERY)` calls) so this
// module still imports cleanly under node:test's DOM-less environments.
function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
