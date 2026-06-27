// IconButton.tsx — a compact icon button with consistent accessibility: an
// aria-label (required) and a tooltip (native title) that defaults to the same
// text. Built on the shadcn/ui Button (Radix Slot-based) for focus-ring and
// disabled handling; keeps the `icon-btn` class so context-specific styling
// (viewer HUD glass, command-bar pills, …) continues to apply.
import type { ReactNode } from "react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

interface Props {
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function IconButton({
  label,
  title,
  onClick,
  disabled,
  className,
  children,
}: Props) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("icon-btn size-8", className)}
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}
