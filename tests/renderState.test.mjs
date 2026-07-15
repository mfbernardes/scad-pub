// Tests the pure render-provenance rules in src/lib/renderState.ts — the
// epoch/currentness/exportability logic behind docs/architecture-review.md H1
// (render result provenance) and M15 (heavy-design first render). Kept as
// pure-function tests per the review's "Render pipeline harness" plan:
// useRenderPipeline.ts calls exactly these functions at its two decision
// points (doRender's commit, and the initial-render effect), so exercising
// them here proves the hook's provenance guarantees without needing to mount
// a React tree (no DOM/jsdom is available in this test environment).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSnapshotCurrent,
  isSnapshotExportable,
  isStaleEpoch,
  nextPauseReason,
  resolveRenderCommit,
  shouldFireInitialRender,
} from "../src/lib/renderState.ts";

function ok(overrides = {}) {
  return { id: 1, ok: true, exitCode: 0, stl: new Uint8Array([1]), log: [], ms: 10, ...overrides };
}
function fail(overrides = {}) {
  return { id: 1, ok: false, exitCode: 1, stl: new Uint8Array(), log: ["error"], ms: 5, ...overrides };
}
function outcome(overrides = {}) {
  return {
    startEpoch: 0,
    renderKey: "key-A",
    designId: "design-a",
    values: { size: 1 },
    fileSig: "",
    result: ok(),
    ...overrides,
  };
}

// ---- isStaleEpoch / isSnapshotCurrent / isSnapshotExportable ----

test("isStaleEpoch: only a mismatch is stale", () => {
  assert.equal(isStaleEpoch(0, 0), false);
  assert.equal(isStaleEpoch(0, 1), true);
  assert.equal(isStaleEpoch(2, 1), true);
});

test("isSnapshotCurrent: null snapshot is never current", () => {
  assert.equal(isSnapshotCurrent(null, "key-A", "design-a"), false);
});

test("isSnapshotCurrent: requires both renderKey and designId to match", () => {
  const snap = { epoch: 0, renderKey: "key-A", designId: "design-a", values: {}, fileSig: "", result: ok() };
  assert.equal(isSnapshotCurrent(snap, "key-A", "design-a"), true);
  assert.equal(isSnapshotCurrent(snap, "key-B", "design-a"), false); // edited since
  assert.equal(isSnapshotCurrent(snap, "key-A", "design-b"), false); // switched since (defense in depth)
});

test("isSnapshotExportable: a stale-but-successful snapshot is never exportable", () => {
  const snap = { epoch: 0, renderKey: "key-A", designId: "design-a", values: {}, fileSig: "", result: ok() };
  assert.equal(isSnapshotExportable(snap, "key-A", "design-a"), true);
  assert.equal(isSnapshotExportable(snap, "key-B", "design-a"), false);
});

test("isSnapshotExportable: a current-but-failed snapshot is never exportable", () => {
  // A snapshot only ever holds successful results in practice (see
  // resolveRenderCommit), but the guard is asserted directly here so the
  // export gate can never regress if that invariant ever slips.
  const snap = { epoch: 0, renderKey: "key-A", designId: "design-a", values: {}, fileSig: "", result: fail() };
  assert.equal(isSnapshotExportable(snap, "key-A", "design-a"), false);
});

// ---- resolveRenderCommit ----

test("resolveRenderCommit: a same-epoch success produces a snapshot", () => {
  const commit = resolveRenderCommit(0, "key-A", outcome());
  assert.equal(commit.discarded, false);
  assert.equal(commit.ok, true);
  assert.deepEqual(commit.snapshot, {
    epoch: 0,
    renderKey: "key-A",
    designId: "design-a",
    values: { size: 1 },
    fileSig: "",
    result: outcome().result,
  });
});

test("resolveRenderCommit: a same-epoch failure produces no snapshot", () => {
  const commit = resolveRenderCommit(0, "key-A", outcome({ result: fail() }));
  assert.equal(commit.discarded, false);
  assert.equal(commit.ok, false);
  assert.equal("snapshot" in commit, false);
});

