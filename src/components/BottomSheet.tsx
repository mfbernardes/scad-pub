// BottomSheet.tsx — persistent, detented bottom sheet for mobile (< 860px).
// Three snap points: Peek (collapsed header) / Half (~50vh) / Full (full-height).
// Never fully dismissed. Drag handle tap cycles detents; Arrow Up/Down adjusts.
// Non-modal at Peek/Half (canvas stays interactive, background stays reachable
// by keyboard/AT). Modal at Full (see docs/architecture-review.md M16): the
// sheet visually covers the background there, so the effect below traps
// keyboard focus inside the sheet (+ scrim), sends initial focus in, restores
// it to the triggering control on close, and Escape collapses it from
// anywhere in the trap. The parent (AppShell) marks the background `inert`
// for the complementary half of the fix — see mobileBackgroundRef there.
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
import { t } from "../lib/i18n";

export type SheetDetent = "peek" | "half" | "full";

const DETENT_ORDER: SheetDetent[] = ["peek", "half", "full"];
// i18n keys for the polite live-region announcement fired on every detent
// change (drag-snap, tap-cycle, or Arrow Up/Down) — see the announcement
// effect below. Not fired on mount (only on a subsequent change), so a
// visitor who lands directly on Half (guided policy — see sheetDetent.ts)
// doesn't hear an announcement before they've done anything.
const DETENT_ANNOUNCE_KEY: Record<SheetDetent, string> = {
  peek: "sheet.detentPeek",
  half: "sheet.detentHalf",
  full: "sheet.detentFull",
};
// i18n keys for the bare detent word, interpolated into the drag handle's
// aria-label (see `sheet.handleAria`) — separate from DETENT_ANNOUNCE_KEY's
// full sentences above.
const DETENT_WORD_KEY: Record<SheetDetent, string> = {
  peek: "sheet.wordPeek",
  half: "sheet.wordHalf",
  full: "sheet.wordFull",
};
// Slightly above 50% to clear browser chrome at the bottom.
export const HALF_VH_RATIO = 0.52;
// Movement (px) past which a pointer interaction counts as a drag, not a tap.
const DRAG_THRESHOLD = 6;
// Elements a focus trap should consider reachable — the standard "visible,
// operable" set (no [hidden], no disabled, no roving -1 tabindex).
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  /** Reports the effective "Peek" height (px) — the measured header (drag
   *  handle + tab row), or the `peekHeight` fallback until that measurement
   *  lands. Distinct from onFollow: this is the sheet's own geometry (how
   *  tall the collapsed sheet is), not the live displayed height, so the
   *  parent can anchor other fixed content (e.g. the output console overlay)
   *  exactly above the real peek row instead of a static guess. */
  onPeekHeightChange?: (heightPx: number) => void;
  /** Fires at the start of any handle interaction — pointer-down (drag start;
   *  a plain tap also passes through pointer-down before its click) — so a
   *  caller showing a one-time hint (see `hint` below) can dismiss it on the
   *  visitor's first touch of the handle, not just on a settled detent
   *  change. Keyboard resizing (Arrow Up/Down) doesn't call this separately —
   *  it already changes the detent, which the parent's onDetentChange
   *  handles dismissing from. */
  onHandleInteract?: () => void;
  /** A one-time hint rendered next to the handle (see AppShell's
   *  `sheetHintVisible` — the guided+half onboarding hint), or undefined to
   *  render nothing. Purely decorative: `aria-hidden` and non-interactive
   *  (`pointer-events-none`) so it can never intercept a tap/drag meant for
   *  the handle underneath it. */
  hint?: ReactNode;
}

export function BottomSheet({
  children,
  detent,
  onDetentChange,
  peekHeight = 72,
  bottomInset = 0,
  onFollow,
  onPeekHeightChange,
  onHandleInteract,
  hint,
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
  // tap-cycle or keyboard) — Android only; silent on iOS / reduced-motion —
  // plus a polite SR announcement of the new state (WCAG: a detent change
  // moves a large amount of on-screen content without a focus change, which a
  // screen-reader user gets no other signal of). Both skip the very first
  // render — a visitor who lands directly on Half via the guided policy
  // shouldn't hear an announcement, or feel a tick, before they've touched
  // anything.
  const didMount = useRef(false);
  const [detentAnnouncement, setDetentAnnouncement] = useState("");
  useEffect(() => {
    if (didMount.current) {
      tapFeedback();
      setDetentAnnouncement(t(DETENT_ANNOUNCE_KEY[detent]));
    } else {
      didMount.current = true;
    }
  }, [detent]);
  // Effective peek height: the measured header height, or the fallback prop
  // until the first measurement lands.
  const effectivePeek = autoPeek ?? peekHeight;
  const peekHeightRef = useRef(effectivePeek);
  peekHeightRef.current = effectivePeek;
  const bottomInsetRef = useRef(bottomInset);
  bottomInsetRef.current = bottomInset;

  // Report the effective peek height whenever it changes (first measurement,
  // font-scaling/resize-driven remeasure, …) so the parent can anchor fixed
  // content (the output console overlay) to the real value instead of a
  // static CSS guess.
  useEffect(() => {
    onPeekHeightChange?.(effectivePeek);
  }, [effectivePeek, onPeekHeightChange]);

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
      case "full": return fullH(bottomInsetRef.current);
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
    onHandleInteract?.();
  }, [heightFor, onHandleInteract]);

  // Apply the live drag height imperatively (rAF-batched direct DOM write),
  // bypassing React render for pointer-move frequency updates. Only called
  // while dragging, so the transition is always suppressed here.
  const { schedule: scheduleHeight, cancel: cancelHeightFrame } = useRafBatchedWrite<number>(
    (height) => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      const full = fullH(bottomInsetRef.current);
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
      const full = fullH(bottomInsetRef.current);
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
  const fullHeight = fullH(bottomInset);

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
    const inTrap = (node: Node | null) =>
      !!node && (sheet.contains(node) || node === scrimRef.current);
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
          aria-label={t("sheet.collapseAria")}
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
        aria-label={t("sheet.panelAria")}
        role="complementary"
      >
        <div className="sheet-frame">
          {/* Drag handle — single visible control; tap cycles, arrow keys resize. */}
          <div
            className="sheet-handle relative"
            role="button"
            tabIndex={0}
            aria-label={t("sheet.handleAria", { state: t(DETENT_WORD_KEY[detent]) })}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={onHandleClick}
            onKeyDown={onHandleKeyDown}
          >
            <div className="sheet-handle__bar" aria-hidden />
            {/* One-time onboarding hint (AppShell's guided+half policy) —
                aria-hidden + pointer-events-none: purely decorative, and must
                never steal a tap/drag meant for the handle beneath it. */}
            {hint && (
              <span
                className="sheet-hint pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-(--radius-sm) border glass-card px-2 py-1 text-[0.72rem] text-muted-foreground transition-opacity duration-300 motion-reduce:transition-none"
                aria-hidden="true"
              >
                {hint}
              </span>
            )}
          </div>

          <div className="sheet-body">
            {children(detent, expand)}
          </div>
        </div>
      </div>

      {/* Polite live region: announces the settled detent on every change
          (drag-snap, tap-cycle, Arrow Up/Down) — a WCAG signal for screen-
          reader users, who get no other cue that a large amount of on-screen
          content just moved. Silent on mount (see the announcement effect
          above) and visually hidden (sr-only). */}
      <div className="sr-only" role="status" aria-live="polite">
        {detentAnnouncement}
      </div>
    </>
  );
}
