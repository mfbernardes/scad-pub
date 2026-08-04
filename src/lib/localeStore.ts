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
import type { DesignI18nFile, DesignStrings } from "./designI18n";
import { ns } from "./appId";
import { readLocal, writeLocal, removeLocal } from "./safeStorage";

export interface LocaleState {
  tag: string;
  dir: "ltr" | "rtl";
  /** Bumped whenever the active tag's per-design translation bundle
   *  (re)loads — including the async DEFAULT-tag load at init (see
   *  `createLocaleStore`'s own comment) that doesn't touch tag/dir at all,
   *  the only OTHER reason this object's reference identity changes.
   *  `useSyncExternalStore` bails out on a referentially-unchanged snapshot,
   *  so a design-strings-only update needs its own reason for a new `state`
   *  object to exist; App.tsx's design memo keys off this alongside `tag`
   *  (see useLocale's `LocaleSnapshot`) so a design's sidecar arriving after
   *  first paint still triggers the memo. */
  designsGeneration: number;
}

export interface CreateLocaleStoreDeps {
  /** Dynamic-import thunks for each non-English locale's chrome catalogue. */
  loadChrome: Record<string, () => Promise<Bundle>>;
  /** Dynamic-import thunks for each REGISTRY tag's per-design translation
   *  bundle (`src/generated/i18n/<tag>.json`, gen-schema.mjs's commitOutputs)
   *  — unlike `loadChrome`, this includes "en": there is no static default
   *  bundle for design text the way `en.json` is a static import in i18n.ts,
   *  since even the deployment's DEFAULT locale can carry sidecars (an
   *  English deployment of a German-authored design, translated back). Loaded
   *  alongside the chrome bundle in `setLocale`, and once more at construction
   *  for the default tag (see below) since a deployment whose initial locale
   *  simply IS the default never calls `setLocale` at all. */
  loadDesignStrings?: Record<string, () => Promise<DesignI18nFile>>;
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

  let state: LocaleState = { tag: defaultTag, dir: localeMeta(defaultTag).dir, designsGeneration: 0 };
  let requestToken = 0;
  // Bumped ONLY by a real tag switch (never by setLocale's same-tag early
  // return, which bumps `requestToken` instead): the init default-tag design
  // load below must survive a same-tag re-selection of the default locale
  // racing ahead of it, or that early return would starve `designsById` for
  // the rest of the session with no reload path while staying on the default
  // tag (Phase 6 review finding).
  let switchToken = 0;
  // The active tag's per-design translation bundle, keyed by design id.
  // Swapped alongside `state` (see setLocale and the default-tag init load
  // below) — never read directly, only through `getDesignStrings`.
  let designsById: Record<string, DesignStrings> = {};
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

