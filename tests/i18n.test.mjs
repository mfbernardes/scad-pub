// Tests the localization core (src/lib/i18n.ts): the makeT() factory's
// override/fallback chain, {var} interpolation, tn()'s CLDR plural-category
// selection (including a non-English locale with more categories),
// overridesForLocale()'s projection of the config `strings` union shape, and
// the rebind()-backed delegating t/tn exports. There's no en/de key-parity
// check here (that's tests/i18nCoverage.test.mjs's job in reverse: catching a
// DEAD key). This file instead asserts every catalogue value is a non-empty
// string, the real-world analogue of the donor branch's "every catalogue
// value is a non-empty string" check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeT, overridesForLocale, rebind, defaultTag, t, tn } from "../src/lib/i18n.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, "..", "src", "locales");
const en = JSON.parse(readFileSync(join(LOCALES, "en.json"), "utf-8"));
const generatedSchema = JSON.parse(
  readFileSync(join(HERE, "..", "src", "generated", "designs.json"), "utf-8")
);

// Reproduces exactly what i18n.ts's own module-scope init binds, so a test
// that rebinds away from it can restore the ORIGINAL binding rather than a
// hardcoded "en" that would be wrong for a non-English-default deployment.
function restoreDefaultBinding() {
  rebind(defaultTag, null, overridesForLocale(generatedSchema.strings, defaultTag, defaultTag));
}

test("t(): resolves from the bundle when the key is present", () => {
  const { t } = makeT({ "a.b": "Hello" });
  assert.equal(t("a.b"), "Hello");
});

test("t(): falls back to the bare key when the bundle lacks it", () => {
  const { t } = makeT({ "a.b": "Hello" });
  assert.equal(t("nope.missing"), "nope.missing");
});

test("t(): a config override wins over the bundle", () => {
  const { t } = makeT({ "a.b": "Hello" }, { "a.b": "Servus" });
  assert.equal(t("a.b"), "Servus");
});

test("t(): an override for a key absent from the bundle still resolves", () => {
  const { t } = makeT({}, { "custom.key": "Custom text" });
  assert.equal(t("custom.key"), "Custom text");
});

test("t(): interpolates {name} placeholders from vars", () => {
  const { t } = makeT({ greet: "Hello {name}, you have {count} items" });
  assert.equal(t("greet", { name: "Ada", count: 3 }), "Hello Ada, you have 3 items");
});

test("t(): an unmatched placeholder is left as literal text", () => {
  const { t } = makeT({ greet: "Hello {name}" });
  assert.equal(t("greet", {}), "Hello {name}");
  assert.equal(t("greet"), "Hello {name}");
});

test("tn(): selects the CLDR plural category (one/other)", () => {
  const { tn } = makeT({ "item.count#one": "{count} item", "item.count#other": "{count} items" });
  assert.equal(tn("item.count", 1), "1 item");
  assert.equal(tn("item.count", 5), "5 items");
  assert.equal(tn("item.count", 0), "0 items");
});

test("tn(): falls back to #other when the selected category is missing", () => {
  const { tn } = makeT({ "item.count#other": "{count} items" });
  assert.equal(tn("item.count", 1), "1 items");
});

test("tn(): falls back to the bare key when neither category exists", () => {
  const { tn } = makeT({});
  assert.equal(tn("item.count", 3), "item.count");
});

test("tn(): merges {count} into vars alongside other placeholders", () => {
  const { tn } = makeT({ "cart.total#other": "{count} items ({total})" });
  assert.equal(tn("cart.total", 2, { total: "$9" }), "2 items ($9)");
});

test("tn(): an override for a specific plural category wins over the bundle's", () => {
  const { tn } = makeT(
    { "item.count#one": "{count} item", "item.count#other": "{count} items" },
    { "item.count#other": "{count} things" }
  );
  assert.equal(tn("item.count", 1), "1 item");
  assert.equal(tn("item.count", 5), "5 things");
});

