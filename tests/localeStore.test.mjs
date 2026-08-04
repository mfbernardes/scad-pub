// Tests src/lib/localeRegistry.ts's RFC 4647 lookup and src/lib/localeStore.ts's
// pure resolution + the createLocaleStore() factory's switch-sequencing
// contract (last-wins race — including a same-tag call invalidating a slower
// in-flight switch, swap-only-after-resolve, a superseded load's own failure
// resolving silently, persist gating, snapshot identity) against stubbed
// loaders — no DOM, no real network or dynamic import. Every pure
// store-contract test passes a no-op `onRebind` so it doesn't touch the
// process-global src/lib/i18n.ts binding; the final test omits it
// deliberately, to prove the default wiring (createLocaleStore -> i18n's
// rebind) actually connects the store to `t()` end to end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { collapseToAvailable, bestFitLocale, LOCALE_TAGS } from "../src/lib/localeRegistry.ts";
import { createLocaleStore, resolveInitialLocale, deriveEnabledTags } from "../src/lib/localeStore.ts";
import { rebind, t, overridesForLocale } from "../src/lib/i18n.ts";

// A controllable promise so a test can hold a "load" pending, then resolve or
// reject it on its own schedule.
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("collapseToAvailable: exact match, case-insensitive", () => {
  assert.equal(collapseToAvailable("de", ["en", "de"]), "de");
  assert.equal(collapseToAvailable("DE", ["en", "de"]), "de");
  assert.equal(collapseToAvailable("En", ["en", "de"]), "en");
});

test("collapseToAvailable: strips trailing BCP-47 subtags until one matches", () => {
  assert.equal(collapseToAvailable("de-AT", ["en", "de"]), "de");
  assert.equal(collapseToAvailable("de-Latn-AT", ["en", "de"]), "de");
});

test("collapseToAvailable: a full miss returns null", () => {
  assert.equal(collapseToAvailable("ja-JP", ["en", "de"]), null);
  assert.equal(collapseToAvailable("fr", ["en", "de"]), null);
});

test("bestFitLocale: the first requested tag that resolves wins, in order", () => {
  assert.equal(bestFitLocale(["fr", "de-AT", "en"], ["en", "de"]), "de");
  assert.equal(bestFitLocale(["en", "de-AT"], ["en", "de"]), "en");
});

test("bestFitLocale: a full miss across every requested tag returns null", () => {
  assert.equal(bestFitLocale(["fr", "ja"], ["en", "de"]), null);
  assert.equal(bestFitLocale([], ["en", "de"]), null);
});

test("resolveInitialLocale: a valid persisted tag wins over navigator languages", () => {
  assert.equal(resolveInitialLocale("de", ["fr"], ["en", "de"], "en"), "de");
});

test("resolveInitialLocale: an invalid persisted tag is ignored, falls through to nav best-fit", () => {
  assert.equal(resolveInitialLocale("xx", ["fr", "de-AT"], ["en", "de"], "en"), "de");
});

test("resolveInitialLocale: no persisted tag falls to navigator best-fit", () => {
  assert.equal(resolveInitialLocale(null, ["fr", "de-CH"], ["en", "de"], "en"), "de");
});

test("resolveInitialLocale: a full miss (no persisted, no nav match) falls to defaultTag", () => {
  assert.equal(resolveInitialLocale(null, ["fr", "ja"], ["en", "de"], "en"), "en");
  assert.equal(resolveInitialLocale("xx", ["fr"], ["en", "de"], "en"), "en");
});

test("createLocaleStore: getSnapshot returns a stable reference between calls with no change in between", () => {
  const store = createLocaleStore({
    loadChrome: {},
    persist: () => {},
    schemaLang: "en",
    enabledTags: ["en"],
    onRebind: () => {},
  });
  assert.strictEqual(store.getSnapshot(), store.getSnapshot());
});

test("createLocaleStore: state swaps only after the load resolves", async () => {
  const load = deferred();
  const store = createLocaleStore({
    loadChrome: { de: () => load.promise },
    persist: () => {},
    schemaLang: "en",
    enabledTags: ["en", "de"],
    onRebind: () => {},
  });
  const before = store.getSnapshot();
  const pending = store.setLocale("de");
  assert.equal(store.getSnapshot().tag, "en", "state must not change while the load is in flight");
  assert.strictEqual(store.getSnapshot(), before, "no new snapshot object while pending");
  load.resolve({ "a.b": "Hallo" });
  await pending;
  assert.equal(store.getSnapshot().tag, "de");
  assert.notStrictEqual(store.getSnapshot(), before, "a real change produces a new snapshot object");
});

