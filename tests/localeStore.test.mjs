// Tests src/lib/localeRegistry.ts's RFC 4647 lookup and src/lib/localeStore.ts's
// pure resolution + the createLocaleStore() factory's switch-sequencing
// contract (last-wins race, swap-only-after-resolve, persist-on-default,
// no-op on the active tag) against stubbed loaders — no DOM, no real network
// or dynamic import. The final test drives a synthetic pseudo-locale bundle
// through the default onRebind wiring into src/lib/i18n.ts's t(), proving the
// store and the text layer are actually connected end to end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { collapseToAvailable, bestFitLocale } from "../src/lib/localeRegistry.ts";
import { createLocaleStore, resolveInitialLocale } from "../src/lib/localeStore.ts";
import { rebind, t } from "../src/lib/i18n.ts";

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

test("createLocaleStore: state swaps only after the load resolves", async () => {
  const load = deferred();
  const store = createLocaleStore({
    loadChrome: { de: () => load.promise },
    persist: () => {},
    schemaLang: "en",
    enabledTags: ["en", "de"],
  });
  const pending = store.setLocale("de");
  assert.equal(store.getSnapshot().tag, "en", "state must not change while the load is in flight");
  load.resolve({ "a.b": "Hallo" });
  await pending;
  assert.equal(store.getSnapshot().tag, "de");
});

test("createLocaleStore: a rejected load keeps the current state and rejects setLocale", async () => {
  const store = createLocaleStore({
    loadChrome: { de: () => Promise.reject(new Error("network down")) },
    persist: () => {},
    schemaLang: "en",
    enabledTags: ["en", "de"],
  });
  await assert.rejects(() => store.setLocale("de"), /network down/);
  assert.equal(store.getSnapshot().tag, "en", "a failed load must not move state");
});

test("createLocaleStore: persist runs by default, and is skipped with {persist: false}", async () => {
  const persistedDefault = [];
  const storeDefault = createLocaleStore({
    loadChrome: { de: () => Promise.resolve({}) },
    persist: (tag) => persistedDefault.push(tag),
    schemaLang: "en",
    enabledTags: ["en", "de"],
  });
  await storeDefault.setLocale("de");
  assert.deepEqual(persistedDefault, ["de"]);

  const persistedExplicit = [];
  const storeNoPersist = createLocaleStore({
    loadChrome: { de: () => Promise.resolve({}) },
    persist: (tag) => persistedExplicit.push(tag),
    schemaLang: "en",
    enabledTags: ["en", "de"],
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

test("createLocaleStore: setLocale to the already-active tag is a no-op", async () => {
  let persistCalls = 0;
  const store = createLocaleStore({
    loadChrome: {},
    persist: () => {
      persistCalls++;
    },
    schemaLang: "en",
    enabledTags: ["en"],
  });
  await store.setLocale("en");
  assert.equal(store.getSnapshot().tag, "en");
  assert.equal(persistCalls, 0);
});

test("createLocaleStore: subscribers are notified exactly once per real change, not on a no-op", async () => {
  const store = createLocaleStore({
    loadChrome: { de: () => Promise.resolve({}) },
    persist: () => {},
    schemaLang: "en",
    enabledTags: ["en", "de"],
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
