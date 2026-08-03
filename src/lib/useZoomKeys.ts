// useZoomKeys.ts: "+" / "-" dolly the viewer camera.
//
// The canvas is aria-hidden and not focusable, and OrbitControls only listens
// for wheel and pinch, so zoom was the one viewer function with no keyboard
// path at all (2.1.1). Orbit already had one — the named standard views in the
// HUD — and this gives magnification the same. Bound on the document rather
// than the canvas precisely because there is nothing focusable to hang it on;
// the typing and modifier guards below are what keep that from being rude.
import { useEffect, type RefObject } from "react";
import type { ViewerHandle } from "../components/Viewer";

/** Whether a keystroke belongs to whatever the visitor is typing into. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

export function useZoomKeys(viewerRef: RefObject<ViewerHandle | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd +/- is the browser's own page zoom, and Alt combinations
      // belong to the platform: neither is ours to take.
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      // "=" and "_" are the unshifted faces of the same two keys, so the
      // binding works without reaching for Shift on a US layout.
      if (e.key === "+" || e.key === "=") viewerRef.current?.zoomIn();
      else if (e.key === "-" || e.key === "_") viewerRef.current?.zoomOut();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [viewerRef, enabled]);
}
