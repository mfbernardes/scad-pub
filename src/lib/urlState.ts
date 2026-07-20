// urlState.ts — shareable + persistent session state. The current design and
// the parameters that differ from its defaults are encoded into the URL hash
// (so a link reproduces an exact configuration) and mirrored to localStorage
// (so a plain reload of the bare URL restores the last session).
import type { Design, Schema } from "../openscad/types";
import { fromPresetString } from "./scad";
import { defaultsFor, type Values } from "./presets";
import { ns } from "./appId";
import { readLocal, writeLocal } from "./safeStorage";

const STORE_KEY = ns("session.v1");

export interface SessionState {
  designId: string;
  values: Values;
  /** The namespaced selected-preset id ("bundled:Name" / "user:Name"), or "". */
  preset: string;
}

// Only the values that differ from the design's defaults — keeps the hash short.
function diffFromDefaults(design: Design, values: Values): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of design.params) {
    const v = values[p.name];
    if (v !== undefined && v !== p.default) out[p.name] = v;
  }
  return out;
}

// Defaults overlaid with a stored diff, coerced back to each param's type.
function applyDiff(design: Design, diff: Record<string, unknown>): Values {
  const values = defaultsFor(design);
  for (const p of design.params) {
    if (Object.prototype.hasOwnProperty.call(diff, p.name)) {
      values[p.name] = fromPresetString(p, String(diff[p.name]));
    }
  }
  return values;
}

function findDesign(schema: Schema, id: string | null): Design | undefined {
  return id ? schema.designs.find((d) => d.id === id) : undefined;
}

// M4: shared by the initial-load reader below AND by App's external-navigation
// consumer (hashchange / launchQueue) — both need to parse the same "d=/v=/p="
// encoding from an arbitrary hash string, not just `location.hash` at module
// init, so a same-document hash change or an installed-app launch target can
// be applied after the app has already booted.
export function parseHashState(schema: Schema, hash: string): SessionState | null {
  if (!hash) return null;
  try {
    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    const design = findDesign(schema, params.get("d"));
    if (!design) return null;
    const diff = params.get("v") ? JSON.parse(params.get("v")!) : {};
    return {
      designId: design.id,
      values: applyDiff(design, diff),
      preset: params.get("p") ?? "",
    };
  } catch {
    return null;
  }
}

function fromHash(schema: Schema): SessionState | null {
  return parseHashState(schema, location.hash);
}

/**
 * True when `hash` names a `d=<id>` design that ISN'T in this schema — a
 * stale/broken deep link (a design renamed or removed since the link was
 * shared). `parseHashState` already treats this the same as no hash at all
 * (falls back to the stored session, then defaults), which is the right
 * runtime behavior; this is a separate, narrower check so App.tsx can additionally
 * surface it — the DesignPickerDialog opens once on load with a short
 * explanation instead of silently substituting a different design. A hash with
 * no `d=` at all (or an empty hash) is not "broken", just absent, so this
 * returns false for both.
 */
export function hashDesignIdMissing(schema: Schema, hash: string): boolean {
  if (!hash) return false;
  try {
    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    const id = params.get("d");
    return id !== null && !schema.designs.some((d) => d.id === id);
  } catch {
    return false;
  }
}

/**
 * True when `hash` already names a design (`d=<id>`, valid or not) — i.e.
 * this load arrived via a deep link or a share link rather than a bare visit
 * to the app's root URL. Used by the welcome design picker (`popup.mode:
 * "picker"` — see src/lib/popup.ts's `resolvePopupSurface`) to skip itself on
 * such a visit: a link that already names a design means the visitor already
 * chose, so a "choose a design" dialog is the wrong first interaction. Unlike
 * `hashDesignIdMissing`, this doesn't check the id against the schema — ANY
 * `d=` counts, valid or stale, since either way a choice was already made.
 */
