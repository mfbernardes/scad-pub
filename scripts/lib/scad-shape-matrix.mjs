// scad-shape-matrix.mjs: GENERATE the arrangements scripts/lib/params.mjs's
// scanTopLevelStatements has to get right, rather than hand-picking them.
//
// Every shape it was wrong on so far — a module and an assignment on one
// line, then `include` followed by two spaces — was an arrangement nobody
// had thought to hand-write. This cross-products the constructs the scanner
// distinguishes (assignment, module/function definition, `use`/`include`,
// line and block comments, `[Hidden]`, strings holding the characters the
// scanner treats specially) over the separators that can sit between them,
// so the shapes that catch the next one of these are generated rather than
// guessed at.
//
// Each shape's `expected` list comes from the CONSTRUCTS THIS FILE PUT
// THERE — never from the parser — so check-scad-semantics.mjs's comparison
// stays a real oracle: an extra or dropped name fails even though nothing
// here ever asked params.mjs what the answer should be.
//
// Every template uses a fixed per-position index for its names (`a0`/`m1`/…)
// rather than a counter, so two components never collide regardless of which
// templates a shape combines.

const ASSIGN_TEMPLATES = [
  { tag: "assign", make: (i) => ({ code: `a${i} = 1;`, controls: [`a${i}`] }) },
  { tag: "assignExpr", make: (i) => ({ code: `a${i} = 1 + 2;`, controls: [`a${i}`] }) },
  { tag: "assignTernary", make: (i) => ({ code: `a${i} = true ? 1 : 2;`, controls: [`a${i}`] }) },
  { tag: "assignVector", make: (i) => ({ code: `a${i} = [1,2,3];`, controls: [`a${i}`] }) },
  { tag: "assignStrSemi", make: (i) => ({ code: `a${i} = "x;y";`, controls: [`a${i}`] }) },
  { tag: "assignStrBrace", make: (i) => ({ code: `a${i} = "x{y";`, controls: [`a${i}`] }) },
  { tag: "assignStrComment", make: (i) => ({ code: `a${i} = "x/*y";`, controls: [`a${i}`] }) },
  { tag: "assignStrLt", make: (i) => ({ code: `a${i} = "x<y";`, controls: [`a${i}`] }) },
];

const OTHER_TEMPLATES = [
  { tag: "moduleDef", make: (i) => ({ code: `module m${i}() { z${i} = 9; }`, controls: [] }) },
  {
    tag: "moduleNested",
    make: (i) => ({ code: `module m${i}() { if (true) { z${i} = 9; } }`, controls: [] }),
  },
  { tag: "functionDef", make: (i) => ({ code: `function f${i}(x) = x*2;`, controls: [] }) },
  { tag: "use", make: () => ({ code: `use <dep.scad>`, controls: [] }) },
  { tag: "include", make: () => ({ code: `include <dep.scad>`, controls: [] }) },
  {
    tag: "lineComment",
    requiresNL: true,
    make: (i) => ({ code: `// c${i}`, controls: [] }),
  },
  { tag: "blockComment", make: (i) => ({ code: `/* c${i} */`, controls: [] }) },
  { tag: "hidden", make: () => ({ code: `/* [Hidden] */`, controls: [] }) },
];

const ALL_TEMPLATES = [...ASSIGN_TEMPLATES, ...OTHER_TEMPLATES];

// Positions a separator can occupy between two already `;`/`>`-terminated
// statements: same line (tight or padded), a blank line, and a comment of
// each kind sitting between them — line, same-line block, and a block
// comment that itself spans a line break, both inline and on its own line.
const SEPARATORS = {
  space: " ",
  twoSpaces: "  ",
  tabs: "\t\t",
  newline: "\n",
  blankLine: "\n\n",
  lineComment: " // sep\n",
  blockSameLine: " /* sep */ ",
  blockMultiline: " /* x\ny */ ",
  blockOwnLine: "\n/* x\ny */\n",
};

