// i18nParity.test.mjs — per-locale bundle integrity, for every src/locales/*.json
// beyond en.json: every value a non-empty string, the exact same base-key set
// as en.json (no missing/extra keys), the same {placeholder} name set per key,
// and — for every plural base — exactly the plural categories
// `Intl.PluralRules(tag)` reports for that locale (not hardcoded one/other:
// see CLAUDE.md, some locales need few/many). i18nCoverage.test.mjs already
// catches a DEAD en.json key; this file is the reverse direction, per locale.
//
// Also carries a cheap heuristic net against a module-scope `t()`/`tn()` call
// (src/lib/i18n.ts's binding is mutable and rebinds at runtime — a value
// resolved once at import time never picks up a locale switch). Not an AST
// check: see its own doc below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = join(ROOT, "src");
const LOCALES = join(SRC, "locales");

const en = JSON.parse(readFileSync(join(LOCALES, "en.json"), "utf-8"));
const localeFiles = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));

/** {placeholder} names referenced in a catalogue string, e.g. "Hi {name}" -> ["name"]. */
function placeholders(value) {
  return new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

const enBases = new Set(Object.keys(en).map((k) => k.split("#")[0]));
const pluralBases = new Set(
  Object.keys(en)
    .filter((k) => k.includes("#"))
    .map((k) => k.split("#")[0])
);

for (const file of localeFiles) {
  const tag = basename(file, ".json");
  const bundle = JSON.parse(readFileSync(join(LOCALES, file), "utf-8"));

  test(`${file}: every value is a non-empty string`, () => {
    for (const [key, value] of Object.entries(bundle)) {
      assert.equal(typeof value, "string", `${file}['${key}'] must be a string`);
      assert.ok(value.length > 0, `${file}['${key}'] must not be empty`);
    }
  });

  if (tag === "en") continue; // en.json is the reference; nothing to diff it against.

  test(`${file}: base-key set matches en.json exactly`, () => {
    const bases = new Set(Object.keys(bundle).map((k) => k.split("#")[0]));
    const missing = [...enBases].filter((k) => !bases.has(k));
    const extra = [...bases].filter((k) => !enBases.has(k));
    assert.deepEqual(missing, [], `${file} is missing keys: ${missing.join(", ")}`);
    assert.deepEqual(extra, [], `${file} has keys en.json doesn't: ${extra.join(", ")}`);
  });

  test(`${file}: {placeholder} names match en.json per key`, () => {
    const mismatches = [];
    for (const [key, enValue] of Object.entries(en)) {
      if (!(key in bundle)) continue; // already reported by the base-key-set test
      const enPh = placeholders(enValue);
      const bundlePh = placeholders(bundle[key]);
      const same = enPh.size === bundlePh.size && [...enPh].every((p) => bundlePh.has(p));
      if (!same) mismatches.push(`${key}: en=${[...enPh]} ${tag}=${[...bundlePh]}`);
    }
    assert.deepEqual(mismatches, [], `${file} placeholder mismatches:\n${mismatches.join("\n")}`);
  });

  test(`${file}: every plural base provides exactly this locale's CLDR categories`, () => {
    const expected = new Set(new Intl.PluralRules(tag).resolvedOptions().pluralCategories);
    const problems = [];
    for (const base of pluralBases) {
      const provided = new Set(
        Object.keys(bundle)
          .filter((k) => k.startsWith(`${base}#`))
          .map((k) => k.split("#")[1])
      );
      const missing = [...expected].filter((c) => !provided.has(c));
      const extra = [...provided].filter((c) => !expected.has(c));
      if (missing.length || extra.length)
        problems.push(`${base}: missing=[${missing}] extra=[${extra}]`);
    }
    assert.deepEqual(problems, [], `${file} plural-category mismatches:\n${problems.join("\n")}`);
  });
}

// --- Module-scope t()/tn() guard -------------------------------------------
//
// i18n.ts's `t`/`tn` delegate through a MUTABLE binding that `rebind()` swaps
// on a runtime locale switch (see src/lib/localeStore.ts). A value resolved
// at module-evaluation time (`const LABEL = t("x")`) is computed once, before
// any switch can happen, and never updates again — the one historical
// offender was BarActions.tsx:45 (removed; resolved inline at each use site
// instead). This is a heuristic net, not an AST check: it flags a top-level
// (column-0) `const`/`export const` binding whose initializer starts with a
// `t(`/`tn(` call — cheap, like i18nCoverage.test.mjs's own dead-key scan,
// and good enough to catch the shape of the bug that actually occurred.
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const SKIP_DIRS = new Set(["node_modules", "generated", "ui"]);
const MODULE_SCOPE_T = /^(export )?const [A-Za-z_$][\w$]*(?:\s*:\s*[^=]+)?\s*=\s*tn?\(/;

function collectCodeFiles(dir) {
  let files = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      files = files.concat(collectCodeFiles(full));
      continue;
    }
    if (CODE_EXTENSIONS.has(extname(full))) files.push(full);
  }
  return files;
}

test("no module-scope t()/tn() call in src/ (i18n.ts's own delegating `t`/`tn` exports excepted)", () => {
  const offenders = [];
  for (const file of collectCodeFiles(SRC)) {
    if (file === join(SRC, "lib", "i18n.ts")) continue; // the delegating exports themselves
    const lines = readFileSync(file, "utf-8").split("\n");
    lines.forEach((line, i) => {
      if (MODULE_SCOPE_T.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `module-scope t()/tn() call(s):\n${offenders.join("\n")}`);
});
