// Unit tests for scripts/lib/svg-sanitize.mjs: the defense-in-depth scrub for
// browser-facing SVGs (logo/icons). Covers the plain cases plus the evasion
// vectors from the review (#13): namespaced <script>/<foreignObject>, multiline
// event-handler values, and whitespace/entity-obfuscated URI schemes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeSvg } from "../scripts/lib/svg-sanitize.mjs";

const wrap = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${inner}</svg>`;
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
  // The prefix is DECLARED: an undeclared one is not well-formed namespaced
  // XML, so a browser asked to render the file as image/svg+xml refuses the
  // whole document — and so, now, does this module.
  const res = sanitizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg">` +
      `<svg:script>alert(1)</svg:script><rect width="1" height="1"/></svg>`
  );
  assert.ok(!/script/i.test(res.text), `still had a script: ${res.text}`);
  assert.ok(res.removed.includes("<script>"));
  // Inert content survives.
  assert.match(res.text, /<rect width="1" height="1"\/>/);
});

test("a namespaced <s:foreignObject> element is stripped", () => {
  const out = clean(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg">` +
      `<s:foreignObject><body xmlns="http://www.w3.org/1999/xhtml">hi</body></s:foreignObject>` +
      `<rect width="1" height="1"/></svg>`
  );
  assert.ok(!/foreignObject/i.test(out));
  assert.match(out, /<rect/);
});

test("an event-handler value spanning multiple lines is stripped", () => {
  const out = clean(wrap(`<rect onload="\n  alert(1)\n" width="1" height="1"/>`));
  assert.ok(!/onload/i.test(out), `multiline onload survived: ${out}`);
});

test("a character reference hiding a scheme is decoded by the parser, then stripped", () => {
  // Numeric character references are XML's own, so the parser resolves them
  // before this module ever sees the value — which is why no de-obfuscation
  // pass exists here any more. Whitespace arrives already normalised too.
  for (const evil of [
    `jav&#x61;script:alert(1)`, // hex reference for 'a'
    `jav&#97;script:alert(1)`, // decimal reference for 'a'
    `javascript&#58;alert(1)`, // reference-encoded colon
    `  javascript:alert(1)`, // leading whitespace
  ]) {
    const out = clean(wrap(`<a xlink:href="${evil}">x</a>`));
    assert.doesNotMatch(out, /href/i, `obfuscated scheme survived: ${evil}`);
  }
});

test("an HTML named entity is not XML, and is refused rather than guessed at", () => {
  // `&colon;` `&Tab;` `&NewLine;` are HTML's; XML predefines five entities and
  // none of them are these. A browser asked to render this as image/svg+xml
  // reports an undefined-entity error and draws nothing, so the honest answer
  // is to fail the build rather than to reimplement HTML's entity table in
  // order to sanitize a document that will never render.
  for (const evil of ["javascript&colon;alert(1)", "jav&Tab;ascript:alert(1)"]) {
    assert.throws(() => sanitizeSvg(wrap(`<a href="${evil}">x</a>`)), /not well-formed XML/, evil);
  }
});

test("an already-inert SVG is returned unchanged with an empty removed list", () => {
  const svg = wrap(`<rect width="10" height="10" fill="red"/>`);
  const res = sanitizeSvg(svg);
  assert.equal(res.text, svg);
  assert.deepEqual(res.removed, []);
});

// ── verified evasions ──────────────────────────────────────────────────────
// Each of these is markup a browser accepts and the scrub used to pass through
// untouched. None was exploitable in the shipped app (the served CSP and, for
// the wizard, never reaching the DOM), which is exactly why they went unnoticed.

test("an unquoted attribute value is refused, handler or not", () => {
  // `onload=alert(1)` was worth catching while this module read markup with
  // regexes. A parser knows it is not well-formed XML — attribute values must
  // be quoted — so a browser asked to render the file as image/svg+xml refuses
  // the whole document. Repairing it quietly meant shipping an asset that
  // renders nowhere, while the docs said malformed XML fails the build.
  assert.throws(() => sanitizeSvg(`<svg><rect onload=alert(1)/></svg>`), /not well-formed XML/);
  assert.throws(() => sanitizeSvg(wrap(`<rect fill=red/>`)), /not well-formed XML/);
  // No SVG in this repo trips it, and neither does a legacy DOCTYPE.
  const withDoctype =
    `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ` +
    `"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">` +
    `<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>`;
  assert.deepEqual(sanitizeSvg(withDoctype).removed, []);
});

