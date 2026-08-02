// securityHeaders.mjs: build-time security-header assembly, shared verbatim
// by the Vite build (vite.config.ts, which hashes and appends the app-document
// CSP to dist/_headers) and the local static server (scripts/serve-dist.mjs,
// which needs to actually enforce the built _headers file so smoke/vis exercise
// the real policy). Plain ESM (no TS) so serve-dist.mjs can import it with no
// loader, the same reason fontNameTable.mjs exists in this form, see that
// file's header comment. A hand-written securityHeaders.d.mts types it for
// vite.config.ts. Pure string logic, no fs/crypto/Vite imports: hashing itself
// stays in the vite plugin (node:crypto), this module only shapes text.

// -- Inline-script extraction -----------------------------------------------

// Matches every <script>...</script> element, capturing its opening tag's
// attribute text (group 1, to check for `src`) and its raw body (group 2, to
// hash). Deliberately not a full HTML parser: this only ever runs against
// ScadPub's own built index.html, not third-party markup, and a regex over a
// handful of known <script> tags is the same trust boundary the rest of
// vite.config.ts's index.html string-replacement already relies on.
const INLINE_SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/**
 * The exact source text of every `<script>` element in `html` that has no
 * `src` attribute: i.e. every inline script a CSP `script-src` hash source
 * would need to allow. Today that's the single pre-paint theme script in
 * index.html, but this handles any count so a future inline script (or none)
 * still produces a correct policy without touching the caller.
 * @param {string} html
 * @returns {string[]}
 */
export function extractInlineScripts(html) {
  const bodies = [];
  for (const match of html.matchAll(INLINE_SCRIPT_RE)) {
    if (/\bsrc\s*=/i.test(match[1])) continue;
    bodies.push(match[2]);
  }
  return bodies;
}

/**
 * The `_headers` block text (Cloudflare Pages / Netlify convention) locking
 * down the app document itself: a CSP, clickjacking protection, MIME sniffing
 * protection, referrer minimisation, and unused-permission denial.
 *
 * `scriptHashes` are pre-formatted `sha256-<base64>` sources; the caller
 * (vite.config.ts) computes them from the built index.html, because this module
 * stays environment-free. They are quoted and appended to `script-src`.
 *
 * docs/security-headers.md gives the directive-by-directive rationale — why
 * each one is as permissive as it is. Read it before loosening anything.
 * @param {string[]} scriptHashes
 * @returns {string}
 */
export function buildAppHeadersBlock(scriptHashes) {
  const scriptSrc = ["'self'", "'wasm-unsafe-eval'", ...scriptHashes.map((h) => `'${h}'`)].join(" ");
  const policy = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `worker-src 'self'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' data:`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
    `frame-ancestors 'none'`,
    `manifest-src 'self'`,
  ].join("; ");
  return [
    "/*",
    `  Content-Security-Policy: ${policy}`,
    "  X-Frame-Options: DENY",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: no-referrer",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
    "",
  ].join("\n");
}

// -- `_headers` parsing (for the local dev/test static server) --------------

/**
 * @typedef {{ pattern: string, headers: [string, string][] }} HeaderRule
 */

/**
 * Parse Cloudflare Pages / Netlify `_headers` file text into an ordered list
 * of rules. A rule is a non-indented path-pattern line followed by any number
 * of indented `Name: value` lines; blank lines and `#`-comment lines (indented
 * or not) are noise and don't end the current rule. Real `_headers` files
 * (including this repo's) freely mix both between and around rules. A header
 * line with no preceding pattern (a malformed file) is dropped rather than
 * thrown on.
 * @param {string} text
 * @returns {HeaderRule[]}
 */
export function parseHeadersFile(text) {
  /** @type {HeaderRule[]} */
  const rules = [];
  /** @type {HeaderRule | null} */
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    if (/^\s/.test(line)) {
      if (!current) continue;
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      current.headers.push([line.slice(0, idx).trim(), line.slice(idx + 1).trim()]);
    } else {
      current = { pattern: line.trim(), headers: [] };
      rules.push(current);
    }
  }
  return rules;
}

// Split a pattern on its first `*` (there should only ever be one: multiple
// wildcards aren't part of the subset implemented here). No `*` at all means
// an exact match; `prefix`/`suffix` alone (empty string) still work as a
// pure-prefix (`/assets/*`) or pure-suffix (`/*.svg`) match respectively, and
// `/*` collapses to prefix "/" suffix "": every path, since every pathname
// starts with "/".
function splitPattern(pattern) {
  const starIdx = pattern.indexOf("*");
  return starIdx === -1
    ? { prefix: pattern, suffix: null }
    : { prefix: pattern.slice(0, starIdx), suffix: pattern.slice(starIdx + 1) };
}

// Whether `pattern` matches `pathname`, with Cloudflare's own `_headers` glob
// semantics: `*` matches any run of characters INCLUDING `/`, so `/*.svg`
// matches both `/icon.svg` and a nested `/scad/foo/bar.svg`. The splat
// crosses slashes, it isn't scoped to one path segment the way a router glob
// can be. That's deliberate here too: `public/_headers`'s `/*.svg` rule is
// meant to catch every served SVG regardless of depth.
function matchesPattern(pattern, pathname) {
  const { prefix, suffix } = splitPattern(pattern);
  if (suffix === null) return pathname === prefix;
  return (
    pathname.startsWith(prefix) &&
    pathname.endsWith(suffix) &&
    pathname.length >= prefix.length + suffix.length
  );
}

/**
 * The merged headers a Cloudflare Pages host would send for `pathname`,
 * applying every matching rule IN FILE ORDER, not only the first match, and
 * comma-JOINING two rules that set the same header name rather than letting the
 * later one win. Both are real host behaviour that public/_headers depends on:
 * a comma-joined CSP is enforced as the INTERSECTION of its policies, which is
 * how /scad/*'s sandbox survives the appended app CSP. Overriding instead would
 * silently drop that sandbox. See docs/security-headers.md.
 *
 * Header names are compared case-insensitively, as HTTP requires; the first
 * matching rule's casing is kept.
 * @param {HeaderRule[]} rules
 * @param {string} pathname
 * @returns {Record<string, string>}
 */
export function headersFor(rules, pathname) {
  /** @type {Map<string, [string, string]>} */
  const merged = new Map();
  for (const rule of rules) {
    if (!matchesPattern(rule.pattern, pathname)) continue;
    for (const [name, value] of rule.headers) {
      const key = name.toLowerCase();
      const prev = merged.get(key);
      merged.set(key, prev ? [prev[0], `${prev[1]}, ${value}`] : [name, value]);
    }
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (const [name, value] of merged.values()) out[name] = value;
  return out;
}
