// BottomSheet.tsx — persistent, detented bottom sheet for mobile (< 860px).
// Three snap points: Peek (collapsed header) / Half (~50vh) / Full (everything
// but a model strip at the top — see FULL_TOP_GAP). Never fully dismissed.
// Drag handle tap cycles detents; Arrow Up/Down adjusts.
// Non-modal at Peek/Half (canvas stays interactive, background stays reachable
// by keyboard/AT). Modal at Full (see docs/architecture-review.md M16): the
// sheet covers everything there but a model strip at the top, and that strip
// is a preview rather than a workspace — AppShell hides the chrome floating
// over it and marks the background `inert` — so the effect below traps
// keyboard focus inside the sheet (+ scrim), sends initial focus in, restores
// it to the triggering control on close, and Escape collapses it from
// anywhere in the trap. See AppShell's mobileBackgroundRef and `sheetFull`
// for the two halves it owns.
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
import { useScrollFocusedIntoView } from "../lib/useScrollFocusedIntoView";
import { useSafeAreaInset } from "../lib/useSafeAreaInset";

export type SheetDetent = "peek" | "half" | "full";

const DETENT_ORDER: SheetDetent[] = ["peek", "half", "full"];
// Slightly above 50% to clear browser chrome at the bottom.
export const HALF_VH_RATIO = 0.52;
// Height (px) of the model strip the Full detent deliberately leaves uncovered
// at the top of the viewport. Any notch inset is added on top of it by fullH's
// `topInset` argument, so a device with one doesn't lose part of the strip.
//
// "Full" used to mean the whole viewport, which made it the one state where a
// visitor could read the form comfortably and the one state where they could
// not see what they were editing — on a tool whose entire loop is "change the
// text, watch the plate change". Stopping short of the top edge keeps the LIVE
// viewer in frame instead of adding a second render surface: the canvas's
// bottom already tracks the sheet (`--sheet-top` in index.css), and the
// Viewer's ResizeObserver re-fits the model into whatever box it is left with
// (Viewer.tsx's refitView), so the strip is the real model, correctly framed,
// for free.
//
// Sized to read as a recognisable object rather than a sliver: below roughly
// this the plate becomes a line. The sheet still gains everything between the
// strip and the half detent, which is most of the screen.
export const FULL_TOP_GAP = 132;

// Movement (px) past which a pointer interaction counts as a drag, not a tap.
const DRAG_THRESHOLD = 6;
// Elements a focus trap should consider reachable — the standard "visible,
// operable" set (no [hidden], no disabled, no roving -1 tabindex).
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function halfH(inset: number) { return Math.round((window.innerHeight - inset) * HALF_VH_RATIO); }
// Full stops FULL_TOP_GAP (plus any notch inset, passed in as `topInset`)
// short of the top edge so the live viewer stays in frame — see FULL_TOP_GAP's
// own doc. Floored at the half height so a very short viewport — a landscape
// phone, where half is already most of the screen — can never resolve "full"
// to something SMALLER than "half", which would make the detent order
// non-monotonic and break the nearest-detent snap in onPointerUp.
function fullH(inset: number, topInset: number) {
  return Math.max(halfH(inset), window.innerHeight - inset - FULL_TOP_GAP - topInset);
}

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
  /** Reports the effective "Peek" height (px) — the measured header (drag
   *  handle + tab row), or the `peekHeight` fallback until that measurement
   *  lands. Distinct from onFollow: this is the sheet's own geometry (how
   *  tall the collapsed sheet is), not the live displayed height, so the
   *  parent can anchor other fixed content (e.g. the output console overlay)
   *  exactly above the real peek row instead of a static guess. */
  onPeekHeightChange?: (heightPx: number) => void;
  /** Reports the gap (px) the Full detent leaves clear at the TOP of the
   *  viewport — FULL_TOP_GAP plus the measured notch inset. The parent
   *  publishes it as a CSS custom property so the stylesheet can anchor to the
   *  model strip (the scrim starts below it) without re-deriving the number:
   *  this module owns the detent model, so it should own the arithmetic. Same
   *  shape and purpose as onPeekHeightChange above. */
  onFullGapChange?: (gapPx: number) => void;
}

