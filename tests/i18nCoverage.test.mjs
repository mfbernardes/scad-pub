// i18nCoverage.test.mjs — catches DEAD catalogue keys (the mirror image of
// i18n.test.mjs's en/de parity check, which catches keys present in one
// bundle but not the other). For every key declared in src/locales/en.json,
// assert the key string appears somewhere under src/ — either as a direct
// t("key")/tn("key", …) call, or as a string literal in an indirection table
// (e.g. ViewPicker's VIEW_OPTIONS.labelKey, ThemeToggle's LABEL_KEY,
// SvgWizard's STEP_NAME_KEYS) that itself gets passed through t()/tn() at
// render time. A plural key (`base#one` / `base#other`) is checked by its
// BASE key — that's the literal `tn()` callers actually write; the `#one`/
// `#other` suffixes are appended internally by tn(), never typed by hand.
//
// This is a coverage net, not a soundness proof: a key could still appear in
// a comment or an unrelated string and pass here. It is deliberately cheap
// (no AST parsing) — see CLAUDE.md's i18n conventions note.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = join(ROOT, "src");
const LOCALES = join(SRC, "locales");
const en = JSON.parse(readFileSync(join(LOCALES, "en.json"), "utf-8"));

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
// Skip generated/output directories that could otherwise dwarf the search or
// contain stale copies (none of these exist under src/, but kept defensive).
const SKIP_DIRS = new Set(["node_modules", "generated"]);

/** Recursively collect the text of every source file under `dir`, excluding
 *  the locale JSON bundles themselves (a key obviously appears in its own
 *  bundle — that's not evidence anything in the APP references it) and this
 *  test file (whose own doc comment quotes example key names). */
function collectSourceText(dir) {
  let text = "";
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      text += collectSourceText(full);
      continue;
    }
    if (full.startsWith(LOCALES)) continue; // the bundles themselves
    if (!CODE_EXTENSIONS.has(extname(full))) continue;
    text += readFileSync(full, "utf-8");
    text += "\n";
  }
  return text;
}

const sourceText = collectSourceText(SRC);

// A handful of call sites build the key at runtime from a static namespace
// prefix plus a dynamic tail — e.g. `` t(`some.prefix.${value}`) ``. Those
// keys never appear as a whole quoted literal anywhere, so the plain
// literal-string scan
// above would flag them as dead. Collect every such dynamic prefix (the
// static text immediately before `${` inside a template literal) once, so a
// key covered by one of them is treated as referenced too.
const DYNAMIC_PREFIX_RE = /`([A-Za-z][\w.-]*\.)\$\{/g;
const dynamicPrefixes = [...sourceText.matchAll(DYNAMIC_PREFIX_RE)].map((m) => m[1]);

test("every en.json key is referenced somewhere in src/", () => {
  const bases = new Set(Object.keys(en).map((k) => k.split("#")[0]));
  const unreferenced = [...bases].filter((key) => {
    // The key as it's actually written in call sites: a quoted string
    // literal, single- or double-quoted (t("x") / t('x') / tn("x", …) /
    // an indirection table's "x" value) — or covered by a dynamic
    // `${prefix}...` template call site (see DYNAMIC_PREFIX_RE above).
    if (sourceText.includes(`"${key}"`) || sourceText.includes(`'${key}'`)) return false;
    if (dynamicPrefixes.some((prefix) => key.startsWith(prefix))) return false;
    return true;
  });
  assert.deepEqual(
    unreferenced,
    [],
    `catalogue keys with no reference in src/ (dead keys?): ${unreferenced.join(", ")}`
  );
});
