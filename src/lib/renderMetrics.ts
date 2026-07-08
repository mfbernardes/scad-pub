// renderMetrics.ts — local-only, in-session render performance telemetry.
// Pure data + functions (mirrors renderStatus.ts): no persistence, no network,
// just enough state to answer "how long did that take, and was it the cache
// or a fresh build?" plus, for the slowest fresh render this session, which
// params had changed since the render before it. Consumed by the Output
// console's Metrics tab (see useRenderPipeline.ts for where it's recorded).
import type { Param } from "../openscad/types";
import type { Values } from "./presets";

export interface RenderMetric {
  ms: number;
  cached: boolean;
  changed: string[];
}

export interface RenderMetrics {
  last: RenderMetric | null;
  slowest: RenderMetric | null;
}

export const emptyMetrics: RenderMetrics = { last: null, slowest: null };

/** "214 ms" under a second, "4.2 s" at or above it. */
export function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/**
 * Human labels (description, falling back to the OpenSCAD variable name) of
 * every param whose value differs between two snapshots, in declaration
 * order. JSON.stringify gives a cheap, stable equality across the value's
 * number/string/boolean shapes without needing a per-type comparator.
 */
export function changedParamLabels(params: Param[], prev: Values, next: Values): string[] {
  const labels: string[] = [];
  for (const p of params) {
    const before = JSON.stringify(prev[p.name] ?? p.default);
    const after = JSON.stringify(next[p.name] ?? p.default);
    if (before !== after) labels.push(p.description || p.name);
  }
  return labels;
}

/**
 * Fold a freshly-finished render into the session's metrics. `last` always
 * becomes the new metric; `slowest` only ever advances to a *fresh* render
 * (cached hits are fast by construction and would just be noise) that took
 * longer than whatever was previously recorded.
 */
export function recordRender(prev: RenderMetrics, metric: RenderMetric): RenderMetrics {
  const slowest =
    !metric.cached && (!prev.slowest || metric.ms > prev.slowest.ms) ? metric : prev.slowest;
  return { last: metric, slowest };
}
