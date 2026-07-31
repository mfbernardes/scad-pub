// Unit tests for the build-time security-header assembly (src/lib/securityHeaders.mjs)
// shared by vite.config.ts's closeBundle plugin and scripts/serve-dist.mjs's
// local static server. The module is pure (no fs/crypto/Vite imports), so
// Node loads it directly with no loader hook, same as fontNameTable.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractInlineScripts,
  buildAppHeadersBlock,
  parseHeadersFile,
  headersFor,
} from "../src/lib/securityHeaders.mjs";

// -- extractInlineScripts -----------------------------------------------

test("extractInlineScripts: no <script> elements -> []", () => {
  assert.deepEqual(extractInlineScripts("<html><head></head><body></body></html>"), []);
});

test("extractInlineScripts: a single inline script returns its exact body", () => {
  const html = `<head><script>\n  var x = 1;\n</script></head>`;
  assert.deepEqual(extractInlineScripts(html), ["\n  var x = 1;\n"]);
});

test("extractInlineScripts: a <script src=...> is ignored (external, not inline)", () => {
  const html = `<script src="/assets/main.js"></script>`;
  assert.deepEqual(extractInlineScripts(html), []);
});

test("extractInlineScripts: a src-bearing and an inline script together only yields the inline one", () => {
  const html = [
    `<script type="module" src="/assets/main.js"></script>`,
    `<script>console.log("hi");</script>`,
  ].join("\n");
  assert.deepEqual(extractInlineScripts(html), [`console.log("hi");`]);
});

test("extractInlineScripts: multiple inline scripts are all returned, in order", () => {
  const html = `<script>a();</script><div></div><script>b();</script>`;
  assert.deepEqual(extractInlineScripts(html), ["a();", "b();"]);
});

// -- buildAppHeadersBlock -------------------------------------------------

test("buildAppHeadersBlock: interpolates each hash, quoted, into script-src", () => {
  const block = buildAppHeadersBlock(["sha256-AAAA", "sha256-BBBB"]);
  assert.match(
    block,
    /script-src 'self' 'wasm-unsafe-eval' 'sha256-AAAA' 'sha256-BBBB';/
  );
});

test("buildAppHeadersBlock: no hashes still yields a valid script-src (self + wasm-unsafe-eval only)", () => {
  const block = buildAppHeadersBlock([]);
  assert.match(block, /script-src 'self' 'wasm-unsafe-eval';/);
});

test("buildAppHeadersBlock: emits the exact directive set and sibling headers", () => {
  const block = buildAppHeadersBlock(["sha256-XYZ"]);
  const lines = block.split("\n");
  assert.equal(lines[0], "/*");
  assert.equal(
    lines[1],
    "  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-XYZ'; " +
      "worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; " +
      "connect-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; " +
      "frame-ancestors 'none'; manifest-src 'self'"
  );
  assert.equal(lines[2], "  X-Frame-Options: DENY");
  assert.equal(lines[3], "  X-Content-Type-Options: nosniff");
  assert.equal(lines[4], "  Referrer-Policy: no-referrer");
  assert.equal(lines[5], "  Permissions-Policy: camera=(), microphone=(), geolocation=()");
  // Trailing blank line so appending this text after existing _headers content
  // never runs a directive into the next line.
  assert.equal(lines[6], "");
});

// -- parseHeadersFile / headersFor -----------------------------------------

const SAMPLE = `# a leading comment, no meaning to the parser
/assets/*
  Cache-Control: public, max-age=31536000, immutable

# another comment between rules
/icon.svg
  Content-Security-Policy: default-src 'none'; sandbox
  X-Content-Type-Options: nosniff
/*.svg
  Content-Security-Policy: default-src 'none'; sandbox
  X-Content-Type-Options: nosniff

/*
  Content-Security-Policy: default-src 'self'
  X-Frame-Options: DENY
`;

test("parseHeadersFile: reads pattern + indented header lines into rules, skipping comments/blanks", () => {
  const rules = parseHeadersFile(SAMPLE);
  assert.deepEqual(
    rules.map((r) => r.pattern),
    ["/assets/*", "/icon.svg", "/*.svg", "/*"]
  );
  assert.deepEqual(rules[0].headers, [["Cache-Control", "public, max-age=31536000, immutable"]]);
  assert.deepEqual(rules[1].headers, [
    ["Content-Security-Policy", "default-src 'none'; sandbox"],
    ["X-Content-Type-Options", "nosniff"],
  ]);
});

