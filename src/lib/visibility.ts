// visibility.ts — evaluate a parameter's `@showIf` expression against the
// current values to decide whether its control is shown. Deliberately tiny and
// safe (no eval): an OR of ANDs of simple clauses. Hidden parameters are still
// sent to OpenSCAD unchanged — visibility is a UI nicety only.
import type { Param } from "../openscad/types";
import type { Values } from "./presets";

function truthy(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v !== "" && v !== "false" && v !== "0";
  return v != null;
}

// "direction" | 'direction' | direction -> direction ; true/false/number kept.
function coerce(token: string): string | number | boolean {
  const t = token.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t.replace(/^["']|["']$/g, "");
}

function evalClause(clause: string, values: Values): boolean {
  const c = clause.trim();
  if (!c) return true;
  const cmp = c.match(/^([A-Za-z_]\w*)\s*(==|!=)\s*(.+)$/);
  if (cmp) {
    const [, name, op, rhs] = cmp;
    // Compare stringified to handle enum/number/bool uniformly.
    const equal = String(values[name]) === String(coerce(rhs));
    return op === "==" ? equal : !equal;
  }
  if (c.startsWith("!")) return !truthy(values[c.slice(1).trim()]);
  return truthy(values[c]);
}

/** Evaluate an `@showIf` expression: `a || b && c` == `(a) || (b && c)`. */
export function evalShowIf(expr: string, values: Values): boolean {
  return expr
    .split("||")
    .some((term) => term.split("&&").every((clause) => evalClause(clause, values)));
}

/** Whether a parameter's control should be shown for the current values. */
export function isVisible(param: Param, values: Values): boolean {
  if (!param.showIf) return true;
  try {
    return evalShowIf(param.showIf, values);
  } catch {
    return true; // a malformed condition must never hide everything
  }
}
