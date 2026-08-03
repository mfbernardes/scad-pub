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

/** Whether the viewer is behind something that owns the keyboard.
 *
 *  Asked of the VIEWER, not of the document, and that distinction is the whole
 *  check: "is there a `[role=dialog]` anywhere" also matches every Radix
 *  Popover (`PopoverContent` carries that role, see ParamForm's help bubble),
 *  so opening the viewer's own View menu — a 200px panel occluding nothing —
 *  killed the zoom keys. Both surfaces that really do take the viewer away mark
 *  it directly instead: a modal dialog `aria-hidden`s the background, and the
 *  mobile sheet `inert`s it at the Full detent. */
function occluded(wrap: HTMLElement | null): boolean {
  return !!wrap?.closest("[inert], [aria-hidden='true']");
}

export function useZoomKeys(
  viewerRef: RefObject<ViewerHandle | null>,
  enabled: boolean,
  wrapRef: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd +/- is the browser's own page zoom, and Alt combinations
      // belong to the platform: neither is ours to take.
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (occluded(wrapRef.current)) return;
      // "=" and "_" are the unshifted faces of the same two keys, so the
      // binding works without reaching for Shift on a US layout. U+2212 is the
      // minus sign the help copy prints and some layouts emit.
      if (e.key === "+" || e.key === "=") viewerRef.current?.zoomIn();
      else if (e.key === "-" || e.key === "_" || e.key === "\u2212") viewerRef.current?.zoomOut();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [viewerRef, enabled, wrapRef]);
}
