// waitForFunctionArity.test.mjs — catches a silent-timeout bug that is
// invisible at every other layer. Playwright's signature is
// `waitForFunction(pageFunction, arg, options)`, and `arg` is typed `any`, so
// `waitForFunction(fn, { timeout: 5000 })` type-checks, lints clean and runs:
// the options object is passed to the page function as its argument and the
// wait silently falls back to Playwright's 30s default. These scripts are
// .mjs, so no type-checker looks at them at all.
//
// It cost ~244s per CI run of the site smoke suite once already — eight
// same-design re-selections in scripts/lib/browser.mjs each burning 30s where
// 5s was intended, and passing either way because the wait is `.catch()`-ed.
// Cheap textual check, in the spirit of i18nCoverage.test.mjs: brace-match the
// call's arguments rather than parsing an AST.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..", "scripts");
const CODE_EXTENSIONS = new Set([".mjs", ".js"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CODE_EXTENSIONS.has(extname(entry))) out.push(full);
  }
  return out;
}

/** Split the balanced argument list that follows `waitForFunction(`, at
 *  `from` = the index just past that opening paren. Commas nested inside
 *  parens/brackets/braces belong to an argument, not to the call. */
function splitArgs(source, from) {
  const args = [];
  let depth = 1;
  let current = "";
  for (let i = from; i < source.length; i++) {
    const char = source[i];
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") {
      depth--;
      if (depth === 0) break;
    }
    if (depth === 1 && char === ",") {
      args.push(current);
      current = "";
    } else current += char;
  }
  args.push(current);
  return args;
}

test("waitForFunction passes options in the third slot, not as the page-function arg", () => {
  const offenders = [];
  for (const file of walk(SCRIPTS)) {
    const source = readFileSync(file, "utf-8");
    for (const match of source.matchAll(/waitForFunction\(/g)) {
      const args = splitArgs(source, match.index + match[0].length);
      const second = args[1]?.trim() ?? "";
      if (args.length === 2 && second.startsWith("{") && /\btimeout\b/.test(second)) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${file.slice(file.indexOf("scripts"))}:${line} — ${second.replace(/\s+/g, " ")}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `waitForFunction(fn, options) silently ignores the timeout. Pass undefined ` +
      `as the arg slot: waitForFunction(fn, undefined, options).\n  ${offenders.join("\n  ")}`
  );
});
