// Tests the localization core (src/lib/i18n.ts): the makeT() factory's
// fallback chain, {var} interpolation, tn()'s CLDR plural-category selection,
// and — the real regression gate — that src/locales/en.json and de.json carry
// the exact same key set (a translator adding/renaming a key in one bundle
// without the other would otherwise silently fall back to English forever).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeT } from "../src/lib/i18n.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, "..", "src", "locales");
const en = JSON.parse(readFileSync(join(LOCALES, "en.json"), "utf-8"));
const de = JSON.parse(readFileSync(join(LOCALES, "de.json"), "utf-8"));

test("t(): resolves from the active bundle when the key is present", () => {
  const { t } = makeT({ en: { "a.b": "Hello" }, de: { "a.b": "Hallo" } }, "de");
  assert.equal(t("a.b"), "Hallo");
});

test("t(): falls back to the English bundle when the active bundle lacks the key", () => {
  const { t } = makeT({ en: { "a.b": "Hello", "a.c": "Only English" }, de: { "a.b": "Hallo" } }, "de");
  assert.equal(t("a.c"), "Only English");
});

test("t(): falls back to the bare key when no bundle has it", () => {
  const { t } = makeT({ en: { "a.b": "Hello" }, de: {} }, "de");
  assert.equal(t("nope.missing"), "nope.missing");
});

test("t(): an unbundled locale falls back to English entirely", () => {
  const { t } = makeT({ en: { "a.b": "Hello" }, de: { "a.b": "Hallo" } }, "fr");
  assert.equal(t("a.b"), "Hello");
});

test("t(): a config override wins over both the active and English bundles", () => {
  const { t } = makeT(
    { en: { "a.b": "Hello" }, de: { "a.b": "Hallo" } },
    "de",
    { "a.b": "Servus" }
  );
  assert.equal(t("a.b"), "Servus");
});

test("t(): an override for a key absent from every bundle still resolves", () => {
  const { t } = makeT({ en: {}, de: {} }, "en", { "custom.key": "Custom text" });
  assert.equal(t("custom.key"), "Custom text");
});

test("t(): interpolates {name} placeholders from vars", () => {
  const { t } = makeT({ en: { greet: "Hello {name}, you have {count} items" } }, "en");
  assert.equal(t("greet", { name: "Ada", count: 3 }), "Hello Ada, you have 3 items");
});

test("t(): an unmatched placeholder is left as literal text", () => {
  const { t } = makeT({ en: { greet: "Hello {name}" } }, "en");
  assert.equal(t("greet", {}), "Hello {name}");
  assert.equal(t("greet"), "Hello {name}");
});

test("tn(): selects the CLDR plural category for English (one/other)", () => {
  const { tn } = makeT(
    { en: { "item.count#one": "{count} item", "item.count#other": "{count} items" } },
    "en"
  );
  assert.equal(tn("item.count", 1), "1 item");
  assert.equal(tn("item.count", 5), "5 items");
  assert.equal(tn("item.count", 0), "0 items");
});

test("tn(): selects the CLDR plural category for German (one/other)", () => {
  const { tn } = makeT(
    {
      en: { "item.count#one": "{count} item", "item.count#other": "{count} items" },
      de: { "item.count#one": "{count} Artikel", "item.count#other": "{count} Artikel" },
    },
    "de"
  );
  assert.equal(tn("item.count", 1), "1 Artikel");
  assert.equal(tn("item.count", 5), "5 Artikel");
});

test("tn(): falls back to #other when the selected category is missing", () => {
  const { tn } = makeT({ en: { "item.count#other": "{count} items" } }, "en");
  assert.equal(tn("item.count", 1), "1 items");
});

test("tn(): merges {count} into vars alongside other placeholders", () => {
  const { tn } = makeT({ en: { "cart.total#other": "{count} items ({total})" } }, "en");
  assert.equal(tn("cart.total", 2, { total: "$9" }), "2 items ($9)");
});

test("en.json and de.json declare the exact same set of keys", () => {
  const enKeys = new Set(Object.keys(en));
  const deKeys = new Set(Object.keys(de));
  const missingFromDe = [...enKeys].filter((k) => !deKeys.has(k));
  const missingFromEn = [...deKeys].filter((k) => !enKeys.has(k));
  assert.deepEqual(missingFromDe, [], `keys missing from de.json: ${missingFromDe.join(", ")}`);
  assert.deepEqual(missingFromEn, [], `keys missing from en.json (typo?): ${missingFromEn.join(", ")}`);
});

test("every catalogue value is a non-empty string", () => {
  for (const [bundleName, bundle] of [["en", en], ["de", de]]) {
    for (const [key, value] of Object.entries(bundle)) {
      assert.equal(typeof value, "string", `${bundleName}.json['${key}'] must be a string`);
      assert.ok(value.length > 0, `${bundleName}.json['${key}'] must not be empty`);
    }
  }
});
