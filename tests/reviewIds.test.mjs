// Roughly 180 comments across the tree cite an architecture-review finding ID
// (`M10`, `H3`, `L1`) as shorthand for an invariant. The grouping is the point —
// every M10 site describes one mechanism — but it only works if the codes
// resolve, and for a long stretch they did not: the committed review numbered
// its findings 1-10 and contained no such codes at all.
//
// This is the guard that keeps them resolving: every ID cited in a comment must
// have a row in the review's appendix, and the appendix must still carry the
// full historical set. Path data in an SVG-shaped string is excluded by scanning only the
// comment part of each line — including a comment trailing code, which cites
// just as much as a full-line one does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REVIEW = join(ROOT, "docs", "architecture-review.md");
const SCAN_ROOTS = ["src", "scripts", "tests"];
const SCAN_FILES = [join("public", "sw.js"), "eslint.config.js", "vite.config.ts"];
const SOURCE_EXT = new Set([".ts", ".tsx", ".mjs", ".js"]);

const ID_RE = /\b([HML][0-9]+)\b/g;
// The comment part of a line, whether the line opens one or trails one after
// code (`foo(); // see M17` cites just as much as a full-line comment does).
// Restricting to the comment keeps an SVG path attribute in a fixture or a
// component out of the results.
const COMMENT_PART_RE = /^\s*(?:\/\/|\/\*|\*).*$|\/\/.*$|\/\*.*$/;
// Quoted or backticked runs INSIDE a comment are quoted material — a path
// string being explained, an example ID being discussed — not a citation.
const QUOTED_RUN_RE = /"[^"]*"|'[^']*'|`[^`]*`/g;
// `L<n>` is also this codebase's own vocabulary: the render cache's two tiers
// are called L1 (the in-memory LRU) and L2 (the IndexedDB store), and
// stlCache.ts and runner.ts say so a couple of dozen times. Those are not
// citations, and counting them made this test agree with the review by
// coincidence rather than by check — it would have gone on passing with every
// real L-citation deleted. So an L-code counts only when the comment also names
// the review it is citing. `H`/`M` codes have no such collision and stay bare.
// (The appendix-completeness test below pins the L rows regardless, so nothing
// goes unguarded.)
const REVIEW_MENTION_RE = /\breview\b/i;

function sourceFiles() {
  const out = SCAN_FILES.map((f) => join(ROOT, f));
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "generated") continue;
        walk(abs);
        continue;
      }
      if (SOURCE_EXT.has(extname(entry.name))) out.push(abs);
    }
  };
  for (const r of SCAN_ROOTS) walk(join(ROOT, r));
  // Only the hand-listed SCAN_FILES need proving; readdirSync's Dirent already
  // established it for everything the walk found.
  return out.filter((f, i) => {
    if (i >= SCAN_FILES.length) return true;
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  });
}

/** Every finding ID cited in a comment -> the files citing it. */
function citedIds() {
  const cited = new Map();
  for (const file of sourceFiles()) {
    for (const line of readFileSync(file, "utf-8").split("\n")) {
      const comment = line.match(COMMENT_PART_RE)?.[0];
      if (!comment) continue;
      const text = comment.replace(QUOTED_RUN_RE, " ");
      for (const [, id] of text.matchAll(ID_RE)) {
        if (id.startsWith("L") && !REVIEW_MENTION_RE.test(text)) continue;
        if (!cited.has(id)) cited.set(id, new Set());
        cited.get(id).add(file.slice(ROOT.length));
      }
    }
  }
  return cited;
}

/** Every ID the review's appendix defines (a `| \`ID\` |` table row). Memoised:
 *  both tests want the same set, and it costs a file read plus a scan. */
let definedIdsCache = null;
function definedIds() {
  if (definedIdsCache) return definedIdsCache;
  const defined = new Set();
  for (const m of readFileSync(REVIEW, "utf-8").matchAll(/^\|\s*`([HML][0-9]+)`\s*\|/gm))
    defined.add(m[1]);
  definedIdsCache = defined;
  return defined;
}

test("every finding ID cited in a comment resolves against the review appendix", () => {
  const defined = definedIds();
  const unresolved = [...citedIds()]
    .filter(([id]) => !defined.has(id))
    .map(([id, files]) => `${id} (cited from ${[...files].sort().join(", ")})`);
  assert.deepEqual(
    unresolved,
    [],
    `these IDs resolve to nothing in docs/architecture-review.md:\n  ${unresolved.join("\n  ")}`
  );
});

test("the review appendix defines the full historical ID set", () => {
  // Pinned rather than derived: a future review APPENDS to the appendix and
  // never renumbers, so a row disappearing is a mistake even when nothing
  // currently cites it.
  const defined = definedIds();
  const expected = [
    ...["H1", "H2", "H3", "H4", "H5", "H6"],
    ...Array.from({ length: 16 }, (_, i) => `M${i + 1}`),
    ...["L1", "L2"],
  ];
  for (const id of expected) assert.ok(defined.has(id), `${id} must have an appendix row`);
});
