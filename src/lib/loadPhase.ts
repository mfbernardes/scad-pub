// loadPhase.ts — pure model for the pre-first-render lifecycle shown by
// ViewerStage's loading overlay: "engine" (the render worker is
// downloading/starting the WASM engine) -> "render" (the engine is up and the
// first preview is being built) -> "done" (a first render has landed; the
// overlay is gone and StaleBanner/the updating chip take over for any later
// re-render). Kept dependency-free (no React, no schema import) so it's
// trivially unit-testable — see tests/loadPhase.test.mjs.
import type { WorkerProgress } from "../openscad/types";
import type { Vars } from "./i18n";

export type LoadPhase = "engine" | "render" | "done";

/**
 * Derive the current phase from the same three booleans ViewerStage already
 * has (ready/rendering/hasResult — mirrors the overlay-visibility condition
 * that predates this file: `!ready || (rendering && !result)`). `hasResult`
 * means "a render attempt — success or failure — has landed for the current
 * view", not "the last render succeeded": a failed first render still ends
 * the "render" phase (the overlay hands off to the failure UI, not to itself).
 */
export function derivePhase(args: {
  ready: boolean;
  rendering: boolean;
  hasResult: boolean;
}): LoadPhase {
  if (!args.ready) return "engine";
  if (args.rendering && !args.hasResult) return "render";
  return "done";
}

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** Human-readable byte size, e.g. `formatBytes(7_400_000)` -> "7.1 MB". One
 *  decimal place below 10 units, none at or above (matches how file sizes are
 *  conventionally shown — "9.5 MB" but "23 MB", not "23.0 MB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const decimals = value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} ${BYTE_UNITS[unit]}`;
}

/** What the engine phase's progress bar should show. `fraction` is null for
 *  an indeterminate bar (no known total, or no progress reported yet — e.g.
 *  a Cache Storage hit, which posts no progress messages at all). */
export function engineProgressFraction(progress: WorkerProgress | null): number | null {
  if (!progress || !progress.total) return null;
  return Math.max(0, Math.min(1, progress.loaded / progress.total));
}

export interface PhaseCopy {
  /** The overlay's headline for this phase (empty once phase is "done" — the
   *  overlay itself is not rendered then, so this is never actually shown). */
  title: string;
  /**
   * The "one-time download — about N MB" line, or null when it shouldn't be
   * shown. Only appears during a REAL download (a progress message has
   * actually arrived) so a warm Cache Storage hit — which loads near
   * instantly and posts no progress at all — never flashes a size line for a
   * download that isn't happening.
   */
  sizeLine: string | null;
}

/**
 * Build the overlay's copy for the current phase. `t` is the app's i18n
 * `t()` (dependency-injected so this stays schema/DOM-free for tests).
 */
export function phaseCopy(
  phase: LoadPhase,
  progress: WorkerProgress | null,
  engineBytes: number | undefined,
  t: (key: string, vars?: Vars) => string
): PhaseCopy {
  if (phase === "render") return { title: t("viewer.building"), sizeLine: null };
  if (phase === "done") return { title: "", sizeLine: null };
  // "engine"
  const sizeLine =
    progress && engineBytes
      ? t("loading.downloadSize", { size: formatBytes(engineBytes) })
      : null;
  return { title: t("loading.preparingEngine"), sizeLine };
}
