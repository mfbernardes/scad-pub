// Tests the pure checklist item-state derivation behind the getting-started
// checklist (src/lib/checklist.ts): deriveChecklistItems + checklistAllDone +
// checklistTaskProgress (PR14's compact-form counts). GettingStarted.tsx
// itself (dismiss/replay/once-flag/compact-expand/retirement chrome) isn't
// exercised here — this repo has no DOM-rendering test harness for React
// components (see tests/useExperience.test.mjs's own doc) — so these are the
// pure units the component is built from, covering every branch directly.
// End-to-end behaviour (dismiss persists, replay row, single vs. multi-design
// counts, the compact form's chevron expand/collapse, the mobile Peek strip,
// and retirement-after-export) is covered by scripts/smoke.mjs against the
// built app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveChecklistItems, checklistAllDone, checklistTaskProgress } from "../src/lib/checklist.ts";

// A fully "nothing has happened yet" baseline — tests override just the
// field(s) they care about, so each test reads as "what changed".
function baseState(overrides = {}) {
  return {
    enabled: true,
    designCount: 1,
    designChanged: false,
    paramInteracted: false,
    exported: false,
    rendering: false,
    resultOk: null,
    hasAttention: false,
    ...overrides,
  };
}

test("deriveChecklistItems: single-design build omits 'Choose a design' entirely", () => {
  const items = deriveChecklistItems(baseState({ designCount: 1 }));
  assert.equal(items.some((i) => i.id === "design"), false);
  assert.deepEqual(items.map((i) => i.id), ["review", "preview", "export"]);
});

test("deriveChecklistItems: multi-design build includes 'Choose a design' as the first row", () => {
  const items = deriveChecklistItems(baseState({ designCount: 3 }));
  assert.deepEqual(items.map((i) => i.id), ["design", "review", "preview", "export"]);
});

test("deriveChecklistItems: 'Choose a design' starts pending with no progress at all", () => {
  const items = deriveChecklistItems(baseState({ designCount: 2 }));
  const design = items.find((i) => i.id === "design");
  assert.equal(design.kind, "task");
  assert.equal(design.status, "pending");
});

test("deriveChecklistItems: 'Choose a design' completes on a real design change", () => {
  const items = deriveChecklistItems(baseState({ designCount: 2, designChanged: true }));
  assert.equal(items.find((i) => i.id === "design").status, "done");
});

test("deriveChecklistItems: 'Choose a design' also completes implicitly once the user has reviewed settings", () => {
  // The chosen rule (see checklist.ts's doc): reviewing settings or exporting
  // is only possible once the user has settled on *a* design, so it counts
  // as implicit confirmation even without an explicit design switch.
  const items = deriveChecklistItems(baseState({ designCount: 2, paramInteracted: true }));
  assert.equal(items.find((i) => i.id === "design").status, "done");
});

test("deriveChecklistItems: 'Choose a design' also completes implicitly once the user has exported", () => {
  const items = deriveChecklistItems(baseState({ designCount: 2, exported: true }));
  assert.equal(items.find((i) => i.id === "design").status, "done");
});

test("deriveChecklistItems: a render simply completing does NOT count as choosing a design (STATUS, NOT THEATER)", () => {
  // A render can finish automatically on page load without any user action —
  // crediting that would award "progress" nobody made.
  const items = deriveChecklistItems(
    baseState({ designCount: 2, resultOk: true, rendering: false })
  );
  assert.equal(items.find((i) => i.id === "design").status, "pending");
});

test("deriveChecklistItems: 'Review the essential settings' completes only on a real param edit", () => {
  assert.equal(deriveChecklistItems(baseState()).find((i) => i.id === "review").status, "pending");
  assert.equal(
    deriveChecklistItems(baseState({ paramInteracted: true })).find((i) => i.id === "review").status,
    "done"
  );
});

test("deriveChecklistItems: 'Export the model' completes only on a real successful export", () => {
  assert.equal(deriveChecklistItems(baseState()).find((i) => i.id === "export").status, "pending");
  assert.equal(
    deriveChecklistItems(baseState({ exported: true })).find((i) => i.id === "export").status,
    "done"
  );
});

test("deriveChecklistItems: 'Preview' is a status row (kind 'status'), never a checkable task", () => {
  const preview = deriveChecklistItems(baseState()).find((i) => i.id === "preview");
  assert.equal(preview.kind, "status");
  // Task-shaped rows carry `status` ("pending"/"done"); the preview row
  // carries `previewStatus` instead — never the checkable-task shape.
  assert.equal(preview.status, undefined);
  assert.ok(["building", "ready", "failed"].includes(preview.previewStatus));
});

test("deriveChecklistItems: 'Preview' reads 'building' before any render has landed", () => {
  assert.equal(
    deriveChecklistItems(baseState({ resultOk: null, rendering: false })).find((i) => i.id === "preview")
      .previewStatus,
    "building"
  );
});

test("deriveChecklistItems: 'Preview' reads 'building' while a render is in flight, regardless of the last result", () => {
  assert.equal(
    deriveChecklistItems(baseState({ rendering: true, resultOk: true })).find((i) => i.id === "preview")
      .previewStatus,
    "building"
  );
  assert.equal(
    deriveChecklistItems(baseState({ rendering: true, resultOk: false })).find((i) => i.id === "preview")
      .previewStatus,
    "building"
  );
});

