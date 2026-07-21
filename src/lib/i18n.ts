// i18n.ts — minimal, dependency-free translation layer. Phase 5 scope is
// deliberately a SUBSET of a full i18n system: English-only, one bundle
// (src/locales/en.json), no locale switching, no generated locales.json. The
// flat dot-namespaced key -> string bundle is the source of truth; `t()`
// resolves a key through config `strings` override -> the bundle -> the bare
// key, and `tn()` layers CLDR plural-category selection on top (`${key}#one`
// / `${key}#other` — the only two categories English needs). See
// docs/config.md's `strings` section for the operator-facing override
// surface (schema.strings, validated by scripts/lib/config-parsers.mjs's
// parseStrings against src/locales/en.json).
//
// `makeT` is the pure, testable factory (no schema/JSON coupling — tests hand
// it a synthetic bundle). The module-level `t`/`tn` exports below bind it to
// the generated schema's `strings` override, which is what the app imports.
//
// The `{ type: "json" }` import attribute is required because this module is
// also imported directly by tests/i18n.test.mjs through the TS-source
// node:test loader (see tests/ts-resolve.mjs), which falls through to Node's
// own ESM loader for `.json` specifiers — Node requires the attribute for a
// native JSON import. Vite's bundler accepts the same syntax, so one import
// works in both places.
import en from "../locales/en.json" with { type: "json" };
import schemaJson from "../generated/designs.json" with { type: "json" };
import type { Schema } from "../openscad/types";

export type Bundle = Record<string, string>;
export type Vars = Record<string, string | number>;

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    hasOwn(vars, name) ? String(vars[name]) : whole
  );
}

/**
 * Pure factory behind the default `t`/`tn` exports: given the bundled English
 * catalogue and an optional config `strings` override map, returns bound
 * `t`/`tn` functions. Kept dependency-free and schema-agnostic so tests can
 * drive it with a synthetic bundle instead of the real one.
 */
export function makeT(bundle: Bundle, overrides: Bundle = {}) {
  function resolve(key: string): string | undefined {
    if (hasOwn(overrides, key)) return overrides[key];
    if (hasOwn(bundle, key)) return bundle[key];
    return undefined;
  }

  function t(key: string, vars?: Vars): string {
    const value = resolve(key);
    if (value === undefined) {
      // import.meta.env is Vite-injected (undefined under node:test, where the
      // optional chain below is a no-op) — warn only in dev builds, matching
      // e.g. src/lib/swUpdate.ts's import.meta.env.PROD check.
      if (import.meta.env?.DEV) console.warn(`i18n: missing key "${key}"`);
      return key;
    }
    return interpolate(value, vars);
  }

  function tn(key: string, count: number, vars?: Vars): string {
    let category: string;
    try {
      category = new Intl.PluralRules("en").select(count);
    } catch {
      category = "other";
    }
    const merged: Vars = { ...vars, count };
    const withCategory = `${key}#${category}`;
    if (resolve(withCategory) !== undefined) return t(withCategory, merged);
    const withOther = `${key}#other`;
    if (resolve(withOther) !== undefined) return t(withOther, merged);
    // Neither the selected category nor #other exists: fall through to a
    // plain t() on the bare key so the missing-key warning/fallback applies.
    return t(key, merged);
  }

  return { t, tn };
}

// Route through `unknown`: the generated JSON is validated at runtime by
// schema.ts; a direct `as Schema` structural-checks the raw literal, which a
// deployment's `strings` (many string-literal keys) can't satisfy vs
// Record<string, string>.
const schema = schemaJson as unknown as Schema;
const bound = makeT(en as Bundle, schema.strings ?? {});

/** Resolve a catalogue key to display text, interpolating `{name}` vars.
 *  Resolution order: config `strings` override -> the bundled English
 *  catalogue -> the bare key (logging a dev-time warning on a true miss). */
export const t = bound.t;
/** Like `t`, but selects `${key}#<CLDR category>` for `count` via
 *  `Intl.PluralRules`, falling back to `#other`, and merges `{count}` into
 *  `vars` before resolving each candidate through the same chain as `t`. */
export const tn = bound.tn;
