// Tests ErrorBoundary's pure state-transition logic (M14): a caught error
// must show a fallback, and changing `resetKey` (the mechanism callers use to
// offer retry — see SvgPrepareControl's `wizardAttempt` and Viewer's
// `result`) must clear that error and let children render again. This repo
// has no DOM-rendering test harness (no jsdom), so instead of mounting a real
// tree we exercise the class component's static lifecycle methods directly —
// they're pure functions of (error | props, state) — and call `render()`
// against a hand-built `this`, which is valid since it only reads
// `this.state`/`this.props` and returns a plain React element tree.
import { test } from "node:test";
import assert from "node:assert/strict";

const { ErrorBoundary } = await import("../src/components/ErrorBoundary.tsx");

test("getDerivedStateFromError captures the thrown error", () => {
  const err = new Error("chunk load failed");
  const partial = ErrorBoundary.getDerivedStateFromError(err);
  assert.equal(partial.error, err);
});

test("getDerivedStateFromProps is a no-op while resetKey is unchanged", () => {
  const state = { error: new Error("boom"), lastKey: 0 };
  const result = ErrorBoundary.getDerivedStateFromProps({ resetKey: 0 }, state);
  assert.equal(result, null, "must not touch state when resetKey hasn't changed");
});

test("getDerivedStateFromProps clears the error when resetKey changes (retry)", () => {
  const state = { error: new Error("chunk load failed"), lastKey: 0 };
  // Simulates SvgPrepareControl bumping `wizardAttempt` after Retry: a fresh
  // resetKey must clear the caught error so the (newly re-created) lazy
  // component gets a real second attempt, not a re-throw of the cached
  // rejection.
  const result = ErrorBoundary.getDerivedStateFromProps({ resetKey: 1 }, state);
  assert.deepEqual(result, { error: null, lastKey: 1 });
});

test("render shows the caught-state fallback, not children, while an error is set", () => {
  const el = ErrorBoundary.prototype.render.call({
    state: { error: new Error("offline"), lastKey: 0 },
    props: { fallback: "FALLBACK_UI", children: "CHILDREN" },
  });
  assert.equal(el, "FALLBACK_UI");
});

test("render falls back to the built-in alert when no fallback prop is supplied", () => {
  const el = ErrorBoundary.prototype.render.call({
    state: { error: new Error("mesh parse error"), lastKey: 0 },
    props: { children: "CHILDREN" },
  });
  assert.notEqual(el, "CHILDREN");
  assert.equal(el.props.role, "alert");
});

test("render passes children through once no error is set (post-retry recovery)", () => {
  const el = ErrorBoundary.prototype.render.call({
    state: { error: null, lastKey: 1 },
    props: { fallback: "FALLBACK_UI", children: "CHILDREN" },
  });
  assert.equal(el, "CHILDREN");
});
