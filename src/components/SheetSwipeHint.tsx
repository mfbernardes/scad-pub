// SheetSwipeHint.tsx — a one-time, non-blocking chip nudging a first-time
// mobile visitor to swipe the collapsed (peek) settings sheet up. Shown only on
// the first-visit-resolved-to-peek mount (AppShell's `showSheetHint` gate — see
// src/lib/sheetPolicy.ts); a half-open sheet already advertises itself and gets
// no nudge. Not persisted separately: the sheet's own first-visit flag
// (SHEET_INTRODUCED_KEY) already makes this a once-per-browser event, so this
// only needs to fade on the first interaction with the sheet, or after a
// timeout, and tell the parent to stop showing it.
//
// Unlike the decorative ViewerGestureHint (aria-hidden — orbit gestures are
// redundant for assistive tech), this hint is ACTIONABLE: it teaches an AT user
// that a settings sheet exists and can be opened. So it stays in the a11y tree
// as a role="status" live region carrying a plain-text, accessible label.
import { useEffect } from "react";
import { t } from "../lib/i18n";

// How long the nudge stays up before auto-fading if the visitor never touches
// the sheet — generous enough to read a short phrase, short enough not to
// linger over the model. Mirrors ViewerGestureHint's own timeout.
const FADE_TIMEOUT_MS = 8000;

export function SheetSwipeHint({ onDismiss }: { onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, FADE_TIMEOUT_MS);
    // The chip is pointer-events:none, so a tap/drag on the sheet always lands
    // on the sheet itself — listen at the document level (capture, ahead of any
    // handler that stops propagation) and dismiss on the first interaction that
    // actually happened inside the sheet (handle included), not anywhere else.
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest(".bottom-sheet")) onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onDismiss]);

  return (
    <div
      role="status"
      className="sheet-hint pointer-events-none whitespace-nowrap rounded-(--radius-sm) border border-(color:--glass-border) bg-(--glass-bg) px-3 py-[0.4rem] text-[0.78rem] text-muted-foreground shadow-(--elevation) transition-opacity duration-300 motion-reduce:transition-none"
    >
      {t("hint.sheetSwipeUp")}
    </div>
  );
}