test("createLocaleStore: a rejected load keeps the current state, its reference, and rejects setLocale", async () => {
  const store = createLocaleStore({
    loadChrome: { de: () => Promise.reject(new Error("network down")) },
    persist: () => {},
    schemaLang: "en",
    enabledTags: ["en", "de"],
    onRebind: () => {},
  });
  const before = store.getSnapshot();
  await assert.rejects(() => store.setLocale("de"), /network down/);
  assert.equal(store.getSnapshot().tag, "en", "a failed load must not move state");
  assert.strictEqual(store.getSnapshot(), before, "a failed load must not produce a new snapshot object");
});

test("createLocaleStore: persist runs by default, and is skipped with {persist: false}", async () => {
  const persistedDefault = [];
  const storeDefault = createLocaleStore({
    loadChrome: { de: () => Promise.resolve({}) },
    persist: (tag) => persistedDefault.push(tag),
    schemaLang: "en",
    enabledTags: ["en", "de"],
    onRebind: () => {},
  });
  await storeDefault.setLocale("de");
  assert.deepEqual(persistedDefault, ["de"]);

  const persistedExplicit = [];
  const storeNoPersist = createLocaleStore({
    loadChrome: { de: () => Promise.resolve({}) },
    persist: (tag) => persistedExplicit.push(tag),
    schemaLang: "en",
    enabledTags: ["en", "de"],
    onRebind: () => {},
  });
  await storeNoPersist.setLocale("de", { persist: false });
  assert.deepEqual(persistedExplicit, [], "persist must not run when opts.persist is false");
});

test("createLocaleStore: last-wins when two setLocale calls race, even if the first-issued loader resolves after the second", async () => {
  const deLoad = deferred();
  const frLoad = deferred();
  const store = createLocaleStore({
    loadChrome: { de: () => deLoad.promise, fr: () => frLoad.promise },
    persist: () => {},
    schemaLang: "en",
    enabledTags: ["en", "de", "fr"],
    onRebind: () => {},
  });

  const first = store.setLocale("de");
  const second = store.setLocale("fr");

  frLoad.resolve({});
  await second;
  assert.equal(store.getSnapshot().tag, "fr");

  // The stale "de" request resolves after "fr" already won; it must not
  // overwrite the newer state, and its own promise must not reject.
  deLoad.resolve({});
  await first;
  assert.equal(store.getSnapshot().tag, "fr", "a stale resolution must not override newer state");
});

test("createLocaleStore: a stale request's load REJECTING after being superseded does not reject its caller", async () => {
  const deLoad = deferred();
  const frLoad = deferred();
  const store = createLocaleStore({
    loadChrome: { de: () => deLoad.promise, fr: () => frLoad.promise },
    persist: () => {},
    schemaLang: "en",
    enabledTags: ["en", "de", "fr"],
    onRebind: () => {},
  });

  const stale = store.setLocale("de");
  const governing = store.setLocale("fr");

  frLoad.resolve({});
  await governing;
  assert.equal(store.getSnapshot().tag, "fr");

  // The superseded "de" request's loader fails after "fr" already won: since
  // only the governing (latest) request may reject, this must resolve
  // silently instead, and state must stay on "fr".
  deLoad.reject(new Error("stale failure"));
  await stale;
  assert.equal(store.getSnapshot().tag, "fr", "a stale rejection must not override newer state either");
});

test("createLocaleStore: switching back to the already-active tag invalidates a slower in-flight switch (en -> de (slow) -> en)", async () => {
  const deLoad = deferred();
  const store = createLocaleStore({
    loadChrome: { de: () => deLoad.promise },
    persist: () => {},
    schemaLang: "en",
    enabledTags: ["en", "de"],
    onRebind: () => {},
  });

  const slowSwitch = store.setLocale("de"); // still pending
  const backToEn = store.setLocale("en"); // same as current state: the no-op path
  await backToEn;
  assert.equal(store.getSnapshot().tag, "en");

  // The "de" load resolves after the no-op already ran; without bumping the
  // token on the no-op path this would incorrectly win and move state to "de".
  deLoad.resolve({});
  await slowSwitch;
  assert.equal(store.getSnapshot().tag, "en", "a slower switch superseded by a same-tag no-op must not win");
});

