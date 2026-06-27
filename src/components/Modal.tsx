// Modal.tsx — shared dialog shell built on the shadcn/ui Dialog (Radix): portal,
// overlay, focus trap, Escape + outside-click close, and a built-in close
// button. Keeps the legacy `.modal-head`/`.modal-body`/`.modal-actions` content
// classes so each modal's body markup styles unchanged. Mounted only while open
// (callers conditionally render it), so the dialog is always `open`.
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

interface Props {
  title: string;
  /** Accessible name for the dialog; defaults to the title. */
  label?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, label, onClose, children }: Props) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="flex w-[min(680px,100%)] max-h-[min(80vh,760px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[680px]"
        aria-label={label ?? title}
        aria-describedby={undefined}
      >
        <div className="modal-head">
          <DialogTitle>{title}</DialogTitle>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
