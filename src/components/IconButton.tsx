// IconButton.tsx — a compact icon button with consistent accessibility: an
// aria-label (required) and a tooltip that defaults to the same text.
import type { ReactNode } from "react";

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
    <button
      type="button"
      className={className ? `icon-btn ${className}` : "icon-btn"}
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
