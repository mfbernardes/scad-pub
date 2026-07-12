// Unit tests for scripts/lib/svg-sanitize.mjs — the defense-in-depth scrub for
// browser-facing SVGs (logo/icons). Covers the plain cases plus the evasion
// vectors from the review (#13): namespaced <script>/<foreignObject>, multiline
// event-handler values, and whitespace/entity-obfuscated URI schemes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeSvg } from "../scripts/lib/svg-sanitize.mjs";

const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
const clean = (svg) => sanitizeSvg(svg).text;

test("plain <script> and event handlers and javascript: hrefs are stripped", () => {
  const out = clean(
    wrap(`<script>alert(1)</script><rect onclick="steal()"/><a href="javascript:alert(1)">x</a>`)
  );
  assert.ok(!/<script/i.test(out));
  assert.ok(!/onclick/i.test(out));
  assert.ok(!/javascript:/i.test(out));
});

test("a namespaced <svg:script> element is stripped", () => {
  const res = sanitizeSvg(wrap(`<svg:script>alert(1)</svg:script><rect width="1" height="1"/>`));
  assert.ok(!/script/i.test(res.text), `still had a script: ${res.text}`);
  assert.ok(res.removed.includes("<script>"));
  // Inert content survives.
  assert.ok(res.text.includes('<rect width="1" height="1"/>'));
});

test("a namespaced <s:foreignObject> element is stripped", () => {
  const out = clean(wrap(`<s:foreignObject><body xmlns="http://www.w3.org/1999/xhtml">hi</body></s:foreignObject>`));
  assert.ok(!/foreignObject/i.test(out));
});

test("an event-handler value spanning multiple lines is stripped", () => {
  const out = clean(wrap(`<rect onload="\n  alert(1)\n" width="1" height="1"/>`));
  assert.ok(!/onload/i.test(out), `multiline onload survived: ${out}`);
});

test("entity- and whitespace-obfuscated javascript: schemes are stripped", () => {
  for (const evil of [
    `jav&#x61;script:alert(1)`, // hex entity for 'a'
    `jav&#97;script:alert(1)`, // decimal entity for 'a'
    `java\tscript:alert(1)`, // embedded tab
    `java\nscript:alert(1)`, // embedded newline
    `javascript&#58;alert(1)`, // entity-encoded colon
    `  javascript:alert(1)`, // leading whitespace
  ]) {
    const out = clean(wrap(`<a xlink:href="${evil}">x</a>`));
    assert.ok(!/xlink:href/i.test(out), `obfuscated scheme survived: ${evil} -> ${out}`);
  }
});

test("same-document fragment refs and scheme-less relative paths are preserved", () => {
  const svg = wrap(`<use href="#grad1"/><image href="pic.png"/><rect fill="url(#grad1)" width="1" height="1"/>`);
  const res = sanitizeSvg(svg);
  assert.equal(res.text, svg, "inert refs must be untouched byte-for-byte");
  assert.deepEqual(res.removed, []);
});

test("an already-inert SVG is returned unchanged with an empty removed list", () => {
  const svg = wrap(`<rect width="10" height="10" fill="red"/>`);
  const res = sanitizeSvg(svg);
  assert.equal(res.text, svg);
  assert.deepEqual(res.removed, []);
});
