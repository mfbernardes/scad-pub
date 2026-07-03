// PopupModal.tsx — the configurable notice dialog (schema.popup). Reuses the
// shared Modal shell (focus trap, Escape, backdrop) and the Markdown renderer
// so the body supports links and basic formatting. The "dismissible" mode adds
// a "Don't show this again" checkbox; "once" remembers on any close; "always"
// never remembers (it's shown every visit).
import { useRef, useState } from "react";
import { Modal, MODAL_BODY } from "./Modal";
import { Markdown } from "./Markdown";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import type { PopupNotice } from "../openscad/types";

export function PopupModal({
  popup,
  onClose,
}: {
  popup: PopupNotice;
  /** Called on any close; `remember` is true when this dismissal should persist. */
  onClose: (remember: boolean) => void;
}) {
  const [dontShow, setDontShow] = useState(false);
  // Radix's default initial focus lands on the first focusable descendant in
  // DOM order, which can land on the secondary "don't show again" checkbox
  // rather than the primary action — steer it to OK instead.
  const okRef = useRef<HTMLButtonElement>(null);

  // "once" persists on every close; "dismissible" only when the box is ticked;
  // "always" never persists. Backdrop click, Escape and the X all route here.
  const close = () =>
    onClose(popup.mode === "once" || (popup.mode === "dismissible" && dontShow));

  return (
    <Modal title={popup.header} size="compact" initialFocus={okRef} onClose={close}>
      <div
        className={cn(
          MODAL_BODY,
          "notice-body [&_p]:my-2 [&_p]:text-[0.9rem] [&_p]:leading-[1.5] [&_p]:text-foreground [&_p:first-child]:mt-0",
          "[&_ul]:my-[0.4rem] [&_ul]:pl-[1.1rem] [&_ul]:text-[0.9rem] [&_ul]:leading-[1.5] [&_ul]:text-foreground"
        )}
      >
        <Markdown body={popup.body} />
      </div>
      <div className="modal-actions flex flex-wrap items-center gap-2 px-4 pb-4">
        {popup.mode === "dismissible" && (
          <Label className="notice-dismiss flex cursor-pointer items-center gap-[0.4rem] py-2 text-[0.85rem] font-normal text-muted-foreground">
            <Checkbox
              checked={dontShow}
              onCheckedChange={(v) => setDontShow(v === true)}
            />
            Don’t show this again
          </Label>
        )}
        <Button ref={okRef} className="notice-ok ml-auto" onClick={close}>
          OK
        </Button>
      </div>
    </Modal>
  );
}