test("resolveRenderCommit: an older-epoch completion is discarded outright, success or not", () => {
  // Required test: edit then export before the debounce fires is really "the
  // renderKey moved on"; this test covers the sibling case — the *epoch*
  // moved on (design switch / invalidation) while a render was in flight.
  const discardedOk = resolveRenderCommit(1, "key-A", outcome({ startEpoch: 0, result: ok() }));
  const discardedFail = resolveRenderCommit(1, "key-A", outcome({ startEpoch: 0, result: fail() }));
  assert.deepEqual(discardedOk, { discarded: true, reason: "epoch" });
  assert.deepEqual(discardedFail, { discarded: true, reason: "epoch" });
});

test("resolveRenderCommit: a same-epoch completion whose key no longer matches the live controls is discarded as superseded (H1)", () => {
  // The revert race: render B is in flight; the user reverts to already-rendered
  // key A, which doRender short-circuits (so B is never superseded on the
  // runner). When B completes, the live renderKey is A again — B must be
  // discarded so it can't overwrite the current A preview, and the reason must
  // be "superseded" (not "epoch") so the caller clears the now-orphaned spinner.
  const discardedOk = resolveRenderCommit(0, "key-A", outcome({ renderKey: "key-B", result: ok() }));
  const discardedFail = resolveRenderCommit(0, "key-A", outcome({ renderKey: "key-B", result: fail() }));
  assert.deepEqual(discardedOk, { discarded: true, reason: "superseded" });
  assert.deepEqual(discardedFail, { discarded: true, reason: "superseded" });
});

test("resolveRenderCommit: an epoch change wins over a key match (design switch beats currency)", () => {
  // If both the epoch moved AND the key differs, epoch discard takes priority —
  // a newer generation owns `rendering`, so the caller must NOT clear it.
  const commit = resolveRenderCommit(1, "b-key", outcome({ startEpoch: 0, renderKey: "a-key", result: ok() }));
  assert.deepEqual(commit, { discarded: true, reason: "epoch" });
});

// ---- Required scenario: resolve design A's deferred render AFTER switching
// to design B — A must never become visible or exportable under B ----
test("scenario: design A resolves after switching to design B (epoch discard)", () => {
  // Design A starts rendering under epoch 0.
  const startEpoch = 0;
  const aOutcome = outcome({ startEpoch, renderKey: "a-key", designId: "design-a", result: ok() });

  // Before A resolves, the user switches to design B: resetForDesign bumps
  // the epoch (now 1) and resets the pipeline's own state to nothing for B.
  const currentEpoch = 1;
  let snapshot = null; // what resetForDesign leaves behind for B
  const currentRenderKey = "b-key";
  const currentDesignId = "design-b";

  // A's render now resolves. It must be discarded, not merged into B's state.
  const commit = resolveRenderCommit(currentEpoch, currentRenderKey, aOutcome);
  assert.equal(commit.discarded, true);
  if (!commit.discarded) snapshot = commit.ok ? commit.snapshot : snapshot; // never reached

  assert.equal(snapshot, null);
  assert.equal(isSnapshotCurrent(snapshot, currentRenderKey, currentDesignId), false);
  assert.equal(isSnapshotExportable(snapshot, currentRenderKey, currentDesignId), false);
});

// ---- Required scenario: edit then export before the debounce fires ----
test("scenario: editing invalidates exportability immediately, before any render runs", () => {
  // A prior successful render exists for the pre-edit values.
  const snapshot = {
    epoch: 0,
    renderKey: "before-edit",
    designId: "design-a",
    values: { size: 1 },
    fileSig: "",
    result: ok(),
  };
  // The user edits a param. useRenderPipeline recomputes `renderKey`
  // synchronously (it's a useMemo over the live values), so exportability
  // must already reflect the edit even though the 400 ms debounce hasn't
  // fired doRender yet.
  const renderKeyAfterEdit = "after-edit";
  assert.equal(isSnapshotExportable(snapshot, renderKeyAfterEdit, "design-a"), false);
});

