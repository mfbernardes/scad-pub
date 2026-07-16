// checklist.ts — pure state derivation for the getting-started checklist
// (see src/components/GettingStarted.tsx). Kept framework/schema-free (like
// src/lib/renderStatus.ts's deriveRenderStatus) so tests/gettingStarted.test.mjs
// can exercise every branch without React or a real generated schema.
//
// STATUS, NOT THEATER (the approved design principle for this milestone):
// every item keys off real, verifiable state — a design actually switched, a
// parameter actually edited, a render that actually finished, an export that
// actually completed. Nothing here awards credit for opening a menu, hovering
// a control, or any interaction that doesn't itself change something real.

/** Inputs the checklist reads. All booleans are real, already-happened facts
 *  (not intentions) — see the doc above. */
export interface ChecklistState {
  /** Whether the checklist should be shown at all (guided experience AND the
   *  config allows it — `ui.checklist !== false`). Callers still get a full
   *  item list back when this is false; GettingStarted is what actually
   *  gates rendering on it, so the derivation itself stays a pure function of
   *  "what happened", not "should we show this". */
  enabled: boolean;
  /** How many designs this build ships. Only when > 1 does "Choose a design"
   *  mean anything — a single-design build has nothing to choose between. */
  designCount: number;
  /** The user has switched to a different design at least once this session
   *  (a real navigation, not merely opening/closing a picker). */
  designChanged: boolean;
  /** The user has changed at least one parameter value via the params form
   *  (ParamForm's onChange -> the `change` action) — not a preset apply,
   *  which is a bulk value replacement, not "reviewing settings" by hand. */
  paramInteracted: boolean;
  /** An export has completed successfully at least once (this browser,
   *  persisted — see the `checklist.exported.v1` pref in App.tsx). */
  exported: boolean;
  /** The render pipeline's live `rendering` flag. */
  rendering: boolean;
  /** The latest render's outcome: true (succeeded), false (failed), or null
   *  (no render has landed yet — still loading/about to render). */
  resultOk: boolean | null;
  /**
   * Whether src/lib/readiness.ts found any unresolved attention items for the
   * CURRENT render (a font param whose selected family isn't loaded, or a
   * flagged notice category with a pending notice — see AttentionItem).
   * Demotes an otherwise-successful render from "ready" to "attention": it
   * rendered, but not necessarily what the controls actually say (PR13's own
   * "rendered ≠ production-ready" distinction). Mirrors readiness.ts's
   * `readinessState` precedence (failed > attention > ready) once a render
   * has actually landed.
   */
  hasAttention: boolean;
}

export type ChecklistItemStatus = "pending" | "done";
export type PreviewStatus = "building" | "ready" | "attention" | "failed";

/** A checkable task row (a real circle/check, can be "done"). */
export interface ChecklistTaskItem {
  id: "design" | "review" | "export";
  kind: "task";
  status: ChecklistItemStatus;
}

/** The "Preview" row: a machine STATUS, not a user achievement — no checkbox,
 *  a status dot instead (see GettingStarted.tsx). Never counted toward
 *  "all done" (see checklistAllDone) since it isn't something a user does. */
export interface ChecklistStatusItem {
  id: "preview";
  kind: "status";
  previewStatus: PreviewStatus;
}

export type ChecklistItem = ChecklistTaskItem | ChecklistStatusItem;

/**
 * Derives the checklist's rows from real app state. "Choose a design" is
 * omitted entirely for single-design builds (designCount <= 1) — there's
 * nothing to choose. Its completion rule, when present, is deliberately
 * generous about WHAT counts but strict about it being real: a design change
 * itself, OR the user having moved on to reviewing settings or exporting
 * (both of which are only possible once they've settled on *a* design,
 * making that settling implicit) — anything short of that (e.g. a render
 * simply completing on page load) is NOT progress, since it happens whether
 * or not the user did anything.
 */
export function deriveChecklistItems(state: ChecklistState): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  if (state.designCount > 1) {
    const designConfirmed = state.designChanged || state.paramInteracted || state.exported;
    items.push({ id: "design", kind: "task", status: designConfirmed ? "done" : "pending" });
  }
  items.push({
    id: "review",
    kind: "task",
    status: state.paramInteracted ? "done" : "pending",
  });
  items.push({
    id: "preview",
    kind: "status",
    previewStatus: state.rendering
      ? "building"
      : state.resultOk === true
        ? state.hasAttention
          ? "attention" // rendered fine, but not necessarily what the controls say — see hasAttention's doc
          : "ready"
        : state.resultOk === false
          ? "failed"
          : "building", // no render has landed yet — same "in progress" copy as an active render
  });
  items.push({
    id: "export",
    kind: "task",
    status: state.exported ? "done" : "pending",
  });
  return items;
}

/** Whether every completable (task-kind) item is done — the checklist's
 *  auto-collapse trigger (see GettingStarted.tsx). The "Preview" status row
 *  never blocks this: it isn't a user task, so it isn't something to
 *  "finish" — a design that's mid-render when the user exports is still a
 *  fully "done" checklist. */
export function checklistAllDone(items: ChecklistItem[]): boolean {
  return items.every((item) => item.kind !== "task" || item.status === "done");
}

/**
 * Task-only progress counts behind the checklist's COMPACT form (PR14 —
 * shown whenever QuickStart is the active guide for the current design+view,
 * see GettingStarted.tsx's `quickStartActive` prop): how many task-kind items
 * (design/review/export) are done, out of how many exist. Deliberately
 * EXCLUDES the "Preview" status row, for two reasons — it mirrors
 * checklistAllDone's own task-only filter (the status row was never a user
 * task to "finish"), and it keeps the compact count independent of render
 * timing: a render still in flight would otherwise make the count itself
 * flicker on every keystroke, which the full card avoids today only because
 * the Preview row never contributes a checkmark to begin with.
 */
export function checklistTaskProgress(items: ChecklistItem[]): { completed: number; total: number } {
  const tasks = items.filter((item): item is ChecklistTaskItem => item.kind === "task");
  return { completed: tasks.filter((task) => task.status === "done").length, total: tasks.length };
}
