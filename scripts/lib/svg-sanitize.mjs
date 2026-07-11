// svg-sanitize.mjs — minimal defense-in-depth for BROWSER-FACING SVGs (the app
// logo, PWA icon, and per-design picker icon). See M13 in
// docs/architecture-review.md and the "SVG asset trust model" section of
// docs/config.md for the full policy: design/config sources are trusted
// operator input, not a sandbox, but a served SVG that becomes an active
// HTML document on direct navigation is a cheap thing to neutralize anyway.
//
// Deliberately NOT applied to render-input SVGs copied into public/scad/ by
// copyAsset() (config `assets` / a design's use/include graph, consumed by
// OpenSCAD's import()/surface()) — those bytes are geometry, and this module
// does not parse SVG well enough to guarantee it never perturbs a path,
// transform or viewBox. Those rely on the operator-input trust boundary plus
// the response headers in public/_headers instead (nosniff + a locked-down
// CSP neutralize script execution on direct navigation without touching a
// single byte of path data).
//
// This is a regex-based scrub, not a real XML parser (the project has no XML
// parsing dependency, and none of these files are attacker-adversarial
// against a parser — they're trusted operator input getting a cheap second
// layer). It strips exactly three known ways an SVG becomes "active":
//   1. <script>...</script> elements (and empty/self-closing <script/>), and
//      <foreignObject> elements (can embed arbitrary HTML/script).
//   2. `on*="..."` event-handler attributes (onload, onclick, onerror, …).
//   3. `href`/`xlink:href` values that carry a URI *scheme* (http:, file:,
//      data:, javascript:, …). Same-document fragment references
//      (`href="#gradient1"`), used routinely for gradients/clip-paths/<use>,
//      have no scheme and are left alone.
// Returns { text, removed } — `removed` is a list of short labels for what was
// stripped, empty when the input was already inert, so callers can log it.

const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>|<script\b[^>]*\/\s*>/gi;
const FOREIGN_OBJECT_RE =
  /<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>|<foreignObject\b[^>]*\/\s*>/gi;
// on<word>="..." or on<word>='...' — covers onload, onclick, onerror, etc.
const EVENT_ATTR_RE = /\son[a-z]+\s*=\s*(".*?"|'.*?')/gi;
// href / xlink:href carrying a URI scheme (javascript:, http(s):, data:,
// file:, …). data: is included — an attacker-controlled data: URI can itself
// carry an active document (e.g. data:text/html or a nested data:image/svg
// with its own <script>). A bare same-document fragment ("#id") or a
// scheme-less relative path has no ":" before the first "/" and is untouched.
const SCHEME_HREF_RE = /\s((?:xlink:)?href)\s*=\s*("[a-z][a-z0-9+.-]*:[^"]*"|'[a-z][a-z0-9+.-]*:[^']*')/gi;

function stripAll(text, re, label, removed) {
  if (re.test(text)) removed.push(label);
  re.lastIndex = 0;
  return text.replace(re, "");
}

export function sanitizeSvg(svgText) {
  const removed = [];
  let out = svgText;
  out = stripAll(out, SCRIPT_RE, "<script>", removed);
  out = stripAll(out, FOREIGN_OBJECT_RE, "<foreignObject>", removed);
  out = stripAll(out, EVENT_ATTR_RE, "event-handler attribute(s)", removed);
  out = stripAll(out, SCHEME_HREF_RE, "scheme href/xlink:href (incl. javascript:/external)", removed);
  return { text: out, removed };
}
