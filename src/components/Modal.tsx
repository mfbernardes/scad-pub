// Modal.tsx: shared dialog shell built on the shadcn/ui Dialog (Radix): portal,
// overlay, focus trap, Escape + outside-click close, and a built-in close
// button. Mounted only while open (callers conditionally render it), so the
// dialog is always `open`.
//
// The dialog's accessible name is its visible `title`, always: Radix wires
// `aria-labelledby` to the DialogTitle, and per the accname spec that beats any
// `aria-label` on the same element, so there is deliberately no `label` prop
// offering an alternative name, since one could never take effect. Anything
// matching a dialog by name (scripts/lib/browser.mjs's openDialog, the capture
// script) should expect the title.
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { isCoarsePointer } from "../lib/pointer";

/** Scrollable dialog body (below the header / between header and actions). */
export const MODAL_BODY = "modal-body min-h-0 overflow-y-auto overscroll-contain px-4 pt-2 pb-4";
/** Muted lead-in paragraph between the header and the body. */
export const MODAL_INTRO =
  "modal-intro mx-4 mt-[0.8rem] text-[0.85rem] text-muted-foreground [&_p]:m-0";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: Props) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="flex w-[min(680px,100%)] max-h-[min(80vh,760px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[680px]"
        aria-describedby={undefined}
        // On touch devices, don't let Radix pull focus to the first field on
        // open (e.g. the picker's design-search input), which pops the mobile
        // keyboard on a first-time visitor. Desktop behaviour is unchanged.
        onOpenAutoFocus={(e) => {
          if (isCoarsePointer()) e.preventDefault();
        }}
      >
        <DialogHeader className="modal-head flex-row items-center justify-between border-b px-4 py-[0.8rem]">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
