// check-scad-semantics.mjs: assert what the PINNED OpenSCAD build actually
// does with the two language behaviours ScadPub's parser reasons about.
//
// Both are beliefs the parser acts on, and one of them was wrong: a `[Hidden]`
// re-assignment was assumed to overwrite what a control sets, so the parser
// failed the build on a program OpenSCAD runs correctly. Nothing caught it,
// because every test asked the parser what it thought rather than asking the
// engine what is true.
//
// Its own script rather than a unit test because `public/wasm/` is fetched
// (gitignored) and `npm test` runs before the fetch in CI. Run after
// `npm run wasm`; exits non-zero with a named failure, like check-dist.mjs.
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeCheck } from "./lib/check.mjs";

const WASM_DIR = fileURLToPath(new URL("../public/wasm/", import.meta.url));
const { check, state } = makeCheck();

console.log("=== pinned OpenSCAD semantics ===");

if (!existsSync(join(WASM_DIR, "openscad.wasm")) || !existsSync(join(WASM_DIR, "openscad.js"))) {
  console.error(
    "check-scad-semantics: public/wasm is missing — run `npm run wasm` first.\n" +
      "  (This check exists to test the real engine, so there is nothing useful to do without it.)"
  );
  process.exit(1);
}

// The Emscripten glue is an ES module but is named .js, and this package is not
// type: module for Node's resolver's purposes, so it is copied to a .mjs to be
// importable. Same binary, same glue.
const tmp = mkdtempSync(join(tmpdir(), "scad-semantics-"));
const gluePath = join(tmp, "openscad.mjs");
writeFileSync(gluePath, readFileSync(join(WASM_DIR, "openscad.js")));
const factory = (await import(gluePath)).default;
const wasmBinary = readFileSync(join(WASM_DIR, "openscad.wasm"));

/** Run `source` with the given `-D` defines; return its echo output and stderr. */
async function runFull(source, defines = []) {
  let stderr = "";
  const instance = await factory({
    wasmBinary,
    noInitialRun: true,
    print: () => {},
    printErr: (s) => {
      stderr += `${s}\n`;
    },
  });
  instance.FS.writeFile("/in.scad", source);
  instance.callMain([
    "/in.scad",
    "-o",
    "/out.echo",
    "--export-format=echo",
    ...defines.flatMap((d) => ["-D", d]),
  ]);
  let stdout = "";
  try {
    stdout = instance.FS.readFile("/out.echo", { encoding: "utf8" });
  } catch {
    // A rejected file never got exported; stderr is what says why.
  }
  return { stdout, stderr };
}

/** Run `source` with the given `-D` defines and return its echo output. */
async function echoRun(source, defines = []) {
  return (await runFull(source, defines)).stdout;
}

// 1. `-D` beats an in-file assignment, wherever that assignment sits. This is
//    why scripts/lib/params.mjs does NOT treat a `[Hidden]` assignment sharing a
//    control's name as a conflict: the control still wins.
const shadowed = await echoRun(
  `value = 1;\n/* [Hidden] */\nvalue = 2;\necho(value);\n`,
  ["value=9"]
);
check(
  /ECHO:\s*9/.test(shadowed),
  `-D overrides a later in-file assignment (got ${JSON.stringify(shadowed.trim())})`
);

// 2. And it beats one in the ordinary body too, so the rule above is about `-D`
//    rather than about the [Hidden] section specifically.
const plain = await echoRun(`value = 1;\nvalue = 2;\necho(value);\n`, ["value=9"]);
check(/ECHO:\s*9/.test(plain), "-D overrides repeated assignment in the main body");

// 3. Repeated assignment is legal — a warning, not an error — so rejecting it
//    at build time would fail programs the engine runs correctly.
const undefined_ = await echoRun(`value = 1;\nvalue = 2;\necho(value);\n`);
check(
  /ECHO:\s*2/.test(undefined_),
  "a repeated assignment runs, taking the last value, rather than failing"
);

// 4. The parser skips `[Hidden]`, so nothing there becomes a control. Confirm
//    the section is otherwise ordinary code that still executes.
const hidden = await echoRun(`/* [Hidden] */\nderived = 7;\necho(derived);\n`);
check(/ECHO:\s*7/.test(hidden), "[Hidden] is a Customizer marker only; its code still runs");

// 5. A block comment is whitespace ANYWHERE in an assignment — before the
//    value, around the `=`, after the value, and across lines. scripts/lib/
//    params.mjs blanks them for exactly this reason: it used to read
//    `a = /* mm */ 1;` as a raw-string default and lose `b /* mm */ = 2;`
//    entirely.
const comments = await echoRun(
  `a = /* c */ 1;\nb /* c */ = 2;\nc = 3 /* c */;\nd = /* multi\n  line */ 4;\necho(a, b, c, d);\n`
);
check(
  /ECHO:\s*1,\s*2,\s*3,\s*4/.test(comments),
  `a block comment is whitespace wherever it sits in an assignment ` +
    `(got ${JSON.stringify(comments.trim())})`
);

