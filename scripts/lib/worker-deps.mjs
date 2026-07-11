// worker-deps.mjs — statically resolve the render worker's own local-import
// dependency closure, starting at src/openscad/worker.ts. H3: the render
// contract must hash every executable file that can affect geometry, and a
// hand-maintained file list silently goes stale the moment worker.ts starts
// pulling in a new helper. Deriving the closure with a (small, static) parser
// instead means a new local import is automatically covered — see
// tests/worker-deps.test.mjs for the guard that keeps this true.
//
// Only RELATIVE (`./`, `../`) specifiers that resolve to a local .ts/.tsx
// source file are followed:
//   - a bare/package specifier (e.g. "react") is never local worker code;
//   - a non-source resolution (e.g. `../generated/designs.json`) can't be
//     read as a further import graph — schema.json's *content* (the design
//     routing map) is hashed separately by the caller (see gen-schema.mjs),
//     not by treating it as a source file here.
// A dynamic, non-literal import (`import(/* @vite-ignore */ asset(...))`, the
// pattern worker.ts uses to load openscad.js) is intentionally NOT matched —
// there is no static specifier to resolve, so that binary is hashed directly
// by hash.mjs instead of discovered here.
import { readFileSync, existsSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

// Matches `import ... from "spec"` / `export ... from "spec"` (any content,
// including multi-line named-import lists, between the keyword and `from`)
// and the bare side-effect form `import "spec"`. Doesn't distinguish a
// type-only import (`import type { X } from "./types"`) from a value import:
// a false positive there only makes the hash over-invalidate, never
// under-invalidate — the safe direction for a cache-correctness hash.
const IMPORT_RE =
  /(?:import|export)(?:[^'"();]*?)\bfrom\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g;

function resolveSpecifier(spec, fromDir) {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null; // bare/package specifier
  const base = resolve(fromDir, spec);
  const ext = extname(base);
  // A specifier with an explicit non-TS extension (e.g. "../generated/designs.json")
  // is a data import, not a further source file to parse for imports — its
  // content is hashed separately (or not at all) by the caller, not followed here.
  if (ext && ext !== ".ts" && ext !== ".tsx") return null;
  const candidates = ext ? [base] : [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/**
 * The sorted, deduplicated set of absolute paths in entryAbsPath's local
 * import closure (including entryAbsPath itself, when it exists on disk).
 */
export function resolveWorkerDependencyClosure(entryAbsPath) {
  const visited = new Set();
  const queue = [resolve(entryAbsPath)];
  while (queue.length) {
    const file = queue.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    let text;
    try {
      text = readFileSync(file, "utf-8");
    } catch {
      continue; // referenced but unreadable — nothing further to follow
    }
    const dir = dirname(file);
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      const resolved = resolveSpecifier(spec, dir);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return [...visited].sort();
}
