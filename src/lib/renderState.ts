// renderState.ts — pure render-provenance helpers used by useRenderPipeline.
// Kept dependency-free (no React) so the epoch/currentness/exportability rules
// that guard Download/Image can be unit-tested directly, without mounting a
// hook or a DOM. See docs/architecture-review.md H1 for the motivating bug:
// an edit or design switch could leave a stale RenderResult exportable under
// the new controls.
import type { RenderResult } from "../openscad/types";
import type { Values } from "./presets";

/**
 * An immutable record of one *successful* render: everything needed to prove
 * a piece of exported/displayed output actually corresponds to the controls
 * that produced it. `epoch` is the pipeline's generation counter — bumped on
 * design switch and on render-input invalidation (e.g. a file import) — so a
 * completion belonging to a stale generation can be recognized and discarded
 * even when its `renderKey` happens to coincide.
 */
export interface RenderSnapshot {
  epoch: number;
  renderKey: string;
  designId: string;
  values: Values;
  fileSig: string;
  result: RenderResult;
}

/**
 * Whether `snapshot` was produced by exactly the render inputs live right
 * now. `renderKey` already folds in design id, defines, and the user-file
 * signature (see useRenderPipeline's `renderKey`), so comparing it is
 * sufficient on its own; `designId` is checked too as a second, cheap,
 * defense-in-depth guard against ever showing/exporting one design's geometry
 * under another design's controls.
 */
export function isSnapshotCurrent(
  snapshot: RenderSnapshot | null,
  currentRenderKey: string,
  currentDesignId: string
): boolean {
  return (
    !!snapshot &&
    snapshot.renderKey === currentRenderKey &&
    snapshot.designId === currentDesignId
  );
}

/**
 * Whether `snapshot` may be exported (Download/Image): it must be a
 * successful render (never true for a null/failed result) AND current per
 * `isSnapshotCurrent`. A stale-but-successful snapshot may still be shown as
 * a labeled-stale preview — see stalePreview — it just can't be exported.
 */
export function isSnapshotExportable(
  snapshot: RenderSnapshot | null,
  currentRenderKey: string,
  currentDesignId: string
): boolean {
  return (
    !!snapshot?.result.ok &&
    isSnapshotCurrent(snapshot, currentRenderKey, currentDesignId)
  );
}

/** Whether a completion started under `startEpoch` should be discarded because a newer epoch (design switch or invalidation) has since begun. */
export function isStaleEpoch(startEpoch: number, currentEpoch: number): boolean {
  return startEpoch !== currentEpoch;
}

/** Everything doRender knows about a render call at the moment it started —
 * captured before the `await`, so the eventual commit decision is judged
 * against the inputs that were actually live when the runner was asked to
 * render, not whatever the closure would read after the fact. */
export interface RenderOutcome {
  startEpoch: number;
  renderKey: string;
  designId: string;
  values: Values;
  fileSig: string;
  result: RenderResult;
}

export type RenderCommit =
  // `epoch`: a newer generation (design switch / invalidation) owns pipeline
  // state now — the caller must not touch `rendering`, it belongs to that
  // generation. `superseded`: the live controls reverted to an already-rendered
  // key, so this completion is stale but nothing else is in flight (the runner
  // is latest-wins) — the caller must clear `rendering` itself.
  | { discarded: true; reason: "epoch" | "superseded" }
  | { discarded: false; ok: false }
  | { discarded: false; ok: true; snapshot: RenderSnapshot };

/**
 * The single decision point for what a completed render() call is allowed to
 * do to pipeline state. Called with the pipeline's epoch AND live renderKey
 * *at commit time* (i.e. after the await):
 *
 *  - If the epoch no longer matches `startEpoch`, a design switch or
 *    invalidation happened while this render was in flight → discard
 *    (`reason: "epoch"`); it must never become the displayed/exportable
 *    snapshot, however tempting its `renderKey` looks (H1).
 *  - Else if the outcome's `renderKey` no longer matches the live
 *    `currentRenderKey`, the controls were reverted to a previously-rendered
 *    key while this render was in flight. doRender short-circuits such a revert
 *    (already rendered) and never issues a superseding render, so nothing
 *    rejects this in-flight completion — discard it here (`reason:
 *    "superseded"`) so it can't overwrite the current preview or, on failure,
 *    clear the viewer while the current snapshot stays exportable.
 *
 * A discarded outcome carries only its reason (see RenderCommit): the caller
 * must not commit its result/snapshot, and touches `rendering` only for the
 * `superseded` reason.
 */
export function resolveRenderCommit(
  currentEpoch: number,
  currentRenderKey: string,
  outcome: RenderOutcome
): RenderCommit {
  if (isStaleEpoch(outcome.startEpoch, currentEpoch)) return { discarded: true, reason: "epoch" };
  if (outcome.renderKey !== currentRenderKey) return { discarded: true, reason: "superseded" };
  if (!outcome.result.ok) return { discarded: false, ok: false };
  return {
    discarded: false,
    ok: true,
    snapshot: {
      epoch: outcome.startEpoch,
      renderKey: outcome.renderKey,
      designId: outcome.designId,
      values: outcome.values,
      fileSig: outcome.fileSig,
      result: outcome.result,
    },
  };
}

/**
 * Whether the "first view of a design" effect should issue a render. Designs
 * with auto-render on get their first render from the debounce loop, so this
 * path exists only for manual-mode (heavy) designs, and fires at most once
 * per design view — `alreadyFired` is reset on every design switch. Written
 * as a pure predicate (rather than inlined in the effect) so the M15
 * "exactly one initial render, never gated on readiness" contract can be
 * asserted directly: notice it takes no `ready` argument at all.
 */
export function shouldFireInitialRender(alreadyFired: boolean, autoRender: boolean): boolean {
  return !alreadyFired && !autoRender;
}
