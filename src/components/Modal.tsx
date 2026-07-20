// Modal.tsx — shared dialog shell built on the shadcn/ui Dialog (Radix): portal,
// overlay, focus trap, Escape + outside-click close, and a built-in close
// button. Mounted only while open (callers conditionally render it), so the
// dialog is always `open`.
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { cn } from "../lib/utils";

/** Scrollable dialog body (below the header / between header and actions). */
export const MODAL_BODY = "modal-body min-h-0 overflow-y-auto px-4 pt-2 pb-4";
/** Muted lead-in paragraph between the header and the body. */
export const MODAL_INTRO =
  "modal-intro mx-4 mt-[0.8rem] text-[0.85rem] text-muted-foreground [&_p]:m-0";

/** Dialog width/height presets. "default" is the classic single-column modal
 *  (Popup/Doc/Licenses). "wide" (760px) is for content that wants more room
 *  to breathe: DesignPickerDialog's card grid (3-across) and, since the
 *  round-2 review pass, HelpModal (the reviewer's own "wider" ask — see
 *  HelpModal's HELP_BODY, which caps its own prose measure independently so
 *  the extra width goes to chrome/tab-strip breathing room, not
 *  overlong text lines). "wide" also caps height a little tighter to the
 *  viewport (`calc(100vh - 48px)` vs. `80vh`) so it reliably shows more
 *  content even on a short window. */
type ModalSize = "default" | "wide";

const MODAL_SIZE_CLASS: Record<ModalSize, string> = {
  default: "w-[min(680px,100%)] max-h-[min(80vh,760px)] sm:max-w-[680px]",
  wide: "w-[min(760px,calc(100vw-32px))] max-h-[min(760px,calc(100vh-48px))] sm:max-w-[760px]",
};

interface Props {
  title: string;
  /** Accessible name for the dialog; defaults to the title. */
  label?: string;
  onClose: () => void;
  children: ReactNode;
  /** Width/height preset (default "default"). See ModalSize. */
  size?: ModalSize;
}

export function Modal({ title, label, onClose, children, size = "default" }: Props) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className={cn("flex flex-col gap-0 overflow-hidden p-0", MODAL_SIZE_CLASS[size])}
        aria-label={label ?? title}
        aria-describedby={undefined}
      >
        <DialogHeader className="modal-head flex-row items-center justify-between border-b px-4 py-[0.8rem]">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