// A `//` line comment runs to the next newline REGARDLESS of what characters
// follow it — so a separator placed right after one only leaves the next
// component intact if a newline appears before anything else does. Of
// SEPARATORS, that rules out the three whitespace-only ones (no newline at
// all: the next component would be swallowed into the comment) and the
// multi-line block comment (its embedded `\n` ends the line comment early,
// stranding a bare `*/` as the next line's leading text).
const SAFE_AFTER_LINE_COMMENT = ["newline", "blankLine", "lineComment", "blockOwnLine"];

function separatorsAfter(template, pool) {
  return template.requiresNL ? pool.filter((s) => SAFE_AFTER_LINE_COMMENT.includes(s)) : pool;
}

// check-scad-semantics.mjs wraps every shape in a leading `/* [Main] */`
// line before handing it to the parser (matching how a real design file
// starts), so a `[Hidden]` marker generated here can flip the ACTIVE
// section too — the Customizer rule that a section marker is a whole line to
// itself, nothing else on it (mirrored from SECTION_RE independently of
// params.mjs, since it is a fixed external rule rather than scanner
// internals). A `hidden` component sharing its line with the previous or
// next one (a `space`/`twoSpaces`/`tabs` separator either side) is NOT a
// section header there and so does nothing, matching the pinned engine's
// own view that `[Hidden]` is otherwise ordinary code.
const SECTION_LINE_RE = /^\s*\/\*\s*\[([^\]]+)\]\s*\*\/\s*$/;

function controlsActiveInMain(body, controlNames) {
  const lines = `/* [Main] */\n${body}`.split("\n");
  let section = "Main";
  const sectionByLine = lines.map((line) => {
    const m = line.match(SECTION_LINE_RE);
    if (m) section = m[1];
    return section;
  });
  return controlNames.filter((name) => {
    const lineIdx = lines.findIndex((l) => l.includes(`${name} = `));
    return sectionByLine[lineIdx] !== "Hidden";
  });
}

/**
 * Every two- and three-construct arrangement this scanner has to
 * distinguish, each as `{ what, body, expected }`: `body` is OpenSCAD source
 * (not yet validated — the caller checks it against the pinned engine
 * before asserting anything), `expected` is the control-name list the
 * generator itself put there.
 */
export function generateShapes() {
  const shapes = [];
  const pairSeps = Object.keys(SEPARATORS);

  for (const A of ALL_TEMPLATES) {
    const a = A.make(0);
    for (const B of ALL_TEMPLATES) {
      const b = B.make(1);
      for (const sepName of separatorsAfter(A, pairSeps)) {
        const body = a.code + SEPARATORS[sepName] + b.code;
        shapes.push({
          what: `pair: ${A.tag} ${sepName} ${B.tag}`,
          body,
          expected: controlsActiveInMain(body, [...a.controls, ...b.controls]),
        });
      }
    }
  }

  // A smaller set, three deep, for the shapes only a THIRD construct can
  // expose (a module sandwiched between two assignments; a comment sitting
  // between two module tails).
  const TRIPLE_TAGS = ["assign", "moduleDef", "use", "lineComment", "blockComment", "hidden"];
  const tripleTemplates = ALL_TEMPLATES.filter((t) => TRIPLE_TAGS.includes(t.tag));
  const tripleSeps = ["newline", "space", "blockOwnLine"];

  for (const A of tripleTemplates) {
    const a = A.make(0);
    for (const B of tripleTemplates) {
      const b = B.make(1);
      for (const C of tripleTemplates) {
        const c = C.make(2);
        for (const s1 of separatorsAfter(A, tripleSeps)) {
          for (const s2 of separatorsAfter(B, tripleSeps)) {
            const body = a.code + SEPARATORS[s1] + b.code + SEPARATORS[s2] + c.code;
            shapes.push({
              what: `triple: ${A.tag} ${s1} ${B.tag} ${s2} ${C.tag}`,
              body,
              expected: controlsActiveInMain(body, [...a.controls, ...b.controls, ...c.controls]),
            });
          }
        }
      }
    }
  }

  return shapes;
}
