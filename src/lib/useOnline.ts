// useOnline: tracks navigator.onLine and the online/offline events. Used to
// reassure the user that renders/exports keep working offline (the WASM and the
// app shell are service-worker cached).
import { useSyncExternalStore } from "react";

// Module scope so useSyncExternalStore sees stable callbacks: a fresh closure
// per render would tear down and re-add both listeners on every render of
// every consumer. Not shared with the matchMedia-backed hooks: this subscribes
// to window events, a different mechanism.
function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const getSnapshot = (): boolean => navigator.onLine;
const getServerSnapshot = (): boolean => true;

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
