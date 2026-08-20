// check-svg-inert.mjs: the sanitizer's claim, asserted on NETWORK TRAFFIC.
//
// tests/svgSanitize.test.mjs asserts on strings — that a URL is no longer in
// the output. That is necessary and not sufficient: it cannot tell whether a
// construct would have fetched in the first place, nor whether what survives
// still can. This serves each SANITIZED result to Chromium as a standalone
// document (the direct-navigation case the whole module exists for) and asserts
// that nothing leaves the page.
//
// Each vector is paired with a CONTROL: the same page UNSANITIZED. Without it,
// "no request was made" is indistinguishable from "this browser was never going
// to make one", and the assertion passes for the wrong reason. The `ping` case
// is exactly why that matters — a hand probe of it wrongly reported "no ping"
// because it clicked without moving the pointer first, and the vector looked
// like spec-only insurance when it is real.
import { createServer } from "node:http";
import { chromium } from "playwright";
import { sanitizeSvg } from "./lib/svg-sanitize.mjs";
import { makeCheck } from "./lib/check.mjs";

const { check, state } = makeCheck();
const EVIL = "http://evil.test";
const H = `xmlns:html="http://www.w3.org/1999/xhtml"`;
const svg = (inner, rootAttrs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${rootAttrs}>${inner}</svg>`;

// Each: the hostile source, and how to provoke it once loaded.
const VECTORS = {
  "css url()": [svg(`<style>.a{fill:url(${EVIL}/a.svg#p)}</style><rect class="a" width="40" height="40"/>`), "load"],
  "css image-set()": [svg(`<style>svg{background:image-set("${EVIL}/b.png" 1x)}</style><rect width="40" height="40"/>`), "load"],
  // CSS-escaped spellings: a browser's CSS tokenizer decodes `\<hex>` before
  // deciding an ident is `url`/an at-keyword is `@import`, so these fetch
  // identically to their plain spellings — proving the escape is a real
  // evasion of a literal-spelling-only scan, not spec-only insurance.
  "css url() (escaped)": [
    svg(`<style>.a{fill:u\\72 l(${EVIL}/a2.svg#p)}</style><rect class="a" width="40" height="40"/>`),
    "load",
  ],
  "css @import (escaped)": [
    svg(`<style>@\\69 mport "${EVIL}/m.css";</style><rect width="40" height="40"/>`),
    "load",
  ],
  // @media is the one at-rule the sanitizer keeps (see svg-sanitize.mjs's
  // cssRisk): the sanitized form here SURVIVES rather than being dropped, so
  // this vector is the important one — it proves the surviving url() is still
  // scrubbed rather than merely proving an already-empty block fetches nothing.
  "@media css url()": [
    svg(`<style>@media (min-width:1px){.a{fill:url(${EVIL}/k.svg#p)}}</style><rect class="a" width="40" height="40"/>`),
    "load",
  ],
  // "screen", not "print": a page loaded normally (not printing) never
  // applies @media print rules at all, which would make the RAW form fetch
  // nothing and the vector insurance-only for a reason unrelated to the
  // sanitizer.
  "@media image-set()": [
    svg(`<style>@media screen{svg{background:image-set("${EVIL}/l.png" 1x)}}</style><rect width="40" height="40"/>`),
    "load",
  ],
  "cursor image-set()": [svg(`<rect width="40" height="40" fill="#ccc" cursor="image-set(&quot;${EVIL}/c.png&quot; 1x), auto"/>`), "hover"],
  "@font-face src": [svg(`<style>@font-face{font-family:x;src:url(${EVIL}/d.woff)}text{font-family:x}</style><text y="20">hi</text>`), "load"],
  "html:video": [svg(`<html:video ${H} src="${EVIL}/e.mp4" poster="${EVIL}/e.png"/>`), "load"],
  "html:img": [svg(`<html:img ${H} src="${EVIL}/f.png"/>`), "load"],
  "html:iframe": [svg(`<html:iframe ${H} src="${EVIL}/g.html"/>`), "load"],
  "xml-stylesheet PI": [`<?xml-stylesheet type="text/css" href="${EVIL}/h.css"?>` + svg(`<rect width="40" height="40"/>`), "load"],
  "image href": [svg(`<image href="${EVIL}/i.png" width="40" height="40"/>`), "load"],
  "a ping": [svg(`<a href="#ok" ping="${EVIL}/j"><rect id="ok" width="40" height="40" fill="#3a7"/></a>`), "click"],
};

// The observer's own proof: an HTML page whose link really does ping.
const HTML_PING_CONTROL = `<!doctype html><html><body><a id="l" href="/dest.html" ping="${EVIL}/control-ping">x</a></body></html>`;

const routes = new Map([["/dest.html", ["text/html", "<!doctype html><html><body>ok</body></html>"]]]);
for (const [name, [source]] of Object.entries(VECTORS)) {
  const key = encodeURIComponent(name);
  routes.set(`/raw/${key}`, ["image/svg+xml", source]);
  routes.set(`/clean/${key}`, ["image/svg+xml", sanitizeSvg(source).text]);
}
routes.set("/control.html", ["text/html", HTML_PING_CONTROL]);

const server = createServer((req, res) => {
  const [type, body] = routes.get(req.url) ?? ["text/plain", "not found"];
  res.writeHead(200, { "Content-Type": type });
  res.end(body);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const hits = new Set();
// Playwright's own browser, NOT lib/browser.mjs's launchChromium: that helper
// honours PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, and an environment pointing it
// at a headless-shell build silently loses hyperlink auditing — the `a ping`
// CONTROL then stops firing and the vector degrades to insurance-only. This
// script's assertions are ground truth about a browser, so it pins the browser.
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.route(`**://evil.test/**`, (route) => {
  hits.add(new URL(route.request().url()).pathname);
  route.abort();
});
const page = await ctx.newPage();

async function visit(path, how) {
  hits.clear();
  // Not swallowed: a navigation that failed would otherwise look exactly like
  // a page that made no request, which is what this script asserts.
  await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "networkidle" });
  if (how === "hover" || how === "click") await page.mouse.move(20, 20);
  if (how === "click") await page.mouse.click(20, 20);
  if (how === "dom-click") await page.click("#l");
  await page.waitForTimeout(600);
  return [...hits];
}

console.log("=== sanitized SVGs make no request ===");

// The observer works: an HTML <a ping> fires.
check((await visit("/control.html", "dom-click")).length > 0, "the request observer sees a hyperlink ping at all");

const insuranceOnly = [];
for (const [name, [, how]] of Object.entries(VECTORS)) {
  const key = encodeURIComponent(name);
  const raw = await visit(`/raw/${key}`, how);
  if (process.env.INERT_DEBUG) console.log(`     raw[${name}] -> ${JSON.stringify(raw)}`);
  const clean = await visit(`/clean/${key}`, how);
  check(clean.length === 0, `sanitized: ${name}${clean.length ? ` still fetched ${clean.join(",")}` : ""}`);
  if (raw.length === 0) insuranceOnly.push(name);
}

// A vector whose UNSANITIZED form makes no request proves nothing: the
// assertion above passes because the browser was never going to fetch, not
// because the sanitizer stopped it. That is a legitimate state — Chromium
// ignores `xml:base`, for instance — but it must be a DECISION, not drift. So
// the set is pinned: if a browser update quietly stops honouring a construct,
// every vector could decay to vacuous while the script still printed PASS.
const EXPECTED_INSURANCE_ONLY = [];
check(
  JSON.stringify(insuranceOnly.sort()) === JSON.stringify([...EXPECTED_INSURANCE_ONLY].sort()),
  `the vectors that cannot be demonstrated are exactly the expected set ` +
    `(expected ${JSON.stringify(EXPECTED_INSURANCE_ONLY)}, got ${JSON.stringify(insuranceOnly)}) ` +
    `— update EXPECTED_INSURANCE_ONLY deliberately if a browser change moved one`
);
console.log(`\n${Object.keys(VECTORS).length} vectors, ${insuranceOnly.length} of them insurance-only`);

await browser.close();
server.close();
console.log(state.failures ? `\nSVG INERT FAIL ❌ (${state.failures})` : "\nSVG INERT PASS ✅");
process.exit(state.failures ? 1 : 0);
