// BottomSheet.tsx — persistent, detented bottom sheet for mobile (< 860px).
// Three snap points: Peek (collapsed header) / Half (~50vh) / Full (full-height).
// Never fully dismissed. Drag handle tap cycles detents; Arrow Up/Down adjusts.
// Non-modal at Peek/Half (canvas stays interactive); scrim only at Full.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { tapFeedback } from "../lib/haptics";
import { useRafBatchedWrite } from "../lib/useRafBatchedWrite";

export type SheetDetent = "peek" | "half" | "full";

const DETENT_ORDER: SheetDetent[] = ["peek", "half", "full"];
// Slightly above 50% to clear browser chrome at the bottom.
export const HALF_VH_RATIO = 0.52;
// Movement (px) past which a pointer interaction counts as a drag, not a tap.
const DRAG_THRESHOLD = 6;

function halfH(inset: number) { return Math.round((window.innerHeight - inset) * HALF_VH_RATIO); }
function fullH(inset: number) { return window.innerHeight - inset; }

interface Props {
  children: (detent: SheetDetent, expand: () => void) => ReactNode;
  /** Current detent (controlled by the parent). */
  detent: SheetDetent;
  onDetentChange: (d: SheetDetent) => void;
  /** Fallback px height of the "Peek" state, used until the real header (drag
   *  handle + tab row) is measured. The measured value wins so the peek detent
   *  shows the whole tab row on any device/font size. */
  peekHeight?: number;
  /** Height in px of any fixed content below the sheet (e.g. mobile footer). */
  bottomInset?: number;
  /** Reports the sheet's live displayed height (px) and whether it's mid-drag,
   *  so the parent can size the viewer to follow the sheet in real time. Fires
   *  every drag frame and on each settle. */
  onFollow?: (heightPx: number, dragging: boolean) => void;
}