// 6. And the multi-statement / module-tail shapes around a MULTI-LINE comment,
//    which is where the parser's continuation logic lives. All of these are
//    ordinary code to the engine; the parser used to lose the second assignment
//    in each.
const spanning = await echoRun(
  `a = 1; /* multi\n line */ b = 2;\n` +
    `module m() { /* multi\n line */ inner = 9;\n} c = 3;\n` +
    // The brace on the line that CLOSES the comment, not the one that opens it:
    // a different shape for the parser's continuation, the same code to OpenSCAD.
    `module n() /* multi\n line */ {\n q = 8;\n} d = 4;\n` +
    `echo(a, b, c, d);\n`
);
check(
  /ECHO:\s*1,\s*2,\s*3,\s*4/.test(spanning),
  `a statement after a multi-line comment, and after a module body opened either ` +
    `side of one, still runs (got ${JSON.stringify(spanning.trim())})`
);

// ── differential: the parser's controls vs the engine's variables ─────────
// The checks above pin individual language facts. This pins the RELATIONSHIP
// the whole parser exists to maintain, and it is the only check here with an
// INDEPENDENT oracle: each shape carries a hand-written list of the controls it
// should produce, so the parser is never asked what the answer is.
//
// The first version of this was self-confirming — it asked the parser for names
// and then asked OpenSCAD only about those names, so a dropped `b` in
// `a = 1; b = 2;` left `["a"]`, the engine agreed `a` exists, and it passed.
// Now:
//   - the parser's names must EQUAL the expected list (extra names fail too,
//     which is what catches a module's local leaking out as a control);
//   - every expected name is set with a unique `-D` sentinel and echoed back,
//     so "this control can actually be set" is demonstrated rather than assumed.
const SHAPES = [
  ["plain", "a = 1;", ["a"]],
  ["two on a line", "a = 1; b = 2;", ["a", "b"]],
  ["comment before the value", "a = /* c */ 1;", ["a"]],
  ["comment around the =", "a /* c */ = 1;", ["a"]],
  ["comment after the value", "a = 1 /* c */;", ["a"]],
  ["multi-line comment mid-assignment", "a = /* x\ny */ 1;", ["a"]],
  ["multi-line comment, then a second statement", "a = 1; /* x\ny */ b = 2;", ["a", "b"]],
  ["module, then a tail", "module m() { z = 9; } a = 1;", ["a"]],
  ["an assignment BEFORE a module", "a = 1; module m() { z = 9; } b = 2;", ["a", "b"]],
  ["a module body with its own semicolons", "a = 1; module m() { p = 1; q = 2; } b = 2;", ["a", "b"]],
  ["two modules around an assignment", "module m() { z = 1; } a = 1; module n() { y = 2; }", ["a"]],
  ["a continued assignment before a module", "a = /* x\ny */ 1; module m() { z = 9; } b = 2;", ["a", "b"]],
  ["a continued assignment after a module", "module m() { z = 9; } a = /* x\ny */ 1;", ["a"]],
  ["module whose comment precedes its brace", "module m() /* x\ny */ { z = 9; } a = 1;", ["a"]],
  ["module whose comment is inside its body", "module m() { /* x\ny */ z = 9; } a = 1;", ["a"]],
  ["nested braces, then a tail", "module m() { if (true) { z = 9; } } a = 1;", ["a"]],
  // `use`/`include` end at `>`, not `;` — the one statement form with no
  // semicolon, and the scanner accumulated the whole file without this.
  ["a use statement, then an assignment", "use <dep.scad>\na = 1;", ["a"]],
  ["an include statement, then an assignment", "include <dep.scad>\na = 1;", ["a"]],
  // The gap before `<` is arbitrary whitespace to OpenSCAD. A parser that
  // bounded how much of the buffer it would look at stopped recognising
  // `include` after two spaces — and then swallowed the rest of the file.
  ["include, two spaces", "include  <dep.scad>\na = 1;\nb = 2;", ["a", "b"]],
  ["include, tabs", "include\t\t<dep.scad>\na = 1;\nb = 2;", ["a", "b"]],
  ["use, six spaces", "use      <dep.scad>\na = 1;\nb = 2;", ["a", "b"]],
  ["a directive split across lines", "include\n<dep.scad>\na = 1;", ["a"]],
  // NOT included: `use /* c */ <dep.scad>`. The engine refuses to parse it —
  // its lexer reads `use <…>` as a single token, so a comment inside the
  // directive is not whitespace the way it is everywhere else. This check
  // discovered that; the parser is merely lenient there, on a file that could
  // never build.
  ["a string containing a semicolon", 'a = "x;y";', ["a"]],
  ["a string containing a brace", 'a = "x{y";', ["a"]],
  ["a string containing a comment marker", 'a = "x/*y";', ["a"]],
  ["a vector value", "a = [1,2,3];", ["a"]],
  ["an expression value", "a = 1 + 2;", ["a"]],
  ["a function definition, then an assignment", "function f(x) = x*2; a = f(2);", ["a"]],
  ["a ternary", "a = true ? 1 : 2;", ["a"]],
  ["nested calls", "a = max(1, min(2, 3));", ["a"]],
  ["a less-than in an expression", "a = 1 < 2 ? 3 : 4;", ["a"]],
  ["a trailing line comment", "a = 1; // note", ["a"]],
  ["a Customizer hint", "a = 1; // [0:10]", ["a"]],
  ["two statements and a hint", "a = 1; b = 2; // [0:10]", ["a", "b"]],
  // A braceless `if` body is a module instantiation, not an assignment —
  // OpenSCAD rejects the latter outright, which this check discovered.
  ["an if with no braces", "a = 1; if (a > 0) cube(1);", ["a"]],
];

