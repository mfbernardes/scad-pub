// useDocumentScrollLock.ts — hold the document at scroll offset 0.
//
// The app is a fixed-height shell: `#root` is `100dvh`, every scrollable region
// is an inner one, and `html, body { overflow: hidden }` says the document has
// nothing to scroll. None of that stops a BROWSER from scrolling the layout
// viewport itself, and iOS Safari does exactly that while the software keyboard
// is up — the visual viewport shrinks, the layout viewport doesn't, so the
// document becomes scrollable and Safari scrolls it to reveal the focused
// field. Dismissing the keyboard restores the visual viewport but not that
// offset, so the shell is left sitting above its own viewport: the model
// clipped off the top, a band of page background below the sheet.
//
// The app never causes that scroll itself (useScrollFocusedIntoView scrolls
// only the field's own scroller), so anything non-zero here is the browser's,
// and putting it back is always right.
//
// Two triggers, because neither alone covers it:
//   • `visualViewport` resize/scroll — fires when the keyboard opens AND when
//     it closes, which is the moment that needs the correction. Only restore
//     once the visual viewport is (near) full height again: correcting mid-
//     keyboard would fight Safari while it is still trying to reveal the field.
//   • the document's own `scroll` — a catch-all for anything else that moves
//     it (a programmatic focus, an anchor jump), where waiting for a viewport
//     event would leave the shell visibly offset.
//
// No-ops everywhere the document isn't scrolled, which is every desktop
// browser and every mobile browser that resizes the layout viewport instead
// (Android's `resizes-content`), so this costs nothing where it isn't needed.
import { useEffect } from "react";

// How close the visual viewport must be to the layout viewport before a
// keyboard counts as "gone". A few px of slack absorbs sub-pixel rounding and
// the tail of the dismiss animation.
const KEYBOARD_GONE_SLACK_PX = 8;

export function useDocumentScrollLock() {
  useEffect(() => {
    const se = () => document.scrollingElement ?? document.documentElement;

    const reset = () => {
      const el = se();
      if (el.scrollTop !== 0) el.scrollTop = 0;
      // iOS reports the offset on the visual viewport too; window.scrollTo
      // clears both without assuming which one moved.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };

    const vv = window.visualViewport;
    const onViewportChange = () => {
      if (!vv) return;
      // Still shrunk — the keyboard is up, and Safari owns the offset until
      // it goes away.
      if (vv.height < document.documentElement.clientHeight - KEYBOARD_GONE_SLACK_PX) return;
      reset();
    };

    // The document scroll listener runs on every frame of a momentum scroll,
    // so keep it passive and let `reset`'s own equality check make the common
    // (already-zero) case free.
    document.addEventListener("scroll", reset, { passive: true });
    vv?.addEventListener("resize", onViewportChange);
    vv?.addEventListener("scroll", onViewportChange);
    return () => {
      document.removeEventListener("scroll", reset);
      vv?.removeEventListener("resize", onViewportChange);
      vv?.removeEventListener("scroll", onViewportChange);
    };
  }, []);
}