test("a handler separated from the tag name by a slash is refused", () => {
  // `<rect/onload=…>` is HTML tag-soup, not XML: a `/` may only precede the `>`
  // that closes an empty element. It was worth catching while this module read
  // markup with regexes and could not tell the difference; a parser can, and a
  // document a browser would refuse to render is not one to quietly repair.
  assert.throws(() => sanitizeSvg(wrap(`<rect/onload="alert(1)"/>`)), /not well-formed XML/);
});

test("a non-xlink namespace prefix on href gets the same treatment", () => {
  const { text } = sanitizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xlink">` +
      `<a x:href="javascript:alert(1)"><rect/></a></svg>`
  );
  assert.doesNotMatch(text, /javascript/i);
  // A fragment reference under a prefix is still routine and must survive.
  const keep = sanitizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xlink">` +
      `<use x:href="#icon"/></svg>`
  );
  assert.match(keep.text, /x:href="#icon"/);
});

test("SMIL animation elements are stripped", () => {
  // <animate attributeName="href" values="javascript:…"> sets at runtime
  // exactly what the href rule removes statically.
  const { text, removed } = sanitizeSvg(
    wrap(`<a><animate attributeName="href" values="javascript:alert(1)"/><rect/></a>`)
  );
  assert.doesNotMatch(text, /<animate/i);
  assert.doesNotMatch(text, /javascript/i);
  assert.ok(removed.some((r) => r.includes("SMIL")));
  assert.match(text, /<rect/);
});