const { parseParams } = await import("./lib/params.mjs");
const scratch = join(tmp, "shape.scad");
writeFileSync(join(tmp, "dep.scad"), "// a dependency\n");
for (const [what, body, expected] of SHAPES) {
  writeFileSync(scratch, `/* [Main] */\n${body}\n`);
  let names;
  try {
    names = parseParams(scratch).params.map((p) => p.name);
  } catch (e) {
    check(false, `${what}: the parser threw — ${e.message}`);
    continue;
  }
  if (
    !check(
      JSON.stringify(names) === JSON.stringify(expected),
      `${what}: controls are ${JSON.stringify(expected)} (parser offered ${JSON.stringify(names)})`
    )
  )
    continue;

  // Every control the parser offered must be settable with `-D`. Unique
  // sentinels, so a name that silently resolves to its source default rather
  // than to what was passed is a failure rather than a coincidence.
  const sentinel = (n, i) => 700 + i;
  const echo = await echoRun(
    `${body}\necho(${expected.map((n) => `"${n}=", ${n}`).join(", ")});\n`,
    expected.map((n, i) => `${n}=${sentinel(n, i)}`)
  );
  const wanted = expected.map((n, i) => `"${n}=", ${sentinel(n, i)}`).join(", ");
  check(
    echo.includes(wanted),
    `${what}: every control is settable with -D (wanted ${JSON.stringify(wanted)}, ` +
      `engine said ${JSON.stringify(echo.trim().split("\n").pop())})`
  );
}

// ── generated matrix: every arrangement, not just the ones we thought of ──
// The hand-picked SHAPES above were extended twice, once per bug the
// scanner shipped with — each time by someone who had just seen the
// arrangement fail. This cross-products the constructs it distinguishes
// (scripts/lib/scad-shape-matrix.mjs) instead of waiting for the next one.
//
// Not every generated shape is valid OpenSCAD (`a = 1; if (a > 0) b = 2;` is
// rejected outright, same as in SHAPES above), so each one is run through
// the pinned engine FIRST: `ERROR:` on stderr excludes it before anything is
// asserted, rather than trying to enumerate the invalid shapes by hand.
const { generateShapes } = await import("./lib/scad-shape-matrix.mjs");
const generated = generateShapes();
console.log(`\n=== generated shape matrix (${generated.length} shapes) ===`);

// Only failures are worth a line here: the hand-picked SHAPES above are few
// enough to read one by one, four thousand generated ones are not, and a log
// nobody reads hides the one line that matters.
const quiet = (ok, msg) => ok || check(false, msg);

let excluded = 0;
let asserted = 0;
for (const { what, body, expected } of generated) {
  const sentinel = (i) => 900 + i;
  const defines = expected.map((n, i) => `${n}=${sentinel(i)}`);
  const echoTail = expected.length
    ? `\necho(${expected.map((n) => `"${n}=", ${n}`).join(", ")});`
    : "";
  const { stdout, stderr } = await runFull(`${body}${echoTail}\n`, defines);
  if (/ERROR:/.test(stderr)) {
    excluded += 1;
    continue;
  }
  asserted += 1;

  writeFileSync(scratch, `/* [Main] */\n${body}\n`);
  let names;
  try {
    names = parseParams(scratch).params.map((p) => p.name);
  } catch (e) {
    quiet(false, `${what}: the parser threw — ${e.message}`);
    continue;
  }
  if (
    !quiet(
      JSON.stringify(names) === JSON.stringify(expected),
      `${what}: controls are ${JSON.stringify(expected)} (parser offered ${JSON.stringify(names)})\n    body: ${JSON.stringify(body)}`
    )
  )
    continue;

  if (expected.length === 0) continue;
  const wanted = expected.map((n, i) => `"${n}=", ${sentinel(i)}`).join(", ");
  quiet(
    stdout.includes(wanted),
    `${what}: every control is settable with -D (wanted ${JSON.stringify(wanted)}, ` +
      `engine said ${JSON.stringify(stdout.trim().split("\n").pop())})\n    body: ${JSON.stringify(body)}`
  );
}
console.log(`generated matrix: ${asserted} asserted, ${excluded} excluded as invalid OpenSCAD`);
// A loop that never ran reports every shape as fine. A generator returning
// nothing, or an engine change that excludes everything as invalid, would
// otherwise print PASS having checked nothing at all.
check(asserted > 2000, `the generated matrix asserted ${asserted} shapes (of ${generated.length})`);

console.log(
  state.failures ? `\nSCAD SEMANTICS FAIL ❌ (${state.failures})` : "\nSCAD SEMANTICS PASS ✅"
);
process.exit(state.failures ? 1 : 0);
