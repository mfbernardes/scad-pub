// scad.ts — convert UI parameter values to/from OpenSCAD -D expressions and the
// string form used by OpenSCAD's Customizer preset (parameterSets) JSON.
import type { Param, ParamValue } from "../openscad/types";

export function escapeScadString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/** Full SCAD expression for `-D name=<expr>` (strings/enums are quoted). */
export function toScadExpr(param: Param, value: ParamValue): string {
  switch (param.type) {
    case "number":
      return String(
        typeof value === "number" && Number.isFinite(value) ? value : param.default
      );
    case "boolean":
      return value ? "true" : "false";
    case "enum":
    case "string":
      return `"${escapeScadString(String(value))}"`;
  }
}

/** OpenSCAD's parameterSets stores every value as a plain (unquoted) string. */
export function toPresetString(param: Param, value: ParamValue): string {
  if (param.type === "boolean") return value ? "true" : "false";
  return String(value);
}

/**
 * Parse a parameterSets string back into a typed value for the given param,
 * validating it against the schema. Values come from sharable URL hashes,
 * localStorage and imported preset files, so an out-of-range number or an enum
 * value outside the declared choices is rejected (falls back to the default /
 * clamped to range) — matching what the UI controls themselves enforce.
 */
export function fromPresetString(param: Param, raw: string): ParamValue {
  switch (param.type) {
    case "number": {
      const n = Number(raw);
      if (Number.isNaN(n)) return param.default;
      let v = n;
      if (param.min !== undefined) v = Math.max(param.min, v);
      if (param.max !== undefined) v = Math.min(param.max, v);
      return v;
    }
    case "boolean":
      return raw === "true" || raw === "1";
    case "enum":
      // Reject values outside the declared choices. (When choices are absent —
      // only the synthetic params in tests — accept the raw value.)
      return !param.choices || param.choices.some((c) => c.value === raw)
        ? raw
        : param.default;
    case "string":
      return raw;
  }
}

/**
 * Skew guard. The parameter *schema* is compiled into the JS bundle, but each
 * design's `.scad` source is fetched fresh at runtime. A stale cached bundle
 * (e.g. a service worker that hasn't picked up a deploy) can ask OpenSCAD to
 * `-D` a parameter the current source no longer declares — which OpenSCAD
 * reports as a confusing "unknown variable" warning. Return the define names
 * that don't appear as a top-level assignment in the source so the caller can
 * drop them and prompt the user to reload instead.
 *
 * Customizer parameters are top-level `name = …;` assignments whose name follows
 * OpenSCAD's identifier grammar (so the name needs no regex escaping). The
 * negative lookahead avoids matching an `==` comparison, and matching at any
 * indentation only errs toward "present", i.e. we flag a define only when its
 * name is genuinely absent.
 */
export function orphanedDefines(
  defineNames: Iterable<string>,
  source: string
): string[] {
  return [...defineNames].filter(
    (name) => !new RegExp(`^\\s*${name}\\s*=(?!=)`, "m").test(source)
  );
}