test("<style> keeps its rules but loses what fetches", () => {
  const { text, removed } = sanitizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg"><style>@import url("http://evil.test/x.css");` +
      `.a{fill:red;background:url(http://evil.test/x.png)}` +
      `.b{fill:url(#grad)}</style><rect class="a"/></svg>`
  );
  assert.doesNotMatch(text, /@import/i);
  assert.doesNotMatch(text, /evil\.test/);
  assert.match(text, /\.a\{fill:red/, "the icon's own fill rules survive");
  assert.match(text, /url\(#grad\)/, "a same-document reference survives");
  assert.ok(removed.some((r) => r.includes("<style>")));
});

test("an already-inert icon is returned byte-for-byte", () => {
  // The scrub over-matching on ordinary artwork would be worse than the
  // evasions it closes.
  const clean =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<title>A tag</title><defs><linearGradient id="g"/></defs>` +
    `<style>.a{fill:url(#g)}</style>` +
    `<path class="a" d="M1 1 L2 2Z"/><use href="#g"/></svg>`;
  const { text, removed } = sanitizeSvg(clean);
  assert.equal(text, clean);
  assert.deepEqual(removed, []);
});

// ── references: the allowlist, over a parsed document ──────────────────────
// A reference is kept only when it is a same-document `#fragment`. Two
// properties make that rule hold, and both were learned the hard way:
//
//   the allowlist itself — the blocklist it replaced had to reproduce, in the
//   browser's own order, XML character references then CSS escapes then
//   backslash normalisation, and each round of review found another ordering
//   it had wrong;
//
//   and a real parser under it — an allowlist is worth nothing if the pattern
//   that FINDS a reference can be dodged, which a namespace prefix outside
//   ASCII and a CSS-escaped `url(` both did.
//
// Every case below got through some earlier version. They are kept together as
// the record of why this module parses.

const NS_ATTRS = `xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`;
const doc = (inner) => `<svg ${NS_ATTRS}>${inner}</svg>`;

const KEPT = [
  ["a fragment", `<use href="#icon"/>`],
  ["an xlink fragment", `<use xlink:href="#icon"/>`],
  ["a url() fragment", `<rect fill="url(#grad1)"/>`],
  ["a url() fragment in a style attribute", `<rect style="filter:url(#f)"/>`],
  ["a url() fragment in a stylesheet", `<style>.a{fill:url(#g)}</style><rect class="a"/>`],
  ["a plain stylesheet", `<style>.a{fill:red}</style><rect class="a"/>`],
  ["a drawing with no references at all", `<rect width="10" height="10" fill="red"/>`],
];

const STRIPPED = [
  ["javascript:", `<a href="javascript:alert(1)"><rect/></a>`],
  ["a character-reference scheme", `<a href="jav&#x61;script:alert(1)"><rect/></a>`],
  ["an http: url()", `<rect fill="url(https://evil.example/p.svg#paint)"/>`],
  ["a protocol-relative href", `<image href="//evil.example/i.png"/>`],
  ["a backslash authority", String.raw`<image href="\\evil.example/i.png"/>`],
  ["an XML reference feeding a CSS escape", String.raw`<rect fill="url(\6&#x38;ttps://evil.example/x.svg#p)"/>`],
  ["a quoted url() containing a paren", `<style>.a{fill:url("https://evil.example/x?a)b")}</style>`],
  // A CSS tokenizer resolves escapes in an ident BEFORE deciding it is `url`,
  // so `u\72 l(` is a url token and `@\69 mport` an at-rule. Patterns matching
  // the literal spellings saw neither.
  ["a CSS-escaped url(", String.raw`<style>.a{fill:u\72 l(https://evil.example/x.svg#p)}</style>`],
  ["a CSS-escaped @import", String.raw`<style>@\69 mport "https://evil.example/x.css";</style>`],
  ["a CSS-escaped url() in an attribute", String.raw`<rect fill="u\72 l(https://evil.example/x.svg#p)"/>`],
  // These files are copied individually into a flat served directory under
  // generated names, so a sibling reference resolves to a file that was never
  // copied: the allowlist removes nothing that worked.
  ["a relative file href", `<image href="pic.png"/>`],
  ["a relative url()", `<rect fill="url(sprite.svg#p)"/>`],
];

test("a same-document reference is kept, and the file is not even re-serialized", () => {
  for (const [what, inner] of KEPT) {
    const svg = doc(inner);
    const res = sanitizeSvg(svg);
    assert.deepEqual(res.removed, [], what);
    assert.equal(res.text, svg, `${what}: a clean asset must pass through byte-for-byte`);
  }
});

test("everything that is not a same-document reference is removed", () => {
  for (const [what, inner] of STRIPPED) {
    const res = sanitizeSvg(doc(inner));
    assert.doesNotMatch(res.text, /evil\.example|javascript/i, what);
    assert.ok(res.removed.length > 0, `${what}: nothing was reported as removed`);
  }
});

test("a namespace prefix outside ASCII is still a namespace prefix", () => {
  // `é` is a valid NCName start character and `\w` in a JS regex is ASCII, so
  // every prefix-matching pattern this module used to carry missed it. The
  // parser resolves the prefix and the rule applies to the resolved name.
  // On `<use>`, an element the allowlist keeps, so it is the HREF rule under
  // test here and not the element rule.
  const { text, removed } = sanitizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:é="http://www.w3.org/1999/xlink">` +
      `<use é:href="https://evil.example/i.svg"/></svg>`
  );
  assert.doesNotMatch(text, /evil\.example/);
  assert.ok(removed.some((r) => r.includes("href")), removed.join("; "));
  assert.match(text, /<use/, "the element itself is allowed and stays");
  // And the same for an element name.
  const script = sanitizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:é="http://www.w3.org/2000/svg">` +
      `<é:script>alert(1)</é:script><rect width="1" height="1"/></svg>`
  );
  assert.doesNotMatch(script.text, /alert/);
  assert.match(script.text, /<rect/, "the drawing survives");
});

test("a stylesheet is kept only if what remains cannot reference anything", () => {
  // The rule, inverted for the last time. "Things that fetch" is open-ended —
  // `url()`, then `@import`, then `image-set("…" 1x)`, which carries its URL as
  // a bare string with no `url()` in it at all and which Chromium really does
  // fetch. What IS closed-ended is the set of value functions that cannot
  // reference anything, so a block survives only if that is all that is left.
  for (const [what, css] of [
    ["image-set with a URL", `.a{background:image-set("https://evil.example/x.png" 1x)}`],
    ["image-set with a relative path", `.a{background:image-set("x.png" 1x)}`],
    ["an unterminated url(", `.a{fill:url(https://evil.example/a.svg#x`],
    ["a function nobody vouched for", `.a{fill:some-future-fn(https://evil.example/x)}`],
    // `@media` is the one at-rule that survives (see cssRisk); these are
    // still correctly rejected BY THE AT-RULE RULE, with no string or
    // function involved, so they isolate what they claim to test.
    ["a font-face at-rule", `@font-face{font-family:x}`],
    ["a keyframes at-rule", `@keyframes s{from{fill:red}}`],
    ["a supports at-rule", `@supports (fill:red){.a{fill:red}}`],
    ["a safe at-rule beside an unsafe one", `@media print{.a{fill:red}}@font-face{font-family:x}`],
    ["an at-rule whose name only starts with media", `@media-x (min-width:1px){.a{fill:red}}`],
  ]) {
    const { text, removed } = sanitizeSvg(doc(`<style>${css}</style><rect class="a"/>`));
    assert.doesNotMatch(text, /evil\.example|image-set/, what);
    assert.ok(removed.length > 0, `${what}: nothing reported`);
    assert.doesNotMatch(text, /<style/, `${what}: the block should have been dropped, not merely rewritten`);
    assert.match(text, /<rect/, `${what}: the drawing is not collateral`);
  }

  // What an icon's stylesheet actually contains still passes untouched.
  for (const css of [
    `.a{fill:red;stroke:#0f0;stroke-width:2}`,
    `.a{fill:rgb(1 2 3)}`,
    `.a{fill:url(#g);width:calc(1px + var(--x))}`,
    `.a{transform:translate(1px,2px) rotate(45deg)}`,
    `@media (prefers-color-scheme: dark){.a{fill:#8FB0F5}}`,
    `.a{fill:#333}@media (prefers-color-scheme:dark){.a{fill:#fff}}`,
    `@media screen and (min-width:100px){.a{fill:red}}`,
    `@MEDIA print{.a{fill:#000}}`,
    `@media screen{@media (min-width:1px){.a{fill:red}}}`,
    `@media (min-aspect-ratio: 16/9){.a{fill:red}}`,
    // An escaped at-keyword that normalizes to `@media` — kept WITH the
    // escape intact, since the output is never the normalized copy.
    String.raw`@\6d edia print{.a{fill:red}}`,
  ]) {
    const svg = doc(`<style>${css}</style><rect class="a"/>`);
    const res = sanitizeSvg(svg);
    assert.deepEqual(res.removed, [], css);
    assert.equal(res.text, svg, `${css} must survive byte-for-byte`);
  }
});

test("an approved url(#fragment) does not make its own stylesheet look unreadable", () => {
  // The fail-closed rule has to ignore the references it just approved, or the
  // commonest stylesheet in an icon — one that fills from a gradient — reads as
  // residue and the whole block is dropped.
  const { text, removed } = sanitizeSvg(
    doc(`<style>@import url("//evil.test/x.css"); .a{fill:red} .b{fill:url(#grad)}</style><rect class="a"/>`)
  );
  assert.doesNotMatch(text, /evil\.test/);
  assert.match(text, /\.a\{fill:red\}/, "the icon's own rules survive");
  assert.match(text, /url\(#grad\)/, "and so does its same-document reference");
  assert.ok(!removed.some((r) => r.includes("will not vouch for")), removed.join("; "));
});

test("removing a reference does not damage the drawing around it", () => {
  const { text } = sanitizeSvg(
    doc(`<rect width="10" height="10" fill="url(https://evil.example/p.svg#x)"/><circle r="5" fill="#0f0"/>`)
  );
  assert.match(text, /<rect[^>]*width="10"/);
  assert.match(text, /<circle[^>]*r="5"/);
  assert.match(text, /fill="#0f0"/);
});

test("an SVG that is not well-formed XML fails rather than being copied", () => {
  // XML is draconian: a browser asked to render these as image/svg+xml refuses
  // them too. The build is simply the first place that says so, and gen-schema
  // wraps this to name the file.
  for (const bad of [`<svg><rect width="1"></svg>`, `not markup at all`, ``]) {
    assert.throws(() => sanitizeSvg(bad), /not well-formed XML/, JSON.stringify(bad));
  }
});

test("the project's own browser-facing SVGs pass through untouched", () => {
  // The over-match check, against real artwork rather than a fixture: these are
  // the files the build actually sanitizes.
  const root = fileURLToPath(new URL("..", import.meta.url));
  const dirs = ["examples", "branding"].map((d) => join(root, d)).filter(existsSync);
  const svgs = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".svg")).map((f) => join(d, f)));
  assert.ok(svgs.length > 0, "expected some real SVGs to check");
  for (const file of svgs) {
    const src = readFileSync(file, "utf-8");
    const res = sanitizeSvg(src);
    assert.deepEqual(res.removed, [], `${file} was modified: ${res.removed.join("; ")}`);
    assert.equal(res.text, src, `${file} did not pass through byte-for-byte`);
  }
});

test("detection normalizes escapes; the OUTPUT never does", () => {
  // The two views have to stay separate. A CSS tokenizer resolves escapes
  // before deciding an ident is `url`, so detection has to see the normalized
  // text — but emitting it corrupted valid CSS: `.\31 23` is a legal class
  // that becomes the illegal `.123`, and a literal private-use character was
  // deleted, both reported as if they were external references.
  const styled = (css) => sanitizeSvg(doc(`<style>${css}</style><rect class="a"/>`));

  // Escapes with nothing to hide: byte-for-byte, nothing reported.
  for (const css of [String.raw`.\31 23{color:red}`, `.a{color:red}/**/`]) {
    const svg = doc(`<style>${css}</style><rect class="a"/>`);
    const res = sanitizeSvg(svg);
    assert.deepEqual(res.removed, [], css);
    assert.equal(res.text, svg, `${css} must not be rewritten`);
  }

  // An escaped reference is caught even though normalizing it neutralizes the
  // probe's own copy — the literal text still carries what the rewrite pass
  // cannot match, so the block goes rather than shipping unrewritten.
  const escaped = styled(String.raw`.a{fill:u\72 l(https://evil.example/x)}`);
  assert.doesNotMatch(escaped.text, /evil\.example/);
  assert.ok(escaped.removed.length > 0);
});

test("only attributes that carry a CSS value are scrubbed for url()", () => {
  // Scrubbing every attribute turned prose into markup damage.
  const prose = doc(`<rect aria-label="see url(https://docs.example)" data-note="url(x)"/>`);
  const res = sanitizeSvg(prose);
  assert.equal(res.text, prose, "a text attribute is not a CSS value");
  assert.deepEqual(res.removed, []);

  // Every attribute that IS one still fails closed.
  for (const attr of ["style", "fill", "stroke", "filter", "mask", "clip-path", "marker-end"]) {
    const value = attr === "style" ? `filter:url(https://evil.example/x)` : `url(https://evil.example/x)`;
    const { text, removed } = sanitizeSvg(doc(`<rect ${attr}="${value}"/>`));
    assert.doesNotMatch(text, /evil\.example/, attr);
    assert.ok(removed.length > 0, attr);
  }
});

test("an xml-stylesheet processing instruction is removed", () => {
  // Not an element, and it sits OUTSIDE documentElement, so an element-only
  // walk from the root never saw it. Verified fetching in Chromium.
  const { text, removed } = sanitizeSvg(
    `<?xml version="1.0"?><?xml-stylesheet type="text/css" href="https://evil.example/x.css"?>` +
      `<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>`
  );
  assert.doesNotMatch(text, /evil\.example/);
  assert.ok(removed.some((r) => r.includes("xml-stylesheet")));
  assert.match(text, /<rect/, "the drawing survives");
  // The XML declaration is not a stylesheet PI and must not be disturbed.
  const clean = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`;
  assert.equal(sanitizeSvg(clean).text, clean);
});

test("an element is kept only if it is an SVG element an icon can use", () => {
  // The element rule is an allowlist for the same reason the reference rule is.
  // SVG 2 permits HTML elements in an SVG document, and `<html:video src>`,
  // `<html:video poster>`, `<html:img src>` and `<html:iframe src>` ALL fetch —
  // verified in Chromium. None is an SVG element, so none of them needed
  // naming: listing what may STAY closes the next one too.
  const HTML = `xmlns:html="http://www.w3.org/1999/xhtml"`;
  for (const [what, inner] of [
    ["video src", `<html:video ${HTML} src="https://evil.example/m.mp4"/>`],
    ["video poster", `<html:video ${HTML} poster="https://evil.example/p.png"/>`],
    ["img", `<html:img ${HTML} src="https://evil.example/i.png"/>`],
    ["iframe", `<html:iframe ${HTML} src="https://evil.example/f.html"/>`],
    ["a source inside a video", `<html:video ${HTML}><html:source src="https://evil.example/s.mp4"/></html:video>`],
  ]) {
    const { text, removed } = sanitizeSvg(doc(inner));
    assert.doesNotMatch(text, /evil\.example/, what);
    assert.ok(removed.some((r) => r.includes("outside the SVG namespace")), `${what}: ${removed}`);
  }
});

test("the elements an icon is actually made of are kept", () => {
  // The cost of an element allowlist is a legitimate element left off it, so
  // pin the shape of a real icon: structure, defs, gradients, shapes, text.
  const icon = doc(
    `<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient>` +
      `<clipPath id="c"><rect width="4" height="4"/></clipPath></defs>` +
      `<title>An icon</title><desc>Drawn by hand</desc>` +
      `<g clip-path="url(#c)"><path d="M0 0h4v4z" fill="url(#g)"/><circle cx="1" cy="1" r="1"/>` +
      `<text x="0" y="3">hi</text></g><use href="#g"/>`
  );
  const res = sanitizeSvg(icon);
  assert.deepEqual(res.removed, []);
  assert.equal(res.text, icon, "an ordinary icon must pass through byte-for-byte");
});

test("a CSS attribute is inspected whether or not it mentions url()", () => {
  // `cursor: image-set("…" 1x)` fetches in Chromium and contains no `url(` at
  // all, so gating the CSS check on "does this mention url()" meant the value
  // was never looked at.
  const { text, removed } = sanitizeSvg(
    doc(`<rect cursor="image-set(&quot;https://evil.example/c.png&quot; 1x), auto"/>`)
  );
  assert.doesNotMatch(text, /evil\.example/);
  assert.ok(removed.length > 0);
});

test("xml:base is removed, so a #fragment cannot be rebased elsewhere", () => {
  // Chromium ignores xml:base (Blink removed support), so this is insurance
  // rather than a demonstrated vector — but it would otherwise make the
  // reference rule's meaning depend on the engine, and no icon needs it.
  const { text, removed } = sanitizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" xml:base="https://evil.example/r/">` +
      `<use href="#a"/></svg>`
  );
  assert.doesNotMatch(text, /evil\.example/);
  assert.ok(removed.includes("xml:base"));
  assert.match(text, /href="#a"/, "the fragment itself is still fine");
});

test("an <a> keeps its fragment link and its artwork, but never a ping", () => {
  // `ping` is a list of URLs the browser requests in the background when the
  // link is followed, and it really does fire on an SVG <a> — activating one in
  // Chromium sends every URL listed. scripts/check-svg-inert.mjs proves both
  // halves: that the unsanitized form fetches, and that the sanitized one does
  // not.
  const { text, removed } = sanitizeSvg(
    doc(`<a href="#ok" ping="https://evil.example/p1 //evil.example/p2"><rect id="ok" width="1" height="1" fill="red"/></a>`)
  );
  assert.doesNotMatch(text, /evil\.example/, "both ping URLs go");
  assert.doesNotMatch(text, /ping/, "the attribute itself goes");
  assert.ok(removed.includes("ping"));
  // The link and the artwork stay: <a> is a legitimate container.
  assert.match(text, /<a href="#ok"/, "a same-document link is still fine");
  assert.match(text, /<rect id="ok" width="1" height="1" fill="red"\/>/, "the artwork is untouched");
});

test("a dropped stylesheet says WHY it was dropped", () => {
  // cssRisk works out the reason and it used to be thrown away, so an operator
  // whose Illustrator icon lost its `style="font-family:'ArialMT';fill:#231F20"`
  // was told to go looking for a `url()` that is not in the file. The drop
  // itself is the documented fail-closed policy; the explanation is what makes
  // it actionable, and gen-schema prints `removed` verbatim.
  const D = (inner) => sanitizeSvg(doc(inner)).removed.join("; ");
  assert.match(D(`<text style="font-family:&apos;ArialMT&apos;;fill:#231F20">Hi</text>`), /string literal/);
  assert.match(D(`<text style="font-family:&apos;ArialMT&apos;;fill:#231F20">Hi</text>`), /style attribute/);
  assert.match(D(`<style>@font-face{font-family:x}</style><rect class="a"/>`), /the at-rule @font-face/);
  assert.match(D(`<style>.a{fill:some-future-fn(x)}</style><rect class="a"/>`), /some-future-fn\(\)/);
});

test("inert metadata vocabularies survive, and still cannot shelter anything", () => {
  // `<metadata><rdf:RDF>` is where a CC-licensed icon carries the attribution
  // its licence REQUIRES, and every Inkscape file carries sodipodi/inkscape
  // state — stripping those deleted real content and warned on essentially
  // every Inkscape-authored icon, which teaches an operator to ignore the
  // warning that also reports the dangerous removals.
  const inkscape =
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
    `xmlns:cc="http://creativecommons.org/ns#" ` +
    `xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" ` +
    `xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" ` +
    `xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 64 64">` +
    `<sodipodi:namedview pagecolor="#ffffff"/>` +
    `<metadata><rdf:RDF><cc:Work rdf:about=""><dc:creator>Someone</dc:creator></cc:Work></rdf:RDF></metadata>` +
    `<g inkscape:groupmode="layer"><rect width="40" height="40"/></g></svg>`;
  const res = sanitizeSvg(inkscape);
  assert.deepEqual(res.removed, [], "an ordinary Inkscape file is not touched");
  assert.equal(res.text, inkscape, "and passes through byte-for-byte");

  // It is a shelter for nothing: the walk re-applies the element rule to the
  // children of everything it keeps.
  const HTML = `xmlns:html="http://www.w3.org/1999/xhtml"`;
  for (const [what, inner] of [
    ["an HTML element nested in RDF", `<rdf:RDF><html:img ${HTML} src="https://evil.example/x.png"/></rdf:RDF>`],
    ["a script nested in RDF", `<rdf:RDF><script>alert(1)</script></rdf:RDF>`],
    ["an HTML element straight under metadata", `<html:img ${HTML} src="https://evil.example/y.png"/>`],
  ]) {
    const { text, removed } = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
        `<metadata>${inner}</metadata><rect width="1" height="1"/></svg>`
    );
    assert.doesNotMatch(text, /evil\.example|alert/, what);
    assert.ok(removed.length > 0, what);
  }
  // And a reference on one of them is still a reference.
  const { text } = sanitizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
      `<metadata><rdf:RDF href="https://evil.example/z"/></metadata><rect width="1" height="1"/></svg>`
  );
  assert.doesNotMatch(text, /evil\.example/);
});

