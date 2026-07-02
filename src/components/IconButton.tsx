// IconButton.tsx — a compact icon button with consistent accessibility: an
// aria-label (required) and a tooltip (native title) that defaults to the same
// text. Built on the shadcn/ui Button (Radix Slot-based) for focus-ring and
// disabled handling. Context-specific styling (viewer HUD glass, …) comes in
// via className and wins through tailwind-merge; `icon-btn` stays as an inert
// semantic hook for tests/extraCss.
import type { ReactNode } from "react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

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
      className={cn("icon-btn size-8 p-[0.35rem] bg-muted border hover:border-brand", className)}
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
