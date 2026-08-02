// cssRefs.mjs: the CSS reference primitives shared verbatim by the two
// modules that each decide something different about a foreign `url()` or
// `@import` in an SVG — scripts/lib/svg-sanitize.mjs, which REMOVES one from a
// browser-facing asset at build time, and src/lib/svgPrep/{check,fixes}.ts,
// which WARN about / neutralise one in the import wizard. The element
// allowlist/denylist each keeps is a policy decision and stays separate; only
// the parsing — what counts as a same-document reference, how `url()`'s value
// is extracted — is one answer both sides need.
//
// `.mjs` under src/lib for the same reason showIfSyntax.mjs is: build scripts
// are plain Node and cannot import TypeScript, so anything both sides need
// lives in a file both can read.

/** Whether a `url()`/`href` value stays inside this document (a bare
 *  `#fragment`), and so may be kept by a caller that only trusts same-document
 *  references. */
export function isSameDocumentRef(value) {
  return /^\s*#[^\s"'<>]*\s*$/.test(value);
}

export const CSS_IMPORT_RE = /@import\b[^;]*;?/gi;

// The quoted forms first, so a value containing `)` runs to its closing quote
// rather than to the first paren — `url("a)b.png")` is the concrete case this
// exists for.
export const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;

/** The referenced value out of a CSS_URL_RE match, whichever of the three
 *  alternatives matched (double-quoted, single-quoted, bare). */
export function urlRefValue(match) {
  return match[1] ?? match[2] ?? match[3] ?? "";
}
