// The scroller an element lives in. Two callers want it for different
// reasons — keeping a focused field clear of the on-screen keyboard, and
// pinning an open popover to the panel its trigger belongs to — but both need
// the same "which ancestor actually scrolls" answer, so the predicate lives
// here once.

/** Whether `node` is a vertical scroll container, ignoring whether it currently overflows. */
export function isScrollableY(node: Element): boolean {
  const { overflowY } = getComputedStyle(node);
  return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
}

/**
 * The nearest vertically-scrollable ancestor of `el`, or null when it has
 * none (the caller then has nothing to scroll or clip against, and should
 * fall back to its own default rather than to the document).
 */
export function nearestScrollParent(el: Element | null | undefined): HTMLElement | null {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    if (isScrollableY(node)) return node;
  }
  return null;
}