test("headersFor: exact-path pattern matches only that path", () => {
  const rules = parseHeadersFile(SAMPLE);
  const exactRule = rules.filter((r) => r.pattern === "/icon.svg");
  assert.equal(headersFor(exactRule, "/icon.svg")["X-Content-Type-Options"], "nosniff");
  // A different .svg path doesn't match the exact /icon.svg rule at all.
  assert.deepEqual(headersFor(exactRule, "/other.svg"), {});
});

test("headersFor: /assets/* prefix pattern matches nested paths under it, not siblings", () => {
  const rules = parseHeadersFile(SAMPLE);
  const h = headersFor(rules, "/assets/main-abc123.js");
  assert.equal(h["Cache-Control"], "public, max-age=31536000, immutable");
  assert.deepEqual(headersFor(rules.filter((r) => r.pattern === "/assets/*"), "/wasm/openscad.wasm"), {});
});

test("headersFor: /* catch-all matches every path", () => {
  const rules = parseHeadersFile(SAMPLE);
  const catchAll = rules.filter((r) => r.pattern === "/*");
  assert.equal(headersFor(catchAll, "/")["X-Frame-Options"], "DENY");
  assert.equal(headersFor(catchAll, "/anything/at/all.json")["X-Frame-Options"], "DENY");
});

test("headersFor: /*.svg suffix pattern crosses slashes (matches nested paths, not just top-level)", () => {
  const rules = parseHeadersFile(SAMPLE);
  const svgRule = rules.filter((r) => r.pattern === "/*.svg");
  assert.equal(headersFor(svgRule, "/logo.svg")["X-Content-Type-Options"], "nosniff");
  assert.equal(headersFor(svgRule, "/scad/parts/gear.svg")["X-Content-Type-Options"], "nosniff");
  assert.deepEqual(headersFor(svgRule, "/logo.png"), {});
});

test("headersFor: multiple matching rules combine their (distinct) headers into one response", () => {
  const rules = parseHeadersFile(SAMPLE);
  // "/icon.svg" matches the exact rule (CSP + nosniff) AND the /* catch-all
  // (a different CSP + X-Frame-Options): all three header NAMES appear.
  const h = headersFor(rules, "/icon.svg");
  // Both the exact /icon.svg rule and the /*.svg rule match "/icon.svg" and
  // each set X-Content-Type-Options, so the (duplicate) value is joined too.
  assert.equal(h["X-Content-Type-Options"], "nosniff, nosniff");
  assert.equal(h["X-Frame-Options"], "DENY");
  assert.ok(h["Content-Security-Policy"], "CSP present");
});

// Cloudflare Pages does not let a later matching rule's value replace an
// earlier one's for the SAME header name: it joins both with ", " into one
// header ("If a header is applied twice in the _headers file, the values are
// joined with a comma separator", per Cloudflare's own docs). For
// Content-Security-Policy specifically this is exactly the mechanism that
// makes "both policies enforced" true: a comma-separated CSP header value is
// a list of policies the browser enforces as their intersection, so this is
// NOT a redundant string-format detail. An override implementation would
// silently drop the stricter /scad/*-style policy wherever it overlaps
// another rule.
test("headersFor: a later matching rule's same-named header is comma-joined, not overridden", () => {
  const rules = parseHeadersFile(`
/foo/*
  X-Test: first

/*
  X-Test: second
`);
  assert.equal(headersFor(rules, "/foo/bar")["X-Test"], "first, second");
});

test("headersFor: header-name comparison is case-insensitive, per HTTP, and the first rule's casing wins", () => {
  const rules = parseHeadersFile(`
/foo/*
  x-test: first

/*
  X-TEST: second
`);
  const h = headersFor(rules, "/foo/bar");
  assert.equal(Object.keys(h).length, 1);
  assert.equal(h["x-test"], "first, second");
});

test("headersFor: /icon.svg's CSP and the appended app CSP comma-join into one policy list", () => {
  // Mirrors the real dist/_headers shape: public/_headers's /icon.svg block
  // (unchanged) followed by the securityHeaders vite plugin's appended /*
  // block. The joined value must contain BOTH policies verbatim, comma-
  // separated: that's what makes the browser enforce their intersection.
  const rules = parseHeadersFile(`
/icon.svg
  Content-Security-Policy: default-src 'none'; sandbox
  X-Content-Type-Options: nosniff

/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'
  X-Frame-Options: DENY
`);
  const h = headersFor(rules, "/icon.svg");
  assert.equal(
    h["Content-Security-Policy"],
    "default-src 'none'; sandbox, default-src 'self'; script-src 'self' 'wasm-unsafe-eval'"
  );
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.equal(h["X-Frame-Options"], "DENY");
});

test("headersFor: no matching rule -> {}", () => {
  const rules = parseHeadersFile(`/assets/*\n  Cache-Control: immutable\n`);
  assert.deepEqual(headersFor(rules, "/index.html"), {});
});
