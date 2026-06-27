// useOnline — tracks navigator.onLine and the online/offline events. Used to
// reassure the user that renders/exports keep working offline (the WASM and the
// app shell are service-worker cached).
import { useSyncExternalStore } from "react";

export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("online", onChange);
      window.addEventListener("offline", onChange);
      return () => {
        window.removeEventListener("online", onChange);
        window.removeEventListener("offline", onChange);
      };
    },
    () => navigator.onLine,
    () => true
  );
}