test("createLocaleStore: setLocale to the already-active tag persists by default and is a no-op otherwise", async () => {
  const persistCalls = [];
  const store = createLocaleStore({
    loadChrome: {},
    persist: (tag) => persistCalls.push(tag),
    schemaLang: "en",
    enabledTags: ["en"],
    onRebind: () => {},
  });
  const before = store.getSnapshot();
  await store.setLocale("en");
  assert.equal(store.getSnapshot().tag, "en");
  assert.strictEqual(store.getSnapshot(), before, "no state change, so no new snapshot object");
  assert.deepEqual(persistCalls, ["en"], "an explicit re-selection of the active locale still persists by default");

  await store.setLocale("en", { persist: false });
  assert.deepEqual(persistCalls, ["en"], "persist: false is honored on the no-op path too");
});

test("createLocaleStore: subscribers are notified exactly once per real change, not on a no-op", async () => {
  const store = createLocaleStore({
    loadChrome: { de: () => Promise.resolve({}) },
    persist: () => {},
    schemaLang: "en",
    enabledTags: ["en", "de"],
    onRebind: () => {},
  });
  let notified = 0;
  const unsubscribe = store.subscribe(() => {
    notified++;
  });
  await store.setLocale("de");
  assert.equal(notified, 1);
  await store.setLocale("de"); // already active: no-op, no notification
  assert.equal(notified, 1);
  unsubscribe();
});

test("createLocaleStore + i18n rebind: a pseudo-locale bundle flips t() output and flips back", async () => {
  // "en-XA" is the conventional pseudo-locale tag; its plural rules resolve
  // to English's, so this exercises the default onRebind wiring (createLocaleStore
  // -> src/lib/i18n.ts's rebind) without needing a second real translation.
  const pseudoBundle = { "status.building": "«Building preview…»" };
  const store = createLocaleStore({
    loadChrome: { "en-XA": () => Promise.resolve(pseudoBundle) },
    persist: () => {},
    schemaLang: "en",
    enabledTags: ["en", "en-XA"],
  });
  try {
    assert.equal(t("status.building"), "Building preview…");
    await store.setLocale("en-XA");
    assert.equal(t("status.building"), "«Building preview…»");
    await store.setLocale("en");
    assert.equal(t("status.building"), "Building preview…");
  } finally {
    rebind("en", null, {});
  }
});

// Phase 4 config-surface reconciliation (Phase 2 review finding 9): a config
// with an UNSHIPPED `lang` (e.g. "fr") and no explicit `languages` gets a
// single-locale `schema.languages`. gen-schema's `parseLanguages` resolves
// that single tag the same way src/lib/i18n.ts's `defaultTag` resolves for
// this exact deployment shape — `collapseToAvailable(lang, LOCALE_TAGS) ??
// "en"`, i.e. "en", NOT the literal unshipped `lang` — so `deriveEnabledTags`
// below must land on the identical tag rather than trusting a stale/foreign
// value: the two can never name two different active locales.
test("deriveEnabledTags: an unshipped config lang resolves to a single 'en' tag, matching i18n's defaultTag", () => {
  const unshippedLang = "fr";
  const resolvedDefaultTag = collapseToAvailable(unshippedLang, LOCALE_TAGS) ?? "en";
  assert.equal(resolvedDefaultTag, "en"); // "fr" isn't a registry tag

  // No `schema.languages` at all (an older build, or this exact single-locale
  // default): falls back to `[fallbackTag]`.
  const enabledTags = deriveEnabledTags(undefined, resolvedDefaultTag);
  assert.deepEqual(enabledTags, ["en"]);
  assert.ok(enabledTags.length <= 1, "a single-locale deployment must hide the language selector");

  // A flat (plain-string) `strings` override still applies: it's keyed to
  // whichever tag IS the deployment's default, not to the literal `lang`
  // value, so it must project through unchanged.
  const flatStrings = { "action.export": "Télécharger" };
  assert.deepEqual(
    overridesForLocale(flatStrings, resolvedDefaultTag, resolvedDefaultTag),
    { "action.export": "Télécharger" }
  );
});

