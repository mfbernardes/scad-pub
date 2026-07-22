// ViewerGestureHint.tsx — a one-time, non-blocking chip over the viewer
// bottom-centre teaching the orbit gesture ("Drag to rotate · Scroll to
// zoom" / "… Pinch to zoom" on a coarse pointer). Mounted by ViewerStage
// (shared by both layouts, so this lands once), positioned via the
// `.viewer-hint` CSS rule in src/index.css (mirrors `.action-dock`'s
// desktop/mobile split, offset above it).
//
// Shown only once real geometry has been shown (the first successful
// render) — never over the pre-first-render loading overlay. Fades on the
// first pointerdown anywhere inside the viewer, or after a timeout,
// remembering either way via a namespaced localStorage once-flag (see
// appId.ts's `ns()`, the same pattern AppShell already uses for its
// advanced-settings flag). `aria-hidden`: the gesture is redundant for
// assistive tech (orbit controls need no explanation for AT, and the canvas
// itself is not a11y-relevant), so this never enters the a11y tree.
import { useCallback, useEffect, useRef, useState } from "react";
import { ns } from "../lib/appId";
import { readLocal, writeLocal } from "../lib/safeStorage";
import { t } from "../lib/i18n";

const HINT_SEEN_KEY = ns("hint.viewer.v1");
// How long the hint stays up before auto-fading if the visitor never touches
// the viewer — generous enough to read a short sentence, short enough not to
// linger indefinitely over the model.
const FADE_TIMEOUT_MS = 8000;

export function ViewerGestureHint({ resultOk, suppressed = false }: { resultOk: boolean; suppressed?: boolean }) {
  // Sticky: once the first successful render has landed this mount, stays
  // true even if a later edit fails or is mid-render — the hint is about
  // "you've now seen a model", not "the model is currently fine".
  const hasRenderedOnceRef = useRef(false);
  if (resultOk) hasRenderedOnceRef.current = true;

  const [dismissed, setDismissed] = useState(() => readLocal(HINT_SEEN_KEY) !== null);
  // `suppressed` (the on-model editor is open) hides the hint without
  // dismissing it — they'd otherwise overlap over the model — so it can still
  // show later once the editor closes, until the visitor interacts or it fades.
  const visible = !dismissed && !suppressed && hasRenderedOnceRef.current;

  const dismiss = useCallback(() => {
    setDismissed((was) => {
      if (!was) writeLocal(HINT_SEEN_KEY, "1");
      return true;
    });
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(dismiss, FADE_TIMEOUT_MS);
    // Pointer-events:none on the chip itself means a pointerdown on the
    // viewer always lands on the canvas/overlay underneath, never the hint —
    // listen at the document level (capture, so it sees the event before any
    // handler stops propagation) and check it actually happened inside the
    // viewer, not just anywhere on screen.
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest(".viewer-wrap")) dismiss();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [visible, dismiss]);

  if (!visible) return null;

  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const text = coarse ? t("hint.rotateZoomTouch") : t("hint.rotateZoomMouse");

  return (
    <div
      aria-hidden="true"
      className="viewer-hint pointer-events-none whitespace-nowrap rounded-(--radius-sm) border border-(color:--glass-border) bg-(--glass-bg) px-3 py-[0.4rem] text-[0.78rem] text-muted-foreground shadow-(--elevation) transition-opacity duration-300 motion-reduce:transition-none"
    >
      {text}
    </div>
  );
}
