// Unit tests for the build-time <head> CSS assembly (src/lib/configCss.ts) that
// vite.config.ts injects. Locks down the consumer-facing theming behaviour —
// the `colors` token map and the `extraCss` escape hatch — without spinning up
// Vite. The module is pure (no imports), so Node's type-stripping loads it as-is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { colorStyle, escapeHtml, headStyleInjection } from "../src/lib/configCss.ts";

test("colorStyle returns '' when no colours are configured", () => {
  assert.equal(colorStyle(null), "");
  assert.equal(colorStyle(undefined), "");
  assert.equal(colorStyle({}), "");
  // present-but-empty theme maps still produce nothing
  assert.equal(colorStyle({ dark: {}, light: {} }), "");
});

test("colorStyle emits per-theme :root blocks with bumped specificity", () => {
  const css = colorStyle({
    dark: { accent: "#ff7849", "viewer-model": "#ff7849" },
    light: { accent: "#b8430f" },
  });
  // dark -> :root:root, light -> :root:root[data-theme="light"]; the doubled
  // root is what beats index.css regardless of source order.
  assert.match(css, /:root:root \{\n {2}--accent: #ff7849;\n {2}--viewer-model: #ff7849;\n\}/);
  assert.match(css, /:root:root\[data-theme="light"\] \{\n {2}--accent: #b8430f;\n\}/);
  assert.ok(css.startsWith("<style>\n"));
  assert.ok(css.trimEnd().endsWith("</style>"));
});

test("colorStyle emits only the themes that are present", () => {
  const darkOnly = colorStyle({ dark: { bg: "#000" } });
  assert.match(darkOnly, /:root:root \{/);
  assert.ok(!darkOnly.includes('data-theme="light"'));

  const lightOnly = colorStyle({ light: { bg: "#fff" } });
  assert.match(lightOnly, /:root:root\[data-theme="light"\] \{/);
  // no bare dark :root:root block when dark is absent
  assert.ok(!/:root:root \{/.test(lightOnly));
});

test("colorStyle drops tokens that could break out of the <style> block", () => {
  // A </style> breakout and CSS-rule injection are both rejected, leaving no block.
  assert.equal(colorStyle({ dark: { accent: "</style><script>alert(1)</script>" } }), "");
  assert.equal(colorStyle({ dark: { accent: "red; } body { display: none }" } }), "");
  // An unsafe token name is dropped too (contains : } and spaces).
  assert.equal(colorStyle({ dark: { "x: red } html {}": "#fff" } }), "");
  // A valid token alongside an unsafe one keeps only the valid one.
  const css = colorStyle({ dark: { accent: "#fff", bad: "</style>" } });
  assert.match(css, /--accent: #fff;/);
  assert.ok(!css.includes("--bad"), "the unsafe token must not be emitted");
});

test("colorStyle accepts the usual CSS colour forms", () => {
  const css = colorStyle({
    dark: { a: "#abc", b: "rgb(255, 0, 0)", c: "oklch(0.7 0.1 30)", d: "var(--x)" },
  });
  assert.match(css, /--a: #abc;/);
  assert.match(css, /--b: rgb\(255, 0, 0\);/);
  assert.match(css, /--c: oklch\(0\.7 0\.1 30\);/);
  assert.match(css, /--d: var\(--x\);/);
});

test("headStyleInjection: nothing configured -> empty string", () => {
  assert.equal(headStyleInjection({}), "");
  assert.equal(headStyleInjection({ colors: null, extraCss: null }), "");
});

test("headStyleInjection: extraCss becomes a <link> after the colour <style>", () => {
  const out = headStyleInjection({
    colors: { dark: { accent: "#ff7849" } },
    extraCss: "scad/theme.css",
  });
  const styleAt = out.indexOf("<style>");
  const linkAt = out.indexOf("<link ");
  assert.ok(styleAt !== -1, "colour <style> present");
  assert.ok(linkAt !== -1, "extraCss <link> present");
  // Order is the contract: the escape hatch loads last so it wins on source order.
  assert.ok(styleAt < linkAt, "the colour <style> must precede the extraCss <link>");
  assert.match(out, /<link rel="stylesheet" href="scad\/theme\.css" \/>/);
});

test("headStyleInjection: extraCss alone emits just the <link>", () => {
  const out = headStyleInjection({ extraCss: "scad/theme.css" });
  assert.ok(!out.includes("<style>"));
  assert.match(out, /^<link rel="stylesheet" href="scad\/theme\.css" \/>\n$/);
});

test("headStyleInjection: double-quotes in extraCss are escaped to prevent HTML injection", () => {
  const out = headStyleInjection({ extraCss: 'evil"onload="alert(1)' });
  // The href attribute must not contain a raw " that could break out of the attribute.
  assert.ok(!out.includes('"onload='), "raw quote must not appear in output");
  assert.match(out, /href="evil&quot;onload=&quot;alert\(1\)"/);
});

test("escapeHtml neutralises element-text and attribute breakouts", () => {
  // Element-text context (<title>): a closing tag must not survive.
  assert.equal(
    escapeHtml("</title><script>alert(1)</script>"),
    "&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;"
  );
  // Attribute context (<meta content="…">): quotes must not survive.
  assert.equal(escapeHtml('a" onload="x'), "a&quot; onload=&quot;x");
  assert.equal(escapeHtml("it's"), "it&#39;s");
  // & is escaped first so entities aren't double-mangled.
  assert.equal(escapeHtml("a & b &amp; c"), "a &amp; b &amp;amp; c");
  // Plain text passes through untouched.
  assert.equal(escapeHtml("Tactile Braille configurator"), "Tactile Braille configurator");
});
