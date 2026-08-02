// Types for showIfSyntax.mjs, which is plain JS so build scripts (which cannot
// import TypeScript) and the app can share one tokenizer. Same arrangement as
// scripts/lib/config-spec.d.mts.
export function splitOutsideQuotes(text: string, sep: string): string[];
export function showIfTerms(expr: string): string[][];