export function BottomSheet({
  children,
  detent,
  onDetentChange,
  peekHeight = 72,
  bottomInset = 0,
  onFollow,
  onPeekHeightChange,
  onFullGapChange,
}: Props) {
  // Detent is controlled by the parent; setDetent forwards to it.
  const setDetent = onDetentChange;
  // The sheet root, used to measure the natural peek height (handle + tab row).
  const sheetRef = useRef<HTMLDivElement>(null);
  // On touch devices, keep a focused field inside the sheet clear of the
  // on-screen keyboard by centring it in the scroll area on focus.
  useScrollFocusedIntoView(sheetRef);
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
  // The notch inset the Full detent's model strip has to clear. Measured once
  // per mount and on viewport change (useSafeAreaInset) rather than read at
  // each call: the probe it uses appends to document.body and reads a rect,
  // forcing a synchronous document layout — and fullH() below runs on every
  // pointermove, every drag frame and every render. Held in a ref for the same
  // reason bottomInset is: so the pointer handlers stay identity-stable with
  // empty dependency lists.
  const topInset = useSafeAreaInset("top");
  const topInsetRef = useRef(topInset);
  topInsetRef.current = topInset;

  // Report the effective peek height whenever it changes (first measurement,
  // font-scaling/resize-driven remeasure, …) so the parent can anchor fixed
  // content (the output console overlay) to the real value instead of a
  // static CSS guess.
  useEffect(() => {
    onPeekHeightChange?.(effectivePeek);
  }, [effectivePeek, onPeekHeightChange]);

  // Publish the Full detent's top gap for the same reason: the stylesheet
  // needs it (see `.sheet-scrim`), and re-deriving `FULL_TOP_GAP + inset` in
  // CSS would be a second definition of a number this module owns.
  useEffect(() => {
    onFullGapChange?.(FULL_TOP_GAP + topInset);
  }, [topInset, onFullGapChange]);

  // Measure the header (drag handle + tab row) and use that as the peek height,
  // so the collapsed sheet always shows the whole tab row regardless of device
  // safe-area insets or font scaling. getBoundingClientRect reports the full
  // layout box even while the body is clipped by the peek height.
  //
  // The content marks where the peek header ENDS with `data-sheet-peek-end`,
  // because the tab row isn't the tablist alone anymore: SheetTabs wraps the
  // tablist and the readiness chip in one row, and measuring the tablist would
  // cut the chip in half whenever it's the taller of the two. The tablist stays
  // as a fallback for any other sheet content.
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const peekEnd = () =>
      (sheet.querySelector("[data-sheet-peek-end]") ??
        sheet.querySelector('[role="tablist"]')) as HTMLElement | null;
    const measure = () => {
      const header = peekEnd();
      if (!header) return;
      const px = Math.ceil(
        header.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top
      );
      if (px > 0) setAutoPeek(px);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(sheet);
    const header = peekEnd();
    if (header) ro.observe(header);
    return () => ro.disconnect();
  }, []);

  // halfH/fullH read window.innerHeight at call time, but nothing re-renders
  // this component when the viewport changes (orientation flip, browser-chrome
  // show/hide) without also changing the detent — so the sheet would keep a
  // stale height/transform until the next unrelated state change. Bump this
  // on resize purely to force a re-render; halfH/fullH/heightFor already read
  // window.innerHeight fresh each call, so the recomputed JSX (and the
  // onFollow effect below, keyed on displayH) pick up the new size for free.
  const [, forceResize] = useState(0);
  useEffect(() => {
    const onResize = () => forceResize((n) => n + 1);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  // heightFor reads peekHeight from a ref so this can have empty deps and stay stable.
  const heightFor = useCallback((d: SheetDetent): number => {
    switch (d) {
      case "peek": return peekHeightRef.current;
      case "half": return halfH(bottomInsetRef.current);
      case "full": return fullH(bottomInsetRef.current, topInsetRef.current);
    }
  }, []);

  // All handlers below are stable — they read current detent/peekHeight via
  // refs instead of closing over state. `setDetent` (== `onDetentChange`) is
  // itself stable because the caller passes a `useCallback` with an empty
  // dep array (see AppShell's `handleDetentChange`), so listing it below
  // doesn't change these handlers' identity.
  const cycleDetent = useCallback(() => {
    const idx = DETENT_ORDER.indexOf(detentRef.current);
    setDetent(DETENT_ORDER[(idx + 1) % DETENT_ORDER.length]);
  }, [setDetent]);

  // Raise a collapsed (peek) sheet to half — used when a tab is tapped at peek.
  const expand = useCallback(() => {
    if (detentRef.current === "peek") setDetent("half");
  }, [setDetent]);

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
      const full = fullH(bottomInsetRef.current, topInsetRef.current);
      sheet.style.setProperty("--sheet-visible-h", `${height}px`);
      sheet.style.transform = `translateY(${Math.max(0, full - height)}px)`;
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
      Math.min(fullH(bottomInsetRef.current, topInsetRef.current), dragStart.current.height + offset)
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
    const maxH = fullH(bottomInsetRef.current, topInsetRef.current);
    const targetH = Math.max(minH, Math.min(maxH, currentH + delta));
    let best = detentRef.current;
    let bestDist = Infinity;
    for (const d of DETENT_ORDER) {
      const dist = Math.abs(heightFor(d) - targetH);
      if (dist < bestDist) { bestDist = dist; best = d; }
    }
    // Imperatively restore the settled geometry for `best` right away. When
    // `best` differs from the pre-drag detent, the setDetent below triggers a
    // React re-render that writes the same values via JSX — harmless. But
    // when `best` equals the current detent, React state doesn't change, so
    // its render is skipped and the DOM would otherwise be left at whatever
    // in-progress drag height the last rAF frame wrote (already stopped short
    // of the committed detent height) — desynchronizing the viewer, which
    // only follows the onFollow call below. Writing here directly keeps the
    // DOM in lockstep with what a render for `best` would produce, so a
    // later render (detent did change) still agrees with it.
    const sheet = sheetRef.current;
    if (sheet) {
      const settledH = heightFor(best);
      const full = fullH(bottomInsetRef.current, topInsetRef.current);
      sheet.style.setProperty("--sheet-visible-h", `${settledH}px`);
      sheet.style.transform = `translateY(${Math.max(0, full - settledH)}px)`;
      sheet.style.transition = "transform 0.28s cubic-bezier(0.32,0.72,0,1)";
      onFollowRef.current?.(settledH, false);
    }
    setDetent(best);
  }, [heightFor, cancelHeightFrame, setDetent]);

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
  }, [cycleDetent, setDetent]);

  // Committed height for the current detent. Drag frames update the DOM
  // directly via applyLiveHeight and don't flow through this render path.
  const displayH = heightFor(detent);
  const fullHeight = fullH(bottomInset, topInset);

  // Report the committed height + drag state up so the viewer follows detent
  // changes; in-progress drag frames report via applyLiveHeight instead.
  useEffect(() => {
    if (!dragging) onFollow?.(displayH, dragging);
  }, [displayH, dragging, onFollow]);

  // M16: the Full detent is modal (the sheet visually covers the app behind
  // it — see the file header). While at Full:
  //  - remember whatever held focus beforehand, and restore it on the way out
  //    (mirrors standard dialog behavior — the trigger gets focus back).
  //  - send initial focus into the sheet (or the scrim) if it isn't already
  //    there, so a keyboard user landing on Full doesn't stay parked on a
  //    control that's about to go `inert` behind it (AppShell inerts the
  //    background for this detent).
  //  - trap focus two ways: (1) Tab/Shift+Tab are intercepted directly and
  //    wrapped to the other end of the trap's focusable list — needed
  //    because tabbing off the LAST focusable element doesn't move focus to
  //    any DOM node (the browser just leaves the document, and
  //    document.activeElement falls back to <body> without a `focusin`
  //    event ever firing), so a focusin-only redirect can't catch it; (2) a
  //    `focusin` listener still redirects any focus that lands outside the
  //    trap by other means (e.g. a programmatic .focus() call).
  //  - Escape collapses to Half from anywhere in the trap, not just the
  //    drag handle (onHandleKeyDown above only fires when the handle itself
  //    has focus).
  const scrimRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (detent !== "full") return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A menu/popover/select opened from a sheet control portals its content to
    // <body> (outside `sheet`) so it isn't clipped by the sheet's `overflow:
    // hidden` — but it is logically part of the sheet's modal surface. Treat any
    // Radix popper content as inside the trap: without this the focusin redirect
    // below yanks focus back into the sheet the instant the popover grabs it, and
    // Radix (seeing focus leave its content) closes the layer again — so e.g. the
    // "Jump to section" navigator could never open at the Full detent.
    const inPopper = (node: Node | null) =>
      node instanceof Element && !!node.closest("[data-radix-popper-content-wrapper]");
    const inTrap = (node: Node | null) =>
      !!node && (sheet.contains(node) || node === scrimRef.current || inPopper(node));
    // DOM/tab order: the scrim (when present) precedes the sheet.
    // FOCUSABLE_SELECTOR alone isn't enough: Radix's inactive TabsContent
    // panels carry tabindex="0" (for programmatic/AT focus management) while
    // `hidden`, which the browser's real Tab key already skips — filter
    // those out too, or "last focusable" here would disagree with what Tab
    // actually visits and the wrap-around below would never trigger.
    const isReachable = (el: HTMLElement) => !el.closest("[hidden]") && el.offsetParent !== null;
    const trapFocusables = () => {
      const list = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        isReachable
      );
      return scrimRef.current ? [scrimRef.current, ...list] : list;
    };
    const focusFirst = () => {
      const focusables = trapFocusables();
      (focusables[0] ?? sheet).focus();
    };
    if (!inTrap(document.activeElement)) focusFirst();
    const onFocusIn = (e: FocusEvent) => {
      if (!inTrap(e.target as Node)) focusFirst();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // While a sheet-spawned popover/menu holds focus it owns Escape and Tab
      // (Radix closes it on Escape, moves within it on Tab). Don't also collapse
      // the sheet or wrap focus back into it — let the layer handle the key.
      if (inPopper(document.activeElement)) return;
      if (e.key === "Escape") {
        setDetent("half");
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = trapFocusables();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement;
      // Wrap at either end (or if focus is somehow already outside the trap)
      // instead of letting Tab walk off the document.
      if (e.shiftKey) {
        if (current === first || !inTrap(current)) {
          e.preventDefault();
          last.focus();
        }
      } else if (current === last || !inTrap(current)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
      // Leaving Full (detent changed, or the sheet unmounted): give focus
      // back to whatever triggered it, if it's still around.
      const prev = returnFocusRef.current;
      returnFocusRef.current = null;
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [detent, setDetent]);

  return (
    <>
      {/* Scrim only at Full detent */}
      {detent === "full" && (
        <button
          ref={scrimRef}
          type="button"
          className="sheet-scrim"
          style={bottomInset ? { bottom: bottomInset } : undefined}
          aria-label="Collapse parameter panel"
          onClick={() => setDetent("half")}
        />
      )}
      <div
        ref={sheetRef}
        className={`bottom-sheet bottom-sheet--${detent}${dragging ? " is-dragging" : ""}`}
        style={{
          height: fullHeight,
          bottom: bottomInset || undefined,
          "--sheet-visible-h": `${displayH}px`,
          transform: `translateY(${Math.max(0, fullHeight - displayH)}px)`,
          transition: dragging ? "none" : "transform 0.28s cubic-bezier(0.32,0.72,0,1)",
        } as React.CSSProperties}
        aria-label="Parameter panel"
        role="complementary"
      >
        <div className="sheet-frame">
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
      </div>
    </>
  );
}
