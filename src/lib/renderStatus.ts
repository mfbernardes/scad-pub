// renderStatus.ts — the render-status state machine, shared by whatever chrome
// surfaces it. Currently the Output bell (OutputToggle) wears it as a corner
// dot; kept framework-free (pure data + a derive function) so any indicator can
// read the same states without drift.
import type { RenderResult } from "../openscad/types";

export type RenderState = "idle" | "loading" | "rendering" | "ok" | "error" | "stale";

export interface RenderStatusInput {
  rendering: boolean;
  ready: boolean;
  result: RenderResult | null;
  /** Auto-render off AND params changed since the last render — preview is out of date. */
  stale?: boolean;
}

/* The dot's literal green/red match the pre-port palette in BOTH themes (the
   light-theme --danger is darker); kept literal for pixel fidelity. */
export const STATE_STYLES: Record<RenderState, { pill?: string; dot: string; pulse?: boolean }> = {
  idle: { pill: "text-muted-foreground", dot: "bg-muted-foreground" },
  loading: { dot: "bg-muted-foreground", pulse: true },
  rendering: { dot: "bg-brand", pulse: true },
  ok: { dot: "bg-[#4ade80]" },
  stale: { pill: "text-warn", dot: "bg-warn", pulse: true },
  error: { pill: "text-[#f87171]", dot: "bg-[#f87171]" },
};

/** Derive the render state + its human text from the raw flags. */
export function deriveRenderStatus({ rendering, ready, result, stale = false }: RenderStatusInput): {
  state: RenderState;
  text: string;
} {
  if (!ready) return { state: "loading", text: "Loading renderer…" };
  if (rendering) return { state: "rendering", text: "Rendering…" };
  // The preview no longer matches the controls — surfaced before "ok" so a
  // happy green "214 ms" never masks unrendered changes.
  if (stale) return { state: "stale", text: "Preview out of date" };
  if (!result) return { state: "idle", text: "Idle" };
  if (result.ok)
    return { state: "ok", text: result.cached ? `${result.ms} ms (cached)` : `${result.ms} ms` };
  return { state: "error", text: `Failed (exit ${result.exitCode})` };
}
