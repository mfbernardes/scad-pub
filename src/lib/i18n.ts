// i18n.ts: the translation layer. The flat dot-namespaced key -> string
// bundle is the source of truth; `t()` resolves a key through a config
// `strings` override -> the active locale's bundle -> English -> the bare
// key, and `tn()` layers CLDR plural-category selection on top
// (`${key}#<category>` before `${key}#other`) using the active locale's own
// `Intl.PluralRules`. See docs/config.md's `strings` section for the
// operator-facing override surface.
//
// `t`/`tn` are stable delegating functions over a mutable current binding so
// the many importing modules never re-import after a locale switch;
// `rebind()` (called by src/lib/localeStore.ts, which owns the switch
// sequencing, loading and persistence) swaps that binding. `makeT` is the
// pure, testable factory behind it (no schema/JSON coupling: tests hand it a
// synthetic bundle).
//
// The `{ type: "json" }` import attribute is required because this module is
// also imported directly by tests/i18n.test.mjs through the TS-source
// node:test loader (see tests/ts-resolve.mjs), which falls through to Node's
// own ESM loader for `.json` specifiers. Node requires the attribute for a
// native JSON import. Vite's bundler accepts the same syntax, so one import
// works in both places.
import en from "../locales/en.json" with { type: "json" };
import schemaJson from "../generated/designs.json" with { type: "json" };
import type { Schema } from "../openscad/types";
import { LOCALE_TAGS, collapseToAvailable } from "./localeRegistry";

export type Bundle = Record<string, string>;
export type Vars = Record<string, string | number>;

/** A deployment's `strings` config block: a plain string overrides the
 *  deployment's default locale only; an object overrides per-locale (keyed
 *  by locale tag). See `overridesForLocale`. */
export type ConfigStrings = Record<string, string | Record<string, string>>;

// Cached per locale rather than one shared instance: `tn()` runs on
// keystroke-frequency render paths, and constructing a PluralRules is
// comparatively costly, but the active locale can now change at runtime.
const pluralRulesCache = new Map<string, Intl.PluralRules>();

function pluralRulesFor(locale: string): Intl.PluralRules {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
  }
  return rules;
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
 * Pure factory behind the default `t`/`tn` exports: given a catalogue (for a
 * non-English locale this is `en` merged with the locale's own translations,
 * see `rebind`), an optional config `strings` override map, and the locale
 * whose CLDR plural rules `tn()` should use, returns bound `t`/`tn`
 * functions. Kept dependency-free and schema-agnostic so tests can drive it
 * with a synthetic bundle instead of the real one.
 */
