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

// ── escape-aware, fail-closed CSS safety ──────────────────────────────────
// A CSS tokenizer resolves `\<hex>`/`\<char>` escapes before it decides an
// ident is `url` or an at-keyword is `@import`, so `u\72 l(` and `@\69 mport`
// are both live references a scan of the literal spelling misses entirely.
// Shared by scripts/lib/svg-sanitize.mjs (which REMOVES an unfit block/value
// at build time) and src/lib/svgPrep/{check,fixes}.ts (which WARN about /
// drop one in the import wizard) so the two can never disagree about what
// counts as safe.

/** CSS escapes: `\<1-6 hex><one optional whitespace>` or `\<any char>`. */
export function normalizeCssEscapes(css) {
  return css.replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([\s\S]))/g, (_, hex, ch) => {
    if (!hex) return ch;
    const n = parseInt(hex, 16);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  });
}

// What IS closed-ended, once `@import`/foreign `url()` are gone, is the set of
// value functions that cannot reference anything: colours, maths, transforms.
// Anything else surviving — a string literal (how `image-set("…" 1x)` carries
// a URL with no `url()` in sight), a scheme, an unlisted function, any other
// at-rule — means the removal patterns above could not account for it, so the
// caller must discard the whole block/value rather than keep it half-scrubbed.
const SAFE_CSS_FUNCTIONS = new Set([
  // colour
  "rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color",
  "color-mix", "light-dark",
  // maths and custom properties
  "calc", "min", "max", "clamp", "round", "var", "env",
  // transforms
  "translate", "translatex", "translatey", "translate3d", "scale", "scalex",
  "scaley", "rotate", "rotate3d", "skew", "skewx", "skewy", "matrix", "matrix3d",
]);
const CSS_FUNCTION_RE = /([-\w]+)\s*\(/g;

// Every `@ident` at-keyword, matched as a MAXIMAL run of CSS ident characters
// (escapes are already normalized out by the time cssRisk sees this text, and
// CSS treats every code point >= U+0080 as an ident character) so a hostile
// ident can never masquerade as a shorter permitted one. `-` is included on
// purpose: `@-webkit-keyframes` has no `\w` inside the leading `-`.
const CSS_AT_RULE_RE = /@([-\w\u0080-\uffff]+)/g;

// The character allowlist for a @media PRELUDE (the text between `@media`
// and its `{`): idents, numbers, ratios, the range-syntax comparison
// operators, commas, colons, parens, whitespace. Deliberately excludes `@`,
// braces, `;`, quotes, `\`, `*`, `#`, `&`, brackets, `!`, `%`, `+`, `~` and
// every non-ASCII code point, so a second at-rule, a comment, a string, a
// fragment, or the approved-url() marker can never hide inside a prelude.
const MEDIA_PRELUDE_RE = /^[-\w\s(),.:/<>=]*$/;

// The only `name(` spellings a @media prelude may contain. Kept separate from
// SAFE_CSS_FUNCTIONS (the VALUE-function allowlist): a prelude like `screen
// and (min-width:100px)` reads as `and(`, and putting query keywords on the
// value allowlist would also legalize `fill: not(...)`.
const MEDIA_QUERY_FUNCTIONS = new Set(["media", "and", "or", "not", "only"]);

// Scans `css` for at-rules. Every at-rule other than `@media` is an immediate
// reject. A `@media` rule's PRELUDE must be plain media-query syntax; its
// BODY is left untouched in `probe` (the caller's other checks see it exactly
// as top-level CSS). Returns `probe` — `css` with every validated `@media`
// prelude replaced by a single space — for the function-allowlist scan alone.
function readAtRules(css) {
  let out = "";
  let last = 0;
  for (const m of css.matchAll(CSS_AT_RULE_RE)) {
    const name = m[1].toLowerCase();
    if (name !== "media") return { reason: `the at-rule @${m[1]}` };
    const open = css.indexOf("{", m.index + m[0].length);
    if (open < 0) return { reason: "a @media rule with no block" };
    const span = css.slice(m.index, open);
    const prelude = span.slice(m[0].length);
    if (!MEDIA_PRELUDE_RE.test(prelude)) return { reason: "a @media prelude this module cannot read" };
    for (const [, fn] of span.matchAll(CSS_FUNCTION_RE)) {
      if (!MEDIA_QUERY_FUNCTIONS.has(fn.toLowerCase()))
        return { reason: `the function ${fn}() in a @media prelude` };
    }
    out += css.slice(last, m.index) + " ";
    last = open;
  }
  return { reason: "", probe: out + css.slice(last) };
}

/** What makes a stylesheet (or a CSS-value attribute's text) unfit to keep,
 *  once `@import`/foreign `url()` have been accounted for, or "" when it's
 *  fit. */
function cssRisk(css) {
  const { reason, probe } = readAtRules(css);
  if (reason) return reason;
  if (/["']/.test(css)) return "a string literal (image-set carries a URL that way)";
  if (/:\s*\/\//.test(css) || /\w+:\/\//.test(css)) return "a URL scheme";
  for (const [, name] of probe.matchAll(CSS_FUNCTION_RE)) {
    if (!SAFE_CSS_FUNCTIONS.has(name.toLowerCase())) return `the function ${name}()`;
  }
  return "";
}

// The stand-in for a url() the allowlist approved, so the risk check above
// cannot see it. A private-use code point rather than a NUL: a control
// character in a regex is a lint error, and neither belongs in a stylesheet.
const APPROVED_MARK = "\uE000";

// How many foreign `@import`/`url()` references a given spelling of `css`
// exposes: a same-document `url(#frag)` is approved (marked, not counted).
function foreignRefCount(css) {
  let count = 0;
  css
    .replace(CSS_IMPORT_RE, () => {
      count++;
      return "";
    })
    .replace(CSS_URL_RE, (m, dq, sq, bare) => {
      if (isSameDocumentRef(dq ?? sq ?? bare ?? "")) return APPROVED_MARK;
      count++;
      return "none";
    });
  return count;
}

/**
 * Whether `css` — a `<style>` block's text, or a single CSS-value
 * attribute's value (`style=`, `fill=`, …) — is unfit to keep as authored:
 * an `@import`/`url()` spelled with CSS escapes that a literal-spelling
 * rewrite would miss (more foreign references show up in an escape-
 * normalized copy than in the original), or — once same-document `url()`s
 * are approved and foreign ones removed — a construct outside the closed
 * safe-function/`@media` allowlist (a quoted string, an unlisted function, a
 * URL scheme, any other at-rule). "" means fit to keep (rewriting foreign
 * `@import`/`url()` out of it is enough); a non-empty reason means the
 * caller must discard the whole block/value rather than keep it half-
 * scrubbed.
 */
export function cssUnsafeReason(css) {
  const normalized = normalizeCssEscapes(css).split(APPROVED_MARK).join("");
  if (foreignRefCount(normalized) > foreignRefCount(css))
    return "a reference written with CSS escapes";
  const probe = normalized
    .replace(CSS_IMPORT_RE, () => "")
    .replace(CSS_URL_RE, (m, dq, sq, bare) =>
      isSameDocumentRef(dq ?? sq ?? bare ?? "") ? APPROVED_MARK : "none"
    );
  return cssRisk(probe);
}
