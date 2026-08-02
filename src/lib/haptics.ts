// haptics.ts: tiny vibration feedback for touch interactions. Android fires
// navigator.vibrate; iOS ignores it (no-op there). Stays silent when the API is
// unavailable or the user prefers reduced motion, so it never becomes an
// accessibility nuisance.
import { prefersReducedMotion } from "./matchMedia";

export function tapFeedback(durationMs = 10): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    if (prefersReducedMotion()) return;
    navigator.vibrate(durationMs);
  } catch {
    /* vibration is best-effort feedback: ignore any failure */
  }
}
