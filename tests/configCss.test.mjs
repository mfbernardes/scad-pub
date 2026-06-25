// Unit tests for the build-time <head> CSS assembly (src/lib/configCss.ts) that
// vite.config.ts injects. Locks down the consumer-facing theming behaviour —
// the `colors` token map and the `extraCss` escape hatch — without spinning up
// Vite. The module is pure (no imports), so Node's type-stripping loads it as-is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { colorStyle, headStyleInjection } from "../src/lib/configCss.ts";

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
