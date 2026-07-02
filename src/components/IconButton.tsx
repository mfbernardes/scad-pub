// IconButton.tsx — a compact icon button with consistent accessibility: an
// aria-label (required) and a tooltip (native title) that defaults to the same
// text. Built on the shadcn/ui Button (Radix Slot-based) for focus-ring and
// disabled handling. Context-specific styling (viewer HUD glass, …) comes in
// via className and wins through tailwind-merge; `icon-btn` stays as an inert
// semantic hook for tests/extraCss.
import type { ReactNode } from "react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

// The top-bar / panel icon-button look (bordered, muted fill). Exported so the
// few icon controls that can't be an IconButton — e.g. a Popover trigger, which
// needs a ref the shadcn Button doesn't forward — match it without repeating it.
export const ICON_BUTTON_CLASS = "icon-btn size-8 p-[0.35rem] bg-muted border hover:border-brand";

interface Props {
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  /** For toggle buttons: announces on/off state to assistive tech. */
  pressed?: boolean;
  children: ReactNode;
}

export function IconButton({
  label,
  title,
  onClick,
  disabled,
  className,
  pressed,
  children,
}: Props) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(ICON_BUTTON_CLASS, className)}
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}