export function makeT(bundle: Bundle, overrides: Bundle = {}, locale = "en") {
  const pluralRules = pluralRulesFor(locale);

  function resolve(key: string): string | undefined {
    if (hasOwn(overrides, key)) return overrides[key];
    if (hasOwn(bundle, key)) return bundle[key];
    return undefined;
  }

  function t(key: string, vars?: Vars): string {
    const value = resolve(key);
    if (value === undefined) {
      // import.meta.env is Vite-injected (undefined under node:test, where the
      // optional chain below is a no-op). Warn only in dev builds, matching
      // e.g. src/lib/swUpdate.ts's import.meta.env.PROD check.
      if (import.meta.env?.DEV) console.warn(`i18n: missing key "${key}"`);
      return key;
    }
    return interpolate(value, vars);
  }

  function tn(key: string, count: number, vars?: Vars): string {
    // ECMA-402 returns "other" for a non-finite count, so this never throws.
    const category = pluralRules.select(count);
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

/**
 * Picks between a singular/plural PAIR of already-resolved strings using the
 * same CLDR plural-category selection `tn()` runs on catalogue keys, for a
 * noun that isn't a catalogue key at all, e.g. a config-defined `notices[]`
 * badge label (`{ one, other }`; see docs/config.md's Notice badges section).
 * `one` is optional and falls back to `other`, mirroring `tn()`'s own
 * fall-through-to-`#other` behaviour. Deliberately NOT a bespoke
 * `count === 1` check: the selection itself should go through
 * `Intl.PluralRules`, for the CURRENT locale (see `rebind`), like every other
 * plural decision in this app, not reimplement its own rule.
 */
export function selectPlural(count: number, forms: { one?: string; other: string }): string {
  const category = pluralRulesFor(currentTag).select(count);
  return (category === "one" ? forms.one : undefined) ?? forms.other;
}

/**
 * Projects a deployment's `strings` config block to a flat override `Bundle`
 * for one active locale `tag`: a plain string value overrides only when
 * `tag` is the deployment's default locale (so an existing flat `strings`
 * block, written before per-locale overrides existed, keeps applying
 * verbatim while that locale is active); an object value contributes its
 * `tag` entry when present. Missing/undefined `strings` yields `{}`.
 */
export function overridesForLocale(
  strings: ConfigStrings | undefined,
  tag: string,
  defaultTag: string
): Bundle {
  const result: Bundle = {};
  if (!strings) return result;
  for (const [key, value] of Object.entries(strings)) {
    if (typeof value === "string") {
      if (tag === defaultTag) result[key] = value;
    } else if (hasOwn(value, tag)) {
      result[key] = value[tag];
    }
  }
  return result;
}

let currentTag = "en";
let currentBinding!: ReturnType<typeof makeT>;

/**
 * Swaps the module's current `t`/`tn` binding to `locale`. `localeBundle` is
 * the loaded chrome catalogue for a non-English locale (null for English, or
 * on any failed/not-yet-loaded switch); it's merged UNDER `en` so a key the
 * locale hasn't translated yet falls back to English rather than the bare
 * key, and an untranslated plural category still reaches `tn`'s `#other`/
 * bare-key fallback. `overrides` is this locale's projection of the
 * deployment's `strings` config (see `overridesForLocale`). Called by
 * src/lib/localeStore.ts, which owns switch sequencing, loading order and
 * persistence; never call this with an unloaded locale's bundle.
 */
export function rebind(tag: string, localeBundle: Bundle | null, overrides: Bundle): void {
  const merged: Bundle =
    tag === "en" || localeBundle === null ? (en as Bundle) : { ...(en as Bundle), ...localeBundle };
  currentBinding = makeT(merged, overrides, tag);
  currentTag = tag;
}

// Route through `unknown`: the generated JSON is validated at runtime by
// schema.ts; a direct `as Schema` structural-checks the raw literal, which a
// deployment's `strings` (string-literal keys) can't satisfy vs
// Record<string, string>.
const schema = schemaJson as unknown as Schema;

/** This deployment's default locale: `schema.lang` collapsed to a registry
 *  tag, or "en" when unset/unshipped. The single source of truth for it —
 *  src/lib/localeStore.ts imports this rather than recomputing its own, so
 *  the two modules can never disagree about which locale is the default. */
export const defaultTag = collapseToAvailable(schema.lang ?? "en", LOCALE_TAGS) ?? "en";

// Binds at the deployment's default locale, not hardcoded "en": Phase 1 has
// no locale bundle to load yet (localeBundle is null, so `rebind` falls back
// to the plain English catalogue), but the binding's tag and the `strings`
// projection below must already be `defaultTag` — otherwise a `lang: "de"`
// deployment's flat `strings` overrides (which apply only "at the default
// locale", see `overridesForLocale`) would silently never apply, since
// nothing else rebinds until a locale switch happens.
rebind(defaultTag, null, overridesForLocale(schema.strings as ConfigStrings | undefined, defaultTag, defaultTag));

/** Resolve a catalogue key to display text, interpolating `{name}` vars.
 *  Resolution order: config `strings` override -> the active locale's
 *  catalogue -> English -> the bare key (logging a dev-time warning on a true
 *  miss). Delegates to the current binding (see `rebind`), so it keeps
 *  resolving through the active locale after a runtime switch without
 *  callers re-importing anything. */
export const t = (key: string, vars?: Vars): string => currentBinding.t(key, vars);
/** Like `t`, but selects `${key}#<CLDR category>` for `count` via the active
 *  locale's `Intl.PluralRules`, falling back to `#other`, and merges
 *  `{count}` into `vars` before resolving each candidate through the same
 *  chain as `t`. */
export const tn = (key: string, count: number, vars?: Vars): string =>
  currentBinding.tn(key, count, vars);
