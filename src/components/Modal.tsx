// Modal.tsx — shared dialog shell built on the shadcn/ui Dialog (Radix): portal,
// overlay, focus trap, Escape + outside-click close, and a built-in close
// button. Mounted only while open (callers conditionally render it), so the
// dialog is always `open`.
import type { ReactNode, RefObject } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

/** Scrollable dialog body (below the header / between header and actions). */
export const MODAL_BODY = "modal-body min-h-0 overflow-y-auto px-4 pt-2 pb-4";
/** Muted lead-in paragraph between the header and the body. */
export const MODAL_INTRO =
  "modal-intro mx-4 mt-[0.8rem] text-[0.85rem] text-muted-foreground [&_p]:m-0";

const SIZE_CLASS = {
  // Long-form content (Help, Licenses): a wide, tall shell.
  default: "w-[min(680px,100%)] max-h-[min(80vh,760px)] sm:max-w-[680px]",
  // A short notice (the welcome popup): a narrower shell sized to its
  // content instead of borrowing the long-form width and leaving it sparse.
  compact: "w-[min(28rem,100%)] max-h-[min(80vh,760px)] sm:max-w-[28rem]",
} as const;

interface Props {
  title: string;
  /** Accessible name for the dialog; defaults to the title. */
  label?: string;
  /** Shell width: `default` for long-form content, `compact` for a short notice. */
  size?: keyof typeof SIZE_CLASS;
  /**
   * Element to focus when the dialog opens, overriding Radix's default (the
   * first focusable descendant in DOM order, which can land on an
   * unrelated secondary control). Optional — omit to keep Radix's default.
   */
  initialFocus?: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, label, size = "default", initialFocus, onClose, children }: Props) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className={`flex ${SIZE_CLASS[size]} flex-col gap-0 overflow-hidden p-0 shadow-none`}
        aria-label={label ?? title}
        aria-describedby={undefined}
        onOpenAutoFocus={
          initialFocus
            ? (e) => {
                e.preventDefault();
                initialFocus.current?.focus();
              }
            : undefined
        }
      >
        <DialogHeader className="modal-head flex-row items-center justify-between border-b px-4 py-[0.8rem]">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
