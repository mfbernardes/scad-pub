// ConfirmDialog.tsx: the title/description/Cancel/Action AlertDialog
// scaffold shared by every confirm-before-destructive-action prompt
// (ResetButton's "Reset to defaults?", and PresetPicker's delete / save
// collision / import collision dialogs), so the four can't drift on
// structure.
import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  cancelLabel: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onConfirm,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {/* No onOpenAutoFocus override here, unlike Modal/DesignPicker: this
          dialog holds nothing but buttons, so there is no keyboard for
          autofocus to pop over it, and suppressing Radix's focus transfer only
          leaves a screen-reader or hardware-keyboard visitor focused behind a
          destructive confirmation. */}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
