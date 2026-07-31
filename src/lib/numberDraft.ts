// numberDraft.ts: pure logic behind ParamForm's NumberControl — how a numeric
// input's typed text maps to a committed value. Pulled out of the component so
// the commit-gating rule (typedCommitValue) has a unit test that doesn't need
// to render React.
import type { Param, ParamValue } from "../openscad/types";

/** A param's committed value as a finite number, falling back to its default
 *  (e.g. before first entry, or after a value the render pipeline rejected). */
export function committedNumber(param: Extract<Param, { type: "number" }>, value: ParamValue): number {
  return typeof value === "number" && Number.isFinite(value) ? value : param.default;
}

/** Parses a draft input string to a finite number, or null for text that
 *  isn't one yet (blank, "-", a trailing "."). */
export function finiteDraft(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Clamps a value into `param`'s [min, max], where each bound is defined. */
export function clampNumber(param: Extract<Param, { type: "number" }>, value: number): number {
  let v = value;
  if (param.min !== undefined) v = Math.max(param.min, v);
  if (param.max !== undefined) v = Math.min(param.max, v);
  return v;
}

/**
 * The value a keystroke should commit while the field is still focused, or
 * null when nothing should commit yet. Committing a CLAMPED out-of-range
 * draft on every keystroke (the old behaviour) meant typing "25" into a
 * min=10 field committed 10 the instant "2" landed: the live preview jumped
 * mid-type and queued a render for a value the visitor never asked for. Only
 * a draft already within range commits — needing no clamping, so the return
 * is the parsed value itself. Blur/Enter still clamp-and-commit whatever's
 * left typed, in NumberControl's own handler.
 */
export function typedCommitValue(param: Extract<Param, { type: "number" }>, raw: string): number | null {
  const n = finiteDraft(raw);
  if (n === null) return null;
  return n === clampNumber(param, n) ? n : null;
}
