// useCssPublishers.ts: the four measured values AppShell mirrors into CSS
// custom properties, so the stylesheet can lay out against real measured
// geometry (a sheet's live height, its Full-detent top gap, its peek row, the
// export dock's height) instead of re-deriving any of it.
//
// All four write imperatively and never re-render: a sheet drag publishes on
// every frame, and routing that through React state would re-render the whole
// shell per frame for values only CSS reads. Extracted from AppShell for the
// same reason its sibling hooks were — it is one mechanism with one shape, and
// AppShell's job is composing layout.
import { useCallback, type RefObject } from "react";

export interface CssPublishers {
  /** The mobile viewer follows the sheet's live height. */
  handleSheetFollow: (heightPx: number, dragging: boolean) => void;
  handleSheetFullGap: (gapPx: number) => void;
  handleSheetPeekHeight: (heightPx: number) => void;
  handleDockHeight: (heightPx: number) => void;
}

export function useCssPublishers(
  /** The mobile layout root: the three sheet-derived properties are scoped to
   *  it, since only the mobile tree reads them. */
  mobileRootRef: RefObject<HTMLElement | null>,
  /** The shell root: the dock height is written here because BOTH layouts'
   *  over-viewer chips read it and only one layout is ever mounted. */
  shellRef: RefObject<HTMLElement | null>
): CssPublishers {
  // One "round, stringify, write" rather than four copies of it.
  const writePx = useCallback(
    (ref: RefObject<HTMLElement | null>, prop: string, px: number) =>
      ref.current?.style.setProperty(prop, `${Math.round(px)}px`),
    []
  );

  // The mobile viewer follows the sheet's live height: --sheet-follow-h sets
  // the viewer's bottom edge, and through the Viewer's ResizeObserver re-fits
  // the model into the new box so it holds its size instead of shrinking with
  // the canvas (see Viewer.tsx's refitView). The CSS caps it at the half
  // height, and data-sheet-dragging toggles the easing.
  const handleSheetFollow = useCallback(
    (heightPx: number, dragging: boolean) => {
      writePx(mobileRootRef, "--sheet-follow-h", heightPx);
      if (mobileRootRef.current) mobileRootRef.current.dataset.sheetDragging = dragging ? "true" : "false";
    },
    [mobileRootRef, writePx]
  );

  // The sheet's Full-detent top gap, so the stylesheet can anchor to the model
  // strip (the scrim starts below it) without re-deriving `FULL_TOP_GAP + notch
  // inset` in CSS. BottomSheet owns the detent model, so it owns the number.
  const handleSheetFullGap = useCallback(
    (gapPx: number) => writePx(mobileRootRef, "--sheet-full-gap", gapPx),
    [mobileRootRef, writePx]
  );

  // The sheet's measured "Peek" height (drag handle + tab row), so the output
  // console overlay + scrim anchor to the real row instead of the static CSS
  // fallback, which font scaling can exceed.
  const handleSheetPeekHeight = useCallback(
    (heightPx: number) => writePx(mobileRootRef, "--mobile-peek-height", heightPx),
    [mobileRootRef, writePx]
  );

  // The export dock's measured height, the offset the over-viewer chips
  // (ViewerGestureHint, SheetSwipeHint) stack themselves by. The dock is a flex
  // column that grows with what it holds — the readiness pill, the after-export
  // panel — and it outranks both chips (z-10 vs z-9), so a static "height of
  // the button cluster" guess meant anything taller covered them. See
  // `.viewer-hint` / `.sheet-hint` in index.css.
  const handleDockHeight = useCallback(
    (heightPx: number) => writePx(shellRef, "--action-dock-h", heightPx),
    [shellRef, writePx]
  );

  return { handleSheetFollow, handleSheetFullGap, handleSheetPeekHeight, handleDockHeight };
}
