// haptics.ts — tiny vibration feedback for touch interactions. Android fires
// navigator.vibrate; iOS ignores it (no-op there). Stays silent when the API is
// unavailable or the user prefers reduced motion, so it never becomes an
// accessibility nuisance.
export function tapFeedback(durationMs = 10): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    navigator.vibrate(durationMs);
  } catch {
    /* vibration is best-effort feedback — ignore any failure */
  }
}
