// utils.ts — the shadcn/ui `cn` helper: merge conditional class names and
// de-duplicate conflicting Tailwind utilities (last-wins).
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
