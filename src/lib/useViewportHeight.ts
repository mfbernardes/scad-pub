// useViewportHeight — window.innerHeight, updated on resize/orientation change.
// Used to place the mobile output console just above the bottom sheet.
import { useSyncExternalStore } from "react";

export function useViewportHeight(): number {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("resize", onChange);
      return () => window.removeEventListener("resize", onChange);
    },
    () => window.innerHeight,
    () => 0
  );
}