  function getDesignStrings(designId: string): DesignStrings | undefined {
    return designsById[designId];
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
    switchToken++;

    const chromeLoader = tag === "en" ? undefined : loadChrome[tag];
    if (tag !== "en" && !chromeLoader) {
      throw new Error(`localeStore: no chrome loader registered for locale "${tag}"`);
    }
    const designLoader = loadDesignStrings?.[tag];

    let bundle: Bundle | null;
    let designFile: DesignI18nFile | undefined;
    try {
      [bundle, designFile] = await Promise.all([
        chromeLoader ? chromeLoader() : Promise.resolve(null),
        // A missing/broken design-strings bundle is never a reason to fail
        // the whole switch (unlike the chrome bundle above): gen-schema
        // always writes one per registry tag, so a rejection here means a
        // stale build or a network hiccup, not "this locale doesn't exist" —
        // the switch still succeeds, just without translated design text.
        designLoader ? designLoader().catch(() => undefined) : Promise.resolve(undefined),
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
    designsById = designFile?.designs ?? {};
    state = { tag, dir: localeMeta(tag).dir, designsGeneration: state.designsGeneration + 1 };
    if (opts.persist !== false) persist(tag);
    notify();
  }

  // Default-tag design strings: fired once, here, independent of any
  // `setLocale` call — a deployment whose initial locale simply IS the
  // default never calls `setLocale` at all (see the module-init block at the
  // bottom of this file), so without this the default tag's own sidecars
  // (see `loadDesignStrings`'s own doc) would never load. Non-blocking: the
  // captured token is checked against `switchToken`, not `requestToken` — a
  // REAL switch racing ahead of this slow load (away from, or back to,
  // defaultTag) always wins, but a same-tag `setLocale` call resolving first
  // must NOT count as one (see `switchToken`'s own comment above).
  if (loadDesignStrings?.[defaultTag]) {
    const initToken = switchToken;
    loadDesignStrings[defaultTag]()
      .then((file) => {
        if (initToken !== switchToken) return; // superseded by a real switch already
        designsById = file?.designs ?? {};
        state = { ...state, designsGeneration: state.designsGeneration + 1 };
        notify();
      })
      .catch(() => {
        // Missing/broken default-tag sidecar bundle: nothing to show, not a
        // store failure (see setLocale's own `.catch` above for the same call).
      });
  }

  return { subscribe, getSnapshot, setLocale, defaultTag, getDesignStrings };
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

// One thunk per REGISTRY tag (unlike `loadChrome` above: no static "en"
// bundle to fall back to, see `CreateLocaleStoreDeps.loadDesignStrings`'s own
// doc) into gen-schema.mjs's generated `src/generated/i18n/<tag>.json` — one
// always exists per tag (possibly `{"designs":{}}`), so this map never
// dangles. Same "no import attribute on a dynamic thunk" rule as `loadChrome`
// above, and the same reason: Vite left the specifier untransformed with it
// present.
const loadDesignStrings: Record<string, () => Promise<DesignI18nFile>> = {
  // Routed through `unknown` first: like i18n.ts's own `schemaJson as unknown
  // as Schema`, the inferred literal type of one build's actual generated
  // JSON (which content-varies per deployment/design set) structural-checks
  // against nothing worth pinning here.
  en: () => import("../generated/i18n/en.json").then((m) => m.default as unknown as DesignI18nFile),
  de: () => import("../generated/i18n/de.json").then((m) => m.default as unknown as DesignI18nFile),
};

/**
 * `enabledTags` derivation: this deployment's build-time-validated
 * `schema.languages` (scripts/lib/config-parsers.mjs's `parseLanguages`,
 * always a non-empty array of registry tags, default-locale first) when
 * present, else `[fallbackTag]` — the fallback only matters for a
 * designs.json built before this field existed, since gen-schema now always
 * emits `languages`. `fallbackTag` is `defaultTag` at the real call site
 * below: the SAME formula (`collapseToAvailable(schema.lang, LOCALE_TAGS) ??
 * "en"`) `parseLanguages` itself falls back to for an unshipped `lang`, so a
 * single-locale deployment's one enabled tag and the tag this store (and
 * i18n.ts) actually binds to can never disagree — see parseLanguages's own
 * comment for the other half of this reconciliation. Exported so tests can
 * drive it without constructing a whole schema.
 */
export function deriveEnabledTags(languages: unknown, fallbackTag: string): readonly string[] {
  if (
    Array.isArray(languages) &&
    languages.length > 0 &&
    languages.every((tag) => typeof tag === "string")
  )
    return languages;
  return [fallbackTag];
}

const enabledTags: readonly string[] = deriveEnabledTags(schema.languages, defaultTag);

const store = createLocaleStore({
  loadChrome,
  loadDesignStrings,
  persist: (tag) => {
    writeLocal(ns("lang"), tag);
  },
  schemaLang: defaultTag,
  configStrings: schema.strings as ConfigStrings | undefined,
  enabledTags,
});

// Review finding (Phase 2): the pre-paint inline script (index.html) writes a
// persisted `ns("lang")` choice straight onto `<html lang>` before this
// module — or React — ever runs, with no validation against the CURRENT
// build's locale set. For a multi-locale deployment that's fine (a real
// switch only ever persists a real enabled tag, and `applyLocale` corrects it
// again once the store settles). For a SINGLE-locale deployment `applyLocale`
// is a deliberate no-op (see its own comment above), so a key surviving a
// config change — a deployment that used to ship a second locale, dropped
// it, and a returning visitor's storage still carries that old choice — would
// keep flashing the wrong `<html lang>` on every future visit with nothing
// left in this file's own code path to ever correct it again.
//
// The smallest sound fix that stays inside this module (no
// `%APP_MULTI_LOCALE%` build-time HTML substitution, no App-level plumbing):
// the moment this module runs, drop any such stale key outright, so every
// SUBSEQUENT visit's pre-paint read is a clean miss, and correct THIS visit's
// `<html lang>` right away rather than leaving the pre-paint script's now-
// wrong guess in place for the rest of the page's life. `schema.lang` (not
// the bare `defaultTag`) mirrors `applyLocale`'s own choice of value for the
// default locale, so a region-flavored tag like `de-AT` isn't narrowed here
// either.
if (enabledTags.length <= 1 && readLocal(ns("lang")) !== null) {
  removeLocal(ns("lang"));
  if (typeof document !== "undefined") document.documentElement.lang = schema.lang ?? defaultTag;
}

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
  /** See `LocaleState.designsGeneration`: include alongside `tag` in a memo
   *  dependency array (e.g. App.tsx's `localizeDesign` call) that needs to
   *  re-run when this tag's design-strings bundle finishes loading, even on
   *  a load that doesn't change `tag` itself (the default-tag init load). */
  designsGeneration: number;
}

/** This tag's per-design translation bundle for one design id, or `undefined`
 *  when the active locale has no sidecar for it (including plain English with
 *  nothing translated). Reads through the module singleton; not itself
 *  reactive — call it from a `useLocale()`-subscribed component/memo so a
 *  locale switch (or the default tag's own async load, see
 *  `LocaleSnapshot.designsGeneration`) re-reads it. */
export function getDesignStrings(designId: string): DesignStrings | undefined {
  return store.getDesignStrings(designId);
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
    cache.current = {
      state,
      snapshot: {
        tag: state.tag,
        dir: state.dir,
        locales: ENABLED_LOCALES,
        designsGeneration: state.designsGeneration,
      },
    };
  }
  return cache.current.snapshot;
}
