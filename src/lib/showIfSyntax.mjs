// showIfSyntax.mjs: the `@showIf` expression grammar, shared verbatim by the
// two ends that must agree on it — scripts/lib/params.mjs, which accepts or
// rejects an expression at build time, and src/lib/visibility.ts, which
// evaluates the accepted ones in the browser.
//
// They were separate implementations, and they drifted the moment the build
// side learned to split outside quotes: the generator started accepting
// `mode=="p||q"` while the evaluator still split on every `||`, so the second
// half of the value became a clause that could not parse. isVisible's catch
// then did what it is there for and showed the control — for EVERY value of
// `mode`. A condition the generator had just validated was unconditionally
// true in the deployed UI, which is the worst shape this bug could take: it
// fails open, silently, only in production.
//
// `.mjs` under src/lib for the same reason securityHeaders.mjs is: build
// scripts are plain Node and cannot import TypeScript, so anything both sides
// need lives in a file both can read. It is NOT in worker.ts's hashed import
// closure (see CLAUDE.md), so editing it does not evict render caches.

/** Split `text` on `sep`, ignoring separators inside a "…" or '…' literal. */
export function splitOutsideQuotes(text, sep) {
  const parts = [];
  let start = 0;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i += 1; // an escaped character never closes the literal
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (text.startsWith(sep, i)) {
      parts.push(text.slice(start, i));
      i += sep.length - 1;
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * An expression as its clauses: an OR of ANDs, each innermost entry trimmed.
 * The one place the precedence (`a || b && c` == `(a) || (b && c)`) and the
 * quote-awareness are decided.
 * @param {string} expr
 * @returns {string[][]}
 */
export function showIfTerms(expr) {
  return splitOutsideQuotes(expr, "||").map((term) =>
    splitOutsideQuotes(term, "&&").map((clause) => clause.trim())
  );
}