test("every catalogue value in src/locales/en.json is a non-empty string", () => {
  for (const [key, value] of Object.entries(en)) {
    assert.equal(typeof value, "string", `en.json['${key}'] must be a string`);
    assert.ok(value.length > 0, `en.json['${key}'] must not be empty`);
  }
});

test("a pluralized key in src/locales/en.json always has both #one and #other", () => {
  const bases = new Set(
    Object.keys(en)
      .filter((k) => k.includes("#"))
      .map((k) => k.split("#")[0])
  );
  for (const base of bases) {
    assert.ok(`${base}#one` in en, `en.json is missing '${base}#one'`);
    assert.ok(`${base}#other` in en, `en.json is missing '${base}#other'`);
  }
});

test("makeT(): a locale with more than one/other CLDR categories resolves its own (Polish few/many)", () => {
  const { tn } = makeT(
    { "item.count#one": "{count} rzecz", "item.count#few": "{count} rzeczy", "item.count#other": "{count} rzeczy" },
    {},
    "pl"
  );
  assert.equal(tn("item.count", 1), "1 rzecz");
  // Polish cardinal: 2-4 (excluding 12-14) selects "few".
  assert.equal(tn("item.count", 2), "2 rzeczy");
});

test("makeT(): defaults to English plural rules when locale is omitted", () => {
  const { tn } = makeT({ "item.count#one": "{count} item", "item.count#other": "{count} items" });
  assert.equal(tn("item.count", 1), "1 item");
  assert.equal(tn("item.count", 2), "2 items");
});

test("overridesForLocale(): a plain string value applies only at the default locale", () => {
  const strings = { "a.b": "Default-locale override" };
  assert.deepEqual(overridesForLocale(strings, "en", "en"), { "a.b": "Default-locale override" });
  assert.deepEqual(overridesForLocale(strings, "de", "en"), {});
});

test("overridesForLocale(): an object value contributes its tag's entry", () => {
  const strings = { "a.b": { en: "Hello override", de: "Hallo Override" } };
  assert.deepEqual(overridesForLocale(strings, "en", "en"), { "a.b": "Hello override" });
  assert.deepEqual(overridesForLocale(strings, "de", "en"), { "a.b": "Hallo Override" });
});

test("overridesForLocale(): an object value with no entry for the active tag contributes nothing", () => {
  const strings = { "a.b": { de: "Hallo Override" } };
  assert.deepEqual(overridesForLocale(strings, "fr", "en"), {});
});

test("overridesForLocale(): undefined strings yields an empty bundle", () => {
  assert.deepEqual(overridesForLocale(undefined, "en", "en"), {});
});

// "en-XA" is a structurally valid BCP-47 tag (the conventional pseudo-locale
// code) whose plural rules resolve to English's, so it exercises rebind's
// non-English path without needing a second real translation.
test("rebind(): the delegating t/tn exports reflect the current binding", () => {
  try {
    rebind("en-XA", { "greet.hello": "«Hello»" }, {});
    assert.equal(t("greet.hello"), "«Hello»");
    assert.equal(t("status.building"), en["status.building"], "untranslated key falls back to English");

    rebind("en-XA", { "item.count#one": "«{count} item»", "item.count#other": "«{count} items»" }, {});
    assert.equal(tn("item.count", 1), "«1 item»");
    assert.equal(tn("item.count", 5), "«5 items»");
  } finally {
    // The module-level binding is process-global state; restore it so a
    // later test in this file (or a differently-ordered run) sees the same
    // binding i18n.ts's own module init produced.
    restoreDefaultBinding();
  }
});

test("rebind(): a config override still wins over the locale bundle", () => {
  try {
    rebind("en-XA", { "greet.hello": "«Hello»" }, { "greet.hello": "Configured override" });
    assert.equal(t("greet.hello"), "Configured override");
  } finally {
    restoreDefaultBinding();
  }
});