test("createLocaleStore: the init default-tag design-strings load populates designsById and bumps designsGeneration", async () => {
  const initLoad = deferred();
  const store = createLocaleStore({
    loadChrome: {},
    loadDesignStrings: { en: () => initLoad.promise },
    persist: () => {},
    schemaLang: "en",
    enabledTags: ["en"],
    onRebind: () => {},
  });
  const before = store.getSnapshot();
  assert.equal(store.getDesignStrings("widget"), undefined);
  initLoad.resolve({ designs: { widget: { description: "A widget" } } });
  await Promise.resolve().then(() => Promise.resolve()); // let the .then() microtask run
  assert.deepEqual(store.getDesignStrings("widget"), { description: "A widget" });
  assert.equal(store.getSnapshot().designsGeneration, before.designsGeneration + 1);
  assert.notStrictEqual(store.getSnapshot(), before, "a design-strings-only update still bumps the snapshot");
});

test("createLocaleStore: a rejected init default-tag design-strings load is tolerated (no throw, no state change)", async () => {
  const store = createLocaleStore({
    loadChrome: {},
    loadDesignStrings: { en: () => Promise.reject(new Error("network down")) },
    persist: () => {},
    schemaLang: "en",
    enabledTags: ["en"],
    onRebind: () => {},
  });
  const before = store.getSnapshot();
  await Promise.resolve().then(() => Promise.resolve());
  assert.strictEqual(store.getSnapshot(), before);
  assert.equal(store.getDesignStrings("widget"), undefined);
});

test("createLocaleStore: setLocale swaps the design-strings bundle alongside the chrome bundle", async () => {
  const store = createLocaleStore({
    loadChrome: { de: () => Promise.resolve({}) },
    loadDesignStrings: {
      en: () => Promise.resolve({ designs: { widget: { description: "A widget" } } }),
      de: () => Promise.resolve({ designs: { widget: { description: "Ein Widget" } } }),
    },
    persist: () => {},
    schemaLang: "en",
    enabledTags: ["en", "de"],
    onRebind: () => {},
  });
  await Promise.resolve().then(() => Promise.resolve()); // let the init en load settle
  assert.deepEqual(store.getDesignStrings("widget"), { description: "A widget" });

  await store.setLocale("de");
  assert.deepEqual(store.getDesignStrings("widget"), { description: "Ein Widget" });

  await store.setLocale("en");
  assert.deepEqual(store.getDesignStrings("widget"), { description: "A widget" });
});

test("createLocaleStore: a same-tag early return does not starve the still-in-flight init default-tag design-strings load (Phase 6 review finding)", async () => {
  const initLoad = deferred();
  const store = createLocaleStore({
    loadChrome: {},
    loadDesignStrings: { en: () => initLoad.promise },
    persist: () => {},
    schemaLang: "en",
    enabledTags: ["en"],
    onRebind: () => {},
  });
  // Re-select the already-active default tag while the init load is still
  // pending — the early-return path in setLocale must not invalidate it.
  await store.setLocale("en");
  assert.equal(store.getDesignStrings("widget"), undefined, "still pending");

  initLoad.resolve({ designs: { widget: { description: "A widget" } } });
  await Promise.resolve().then(() => Promise.resolve());
  assert.deepEqual(
    store.getDesignStrings("widget"),
    { description: "A widget" },
    "the init load must still land after a same-tag early return raced ahead of it"
  );
});

test("deriveEnabledTags: a real schema.languages array passes through verbatim", () => {
  assert.deepEqual(deriveEnabledTags(["de", "en"], "de"), ["de", "en"]);
});

test("deriveEnabledTags: malformed languages (empty, non-array, non-string entries) falls back to [fallbackTag]", () => {
  assert.deepEqual(deriveEnabledTags(undefined, "en"), ["en"]);
  assert.deepEqual(deriveEnabledTags(null, "en"), ["en"]);
  assert.deepEqual(deriveEnabledTags([], "en"), ["en"]);
  assert.deepEqual(deriveEnabledTags(["en", 5], "en"), ["en"]);
});
