// Modal.tsx — shared dialog shell: backdrop, focus-trapped container (useDialog
// handles Escape + focus management), and a titled header with a close button.
// The body is provided as children.
import type { ReactNode } from "react";
import { useDialog } from "../lib/useDialog";
import { IconButton } from "./IconButton";

interface Props {
  title: string;
  /** Accessible name for the dialog; defaults to the title. */
  label?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, label, onClose, children }: Props) {
  const dialogRef = useDialog<HTMLDivElement>(onClose);
  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={label ?? title}
    >
      <div
        className="modal"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            ✕
          </IconButton>
        </header>
        {children}
      </div>
    </div>
  );
}
