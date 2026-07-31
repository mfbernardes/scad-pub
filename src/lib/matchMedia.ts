// subscribeMatchMedia: the `subscribe` half of a useSyncExternalStore store
// backed by a media query. Shared by useIsMobile and useStandalone, whose
// subscriptions are identical and differ only in the query; each keeps its own
// snapshot function, since what they read off the match differs (useStandalone
// also ORs in navigator.standalone).
//
// Returns a stable function per query so callers can hold it at module scope:
// useSyncExternalStore re-subscribes whenever `subscribe` changes identity, so
// a fresh closure per render would tear down and re-add the listener on every
// render of every consumer. The MediaQueryList is created inside the returned
// function rather than here, so importing this module never touches `window`
// (the hooks are pulled in by node:test's type-stripped, DOM-less runs).
export function subscribeMatchMedia(query: string): (onChange: () => void) => () => void {
  return (onChange) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  };
}
