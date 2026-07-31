// useSheetPolicy.ts: the mobile bottom-sheet's first-visit opening policy
// (see the pure src/lib/sheetPolicy.ts) plus the ongoing detent/hint state it
// seeds, extracted from AppShell. On a mobile visitor's genuine first visit
// the settings sheet opens partway ("half" on a tall viewport, "peek" on a
// short/landscape one) so a new visitor sees the settings exist while the
// model stays meaningfully visible; every later visit starts at "peek".
// Desktop never uses the sheet, so it keeps the prior "peek" default, touches
// no storage, and shows no hint.
//
// AppShell still owns the sheet's DRAG-DRIVEN transitions (handleDetentChange,
// handleSheetFollow, the mobileBackgroundRef `inert` wiring): those are
// layout, reacting to the BottomSheet component itself, and reads
// `setSheetDetent` back out of this hook to drive them. What lives here is the
// POLICY: what the detent and the hint should be BEFORE the visitor has
// touched anything, and when it's safe to show the hint at all.
import { useCallback, useRef, useState } from "react";
import type { SheetDetent } from "../components/BottomSheet";
import type { RenderResult } from "../openscad/types";
import { readLocal, writeLocal } from "./safeStorage";
import { SHEET_INTRODUCED_KEY, initialSheetDetent } from "./sheetPolicy";
import { stageLoading } from "./renderStatus";

export interface UseSheetPolicyArgs {
  isMobile: boolean;
  /** Whether the config's welcome popup (schema.popup) is currently up, see
   *  `sheetHintArmed` below. */
  introOpen: boolean;
  ready: boolean;
  rendering: boolean;
  result: RenderResult | null;
}

export interface SheetPolicyModel {
  sheetDetent: SheetDetent;
  setSheetDetent: (d: SheetDetent) => void;
  /** Whether to show the one-time "Swipe up for settings" nudge: true only
   *  on a first-visit mount that resolved to peek (a half-open sheet needs no
   *  nudge). Dismissed on the first sheet interaction or a timeout
   *  (SheetSwipeHint), and permanently false thereafter for this session. */
  showSheetHint: boolean;
  dismissSheetHint: () => void;
  /**
   * Whether it's safe to actually show the nudge right now: true once
   * there's something to nudge the visitor TOWARDS. The nudge's fade timeout
   * runs from the moment it mounts (SheetSwipeHint), so it must not mount
   * while the visitor can't act on it: otherwise the whole once-per-browser
   * nudge expires unseen and, since the introduced flag was written on mount,
   * never comes back. Two ways that happens, both invisible on a fast machine
   * and both certain on a slow phone:
   *   • first-run boot. A cold ~10 MB engine download plus the first render
   *     outlasts the timeout, leaving the nudge to fade behind the
   *     "Getting things ready…" overlay. Same signal ViewerGestureHint arms on.
   *   • the config's welcome popup: the one modal that opens by itself on a
   *     first visit and covers everything, including this chip. A visitor who
   *     reads it (or, in `popup.mode: "picker"`, browses the design cards) for
   *     longer than the timeout would come out the other side to nothing.
   * Not sticky: a later design switch re-raises the loading overlay, and it's
   * better to re-show the still-undismissed nudge over the new model than to
   * let it tick away over a spinner. Once the visitor touches the sheet (or it
   * times out while genuinely visible) `showSheetHint` retires it for good.
   */
  sheetHintArmed: boolean;
}

export function useSheetPolicy({
  isMobile,
  introOpen,
  ready,
  rendering,
  result,
}: UseSheetPolicyArgs): SheetPolicyModel {
  // Resolved once, on mount, in a single lazy pass held in a ref rather than
  // two useState initializers, because the detent and the hint share one
  // decision: the detent branch SETS the introduced flag, so a second
  // initializer re-reading it could no longer tell this was a first visit.
  // Deciding both together: before that write is observable to any later
  // read. Keeps them consistent, and the write itself is the once-per-browser
  // guard (the flag exists ever after, so `firstVisitPeek` can only ever be
  // true on this mount).
  const initialSheet = useRef<{ detent: SheetDetent; firstVisitPeek: boolean } | null>(null);
  if (initialSheet.current === null) {
    if (!isMobile || readLocal(SHEET_INTRODUCED_KEY) !== null) {
      initialSheet.current = { detent: "peek", firstVisitPeek: false };
    } else {
      const detent = initialSheetDetent(window.innerHeight, window.innerWidth > window.innerHeight);
      writeLocal(SHEET_INTRODUCED_KEY, "1");
      initialSheet.current = { detent, firstVisitPeek: detent === "peek" };
    }
  }
  // Sheet detent state (peek/half/full). On mobile the output overlay now
  // covers the sheet, so it no longer has to be positioned relative to the
  // detent.
  const [sheetDetent, setSheetDetent] = useState<SheetDetent>(initialSheet.current.detent);
  const [showSheetHint, setShowSheetHint] = useState(initialSheet.current.firstVisitPeek);
  const dismissSheetHint = useCallback(() => setShowSheetHint(false), []);
  const sheetHintArmed = !introOpen && !stageLoading({ ready, rendering, result });

  return { sheetDetent, setSheetDetent, showSheetHint, dismissSheetHint, sheetHintArmed };
}
