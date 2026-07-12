// visibility.ts — evaluate a parameter's `@showIf` expression against the
// current values to decide whether its control is shown. Deliberately tiny and
// safe (no eval): an OR of ANDs of simple clauses. Hidden parameters are still
// sent to OpenSCAD unchanged — visibility is a UI nicety only.
//
// M9: gen-schema.mjs (scripts/lib/params.mjs) is the PRIMARY gate — it rejects
// an unsupported clause shape (a relational operator, stray tokens, …) at
// generate time, so a shipped schema.json's showIf strings are always
// well-formed. The strict clause regexes here mirror that build-time grammar
// as defense-in-depth: evalClause throws on anything outside the supported
// shapes instead of silently reading it as an unknown, always-falsy lookup,
// and isVisible's catch is the actual fail-safe for that (e.g. a schema built
// by an older/bypassed generator).
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

// Supported clause shapes — same grammar scripts/lib/params.mjs validates at
// generate time. Anything else (a relational operator, malformed syntax) is
// NOT a recognised comparison and NOT treated as a falsy bare lookup: it
// throws, so callers can tell "hidden" apart from "malformed".
const BARE_RE = /^!?[A-Za-z_]\w*$/;
const CMP_RE = /^([A-Za-z_]\w*)\s*(==|!=)\s*(.+)$/;

function evalClause(clause: string, values: Values): boolean {
  const c = clause.trim();
  if (!c) return true;
  const cmp = c.match(CMP_RE);
  if (cmp) {
    const [, name, op, rhs] = cmp;
    // Compare stringified to handle enum/number/bool uniformly.
    const equal = String(values[name]) === String(coerce(rhs));
    return op === "==" ? equal : !equal;
  }
  if (BARE_RE.test(c)) {
    if (c.startsWith("!")) return !truthy(values[c.slice(1).trim()]);
    return truthy(values[c]);
  }
  throw new Error(`unsupported @showIf clause: ${c}`);
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
