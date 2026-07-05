// PopupModal.tsx — the configurable notice dialog (schema.popup). Reuses the
// shared Modal shell (focus trap, Escape, backdrop) and the Markdown renderer
// so the body supports links and basic formatting. The "dismissible" mode adds
// a "Don't show this again" checkbox; "once" remembers on any close; "always"
// never remembers (it's shown every visit).
import { useState } from "react";
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
  onPrimary,
}: {
  popup: PopupNotice;
  /** Incidental close (backdrop / Escape / X). `remember` persists the dismissal. */
  onClose: (remember: boolean) => void;
  /** The primary button — closes and advances (e.g. opens the design picker). */
  onPrimary: (remember: boolean) => void;
}) {
  const [dontShow, setDontShow] = useState(false);

  // "once" persists on every close; "dismissible" only when the box is ticked;
  // "always" never persists. Shared by the incidental close and the primary CTA.
  const remember = () =>
    popup.mode === "once" || (popup.mode === "dismissible" && dontShow);
  const close = () => onClose(remember());
  const primary = () => onPrimary(remember());

  return (
    <Modal title={popup.header} onClose={close}>
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
          <Label className="notice-dismiss flex cursor-pointer items-center gap-[0.4rem] text-[0.85rem] font-normal text-muted-foreground">
            <Checkbox
              checked={dontShow}
              onCheckedChange={(v) => setDontShow(v === true)}
            />
            Don’t show this again
          </Label>
        )}
        <Button className="notice-ok ml-auto" onClick={primary}>
          {popup.button ?? "OK"}
        </Button>
      </div>
    </Modal>
  );
}
