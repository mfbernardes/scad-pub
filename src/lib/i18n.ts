// i18n.ts — minimal, dependency-free translation layer. Flat dot-namespaced
// key -> string bundles (src/locales/*.json) are the source of truth; `t()`
// resolves a key through config override -> active bundle -> English bundle
// -> the bare key, and `tn()` layers CLDR plural-category selection on top
// (`${key}#one` / `${key}#other`, both languages currently bundled use only
// those two categories). See docs/config.md's `strings` section for the
// operator-facing override surface (schema.strings, validated by
// scripts/lib/config-parsers.mjs's parseStrings against src/locales/en.json).
//
// `makeT` is the pure, testable factory (no schema/JSON coupling — tests hand
// it synthetic bundles). The module-level `t`/`tn` exports below bind it to
// the generated schema's `lang` and `strings`, which is what the app imports.
//
// The runtime bundle set comes from the GENERATED src/generated/locales.json
// (scripts/gen-schema.mjs), not the two static src/locales/{en,de}.json files
// directly — those remain the SOURCE of truth (tests/i18n.test.mjs still
// reads them for the en/de key-parity check), but importing both of them
// here unconditionally shipped ~46KB of catalogue text even though only one
// locale (plus the English fallback) is ever active for a given build.
// gen-schema resolves `lang` to a bundled locale tag at build time and emits
// only the bundle(s) actually needed — see its own GENERATED_LOCALES
// comment. The `{ type: "json" }` import attribute is required because this
// module is also imported directly by tests/i18n.test.mjs through the
// TS-source node:test loader (see tests/ts-resolve.mjs), which falls through
// to Node's own ESM loader for `.json` specifiers; Vite's bundler accepts the
// same syntax, so one import works in both places.
import generatedLocales from "../generated/locales.json" with { type: "json" };
import schemaJson from "../generated/designs.json" with { type: "json" };
import type { Schema } from "../openscad/types";

export type Bundle = Record<string, string>;
export type Vars = Record<string, string | number>;

const BUNDLES: Record<string, Bundle> = generatedLocales;

// BCP-47 -> bundled locale: use the primary subtag ("de-AT" -> "de"),
// falling back to "en" when the subtag has no bundle of its own.
function primarySubtag(lang: string): string {
  return (lang.split("-")[0] || "en").toLowerCase();
}

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
 * Pure factory behind the default `t`/`tn` exports: given the locale bundles,
 * an active locale (falling back to "en" when unbundled), and an optional
 * config `strings` override map, returns bound `t`/`tn` functions. Kept
 * dependency-free and schema-agnostic so tests can drive it with synthetic
 * bundles instead of the generated schema.
 */
export function makeT(bundles: Record<string, Bundle>, locale: string, overrides: Bundle = {}) {
  const active = bundles[locale] ?? {};
  const en = bundles.en ?? {};

  function resolve(key: string): string | undefined {
    if (hasOwn(overrides, key)) return overrides[key];
    if (hasOwn(active, key)) return active[key];
    if (hasOwn(en, key)) return en[key];
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
    let category = "other";
    try {
      category = new Intl.PluralRules(locale).select(count);
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
// deployment's `presetImages` (many string-literal keys) can't satisfy vs
// Record<string, string>.
const schema = schemaJson as unknown as Schema;
const activeLocale = BUNDLES[primarySubtag(schema.lang ?? "en")] ? primarySubtag(schema.lang ?? "en") : "en";
const bound = makeT(BUNDLES, activeLocale, schema.strings ?? {});

/** Resolve a catalogue key to display text, interpolating `{name}` vars.
 *  Resolution order: config `strings` override -> active bundle -> English
 *  bundle -> the bare key (logging a dev-time warning on a true miss). */
export const t = bound.t;
/** Like `t`, but selects `${key}#<CLDR category>` for `count` via
 *  `Intl.PluralRules`, falling back to `#other`, and merges `{count}` into
 *  `vars` before resolving each candidate through the same chain as `t`. */
export const tn = bound.tn;
