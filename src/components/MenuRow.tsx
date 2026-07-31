// MenuRow.tsx: one row of a popover menu: an icon, a label, and whatever the
// caller puts after them. The app has several popover menus (the top bar's "⋮"
// overflow, the viewer's collapsed "View options", the section navigator, the
// preset footer's "⋮") and they were each spelling the same row out by
// hand, which is how two of them had already drifted on the active/disabled
// treatment.
//
// Exported as BOTH a component and a class string, the same pairing
// IconButton.tsx uses (see ICON_BUTTON_CLASS's own doc): a caller that has to
// render something other than a plain <button>. A <Label> wrapping a Switch,
// a Radix trigger that owns its own element. Takes the class and keeps the
// look without contorting itself into this component.
import type { ReactNode } from "react";
import { cn } from "../lib/utils";

/** The shared row look. Includes the disabled treatment, so a row that can be
 *  disabled needs nothing extra. */
export const MENU_ROW_CLASS =
  "flex w-full items-center gap-2 rounded-(--radius-sm) px-2 py-[0.45rem] text-left text-[0.9rem] text-foreground cursor-pointer hover:bg-muted focus-visible:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

interface Props {
  /** The row's visible text, and its accessible name. */
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /**
   * For a row that toggles rather than acts: announces on/off state to
   * assistive tech, and marks the row when on. A toggle row usually should NOT
   * close its menu: the visitor wants to see the result and often flip it
   * straight back, which is the caller's decision, not this component's.
   */
  pressed?: boolean;
  /** Leading icon. Sized by the caller (16px matches the rows in use). */
  icon?: ReactNode;
  /** Trailing content: a Switch, a shortcut hint, a badge. */
  children?: ReactNode;
  className?: string;
  /** Overrides the accessible name when `label` isn't plain text. */
  "aria-label"?: string;
}

export function MenuRow({
  label,
  onClick,
  disabled,
  pressed,
  icon,
  children,
  className,
  "aria-label": ariaLabel,
}: Props) {
  return (
    <button
      type="button"
      className={cn(MENU_ROW_CLASS, pressed && "text-brand font-medium", className)}
      aria-pressed={pressed}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {label}
      {children}
    </button>
  );
}
