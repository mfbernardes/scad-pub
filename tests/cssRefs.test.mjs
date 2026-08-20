// Unit tests for src/lib/cssRefs.mjs's own primitives, shared by
// scripts/lib/svg-sanitize.mjs and src/lib/svgPrep (see tests/svgSanitize.test.mjs
// and tests/svgPrep.test.mjs for the caller-level agreement assertions).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CSS_IMPORT_RE,
  CSS_URL_RE,
  cssUnsafeReason,
  isSameDocumentRef,
  normalizeCssEscapes,
  urlRefValue,
} from "../src/lib/cssRefs.mjs";

test("isSameDocumentRef accepts only a bare #fragment", () => {
  assert.ok(isSameDocumentRef("#gradient"));
  assert.ok(isSameDocumentRef("  #gradient  "));
  assert.ok(!isSameDocumentRef(""));
  assert.ok(!isSameDocumentRef("http://evil.test/x.png"));
  assert.ok(!isSameDocumentRef("/relative.png"));
  assert.ok(!isSameDocumentRef("#a b")); // whitespace inside the fragment
});

test("CSS_URL_RE extracts the value from all three url() forms", () => {
  for (const [css, expected] of [
    [`url(#g)`, "#g"],
    [`url("#g")`, "#g"],
    [`url('#g')`, "#g"],
    [`url("a)b.png")`, "a)b.png"], // the quoted-')' case the two sides used to disagree on
    [`url('a)b.png')`, "a)b.png"],
    [`url(plain.png)`, "plain.png"],
  ]) {
    const match = [...css.matchAll(CSS_URL_RE)][0];
    assert.ok(match, css);
    assert.equal(urlRefValue(match), expected, css);
  }
});

test("CSS_IMPORT_RE matches @import statements with or without a trailing semicolon", () => {
  assert.equal([...`@import url(http://evil.test/x.css);`.matchAll(CSS_IMPORT_RE)].length, 1);
  assert.equal([...`@import "x.css"`.matchAll(CSS_IMPORT_RE)].length, 1);
  assert.equal([...`.a{color:red}`.matchAll(CSS_IMPORT_RE)].length, 0);
});

test("normalizeCssEscapes decodes hex escapes (with the one optional trailing whitespace) and bare-char escapes", () => {
  assert.equal(normalizeCssEscapes("u\\72 l"), "url");
  assert.equal(normalizeCssEscapes("@\\69mport"), "@import");
  assert.equal(normalizeCssEscapes("\\@media"), "@media");
  assert.equal(normalizeCssEscapes("plain"), "plain");
});

test("cssUnsafeReason is fit (\"\") for ordinary foreign/same-document url()s and @media/colour/transform CSS", () => {
  assert.equal(cssUnsafeReason(".a{fill:red;background:url(http://evil.test/p.png)}.b{fill:url(#g)}"), "");
  assert.equal(cssUnsafeReason('url("http://evil.test/a)b.png")'), "");
  assert.equal(cssUnsafeReason("@media (prefers-color-scheme: dark){.a{fill:rgb(1,2,3)}}"), "");
});

test("cssUnsafeReason flags an @import/url() spelled with CSS escapes (more refs normalized than literal)", () => {
  assert.match(cssUnsafeReason(".a{background:u\\72 l(http://evil.test/x)}"), /CSS escapes/);
  // A bare-string @import (no url() at all) is the realistic evasion: no
  // literal "url(" for the un-normalized pass to catch either.
  assert.match(cssUnsafeReason('@\\69mport "http://evil.test/x.css";'), /CSS escapes/);
});

test("cssUnsafeReason flags image-set()'s bare quoted-string URL, once url()/@import are accounted for", () => {
  assert.match(cssUnsafeReason('.a{background:image-set("http://evil.test/x.png" 1x)}'), /string literal/);
});

test("cssUnsafeReason flags an unlisted function surviving the allowlist", () => {
  assert.match(cssUnsafeReason(".a{fill:not-a-real-function(1)}"), /function/);
});
