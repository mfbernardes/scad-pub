// useIsMobile — true below the 860px breakpoint (kept in sync with the CSS
// media query that toggles the mobile/desktop layouts). Used so only the active
// layout mounts a three.js Viewer instead of both running at once.
import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 860px)";

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}