export function hashHasDesignId(hash: string): boolean {
  if (!hash) return false;
  try {
    return new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash).has("d");
  } catch {
    return false;
  }
}

/**
 * M4: is `next` a no-op relative to `current`? Used as the external-navigation
 * loop guard in App.tsx — a `hashchange`/`launchQueue` target that already
 * matches the live design/values/preset should not trigger a redundant
 * design-switch reset. Pure so the guard is directly unit-testable without
 * mounting React. Value equality is by JSON shape, not reference — both sides
 * are always built by `defaultsFor`/`applyDiff` over the same param list, so
 * key order (and therefore JSON.stringify output) is stable for equal values.
 */
export function sessionStateEquals(current: SessionState, next: SessionState): boolean {
  return (
    current.designId === next.designId &&
    current.preset === next.preset &&
    JSON.stringify(current.values) === JSON.stringify(next.values)
  );
}

function fromStore(schema: Schema): SessionState | null {
  try {
    const raw = readLocal(STORE_KEY);
    if (!raw) return null;
    const { designId, diff, preset } = JSON.parse(raw);
    const design = findDesign(schema, designId);
    if (!design) return null;
    return {
      designId: design.id,
      values: applyDiff(design, diff ?? {}),
      preset: preset ?? "",
    };
  } catch {
    return null;
  }
}

/** Initial state on load: URL hash wins, then last session, then defaults. The
 *  no-link default is the configured `defaultDesign`, else the first design. */
export function readInitialState(schema: Schema): SessionState {
  // find() returns undefined when defaultDesign is unset (no id === undefined),
  // so the ?? fallback to the first design covers the no-default case too.
  const design0 =
    schema.designs.find((d) => d.id === schema.defaultDesign) ?? schema.designs[0];
  return (
    fromHash(schema) ??
    fromStore(schema) ?? {
      designId: design0.id,
      values: defaultsFor(design0),
      preset: "",
    }
  );
}

// The single source of the "d=/v=/p=" hash encoding, shared by `persistState`
// (debounced, mirrors to the URL bar + localStorage) and `buildShareUrl`
// (synchronous, used by Share) — see docs/architecture-review.md H2. Reusing
// one function means the two can never encode a design's state differently.
function buildShareState(design: Design, values: Values, preset: string) {
  const diff = diffFromDefaults(design, values);
  const params = new URLSearchParams({ d: design.id });
  if (Object.keys(diff).length) params.set("v", JSON.stringify(diff));
  if (preset) params.set("p", preset);
  return { diff, params };
}

/** Write the current state to the URL hash and localStorage (no history entry). */
export function persistState(design: Design, values: Values, preset = "") {
  const { diff, params } = buildShareState(design, values, preset);
  // The localStorage mirror always runs, even if the history update below is
  // throttled away, so a reload still restores the latest state.
  writeLocal(STORE_KEY, JSON.stringify({ designId: design.id, diff, preset }));
  try {
    history.replaceState(null, "", "#" + params.toString());
  } catch {
    // Safari throws SecurityError past ~100 replaceState calls in 30s; rhythmic
    // stepper nudging at the 300ms debounce (~3.3/s) can cross that. Dropping
    // this particular hash update is harmless — the next call, or the
    // localStorage mirror above, keeps state in sync.
  }
}

/**
 * The share URL for the CURRENT design/values/preset, built synchronously —
 * unlike `persistState`, which is debounced 300ms behind React state, this
 * must never lag an edit (docs/architecture-review.md H2: a quick edit-then-
 * Share must not copy the pre-edit URL). Only `location.origin`/`pathname`/
 * `search` are read, since those aren't debounced or state-derived — the hash
 * itself is always rebuilt from the arguments, never from `location.hash`.
 */
export function buildShareUrl(design: Design, values: Values, preset = ""): string {
  const { params } = buildShareState(design, values, preset);
  return `${location.origin}${location.pathname}${location.search}#${params.toString()}`;
}