// ---- Required scenario: export while a newer render is in flight, and after
// that render fails ----
test("scenario: a newer in-flight render blocks export, including after it fails", () => {
  const epoch = 0;
  // Snapshot from an older, still-successful render.
  const snapshot = {
    epoch,
    renderKey: "key-1",
    designId: "design-a",
    values: { size: 1 },
    fileSig: "",
    result: ok(),
  };
  // The user has since edited again; a newer render for "key-2" is in flight.
  const liveRenderKey = "key-2";
  assert.equal(isSnapshotExportable(snapshot, liveRenderKey, "design-a"), false);

  // That newer render now fails.
  const commit = resolveRenderCommit(epoch, liveRenderKey, outcome({ startEpoch: epoch, renderKey: liveRenderKey, result: fail() }));
  assert.equal(commit.discarded, false);
  assert.equal(commit.ok, false);
  // The old snapshot is untouched by a failure (resolveRenderCommit produces
  // no snapshot on failure), so it remains what it was — still not current,
  // still not exportable, against the now-failed live key.
  assert.equal(isSnapshotExportable(snapshot, liveRenderKey, "design-a"), false);
});

// ---- shouldFireInitialRender (M15) ----

test("shouldFireInitialRender: fires exactly once for a manual-mode (heavy) design", () => {
  assert.equal(shouldFireInitialRender(false, /* autoRender */ false), true);
  assert.equal(shouldFireInitialRender(true, false), false); // already fired
});

test("shouldFireInitialRender: never fires for an auto-render design (the debounce loop owns it)", () => {
  assert.equal(shouldFireInitialRender(false, /* autoRender */ true), false);
  assert.equal(shouldFireInitialRender(true, true), false);
});

test("shouldFireInitialRender: the predicate takes no readiness input at all", () => {
  // M15: the old contract gated the first render on a `ready` signal that
  // only a render itself produces, deadlocking heavy designs. The fix is
  // structural — this predicate has no readiness parameter to gate on.
  assert.equal(shouldFireInitialRender.length, 2);
});

// ---- nextPauseReason (PR4: live-preview pause reason) ----

test("nextPauseReason: a design switch resolves from scratch, ignoring `current`", () => {
  assert.equal(nextPauseReason(null, { type: "design-switch", heavy: true }), "manual-design");
  assert.equal(nextPauseReason(null, { type: "design-switch", heavy: false }), null);
  // Switching TO a light design always clears whatever reason a previous
  // heavy design (or a brake) left behind.
  assert.equal(nextPauseReason("heavy", { type: "design-switch", heavy: false }), null);
  assert.equal(nextPauseReason("manual-design", { type: "design-switch", heavy: false }), null);
  // Switching TO a heavy design always reports "manual-design", even if the
  // previous design's reason was "heavy" (a fresh design view is a fresh
  // manual start, not a leftover brake).
  assert.equal(nextPauseReason("heavy", { type: "design-switch", heavy: true }), "manual-design");
});

test("nextPauseReason: the heavy brake always reports \"heavy\", regardless of `current`", () => {
  assert.equal(nextPauseReason(null, { type: "heavy-brake" }), "heavy");
  assert.equal(nextPauseReason("manual-design", { type: "heavy-brake" }), "heavy");
  assert.equal(nextPauseReason("heavy", { type: "heavy-brake" }), "heavy");
});

test("nextPauseReason: re-enabling auto-render always clears the reason", () => {
  assert.equal(nextPauseReason("heavy", { type: "auto-render-toggle", enabled: true }), null);
  assert.equal(nextPauseReason("manual-design", { type: "auto-render-toggle", enabled: true }), null);
  assert.equal(nextPauseReason(null, { type: "auto-render-toggle", enabled: true }), null);
});

test("nextPauseReason: turning auto-render off (the user's own choice) leaves the reason as-is", () => {
  // In practice this is always called with `current === null` (nothing else
  // sets a reason without also turning auto-render off itself), but the
  // reducer is still exercised directly against every `current` value so the
  // "no reason for a user's own choice" contract can't silently regress.
  assert.equal(nextPauseReason(null, { type: "auto-render-toggle", enabled: false }), null);
  assert.equal(nextPauseReason("heavy", { type: "auto-render-toggle", enabled: false }), "heavy");
});