export function BottomSheet({
  children,
  detent,
  onDetentChange,
  peekHeight = 72,
  bottomInset = 0,
  onFollow,
}: Props) {
  // Detent is controlled by the parent; setDetent forwards to it.
  const setDetent = onDetentChange;
  // The sheet root, used to measure the natural peek height (handle + tab row).
  const sheetRef = useRef<HTMLDivElement>(null);
  // Measured px from the sheet's top edge down to the bottom of the tab row;
  // null until first layout, when it replaces the peekHeight fallback.
  const [autoPeek, setAutoPeek] = useState<number | null>(null);
  const dragStart = useRef<{ y: number; height: number } | null>(null);
  const dragPointerId = useRef<number | null>(null);
  // Whether the current interaction moved enough to be a drag (vs a tap).
  const draggedRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  // Refs so stable callbacks can read current values without deps.
  const detentRef = useRef(detent);
  detentRef.current = detent;
  const onFollowRef = useRef(onFollow);
  onFollowRef.current = onFollow;

  // A short haptic tick whenever the sheet settles on a new detent (drag-snap,
  // tap-cycle or keyboard) — Android only; silent on iOS / reduced-motion.
  const didMount = useRef(false);
  useEffect(() => {
    if (didMount.current) tapFeedback();
    else didMount.current = true;
  }, [detent]);
  // Effective peek height: the measured header height, or the fallback prop
  // until the first measurement lands.
  const effectivePeek = autoPeek ?? peekHeight;
  const peekHeightRef = useRef(effectivePeek);
  peekHeightRef.current = effectivePeek;
  const bottomInsetRef = useRef(bottomInset);
  bottomInsetRef.current = bottomInset;

  // Measure the header (drag handle + tab row) and use that as the peek height,
  // so the collapsed sheet always shows the whole tab row regardless of device
  // safe-area insets or font scaling. getBoundingClientRect reports the full
  // layout box even while the body is clipped by the peek height.
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const measure = () => {
      const tabs = sheet.querySelector('[role="tablist"]') as HTMLElement | null;
      if (!tabs) return;
      const px = Math.ceil(
        tabs.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top
      );
      if (px > 0) setAutoPeek(px);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(sheet);
    const tabs = sheet.querySelector('[role="tablist"]');
    if (tabs) ro.observe(tabs);
    return () => ro.disconnect();
  }, []);

  // heightFor reads peekHeight from a ref so this can have empty deps and stay stable.
  const heightFor = useCallback((d: SheetDetent): number => {
    switch (d) {
      case "peek": return peekHeightRef.current;
      case "half": return halfH(bottomInsetRef.current);
      case "full": return fullH(bottomInsetRef.current);
    }
  }, []);

  // All handlers below are stable (created once) — they read current
  // detent/peekHeight via refs instead of closing over state. setDetent itself
  // is a stable React setter, so none of them need it in their deps.
  const cycleDetent = useCallback(() => {
    const idx = DETENT_ORDER.indexOf(detentRef.current);
    setDetent(DETENT_ORDER[(idx + 1) % DETENT_ORDER.length]);
  }, []);

  // Raise a collapsed (peek) sheet to half — used when a tab is tapped at peek.
  const expand = useCallback(() => {
    if (detentRef.current === "peek") setDetent("half");
  }, []);

  // Tap cycles detents — but only when the pointer didn't drag (a drag already
  // snapped on pointer-up, and the browser still fires a click afterwards).
  const onHandleClick = useCallback(() => {
    if (draggedRef.current) { draggedRef.current = false; return; }
    cycleDetent();
  }, [cycleDetent]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || dragPointerId.current !== null) return;
    dragPointerId.current = e.pointerId;
    draggedRef.current = false;
    dragStart.current = { y: e.clientY, height: heightFor(detentRef.current) };
    setDragging(true);
    // Capture on the handle itself so move/up keep arriving even off-element.
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [heightFor]);

  // Apply the live drag height imperatively (rAF-batched direct DOM write),
  // bypassing React render for pointer-move frequency updates. Only called
  // while dragging, so the transition is always suppressed here.
  const { schedule: scheduleHeight, cancel: cancelHeightFrame } = useRafBatchedWrite<number>(
    (height) => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      sheet.style.height = `${height}px`;
      sheet.style.transition = "none";
      onFollowRef.current?.(height, true);
    }
  );

  // onPointerMove only reads refs — no state deps at all.
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStart.current || e.pointerId !== dragPointerId.current) return;
    const offset = dragStart.current.y - e.clientY;
    if (Math.abs(offset) > DRAG_THRESHOLD) draggedRef.current = true;
    const nextH = Math.max(
      peekHeightRef.current,
      Math.min(fullH(bottomInsetRef.current), dragStart.current.height + offset)
    );
    scheduleHeight(nextH);
  }, [scheduleHeight]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragStart.current || e.pointerId !== dragPointerId.current) return;
    dragPointerId.current = null;
    const delta = dragStart.current.y - e.clientY;
    const currentH = dragStart.current.height;
    dragStart.current = null;
    // Drop any pending rAF write so a frame queued just before pointer-up
    // can't fire after React commits the settled detent below.
    cancelHeightFrame();
    setDragging(false);

    const minH = peekHeightRef.current;
    const maxH = fullH(bottomInsetRef.current);
    const targetH = Math.max(minH, Math.min(maxH, currentH + delta));
    let best = detentRef.current;
    let bestDist = Infinity;
    for (const d of DETENT_ORDER) {
      const dist = Math.abs(heightFor(d) - targetH);
      if (dist < bestDist) { bestDist = dist; best = d; }
    }
    setDetent(best);
  }, [heightFor, cancelHeightFrame]);

  const onHandleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") {
      const idx = DETENT_ORDER.indexOf(detentRef.current);
      if (idx < DETENT_ORDER.length - 1) setDetent(DETENT_ORDER[idx + 1]);
    } else if (e.key === "ArrowDown") {
      const idx = DETENT_ORDER.indexOf(detentRef.current);
      if (idx > 0) setDetent(DETENT_ORDER[idx - 1]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      cycleDetent();
    } else if (e.key === "Escape") {
      setDetent("peek");
    }
  }, [cycleDetent]);

  // Committed height for the current detent. Drag frames update the DOM
  // directly via applyLiveHeight and don't flow through this render path.
  const displayH = heightFor(detent);

  // Report the committed height + drag state up so the viewer follows detent
  // changes; in-progress drag frames report via applyLiveHeight instead.
  useEffect(() => {
    if (!dragging) onFollow?.(displayH, dragging);
  }, [displayH, dragging, onFollow]);

  return (
    <>
      {/* Scrim only at Full detent */}
      {detent === "full" && (
        <div
          className="sheet-scrim"
          style={bottomInset ? { bottom: bottomInset } : undefined}
          aria-hidden
          onClick={() => setDetent("half")}
        />
      )}
      <div
        ref={sheetRef}
        className={`bottom-sheet bottom-sheet--${detent}${dragging ? " is-dragging" : ""}`}
        style={{
          height: displayH,
          bottom: bottomInset || undefined,
          transition: dragging ? "none" : "height 0.28s cubic-bezier(0.32,0.72,0,1)",
        }}
        aria-label="Parameter panel"
        role="complementary"
      >
        {/* Drag handle — single visible control; tap cycles, arrow keys resize. */}
        <div
          className="sheet-handle"
          role="button"
          tabIndex={0}
          aria-label={`Parameter panel — ${detent}. Tap to cycle, Arrow Up/Down to resize`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={onHandleClick}
          onKeyDown={onHandleKeyDown}
        >
          <div className="sheet-handle__bar" aria-hidden />
        </div>

        <div className="sheet-body">
          {children(detent, expand)}
        </div>
      </div>
    </>
  );
}
