// PopupModal.tsx — the configurable notice dialog (schema.popup). Reuses the
// shared Modal shell (focus trap, Escape, backdrop) and the Markdown renderer
// so the body supports links and basic formatting. The "dismissible" mode adds
// a "Don't show this again" checkbox; "once" remembers on any close; "always"
// never remembers (it's shown every visit).
import { useState } from "react";
import { Modal } from "./Modal";
import { Markdown } from "./Markdown";
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

  // "once" persists on every close; "dismissible" only when the box is ticked;
  // "always" never persists. Backdrop click, Escape and the X all route here.
  const close = () =>
    onClose(popup.mode === "once" || (popup.mode === "dismissible" && dontShow));

  return (
    <Modal title={popup.header} onClose={close}>
      <div className="modal-body notice-body">
        <Markdown body={popup.body} />
      </div>
      <div className="modal-actions">
        {popup.mode === "dismissible" && (
          <Label className="notice-dismiss cursor-pointer font-normal">
            <Checkbox
              checked={dontShow}
              onCheckedChange={(v) => setDontShow(v === true)}
            />
            Don’t show this again
          </Label>
        )}
        <Button className="notice-ok" onClick={close}>
          OK
        </Button>
      </div>
    </Modal>
  );
}
