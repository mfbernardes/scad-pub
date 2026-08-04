// localeStore.ts: owns runtime locale STATE (which tag is active, its text
// direction), separately from src/lib/i18n.ts, which owns TEXT RESOLUTION
// (the `t`/`tn` binding `rebind()` swaps). Modeled on theme.ts's exported
// subscribe/snapshot discipline, but state is module-level and shared by
// every `useLocale()` instance rather than per-hook `useState`: many
// components need the same active tag, and a switch has to notify all of
// them from one async load, not from N independent ones.
import { useSyncExternalStore } from "react";
import schemaJson from "../generated/designs.json" with { type: "json" };
import type { Schema } from "../openscad/types";
import {
  LOCALES,
  LOCALE_TAGS,
  collapseToAvailable,
  bestFitLocale,
  type LocaleMeta,
} from "./localeRegistry";
import { rebind, overridesForLocale, type Bundle, type ConfigStrings } from "./i18n";
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
 * `setLocale` calls resolving out of order; state swaps and subscribers are
 * notified only after the load resolves; a rejected load leaves the current
 * state untouched and rejects the returned promise; persistence runs only
 * when `opts.persist !== false`.
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
    if (tag === state.tag) return;
    if (!enabledTags.includes(tag)) {
      throw new Error(`localeStore: "${tag}" is not an enabled locale`);
    }
    const token = ++requestToken;

    const chromeLoader = tag === "en" ? undefined : loadChrome[tag];
    if (tag !== "en" && !chromeLoader) {
      throw new Error(`localeStore: no chrome loader registered for locale "${tag}"`);
    }
    const designLoader = loadDesignStrings?.[tag];
    const [bundle] = await Promise.all([
      chromeLoader ? chromeLoader() : Promise.resolve(null),
      designLoader ? designLoader() : Promise.resolve(undefined),
    ]);

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
const registryDefaultTag = collapseToAvailable(schema.lang ?? "en", LOCALE_TAGS) ?? "en";

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
  const lang = state.tag === registryDefaultTag ? (schema.lang ?? registryDefaultTag) : state.tag;
  document.documentElement.lang = lang;
  document.documentElement.dir = state.dir;
}

// Phase 4 reads `schema.languages` for enabledTags; until then every
// deployment ships exactly its default locale, so the store below never has
// anywhere else to switch to and stays inert.
const enabledTags: readonly string[] = [registryDefaultTag];

// Phase 2 adds the "de" thunk here once src/locales/de.json exists.
const loadChrome: Record<string, () => Promise<Bundle>> = {};

const store = createLocaleStore({
  loadChrome,
  persist: (tag) => {
    writeLocal(ns("lang"), tag);
  },
  schemaLang: schema.lang ?? "en",
  configStrings: schema.strings as ConfigStrings | undefined,
  enabledTags,
});

{
  const persisted = readLocal(ns("lang"));
  const navLangs = typeof navigator !== "undefined" ? (navigator.languages ?? []) : [];
  const initial = resolveInitialLocale(persisted, navLangs, enabledTags, registryDefaultTag);
  if (initial !== registryDefaultTag) {
    void store.setLocale(initial, { persist: false }).catch(() => {});
  }
}

/** `LocaleMeta` for every locale enabled on this deployment. */
export function availableLocales(): LocaleMeta[] {
  return LOCALES.filter((locale) => enabledTags.includes(locale.tag));
}

/** Subscribes to the active locale. Re-renders on any runtime switch; the
 *  returned `locales` list is this deployment's enabled locales, for a
 *  language selector. */
export function useLocale(): { tag: string; dir: "ltr" | "rtl"; locales: LocaleMeta[] } {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { tag: state.tag, dir: state.dir, locales: availableLocales() };
}
