// ExplainedDisabledButton.tsx: the "disabled with an explanation" pattern
// shared by the export dock's Download button (ActionButtons) and the
// Review dialog's own Download button. A disabled <button> fires no pointer
// events, so `title` alone never reaches a sighted visitor hovering it: the
// explanation lives on a wrapping <span title>. Assistive tech instead needs
// an `aria-describedby`'d sr-only note, published under `hintId`. Keeping
// both call sites on one component means the pattern can't drift between
// them.
import type { ComponentProps, ReactNode } from "react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

interface Props extends Omit<ComponentProps<typeof Button>, "disabled" | "aria-describedby"> {
  /** Why the button is disabled, or null when it isn't. Drives `disabled`,
   *  the wrapping span's `title`, and the sr-only note at `hintId`. */
  reason: string | null;
  /** id the sr-only reason span publishes under, and the button's
   *  `aria-describedby` points at while disabled. Callers keep their own
   *  ids, since two of these can be mounted at once (dock + Review dialog). */
  hintId: string;
  /** `aria-describedby` to use while NOT disabled, for a caller with an
   *  unrelated hint of its own (e.g. ActionButtons' attention-count note). */
  ariaDescribedBy?: string;
  /** Extra classes on the wrapping <span>, beyond the shared "inline-flex min-w-0". */
  wrapperClassName?: string;
  children: ReactNode;
}

export function ExplainedDisabledButton({
  reason,
  hintId,
  ariaDescribedBy,
  wrapperClassName,
  children,
  ...buttonProps
}: Props) {
  return (
    <>
      <span className={cn("inline-flex min-w-0", wrapperClassName)} title={reason ?? undefined}>
        <Button {...buttonProps} disabled={!!reason} aria-describedby={reason ? hintId : ariaDescribedBy}>
          {children}
        </Button>
      </span>
      {reason && (
        <span id={hintId} className="sr-only">
          {reason}
        </span>
      )}
    </>
  );
}
