// Unit tests for src/lib/cssRefs.mjs's own primitives, shared by
// scripts/lib/svg-sanitize.mjs and src/lib/svgPrep (see tests/svgSanitize.test.mjs
// and tests/svgPrep.test.mjs for the caller-level agreement assertions).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CSS_IMPORT_RE, CSS_URL_RE, isSameDocumentRef, urlRefValue } from "../src/lib/cssRefs.mjs";

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
