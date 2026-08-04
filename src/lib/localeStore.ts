// localeStore.ts: owns runtime locale STATE (which tag is active, its text
// direction), separately from src/lib/i18n.ts, which owns TEXT RESOLUTION
// (the `t`/`tn` binding `rebind()` swaps). Modeled on theme.ts's exported
// subscribe/snapshot discipline, but state is module-level and shared by
// every `useLocale()` instance rather than per-hook `useState`: many
// components need the same active tag, and a switch has to notify all of
// them from one async load, not from N independent ones.
import { useRef, useSyncExternalStore } from "react";
import schemaJson from "../generated/designs.json" with { type: "json" };
import type { Schema } from "../openscad/types";
import {
  LOCALES,
  LOCALE_TAGS,
  collapseToAvailable,
  bestFitLocale,
  type LocaleMeta,
} from "./localeRegistry";
import { rebind, overridesForLocale, defaultTag, type Bundle, type ConfigStrings } from "./i18n";
import { ns } from "./appId";
import { readLocal, writeLocal } from "./safeStorage";

export interface LocaleState {
  tag: string;
  dir: "ltr" | "rtl";
}

export interface CreateLocaleStoreDeps {
  /** Dynamic-import thunks for each non-English locale's chrome catalogue. */
  loadChrome: Record<string, () => Promise<Bundle>>;
  /** Placeholder seam for Phase 5's per-design translation bundles: loaded
   *  alongside the chrome bundle when present, otherwise ignored entirely. */
  loadDesignStrings?: Record<string, () => Promise<unknown>>;
  persist: (tag: string) => void;
  schemaLang: string;
  configStrings?: ConfigStrings;
  enabledTags: readonly string[];
  onRebind?: (tag: string, localeBundle: Bundle | null, overrides: Bundle) => void;
}

function localeMeta(tag: string): LocaleMeta {
  return LOCALES.find((locale) => locale.tag === tag) ?? { tag, label: tag, dir: "ltr" };
}

/**
 * DOM-free store factory: builds the switch/subscribe/snapshot machinery
 * over injected loaders so tests can drive it with stubs. Switch sequencing
 * (see the plan): a last-wins request token guards against two in-flight
 * `setLocale` calls resolving out of order — bumped on every call, including
 * one that targets the already-active tag, so a slower switch still in
 * flight goes stale too; state swaps and subscribers are notified only after
 * the load resolves; a rejected load leaves state untouched and rejects the
 * caller ONLY when that call is still the governing (latest) one — a
 * superseded call's own failure resolves silently instead; persistence runs
 * only when `opts.persist !== false`.
 */
export function createLocaleStore(deps: CreateLocaleStoreDeps) {
  const {
    loadChrome,
    loadDesignStrings,
    persist,
    schemaLang,
    configStrings,
    enabledTags,
    onRebind = rebind,
  } = deps;
  const defaultTag = collapseToAvailable(schemaLang, LOCALE_TAGS) ?? "en";

  let state: LocaleState = { tag: defaultTag, dir: localeMeta(defaultTag).dir };
  let requestToken = 0;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getSnapshot(): LocaleState {
    return state;
  }

  async function setLocale(tag: string, opts: { persist?: boolean } = {}): Promise<void> {
    if (tag === state.tag) {
      // Already there: no load, no rebind, no notify (nothing actually
      // changed) — but still bump the token, so a SLOWER switch still in
      // flight (e.g. en -> de (slow) -> en) goes stale and can't overwrite
      // this settled state when its load eventually resolves. Persistence is
      // still an explicit choice this call can make (e.g. a user re-picking
      // the already-active locale from a selector), so it's honored here too.
      requestToken++;
      if (opts.persist !== false) persist(tag);
      return;
    }
    if (!enabledTags.includes(tag)) {
      throw new Error(`localeStore: "${tag}" is not an enabled locale`);
    }
    const token = ++requestToken;

    const chromeLoader = tag === "en" ? undefined : loadChrome[tag];
    if (tag !== "en" && !chromeLoader) {
      throw new Error(`localeStore: no chrome loader registered for locale "${tag}"`);
    }
    const designLoader = loadDesignStrings?.[tag];

    let bundle: Bundle | null;
    try {
      [bundle] = await Promise.all([
        chromeLoader ? chromeLoader() : Promise.resolve(null),
        designLoader ? designLoader() : Promise.resolve(undefined),
      ]);
    } catch (err) {
      // A superseded request's own failure must not surface: only the
      // governing (latest) request may reject its caller.
      if (token !== requestToken) return;
      throw err;
    }

    // Superseded by a later setLocale call: that call's own resolution owns
    // the state swap and notification, so this one is a silent no-op.
    if (token !== requestToken) return;

    const overrides = overridesForLocale(configStrings, tag, defaultTag);
    onRebind(tag, bundle, overrides);
    state = { tag, dir: localeMeta(tag).dir };
    if (opts.persist !== false) persist(tag);
    notify();
  }

  return { subscribe, getSnapshot, setLocale, defaultTag };
}

/** Pure resolution of the locale to start in: a valid persisted choice wins;
 *  otherwise the browser's language preference, best-fit against `enabled`;
 *  otherwise `defaultTag`. */