test("deriveChecklistItems: 'Preview' reads 'ready' once the latest render succeeded", () => {
  assert.equal(
    deriveChecklistItems(baseState({ rendering: false, resultOk: true })).find((i) => i.id === "preview")
      .previewStatus,
    "ready"
  );
});

test("deriveChecklistItems: 'Preview' reads 'failed' when the latest render failed", () => {
  assert.equal(
    deriveChecklistItems(baseState({ rendering: false, resultOk: false })).find((i) => i.id === "preview")
      .previewStatus,
    "failed"
  );
});

// PR13: a render can succeed while it's not necessarily production-ready
// (src/lib/readiness.ts) — a font fallback in use, or a flagged notice
// pending. "attention" demotes what would otherwise read "ready" without
// claiming the render itself failed.
test("deriveChecklistItems: 'Preview' reads 'attention' when the render succeeded but readiness found unresolved items", () => {
  assert.equal(
    deriveChecklistItems(baseState({ rendering: false, resultOk: true, hasAttention: true })).find(
      (i) => i.id === "preview"
    ).previewStatus,
    "attention"
  );
});

test("deriveChecklistItems: 'Preview' still reads 'ready' when the render succeeded and nothing needs attention", () => {
  assert.equal(
    deriveChecklistItems(baseState({ rendering: false, resultOk: true, hasAttention: false })).find(
      (i) => i.id === "preview"
    ).previewStatus,
    "ready"
  );
});

test("deriveChecklistItems: 'Preview' reads 'failed', not 'attention', when the render failed even with hasAttention set", () => {
  // Precedence mirrors readiness.ts's readinessState: failed > attention.
  assert.equal(
    deriveChecklistItems(baseState({ rendering: false, resultOk: false, hasAttention: true })).find(
      (i) => i.id === "preview"
    ).previewStatus,
    "failed"
  );
});

test("deriveChecklistItems: 'Preview' reads 'building' while rendering, even with hasAttention set", () => {
  assert.equal(
    deriveChecklistItems(baseState({ rendering: true, resultOk: true, hasAttention: true })).find(
      (i) => i.id === "preview"
    ).previewStatus,
    "building"
  );
});

test("checklistAllDone: false while any task item is still pending", () => {
  assert.equal(checklistAllDone(deriveChecklistItems(baseState({ designCount: 2 }))), false);
  assert.equal(
    checklistAllDone(deriveChecklistItems(baseState({ designCount: 2, designChanged: true }))),
    false // review + export still pending
  );
});

test("checklistAllDone: true once every task item is done, regardless of the preview status row", () => {
  const failed = deriveChecklistItems(
    baseState({ designCount: 2, designChanged: true, paramInteracted: true, exported: true, resultOk: false })
  );
  assert.equal(checklistAllDone(failed), true);
});

test("checklistAllDone: true for a single-design build once review + export are both done", () => {
  const items = deriveChecklistItems(baseState({ designCount: 1, paramInteracted: true, exported: true }));
  assert.equal(checklistAllDone(items), true);
});

test("checklistAllDone: an empty item list is vacuously all-done", () => {
  assert.equal(checklistAllDone([]), true);
});

// PR14: the compact one-line form's "N of M complete" counts — task-kind
// items only, the "Preview" status row never contributes either way.
test("checklistTaskProgress: counts only task-kind items, excluding the Preview status row", () => {
  const items = deriveChecklistItems(baseState({ designCount: 2 }));
  const { completed, total } = checklistTaskProgress(items);
  assert.equal(total, 3, "design + review + export, not the Preview row too");
  assert.equal(completed, 0);
});

test("checklistTaskProgress: single-design build has 2 tasks (no 'Choose a design')", () => {
  const items = deriveChecklistItems(baseState({ designCount: 1 }));
  assert.deepEqual(checklistTaskProgress(items), { completed: 0, total: 2 });
});

test("checklistTaskProgress: reflects real completed tasks", () => {
  const items = deriveChecklistItems(
    baseState({ designCount: 2, designChanged: true, paramInteracted: true })
  );
  // design done (explicit) + review done (paramInteracted) = 2; export still pending.
  assert.deepEqual(checklistTaskProgress(items), { completed: 2, total: 3 });
});

test("checklistTaskProgress: reads 'all done' once every task is, matching checklistAllDone", () => {
  const items = deriveChecklistItems(
    baseState({ designCount: 1, paramInteracted: true, exported: true })
  );
  assert.deepEqual(checklistTaskProgress(items), { completed: 2, total: 2 });
  assert.equal(checklistAllDone(items), true);
});

test("checklistTaskProgress: unaffected by rendering/resultOk/hasAttention (the Preview row alone carries those)", () => {
  const building = checklistTaskProgress(
    deriveChecklistItems(baseState({ designCount: 2, rendering: true }))
  );
  const attention = checklistTaskProgress(
    deriveChecklistItems(baseState({ designCount: 2, resultOk: true, hasAttention: true }))
  );
  assert.deepEqual(building, { completed: 0, total: 3 });
  assert.deepEqual(attention, { completed: 0, total: 3 });
});
