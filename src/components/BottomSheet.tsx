// BottomSheet.tsx — persistent, detented bottom sheet for mobile (< 860px).
// Three snap points: Peek (collapsed header) / Half (~50vh) / Full (full-height).
// Never fully dismissed. Drag handle tap cycles detents; Arrow Up/Down adjusts.
// Non-modal at Peek/Half (canvas stays interactive); scrim only at Full.
import {
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type SheetDetent = "peek" | "half" | "full";

const DETENT_ORDER: SheetDetent[] = ["peek", "half", "full"];
// Slightly above 50% to clear browser chrome at the bottom.
const HALF_VH_RATIO = 0.52;

function halfH(inset: number) { return Math.round((window.innerHeight - inset) * HALF_VH_RATIO); }
function fullH(inset: number) { return window.innerHeight - inset; }

interface Props {
  children: (detent: SheetDetent, expand: () => void) => ReactNode;
  /** Height in px of the "Peek" state (handle + header row). */
  peekHeight?: number;
  /** Height in px of any fixed content below the sheet (e.g. mobile footer). */
  bottomInset?: number;
}

export function BottomSheet({ children, peekHeight = 72, bottomInset = 0 }: Props) {
  const [detent, setDetent] = useState<SheetDetent>("peek");
  const dragStart = useRef<{ y: number; height: number } | null>(null);
  const dragPointerId = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);

  // Refs so stable callbacks can read current values without deps.
  const detentRef = useRef(detent);
  detentRef.current = detent;
  const peekHeightRef = useRef(peekHeight);
  peekHeightRef.current = peekHeight;
  const bottomInsetRef = useRef(bottomInset);
  bottomInsetRef.current = bottomInset;

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

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || dragPointerId.current !== null) return;
    dragPointerId.current = e.pointerId;
    dragStart.current = { y: e.clientY, height: heightFor(detentRef.current) };
    setDragging(true);
    (e.target as Element).setPointerCapture(e.pointerId);
  }, [heightFor]);

  // onPointerMove only reads refs — no state deps at all.
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStart.current || e.pointerId !== dragPointerId.current) return;
    setDragOffset(dragStart.current.y - e.clientY);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragStart.current || e.pointerId !== dragPointerId.current) return;
    dragPointerId.current = null;
    const delta = dragStart.current.y - e.clientY;
    const currentH = dragStart.current.height;
    dragStart.current = null;
    setDragging(false);
    setDragOffset(0);

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
  }, [heightFor]);

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

  const currentH = heightFor(detent);
  const displayH = dragging
    ? Math.max(peekHeightRef.current, Math.min(fullH(bottomInsetRef.current), currentH + dragOffset))
    : currentH;

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
          onClick={cycleDetent}
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