test("the document must actually be an SVG, declared as one", () => {
  // The element allowlist alone let a non-SVG document through as an empty
  // husk: every element was stripped, `removed` explained why, and the build
  // wrote a file with no root — which resvg reports as a rasterization failure
  // if it happens to be rasterized, and nothing reports at all if it is only
  // served. The root is checked before any of that.
  const SVG = "http://www.w3.org/2000/svg";
  for (const [what, doc] of [
    ["a <g> root", `<g xmlns="${SVG}"><rect width="1" height="1"/></g>`],
    // xmldom INFERS the SVG namespace for a bare <svg> under the image/svg+xml
    // mimetype, so namespaceURI alone cannot see this one — and resvg refuses
    // it ("does not have a root node"), so the declaration is load-bearing.
    ["an <svg> that declares no namespace", `<svg width="1" height="1"><rect/></svg>`],
    [
      "an RDF root",
      `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description/></rdf:RDF>`,
    ],
    ["an unknown element in the SVG namespace", `<notsvg xmlns="${SVG}"><rect/></notsvg>`],
    ["an HTML document", `<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>`],
  ])
    assert.throws(() => sanitizeSvg(doc), /root must be <svg/, what);

  // And the two shapes that ARE an SVG root still pass.
  for (const [what, doc] of [
    ["the ordinary form", `<svg xmlns="${SVG}" width="1" height="1"><rect/></svg>`],
    [
      "a prefixed root",
      `<s:svg xmlns:s="${SVG}" width="1" height="1"><s:rect/></s:svg>`,
    ],
  ])
    assert.doesNotThrow(() => sanitizeSvg(doc), what);
});

