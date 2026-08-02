// Which ancestor an anchored overlay is clipped by. The param help popover
// passes this to Radix as its collision boundary, so getting it wrong is the
// difference between a popover that stays over the customizer and one that
// drifts up into the 3D viewer when the form scrolls under it.
//
// Driven against a stand-in element tree: the walk only ever reads
// `parentElement` and the computed `overflow-y`, so a plain object graph plus a
// stubbed `getComputedStyle` exercises the real function.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isScrollableY, nearestScrollParent } from "../src/lib/scrollParent.ts";

globalThis.getComputedStyle = (node) => ({ overflowY: node.overflowY ?? "visible" });

/** Chain of nodes from outermost to innermost; returns the innermost. */
function chain(...overflows) {
  let node = null;
  for (const overflowY of overflows) node = { overflowY, parentElement: node };
  return node;
}

test("finds the scroller a trigger sits inside", () => {
  const button = chain("auto", "visible", "visible");
  assert.equal(nearestScrollParent(button), button.parentElement.parentElement);
});

test("stops at the NEAREST scroller, not the outermost", () => {
  // The mobile sheet's tab body scrolls inside a shell that also scrolls; a
  // popover clipped by the outer one would still escape over the model.
  const outer = { overflowY: "auto", parentElement: null };
  const inner = { overflowY: "scroll", parentElement: outer };
  const button = { overflowY: "visible", parentElement: inner };
  assert.equal(nearestScrollParent(button), inner);
});

test("returns null when nothing in the ancestry scrolls", () => {
  // The caller then leaves Radix on its own default rather than pinning the
  // popover to a boundary that doesn't clip anything.
  assert.equal(nearestScrollParent(chain("visible", "visible")), null);
});

test("never returns the element itself", () => {
  const button = { overflowY: "auto", parentElement: null };
  assert.equal(nearestScrollParent(button), null);
});

test("tolerates a missing trigger", () => {
  assert.equal(nearestScrollParent(null), null);
  assert.equal(nearestScrollParent(undefined), null);
});

test("counts the overflow values that actually scroll", () => {
  for (const overflowY of ["auto", "scroll", "overlay"]) {
    assert.equal(isScrollableY({ overflowY }), true, overflowY);
  }
  // `visible` doesn't clip at all; `hidden`/`clip` clip but can't be scrolled
  // past, so an anchor inside one can never scroll away from its popover.
  for (const overflowY of ["visible", "hidden", "clip"]) {
    assert.equal(isScrollableY({ overflowY }), false, overflowY);
  }
});
