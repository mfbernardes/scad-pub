// useOutputConsole.ts: the Output console's open/closed state and its
// auto-open-on-problem state machine, extracted from AppShell. Info-level
// notices (config-driven `notices`) are surfaced passively by the dot/count on
// the Output toggle; a warning or assert is different: the model came out
// wrong in a way worth seeing, so the console auto-opens the first time a
// render surfaces one, rather than hiding it behind a badge the user may never
// click.
//
// AppShell supplies the parsed diagnostics (diagnostics.ts, itself fed by
// useReadinessModel) and a `collapseSheet` callback. The overlay's fixed
// anchor sits immediately above the mobile sheet's peek tab row and would overlap an
// expanded sheet otherwise, but that sheet's detent state lives outside this
// hook (see useSheetPolicy.ts): rather than reach into it directly, opening
// the console goes through this injected callback, so AppShell owns wiring
// the two together and this hook stays ignorant of the sheet entirely.
// `collapseSheet` must be an identity-stable callback (AppShell wraps it in
// its own zero-dep useCallback), see openOutput's comment below for why that
// matters.
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
}

export interface OutputConsoleModel {
  outputOpen: boolean;
  openOutput: () => void;
  closeOutput: () => void;
  toggleOutput: () => void;
}

export function useOutputConsole({
  diagnostics,
  defaultOpen,
  collapseSheet,
}: UseOutputConsoleArgs): OutputConsoleModel {
  const [outputOpen, setOutputOpen] = useState(defaultOpen);
  // Mirrored on every render so toggleOutput can read the live value without
  // needing outputOpen in its own dependency array, that keeps toggleOutput's
  // identity permanently stable (it only ever depends on openOutput, itself
  // stable via collapseSheet), which matters for CommandBar: it's memo'd, and
  // an identity that changed on every open/close would defeat that memo on
  // every single toggle.
  const outputOpenRef = useRef(outputOpen);
  outputOpenRef.current = outputOpen;

  // Open the overlay and collapse the sheet to peek, so the overlay's fixed
  // anchor (immediately above the peek tab row) never overlaps an expanded sheet.
  const openOutput = useCallback(() => {
    setOutputOpen(true);
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
    if (!hasNotices) setOutputOpen(false); // notices cleared → hide the console
  }
  // Auto-open on the false→true edge only, so a persistent warning across edits
  // doesn't re-pop a console the user has dismissed.
  const hasProblem = diagnostics.some((d) => d.level === "warning" || d.level === "assert");
  const [prevHasProblem, setPrevHasProblem] = useState(hasProblem);
  if (hasProblem !== prevHasProblem) {
    setPrevHasProblem(hasProblem);
    if (hasProblem) openOutput(); // also collapses the sheet to peek
  }

  return { outputOpen, openOutput, closeOutput, toggleOutput };
}
