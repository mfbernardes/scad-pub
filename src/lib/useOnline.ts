// useOnline — tracks navigator.onLine and the online/offline events. Used to
// reassure the user that renders/exports keep working offline (the WASM and the
// app shell are service-worker cached).
import { useSyncExternalStore } from "react";

// Module-scope so useSyncExternalStore gets a referentially stable subscribe/
// getSnapshot/getServerSnapshot across renders — inline callbacks would make it
// tear down and re-add the listeners on every render of every consumer.
function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

function getServerSnapshot(): boolean {
  return true;
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
