// useOutputConsole.ts: the Output console's open/closed state, its
// auto-open-on-problem state machine, and the active tab (Notices/Log/
// Metrics), extracted from AppShell. Info-level notices (config-driven
// `notices`) are surfaced passively by the dot/count on the Output toggle; a
// warning or assert is different: the model came out wrong in a way worth
// seeing, so the console auto-opens the first time a render surfaces one,
// rather than hiding it behind a badge the user may never click.
//
// The state lives here rather than in OutputConsole.tsx itself because that
// component unmounts on close (`if (!open) return null`): a `useState` inside
// it would forget which tab was active every time the console closes and
// reopens. Hoisting it here — the state that survives the unmount — means a
// visitor reading the Log tab, closing the console, and reopening it lands
// back on Log instead of resetting to Notices.
//
// AppShell supplies the parsed diagnostics (diagnostics.ts, itself fed by
// useReadinessModel), a `collapseSheet` callback, and whether the mobile
// sheet currently sits at its collapsed "peek" detent. The overlay's fixed
// anchor sits immediately above the mobile sheet's peek tab row and would
// overlap an expanded sheet otherwise, but that sheet's detent state lives
// outside this hook (see useSheetPolicy.ts): rather than reach into it
// directly, opening the console goes through the injected `collapseSheet`
// callback, so AppShell owns wiring the two together and this hook stays
// mostly ignorant of the sheet. `collapseSheet` must be an identity-stable
// callback (AppShell wraps it in its own zero-dep useCallback), see
// openOutput's comment below for why that matters.
import { useCallback, useRef, useState } from "react";
import type { Diagnostic } from "./diagnostics";

export interface UseOutputConsoleArgs {
  /** The current render's parsed diagnostics: the auto-open machine watches
   *  whether these are present at all, and whether any is a warning/assert. */
  diagnostics: Diagnostic[];
  /** Initial open state: schema.ui?.outputDefault === "open". */
  defaultOpen: boolean;
  /** Called whenever the console opens (a manual toggle-open or the
   *  auto-open-on-problem edge) so the mobile sheet can collapse to peek. */
  collapseSheet: () => void;
  /** Whether the mobile sheet is currently at its collapsed "peek" detent.
   *  Always true on desktop, which has no sheet to collapse. The
   *  auto-open-on-problem edge only fires while this holds: at half/full the
   *  visitor is mid-edit in the expanded sheet, and force-collapsing it out
   *  from under them just to reveal a warning they can already see announced
   *  on the bell's badge is worse than leaving the badge to speak for
   *  itself. A deliberate open (the bell, "View messages") still collapses
   *  regardless — but the bell is only reachable at peek in the first place,
   *  since the expanded sheet inerts the top bar. */
  sheetAtPeek: boolean;
}

export interface OutputConsoleModel {
  outputOpen: boolean;
  openOutput: () => void;
  closeOutput: () => void;
  toggleOutput: () => void;
  tab: string;
  setTab: (tab: string) => void;
}

/**
 * Pure edge-detector for the auto-open-on-problem transition: fires only on
 * the false→true edge of `hasProblem` (so a warning that persists across
 * edits doesn't re-pop a console the visitor has since dismissed), and only
 * while the mobile sheet sits at peek (see `UseOutputConsoleArgs.sheetAtPeek`).
 */
export function shouldAutoOpen(hasProblem: boolean, prevHasProblem: boolean, sheetAtPeek: boolean): boolean {
  return hasProblem && !prevHasProblem && sheetAtPeek;
}

/**
 * Pure edge-detector for the auto-close-on-clear transition: fires only on
 * the true→false edge of `hasNotices`, AND only for a console THIS machine
 * opened (`openedByAuto`). A console the visitor opened by hand — the bell,
 * "View messages", the Output toggle — stays open once notices clear until
 * they close it themselves; they may be mid-read on the Log or Metrics tab.
 */
export function shouldAutoClose(hasNotices: boolean, prevHasNotices: boolean, openedByAuto: boolean): boolean {
  return !hasNotices && hasNotices !== prevHasNotices && openedByAuto;
}

export function useOutputConsole({
  diagnostics,
  defaultOpen,
  collapseSheet,
  sheetAtPeek,
}: UseOutputConsoleArgs): OutputConsoleModel {
  const [outputOpen, setOutputOpen] = useState(defaultOpen);
  const [tab, setTabState] = useState("notices");
  // Mirrored on every render so toggleOutput can read the live value without
  // needing outputOpen in its own dependency array, that keeps toggleOutput's
  // identity permanently stable (it only ever depends on openOutput, itself
  // stable via collapseSheet), which matters for CommandBar: it's memo'd, and
  // an identity that changed on every open/close would defeat that memo on
  // every single toggle.
  const outputOpenRef = useRef(outputOpen);
  outputOpenRef.current = outputOpen;

  // Whether the CURRENTLY open console was opened by the auto-open-on-problem
  // edge below, rather than a deliberate toggle/bell/"View messages" click:
  // see shouldAutoClose's own doc for why that distinction matters.
  const [openedByAuto, setOpenedByAuto] = useState(false);

  // Switching tabs claims an auto-opened console for the visitor: someone
  // digging into Log/Metrics is mid-read, and auto-close must not yank the
  // console out from under them when the notices happen to clear.
  const setTab = useCallback((next: string) => {
    setTabState(next);
    setOpenedByAuto(false);
  }, []);

  // Open the overlay and collapse the sheet to peek, so the overlay's fixed
  // anchor (immediately above the peek tab row) never overlaps an expanded
  // sheet. Always a deliberate (non-auto) open: every external caller
  // (toggleOutput, the bell, "View messages" from the Review dialog) is a
  // visitor action, so the console it opens is exempt from auto-close.
  const openOutput = useCallback(() => {
    setOutputOpen(true);
    setOpenedByAuto(false);
    collapseSheet();
  }, [collapseSheet]);

  const closeOutput = useCallback(() => setOutputOpen(false), []);

  const toggleOutput = useCallback(() => {
    if (outputOpenRef.current) setOutputOpen(false);
    else openOutput();
  }, [openOutput]);

  // Both transitions below use the react.dev "adjust state during render"
  // pattern (compare against the previous render's value), no effect.
  const hasNotices = diagnostics.length > 0;
  const [prevHasNotices, setPrevHasNotices] = useState(hasNotices);
  if (hasNotices !== prevHasNotices) {
    setPrevHasNotices(hasNotices);
    if (shouldAutoClose(hasNotices, prevHasNotices, openedByAuto)) setOutputOpen(false);
  }
  const hasProblem = diagnostics.some((d) => d.level === "warning" || d.level === "assert");
  const [prevHasProblem, setPrevHasProblem] = useState(hasProblem);
  if (hasProblem !== prevHasProblem) {
    setPrevHasProblem(hasProblem);
    if (shouldAutoOpen(hasProblem, prevHasProblem, sheetAtPeek)) {
      setOutputOpen(true);
      setOpenedByAuto(true);
      collapseSheet(); // sheetAtPeek already holds, so this is a no-op collapse
    }
  }

  return { outputOpen, openOutput, closeOutput, toggleOutput, tab, setTab };
}
