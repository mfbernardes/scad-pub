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
// This is a regex-based scrub, not a real XML parser (the project takes on no
// XML-parsing dependency for it). It is DEFENSE-IN-DEPTH over TRUSTED operator
// input — the design/config author's own logo/icon SVGs — NOT a guarantee
// against adversarial SVG. A determined author can still craft input a regex
// misses; the actual guarantee against a served SVG executing as a document
// comes from public/_headers (`nosniff` + a `default-src 'none'; sandbox`
// CSP). On hosts that ignore custom headers (notably GitHub Pages) that CSP is
// absent, so this scrub is the only in-band layer there — hence it now covers
// the obfuscations a browser itself normalizes away, but the security claim
// remains "trusted operator input, hardened defense-in-depth", not "safe to
// feed attacker-controlled SVG".
//
// It strips the three known ways an SVG becomes "active", each hardened against
// the evasions a naive regex misses:
//   1. <script> and <foreignObject> elements — INCLUDING a namespace prefix
//      (`<svg:script>`, `<s:foreignObject>`), and empty/self-closing forms.
//   2. `on*=` event-handler attributes — including values that span multiple
//      lines (dotAll), e.g. onload="\n  alert(1)\n".
//   3. `href`/`xlink:href` values carrying a URI *scheme* (http:, file:, data:,
//      javascript:, …) — checked AFTER normalizing away the whitespace/control
//      chars and HTML entities a browser ignores when reading a scheme, so
//      "jav&#x61;script:", "java\tscript:" and "javascript&#58;…" are caught.
//      A same-document fragment ("#gradient1") or a scheme-less relative path
//      is left alone (routine for gradients/clip-paths/<use>).
// Returns { text, removed } — `removed` is a list of short labels for what was
// stripped, empty when the input was already inert, so callers can log it.

// An optional XML namespace prefix on an element name, e.g. the `svg:` in
// `<svg:script>`. Kept permissive so an unusual prefix can't smuggle the element past.
const NS = "(?:[a-z_][\\w.-]*:)?";
const SCRIPT_RE = new RegExp(
  `<${NS}script\\b[^>]*>[\\s\\S]*?<\\/${NS}script\\s*>|<${NS}script\\b[^>]*\\/\\s*>`,
  "gi"
);
const FOREIGN_OBJECT_RE = new RegExp(
  `<${NS}foreignObject\\b[^>]*>[\\s\\S]*?<\\/${NS}foreignObject\\s*>|<${NS}foreignObject\\b[^>]*\\/\\s*>`,
  "gi"
);
// on<word>="..." / '...' — the `s` (dotAll) flag lets a quoted value cross
// newlines, so a line-wrapped handler value is still matched and removed.
const EVENT_ATTR_RE = /\son[a-z]+\s*=\s*(".*?"|'.*?')/gis;
// Every href / xlink:href attribute, captured so its value can be normalized
// and scheme-checked individually (see hasUriScheme).
const HREF_ATTR_RE = /\s(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

function stripAll(text, re, label, removed) {
  if (re.test(text)) removed.push(label);
  re.lastIndex = 0;
  return text.replace(re, "");
}

function codePoint(n) {
  try {
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}

// Normalize a URL value the way a browser does before interpreting its scheme:
// decode numeric/hex HTML entities (and &colon;), then drop the ASCII
// whitespace and control characters it ignores. So "jav&#x61;script:",
// "java\tscript:" and "javascript&#58;alert(1)" all collapse to "javascript:".
function deobfuscateScheme(value) {
  const decoded = value
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => codePoint(parseInt(d, 10)))
    .replace(/&colon;/gi, ":");
  // Drop ASCII whitespace and C0/DEL control chars (code point <= 0x20, or
  // 0x7f) — the ones a browser ignores when reading a URL scheme. Done by
  // code point rather than a control-char regex literal (avoids no-control-regex).
  let out = "";
  for (const ch of decoded) {
    const c = ch.codePointAt(0);
    if (c > 0x20 && c !== 0x7f) out += ch;
  }
  return out;
}

// A value "carries a scheme" if, after de-obfuscation, it begins with
// `<scheme>:` — as opposed to a same-document fragment ("#id") or a scheme-less
// relative path, both of which are safe and preserved.
function hasUriScheme(value) {
  const v = deobfuscateScheme(value);
  return !v.startsWith("#") && /^[a-z][a-z0-9+.-]*:/i.test(v);
}

function stripSchemeHrefs(text, removed) {
  let hit = false;
  const out = text.replace(HREF_ATTR_RE, (match, dq, sq) => {
    if (hasUriScheme(dq ?? sq ?? "")) {
      hit = true;
      return "";
    }
    return match; // scheme-less (fragment/relative) — keep byte-for-byte
  });
  if (hit) removed.push("scheme href/xlink:href (incl. javascript:/external)");
  return out;
}

export function sanitizeSvg(svgText) {
  const removed = [];
  let out = svgText;
  out = stripAll(out, SCRIPT_RE, "<script>", removed);
  out = stripAll(out, FOREIGN_OBJECT_RE, "<foreignObject>", removed);
  out = stripAll(out, EVENT_ATTR_RE, "event-handler attribute(s)", removed);
  out = stripSchemeHrefs(out, removed);
  return { text: out, removed };
}
