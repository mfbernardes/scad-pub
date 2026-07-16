// quickStart.ts — pure step-derivation logic behind the QuickStart navigation
// (src/components/QuickStart.tsx): which of a stepped design's `@step`s are
// currently showable, which one should be "current" after a value change
// makes the previous current step disappear, and which un-stepped sections
// belong in the "Also available" tail below the current step. Kept
// dependency-free (no React) so tests/quickStart.test.mjs can exercise every
// branch directly — mirroring src/lib/paramFilter.ts's own split from its
// React consumers.
import type { Design } from "../openscad/types";
import type { Values } from "./presets";
import type { ExperienceMode, SettingsView } from "./useExperience";
import { isShown } from "./paramFilter";

export type QuickStartStep = NonNullable<Design["steps"]>[number];

/** Sentinel id for the trailing "Export" chip — not a real `@step` id (those
 *  are validated at build time to be `[A-Za-z0-9_-]+`, so this deliberately
 *  isn't shaped like one and can never collide with an authored id). */
export const EXPORT_STEP_ID = "__export__";

function sectionHasVisibleParam(
  design: Design,
  sectionNames: ReadonlySet<string>,
  values: Values,
  view: SettingsView
): boolean {
  return design.params.some((p) => sectionNames.has(p.section) && isShown(p, values, view));
}

/**
 * The design's `@step`s that currently have at least one visible parameter
 * control, in declared step order. A step whose every parameter is hidden by
 * `@showIf` or demoted by the settings view is skipped entirely — rendering
 * it as a chip would land on an empty step with nothing to show. Recompute
 * whenever `design`, `values`, or `view` change: a value change can reveal or
 * hide a `@showIf`-conditional param and so flip a step's visibility either
 * way, in either direction.
 */
export function visibleSteps(design: Design, values: Values, view: SettingsView): QuickStartStep[] {
  const steps = design.steps ?? [];
  return steps.filter((step) => sectionHasVisibleParam(design, new Set(step.sections), values, view));
}

/**
 * Section names NOT covered by any `@step`, in the design's own section
 * order — the candidate pool for QuickStart's "Also available" tail (further
 * filtered by `isShown` per parameter, same as every other section, so an
 * all-`@advanced` un-stepped section still stays behind the All settings
 * view exactly like an advanced param anywhere else).
 */
export function unsteppedSectionNames(design: Design): string[] {
  const stepped = new Set((design.steps ?? []).flatMap((s) => s.sections));
  return design.sections.filter((s) => !stepped.has(s));
}

/**
 * Whether any un-stepped section currently has a visible parameter — gates
 * whether QuickStart's "Also available" heading + section list renders at
 * all below the current step, as opposed to an empty heading over nothing
 * (e.g. every un-stepped section is `@advanced` in the essentials view,
 * tag.scad's own dogfood case).
 */
export function hasVisibleUnstepped(design: Design, values: Values, view: SettingsView): boolean {
  return sectionHasVisibleParam(design, new Set(unsteppedSectionNames(design)), values, view);
}

/**
 * Resolves which step/chip should be "current" given the previously-current
 * id (a real step id, `EXPORT_STEP_ID`, or null on first mount for the
 * design) and the step list currently visible (see `visibleSteps`):
 *
 *  - the Export chip is never hidden, so a previous `EXPORT_STEP_ID` always
 *    stays put;
 *  - a previous step id that's still visible stays put;
 *  - otherwise (the previous current step just disappeared), fall back to
 *    the visible step whose ORIGINAL declared index (in `design.steps`, not
 *    the filtered list) is closest to the previous step's — the "nearest
 *    remaining step", not always snapping back to the first one;
 *  - when no step is visible at all (every step's params got hidden), falls
 *    back to the Export chip — there's nothing else left to show.
 *
 * `currentId` should be null only on a genuine first mount for this design;
 * callers reset to the first visible step on a design SWITCH themselves
 * rather than relying on this fallback for that case (see QuickStart.tsx).
 */
export function resolveCurrentStep(
  design: Design,
  visible: QuickStartStep[],
  currentId: string | null
): string {
  if (currentId === EXPORT_STEP_ID) return EXPORT_STEP_ID;
  if (currentId && visible.some((s) => s.id === currentId)) return currentId;
  if (visible.length === 0) return EXPORT_STEP_ID;
  const allSteps = design.steps ?? [];
  const prevIndex = currentId ? allSteps.findIndex((s) => s.id === currentId) : -1;
  if (prevIndex === -1) return visible[0].id;
  let best = visible[0];
  let bestDist = Infinity;
  for (const step of visible) {
    const idx = allSteps.findIndex((s) => s.id === step.id);
    const dist = Math.abs(idx - prevIndex);
    if (dist < bestDist) {
      bestDist = dist;
      best = step;
    }
  }
  return best.id;
}

/**
 * Desktop scroll mode (QuickStart.tsx's `variant="scroll"`) mounts every
 * visible step's group in one scrollable flow instead of showing one step at
 * a time, so "current" (the chip carrying `aria-current="step"`) has to be
 * derived from scroll position instead of navigation state. QuickStart wires
 * an IntersectionObserver over each step-group heading (plus the trailing
 * Export heading), tuned with a `rootMargin` that only counts a thin band
 * near the scroll container's top as "visible" (see its own comment for the
 * exact margin) — so as a visitor scrolls down, group headings cross that
 * band and flip in and out of `intersecting` one at a time in step order.
 *
 * This is the pure mapping from that observer state to a step id: `order` is
 * every candidate id in declared order (steps, then `EXPORT_STEP_ID` last —
 * the same shape as QuickStart's own `stepOrder`), and `intersecting` is the
 * set of ids CURRENTLY inside the band. Multiple ids can be intersecting at
 * once (a short step's group can fully fit inside the band while a neighbour
 * is still entering/leaving it), so this resolves the ambiguity by picking
 * the LAST one in `order` — the step whose heading has scrolled furthest
 * down past the band, matching what a visitor reading near the top of the
 * panel is actually looking at. Returns null when nothing intersects (e.g.
 * between two groups mid-scroll, or before the observer's first callback),
 * letting the caller keep whatever was current rather than snapping to a
 * wrong fallback.
 */
export function currentStepFromIntersections(
  order: readonly string[],
  intersecting: ReadonlySet<string>
): string | null {
  for (let i = order.length - 1; i >= 0; i--) {
    if (intersecting.has(order[i])) return order[i];
  }
  return null;
}

/**
 * Whether QuickStart should render at all in place of the classic form: ALL
 * of guided experience, the essentials settings view, a design that
 * declares at least one `@step`, and the build's `ui.quickStart` opt-out
 * (default true — declaring steps at all is the opt-in). An active search
 * query is handled by the caller (CustomizeTab), not here: it always shows
 * the classic filtered form regardless of this result, for the query's
 * duration — see CustomizeTab's own comment on why search bypasses steps.
 */
export function quickStartAvailable(
  design: Design,
  experienceMode: ExperienceMode,
  settingsView: SettingsView,
  quickStartEnabled: boolean
): boolean {
  return (
    experienceMode === "guided" &&
    settingsView === "essentials" &&
    (design.steps?.length ?? 0) > 0 &&
    quickStartEnabled
  );
}