// ── shared with src/lib/svgPrep/dom.ts via src/lib/cssRefs.mjs ────────────
// A quoted url() value containing `)` used to parse differently on the two
// sides (see src/lib/cssRefs.mjs's header); this pins that they now agree.

test("a quoted url() value containing ')' is recognised as external, not same-document", () => {
  const out = clean(
    wrap(`<style>.a{background:url("http://evil.test/a)b.png")}</style><rect width="1" height="1"/>`)
  );
  assert.doesNotMatch(out, /evil\.test/, `external ref with ')' survived: ${out}`);
});

test("a @media block is kept, and everything inside it is still checked", () => {
  // Dropping a stylesheet for containing ANY at-rule used to remove an icon's
  // BASE styling too, not just a dark-mode override, whenever the icon was
  // themed entirely via CSS classes with a `@media (prefers-color-scheme:
  // dark)` retint and no inline fill/stroke fallback. A design's picker icon
  // is wired directly into `manifest.webmanifest`'s `shortcuts[].icons[]`,
  // which the OS reads with nothing in between (Android long-press shortcuts,
  // desktop jump lists), so losing all styling there is not cosmetic.

  // Still refused: a @media wrapper does not launder what is inside it.
  for (const [what, css] of [
    [
      "image-set inside a media body",
      `@media print{.a{background:image-set("https://evil.example/x.png" 1x)}}`,
    ],
    ["an unvouched function inside a media body", `@media print{.a{fill:some-future-fn(x)}}`],
    ["a function carrying a URL inside a media body", `@media print{.a{fill:some(https://evil.example/x)}}`],
    ["a function smuggled into the prelude", `@media (min-width:1px) some-fn(y){.a{fill:red}}`],
    ["an unterminated url( in the prelude", `@media (x) url(evil.png {.a{fill:red}}`],
    ["a @media rule with no block at all", `.a{fill:red} @media (min-width:1px)`],
    ["an escaped at-keyword normalizing to @font-face", String.raw`@\66 ont-face{font-family:x}`],
    // Only the prelude character-class allowlist rejects this one — no
    // disallowed function, no string, no scheme — so it is the sole case
    // that would still pass if MEDIA_PRELUDE_RE were mutated to accept
    // everything.
    ["a prelude character the allowlist does not spell", `@media (x);{.a{fill:red}}`],
    // A prelude that is scheme-shaped but contains no `(`/`)`, so it passes
    // both the character class and the (function-only) prelude allowlist,
    // and is only caught because the URL-scheme check runs against the
    // ORIGINAL `css`, not the elided `probe`. Mutating cssRisk to scan
    // `probe` for every check would let this one through.
    ["a URL scheme hiding in the prelude", `@media http://evil.example/x {.a{fill:red}}`],
  ]) {
    const { text, removed } = sanitizeSvg(doc(`<style>${css}</style><rect class="a"/>`));
    assert.doesNotMatch(text, /evil\.example|image-set/, what);
    assert.ok(removed.length > 0, `${what}: nothing reported`);
    // Not just "something was reported" — the whole <style> element is gone.
    assert.doesNotMatch(text, /<style/, `${what}: the block should have been dropped, not merely rewritten`);
    assert.match(text, /<rect/, `${what}: the drawing is not collateral`);
  }
  {
    const { removed } = sanitizeSvg(
      doc(`<style>@media (x);{.a{fill:red}}</style><rect class="a"/>`)
    );
    assert.ok(
      removed.some((r) => /prelude this module cannot read/.test(r)),
      removed.join("; ")
    );
  }
  {
    const { removed } = sanitizeSvg(
      doc(`<style>@media http://evil.example/x {.a{fill:red}}</style><rect class="a"/>`)
    );
    assert.ok(
      removed.some((r) => /URL scheme/.test(r)),
      removed.join("; ")
    );
  }
  {
    const { removed } = sanitizeSvg(
      doc(`<style>@media (x) url(evil.png {.a{fill:red}}</style><rect class="a"/>`)
    );
    assert.ok(removed.some((r) => r.includes("prelude")), removed.join("; "));
  }
  {
    const { removed } = sanitizeSvg(doc(`<style>.a{fill:red} @media (min-width:1px)</style><rect class="a"/>`));
    assert.ok(
      removed.some((r) => /no block/.test(r)),
      removed.join("; ")
    );
  }

  // Kept but rewritten: a surviving @media block whose internal references
  // are still scrubbed exactly as top-level CSS would be.
  {
    const { text, removed } = sanitizeSvg(
      doc(`<style>@media print{.a{fill:url(https://evil.example/x.svg#p)}}</style><rect class="a"/>`)
    );
    assert.doesNotMatch(text, /evil\.example/);
    assert.match(text, /fill:none/);
    assert.match(text, /@media print/);
    assert.ok(removed.some((r) => r.includes("not a same-document")), removed.join("; "));
  }
  {
    const { text, removed } = sanitizeSvg(
      doc(
        `<style>@media print{@import url("https://evil.example/x.css");.a{fill:red}}</style><rect class="a"/>`
      )
    );
    assert.doesNotMatch(text, /@import/i);
    assert.doesNotMatch(text, /evil\.example/);
    assert.match(text, /\.a\{fill:red\}/);
    assert.match(text, /@media print/);
    assert.ok(!removed.some((r) => r.includes("will not vouch for")), removed.join("; "));
  }
  {
    // An approved same-document reference inside a media block must not make
    // the block look unreadable: kept byte-for-byte, nothing reported.
    const svg = doc(`<style>@media (min-width:1px){.a{fill:url(#g)}}</style><rect class="a"/>`);
    const res = sanitizeSvg(svg);
    assert.equal(res.text, svg);
    assert.deepEqual(res.removed, []);
  }
});