export function resolveInitialLocale(
  persisted: string | null,
  navLangs: readonly string[],
  enabled: readonly string[],
  defaultTag: string
): string {
  if (persisted) {
    const hit = collapseToAvailable(persisted, enabled);
    if (hit !== null) return hit;
  }
  return bestFitLocale(navLangs, enabled) ?? defaultTag;
}

const schema = schemaJson as unknown as Schema;

/**
 * Sets `<html lang>`/`<html dir>` for a multi-locale deployment. Single-locale
 * deployments leave the config-injected `<html>` attributes alone: there's
 * nothing to switch between, so `App` never calls this for them. When the
 * active tag is the deployment's default locale, writes `schema.lang`
 * verbatim rather than the bare registry tag, so a region-flavored default
 * like `de-AT` (which collapses to the registry's `de`) isn't narrowed by a
 * switch back to the default.
 */
export function applyLocale(state: LocaleState, multiLocale: boolean): void {
  if (typeof document === "undefined" || !multiLocale) return;
  const lang = state.tag === defaultTag ? (schema.lang ?? defaultTag) : state.tag;
  document.documentElement.lang = lang;
  document.documentElement.dir = state.dir;
}

// Phase 4 narrows this to `schema.languages`. For now every deployment can
// reach every locale that has a chrome bundle: defaultTag first (so an
// index-0 assumption elsewhere — e.g. a selector's default highlight — picks
// the deployment's own default), then the rest of `loadChrome`'s keys ("en"
// is implicit: it needs no loader).
// No `{ with: { type: "json" } }` attribute here, unlike i18n.ts's STATIC
// English import: Vite left this dynamic import's specifier untransformed
// with the attribute present (it still pointed at the literal source path at
// runtime — a 404 in the built app, even though a de-*.js chunk existed in
// asset-manifest.json), so it's dropped on this dynamic thunk specifically.
// Safe to drop: Node never executes this thunk (it's only reached through a
// running locale switch, which nothing under node:test triggers), so there's
// no ERR_UNKNOWN_FILE_EXTENSION risk here the way there is for i18n.ts's
// static import under the node:test loader.
const loadChrome: Record<string, () => Promise<Bundle>> = {
  de: () => import("../locales/de.json").then((m) => m.default),
};
// "en" is always available (no loader needed: rebind falls back to the plain
// English catalogue), so it's added explicitly rather than read off
// `loadChrome`'s keys.
const shippedTags = ["en", ...Object.keys(loadChrome)];
const enabledTags: readonly string[] = [
  defaultTag,
  ...shippedTags.filter((tag) => tag !== defaultTag),
];

const store = createLocaleStore({
  loadChrome,
  persist: (tag) => {
    writeLocal(ns("lang"), tag);
  },
  schemaLang: defaultTag,
  configStrings: schema.strings as ConfigStrings | undefined,
  enabledTags,
});

{
  const persisted = readLocal(ns("lang"));
  const navLangs = typeof navigator !== "undefined" ? (navigator.languages ?? []) : [];
  const initial = resolveInitialLocale(persisted, navLangs, enabledTags, defaultTag);
  if (initial !== defaultTag) {
    void store.setLocale(initial, { persist: false }).catch(() => {});
  }
}

/** The module singleton, for callers that need to trigger a switch
 *  (`localeStore.setLocale(tag)`, see appActions' `localeChange`) rather than
 *  just subscribing (`useLocale()` below). */
export const localeStore = store;

// `enabledTags` is fixed for the deployment's lifetime (Phase 4 will read it
// from config at BUILD time, still not a runtime-varying value), so this list
// is computed once rather than re-filtered on every `useLocale()` call —
// keeping one stable array reference across renders, not just stable
// contents, matters below.
const ENABLED_LOCALES: readonly LocaleMeta[] = LOCALES.filter((locale) => enabledTags.includes(locale.tag));

/** `LocaleMeta` for every locale enabled on this deployment. Same array
 *  reference every call (see `ENABLED_LOCALES`). */
export function availableLocales(): readonly LocaleMeta[] {
  return ENABLED_LOCALES;
}

export interface LocaleSnapshot {
  tag: string;
  dir: "ltr" | "rtl";
  locales: readonly LocaleMeta[];
}

/** Subscribes to the active locale. Re-renders on any runtime switch; the
 *  returned `locales` list is this deployment's enabled locales, for a
 *  language selector. The returned object is referentially stable across
 *  renders that don't change the locale (safe to put directly in a `useEffect`/
 *  `useMemo` dependency array): `state` is a pure function of the store's own
 *  snapshot, which the store already keeps stable across renders where
 *  nothing changed (see localeStore.test.mjs's getSnapshot-identity case), so
 *  caching the last {tag,dir,locales} wrapper in a per-hook-instance ref —
 *  the same lazy-ref-init pattern as `appActions.ts`'s stable callbacks, see
 *  CLAUDE.md — keyed on that same `state` reference reuses one wrapper object
 *  for as long as the locale hasn't actually changed. */
export function useLocale(): LocaleSnapshot {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const cache = useRef<{ state: LocaleState; snapshot: LocaleSnapshot } | null>(null);
  if (cache.current === null || cache.current.state !== state) {
    cache.current = { state, snapshot: { tag: state.tag, dir: state.dir, locales: ENABLED_LOCALES } };
  }
  return cache.current.snapshot;
}
