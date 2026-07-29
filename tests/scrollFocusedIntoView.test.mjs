// The pure half of useScrollFocusedIntoView: where a scroller must land to
// centre a focused field in it. The hook itself needs a DOM and a coarse
// pointer; this covers the arithmetic and — more importantly — the clamping,
// which is what keeps the correction inside the scroller instead of asking for
// an offset the browser would resolve by scrolling something further up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { centeringScrollTop } from "../src/lib/useScrollFocusedIntoView.ts";

// A 400px-tall scroller at viewport y=200, holding 1200px of content.
const SCROLLER = { top: 200, height: 400 };
const SCROLL_HEIGHT = 1200;
const CLIENT_HEIGHT = 400;

test("centres a field below the scroller's middle by scrolling down", () => {
  // Field centre at y=550; scroller centre at y=400 → move down 150.
  const next = centeringScrollTop({ top: 530, height: 40 }, SCROLLER, 0, SCROLL_HEIGHT, CLIENT_HEIGHT);
  assert.equal(next, 150);
});

test("centres a field above the scroller's middle by scrolling up", () => {
  // Field centre at y=270, scroller centre at y=400 → move up 130 from 300.
  const next = centeringScrollTop({ top: 250, height: 40 }, SCROLLER, 300, SCROLL_HEIGHT, CLIENT_HEIGHT);
  assert.equal(next, 170);
});

test("a field already centred asks for no movement", () => {
  const next = centeringScrollTop({ top: 380, height: 40 }, SCROLLER, 120, SCROLL_HEIGHT, CLIENT_HEIGHT);
  assert.equal(next, 120);
});

test("clamps to the scroller's own range rather than overscrolling", () => {
  // The first field in a long form can't be centred — that would need a
  // negative scrollTop, which the browser would resolve by scrolling an
  // ANCESTOR (the document, on iOS). Clamped to 0 instead.
  assert.equal(
    centeringScrollTop({ top: 210, height: 40 }, SCROLLER, 0, SCROLL_HEIGHT, CLIENT_HEIGHT),
    0
  );
  // …and the last field clamps to the bottom of the range, not past it.
  assert.equal(
    centeringScrollTop({ top: 560, height: 40 }, SCROLLER, 790, SCROLL_HEIGHT, CLIENT_HEIGHT),
    SCROLL_HEIGHT - CLIENT_HEIGHT
  );
});

test("a scroller with nothing to scroll never moves", () => {
  // scrollHeight === clientHeight: max is 0, so every field resolves to 0
  // however far off-centre it is.
  for (const top of [0, 250, 590]) {
    assert.equal(centeringScrollTop({ top, height: 40 }, SCROLLER, 0, 400, 400), 0);
  }
});
