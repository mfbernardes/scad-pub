// svg-sanitize.mjs: defense-in-depth for BROWSER-FACING SVGs (the app logo, the
// PWA icon, and each design's picker icon), applied by gen-schema's
// copyBrowserFacing. NOT applied to render-input SVGs under public/scad/: those
// bytes are geometry, and a parse/serialize round trip is not something to do
// to a path or a viewBox.
//
// docs/config.md's "SVG asset trust model" is the policy — what this removes,
// why the reference rule is an allowlist rather than a scheme blocklist, why
// that costs nothing these files could use, and why a not-well-formed SVG now
// fails the build. Read it before loosening any of this.
//
// The two things to know at the code:
//   - It PARSES. Every evasion this module used to have was a question about
//     how an XML parser reads a document (a namespace prefix outside ASCII, an
//     unquoted value, a character reference resolving mid-scheme), and the
//     answer to a parser question is a parser.
//   - CSS is the part that is not parsed, so it FAILS CLOSED: escapes are
//     normalised, the allowlist is applied, and anything url- or import-shaped
//     that survives means the patterns could not account for it, so the whole
//     block or attribute goes.
//
// Returns { text, removed }. `removed` is empty exactly when the input was
// already inert — in which case the ORIGINAL BYTES come back, unparsed and
// unserialized, so a clean asset is never perturbed.
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { CSS_IMPORT_RE, CSS_URL_RE, isSameDocumentRef } from "../../src/lib/cssRefs.mjs";

// ── which elements may stay: an ALLOWLIST ─────────────────────────────────
// This was a denylist of things that execute (`<script>`, `<foreignObject>`,
// SMIL). It was wrong in the same way the reference rule was wrong before it
// was inverted: "things that fetch or execute" is open-ended. SVG 2 permits
// HTML elements in an SVG document, and `<html:video src>`, `<html:video
// poster>`, `<html:img src>` and `<html:iframe src>` ALL fetch — verified in
// Chromium, and none of them is an SVG element at all.
//
// So: an icon is drawing, structure, painting and text. Everything else goes.
// A new fetching element in some future spec is then closed by default rather
// than by amendment, which is the whole point of listing it this way round.
//
// Namespace is checked as well as name: `<html:title>` is not `<svg:title>`,
// and only the SVG namespace (or no namespace at all, for a document that
// omits xmlns) may match.
const SVG_NS = "http://www.w3.org/2000/svg";
const ALLOWED_ELEMENTS = new Set([
  // structure
  "svg", "g", "defs", "symbol", "use", "switch", "a",
  // shapes
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  // text
  "text", "tspan", "textPath",
  // painting
  "linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask",
  "marker", "filter", "style",
  // filter primitives an icon may legitimately carry
  "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite",
  "feConvolveMatrix", "feDiffuseLighting", "feDisplacementMap", "feDistantLight",
  "feDropShadow", "feFlood", "feFuncA", "feFuncB", "feFuncG", "feFuncR",
  "feGaussianBlur", "feMerge", "feMergeNode", "feMorphology", "feOffset",
  "fePointLight", "feSpecularLighting", "feSpotLight", "feTile", "feTurbulence",
  // metadata and description
  "title", "desc", "metadata", "view",
]);
// `<image>` is deliberately absent: its only purpose is to reference a raster,
// and the reference rule allows nothing but a same-document fragment, so an
// `<image>` that survives can never have anything to show.

// Named separately only so the report reads as one mechanism rather than as
// four unrelated tags.
const ANIMATION_ELEMENTS = new Set(["animate", "animateTransform", "animateMotion", "set"]);
const removalLabel = (el) => {
  if (ANIMATION_ELEMENTS.has(el.localName)) return "SMIL animation element(s)";
  if (el.namespaceURI && el.namespaceURI !== SVG_NS)
    return `element(s) outside the SVG namespace (<${el.nodeName}>)`;
  return `<${el.localName}>`;
};

// Pure-data vocabularies that describe the file rather than draw or fetch: RDF
// and its usual companions, plus the two editor namespaces every Inkscape file
// carries. They are allowed for a reason beyond noise: `<metadata><rdf:RDF>` is
// where a CC-licensed icon carries the attribution its licence REQUIRES, and
// silently deleting that is a licence problem, not a cosmetic one. Stripping
// them also warned on every Inkscape-authored icon, which is how an operator
// learns to ignore the warning that also reports the dangerous removals.
//
// Safe because the walk re-applies this rule to the children of anything it
// keeps: `<rdf:RDF><html:img src=…>` keeps the RDF and still removes the img.
// Verified, along with the fact that <metadata>/<desc> content really does
// fetch and execute in Chromium — which is why this is a short closed list of
// vocabularies with no browser behaviour, not "anything under <metadata>".
const INERT_METADATA_NS = new Set([
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  "http://purl.org/dc/elements/1.1/",
  "http://creativecommons.org/ns#",
  "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd",
  "http://www.inkscape.org/namespaces/inkscape",
]);

function isAllowedElement(el) {
  if (el.namespaceURI && el.namespaceURI !== SVG_NS)
    return INERT_METADATA_NS.has(el.namespaceURI);
  return ALLOWED_ELEMENTS.has(el.localName);
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_NODE = 4;
const PROCESSING_INSTRUCTION_NODE = 7;

// CSS escapes: `\<1-6 hex><one optional whitespace>` or `\<any char>`. Decoding
// them is what a CSS tokenizer does before it decides whether an ident is
// `url`, so it has to happen before anything looks for one.
function normalizeCssEscapes(css) {
  return css.replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([\s\S]))/g, (_, hex, ch) => {
    if (!hex) return ch;
    const n = parseInt(hex, 16);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  });
}

// ── the CSS rule, inverted for the last time ──────────────────────────────
// Removing "the things that fetch" is an open-ended list. `url()` was the
// first, `@import` the second, and `image-set("…" 1x)` — which a browser
// really does fetch, verified against Chromium — is a third that carries its
// URL as a bare string with no `url()` anywhere in it. LightningCSS, which
// this repo already has, does not surface that one either: its `Url` visitor
// sees `url()` in every property and misses `image-set` entirely. So a CSS
// parser would not have closed it, and the next construct would not be closed
// either.
//
// What IS closed-ended is the set of value functions that cannot reference
// anything: colours, maths, transforms. So after the passes above have
// approved `url(#fragment)` and removed the rest, a block survives only if
// what remains is literal values and functions from this list. Anything else
// — a string literal, a scheme, a function nobody vouched for — drops the
// whole block, reported.
//
// The cost is real and bounded: an icon stylesheet may use colours, lengths,
// keywords, custom properties and `url(#gradient)`. A quoted string is the
// notable exclusion (a `font-family:"My Font"` in an icon), and it is excluded
// because a bare quoted string is exactly how image-set carries a URL and
// there is no way to tell the two apart without a value grammar per property.
const SAFE_CSS_FUNCTIONS = new Set([
  // colour
  "rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color",
  "color-mix", "light-dark",
  // maths and custom properties
  "calc", "min", "max", "clamp", "round", "var", "env",
  // transforms
  "translate", "translatex", "translatey", "translate3d", "scale", "scalex",
  "scaley", "rotate", "rotate3d", "skew", "skewx", "skewy", "matrix", "matrix3d",
]);
// Every `name(` in the text, so an unvouched function can be named in the log.
const CSS_FUNCTION_RE = /([-\w]+)\s*\(/g;

/** What makes a stylesheet unfit to keep, or "" when it is fit. */
function cssRisk(css) {
  if (/@\w/.test(css)) return "an at-rule";
  if (/["']/.test(css)) return "a string literal (image-set carries a URL that way)";
  if (/:\s*\/\//.test(css) || /\w+:\/\//.test(css)) return "a URL scheme";
  for (const [, name] of css.matchAll(CSS_FUNCTION_RE)) {
    if (!SAFE_CSS_FUNCTIONS.has(name.toLowerCase())) return `the function ${name}()`;
  }
  return "";
}

// The stand-in for a url() the allowlist approved, so the risk check above
// cannot see it. A private-use code point rather than a NUL: a control
// character in a regex is a lint error, and neither belongs in a stylesheet.
const APPROVED_MARK = "\uE000";

/**
 * One CSS text, with `@import` and foreign `url()` removed.
 * Returns { css, changed, unsafe }: `unsafe` means what remained is not
 * something this module will vouch for, and the caller must discard it.
 *
 * DETECTION runs on an escape-normalized copy (a CSS tokenizer resolves
 * escapes before deciding an ident is `url`, so `u\72 l(` has to be seen);
 * REWRITING runs on the ORIGINAL text and never emits the normalized copy.
 * Emitting it corrupted valid CSS — `.\31 23` is a legal class that becomes
 * the illegal `.123`, and a literal private-use character was deleted — and
 * reported both as if they were external references. Anything the normalized
 * view catches that the original spelling does not is `unsafe` rather than
 * rewritten, so the two views can never disagree in the shipping direction.
 */
function scrubCss(text) {
  // How many foreign references a given spelling of this text exposes.
  let count = 0;
  const strip = (src) => {
    count = 0;
    return src.replace(CSS_IMPORT_RE, () => {
      count++;
      return "";
    }).replace(CSS_URL_RE, (m, dq, sq, bare) => {
      if (isSameDocumentRef(dq ?? sq ?? bare ?? "")) return APPROVED_MARK;
      count++;
      return "none";
    });
  };

  const normalized = normalizeCssEscapes(text).split(APPROVED_MARK).join("");
  const strippedNormalized = strip(normalized);
  const normalizedCount = count;
  strip(text);
  const literalCount = count;

  // Two ways to be unfit. The risk check is what remains after the allowlist;
  // the count comparison is the escaped-spelling case, and it is the reason
  // detection and rewriting cannot simply be the same pass: normalizing
  // `u\72 l(https://…)` NEUTRALISES it in the probe, so a probe judged on its
  // own content looks clean while the original text still carries the
  // reference the rewrite pass cannot match. More removals in the normalized
  // spelling than in the literal one means exactly that.
  const unsafe =
    normalizedCount > literalCount
      ? "a reference written with CSS escapes"
      : cssRisk(strippedNormalized);

  let changed = false;
  const css = text
    .replace(CSS_IMPORT_RE, () => {
      changed = true;
      return "";
    })
    .replace(CSS_URL_RE, (m, dq, sq, bare) => {
      if (isSameDocumentRef(dq ?? sq ?? bare ?? "")) return m; // untouched, in place
      changed = true;
      return "none";
    });
  return { css: changed ? css : text, changed, unsafe };
}

// The attributes whose value is CSS, and so may carry a `url()`: `style`
// itself plus the SVG presentation attributes that accept a <paint>, a
// <filter> or a reference. An attribute outside this set is data or prose.
const CSS_VALUE_ATTRS = new Set([
  "style",
  "fill",
  "stroke",
  "filter",
  "mask",
  "clip-path",
  "cursor",
  "marker",
  "marker-start",
  "marker-mid",
  "marker-end",
]);

function walk(node, visit) {
  // Snapshot: visit() removes nodes, and childNodes is live.
  for (const child of [...(node.childNodes ?? [])]) {
    if (child.nodeType === ELEMENT_NODE) {
      if (visit(child)) walk(child, visit);
    }
  }
}

// `<?xml-stylesheet href="…"?>` before the root element pulls in an external
// stylesheet, verified fetching in Chromium. It is not an element, so an
// element-only walk never saw it — and it sits OUTSIDE documentElement, so
// walking from the document is what finds it. Removed outright rather than
// href-checked: its whole purpose is to reference a stylesheet, and an icon
// that needs styling has `<style>` for that.
function stripStylesheetPis(doc, note) {
  for (const child of [...(doc.childNodes ?? [])]) {
    if (child.nodeType !== PROCESSING_INSTRUCTION_NODE) continue;
    if (child.target !== "xml-stylesheet") continue;
    note("<?xml-stylesheet?> processing instruction");
    doc.removeChild(child);
  }
}

function textOf(el) {
  let out = "";
  for (const child of el.childNodes ?? []) {
    if (child.nodeType === TEXT_NODE || child.nodeType === CDATA_NODE) out += child.data ?? "";
  }
  return out;
}

function setText(el, text) {
  for (const child of [...(el.childNodes ?? [])]) el.removeChild(child);
  el.appendChild(el.ownerDocument.createTextNode(text));
}

export function sanitizeSvg(svgText) {
  const removed = [];
  const fatal = [];
  // EVERY level counts, warnings included. xmldom "repairs" an unquoted
  // attribute value and reports a warning — but `fill=red` is not well-formed
  // XML, so a browser asked to render this as image/svg+xml refuses the whole
  // document, and quietly repairing it meant shipping an asset that renders
  // nowhere while the docs claimed malformed XML fails the build. Verified
  // against every SVG in this repo: none produces a warning, and neither does
  // a legacy DOCTYPE, so this costs nothing real. An undeclared namespace
  // prefix THROWS rather than reporting, so both paths land here.
  let doc;
  try {
    doc = new DOMParser({
      onError: (level, msg) => {
        fatal.push(`${level}: ${String(msg).split("\n")[0]}`);
      },
    }).parseFromString(svgText, "image/svg+xml");
  } catch (e) {
    fatal.push(e.message);
  }
  if (fatal.length || !doc?.documentElement)
    throw new Error(
      `svg-sanitize: not well-formed XML, so a browser could not render it as an SVG either:\n  ` +
        (fatal[0] ?? "no document element")
    );
  // Well-formed is not the same as being an SVG. `<g xmlns="…/svg">`, an `<svg>`
  // with no namespace and an `<rdf:RDF>` root are all well-formed XML that resvg
  // refuses and a browser will not draw — and the last of those only started
  // passing when the inert-metadata namespaces were allowed. Meanwhile a
  // non-SVG root in the SVG namespace was silently emptied by the element rule,
  // so the build wrote a rootless file. Fail here instead, where the callers
  // already name the source path.
  const rootEl = doc.documentElement;
  // The namespace has to be DECLARED, not inferred. xmldom infers the SVG
  // namespace for a bare `<svg>` root when parsing with the image/svg+xml
  // mimetype, so `namespaceURI` alone cannot tell the two apart — while resvg
  // refuses a namespace-less document ("does not have a root node") and so does
  // a browser. A prefixed root (`<svg:svg xmlns:svg="…">`) declares it too, and
  // is fine.
  const declaresSvgNs =
    rootEl.getAttribute("xmlns") === SVG_NS ||
    (rootEl.prefix && rootEl.lookupNamespaceURI?.(rootEl.prefix) === SVG_NS);
  if (rootEl.localName !== "svg" || rootEl.namespaceURI !== SVG_NS || !declaresSvgNs)
    throw new Error(
      `svg-sanitize: root must be <svg xmlns="${SVG_NS}"> — got <${rootEl.nodeName}>` +
        (rootEl.localName === "svg" ? " with no SVG namespace declared" : "")
    );

  const note = (label) => {
    if (!removed.includes(label)) removed.push(label);
  };

  stripStylesheetPis(doc, note);

  walk(doc, (el) => {
    if (!isAllowedElement(el)) {
      note(removalLabel(el));
      el.parentNode.removeChild(el);
      return false; // gone: nothing inside it to visit
    }
    // Attributes, on a snapshot for the same reason as childNodes.
    for (const attr of [...(el.attributes ?? [])]) {
      const local = attr.localName ?? attr.name;
      const value = attr.value ?? "";
      if (/^on/i.test(local)) {
        note("event-handler attribute(s)");
        el.removeAttribute(attr.name);
        continue;
      }
      // `xml:base` rebases every relative reference in its subtree, which
      // would make even a `#fragment` point at another document. Chromium
      // ignores it (Blink removed support) so this is not a demonstrated
      // vector, but no icon needs it and keeping it would make the reference
      // rule's meaning depend on the engine.
      if (attr.name.toLowerCase() === "xml:base") {
        note("xml:base");
        el.removeAttribute(attr.name);
        continue;
      }
      // `ping` on an SVG <a> is a list of URLs the browser requests in the
      // background when the link is followed (SVG 2 delegates it to HTML's
      // hyperlink auditing). It FIRES: activating the link in Chromium sends
      // every URL listed, verified by scripts/check-svg-inert.mjs. Unlike
      // xml:base above, this one is a demonstrated vector, and no icon needs it.
      if (local.toLowerCase() === "ping") {
        note("ping");
        el.removeAttribute(attr.name);
        continue;
      }
      if (local.toLowerCase() === "href" && !isSameDocumentRef(value)) {
        note("href that is not a same-document fragment");
        el.removeAttribute(attr.name);
        continue;
      }
      // A `style` or presentation attribute is a CSS value, and CSS values are
      // where url() lives outside a stylesheet. Only those: scrubbing EVERY
      // attribute turned `aria-label="see url(https://docs)"` into
      // `aria-label="see none"`, which is prose, not a fetch. The list is
      // closed rather than "anything that mentions url(", so a name not on it
      // is left alone even if its text looks CSS-shaped.
      if (CSS_VALUE_ATTRS.has(local.toLowerCase())) {
        const { css, changed, unsafe } = scrubCss(value);
        if (unsafe) {
          // `unsafe` is the REASON cssRisk worked out. Reporting a generic
          // "url() could not be read" sent an operator whose Illustrator icon
          // just lost its `style="font-family:'ArialMT';fill:#231F20"` looking
          // for a URL that is not in the file.
          note(`a ${local} attribute this module will not vouch for (${unsafe})`);
          el.removeAttribute(attr.name);
        } else if (changed) {
          note("url() that is not a same-document fragment");
          attr.value = css;
        }
      }
    }
    if (el.localName === "style") {
      const { css, changed, unsafe } = scrubCss(textOf(el));
      if (unsafe) {
        note(`a <style> block this module will not vouch for (${unsafe})`);
        el.parentNode.removeChild(el);
        return false;
      }
      if (changed) {
        note("<style> @import / url() that is not a same-document fragment");
        setText(el, css);
      }
    }
    return true;
  });

  // Nothing changed means nothing to re-serialize: a clean asset goes through
  // byte-for-byte, which is worth more than a canonical form nobody asked for.
  if (!removed.length) return { text: svgText, removed };
  return { text: new XMLSerializer().serializeToString(doc), removed };
}

/**
 * sanitizeSvg for a build's browser-facing asset: names the file on failure,
 * and reports what it removed. Both matter to an operator and neither is
 * derivable from the sanitizer's own return value, which knows nothing about
 * where the bytes came from.
 *
 * Shared rather than duplicated because it already diverged once: the PWA icon
 * path had the named error but dropped `removed` on the floor, so sanitizing
 * `pwa.icon` was silent while sanitizing a logo was not.
 * @param {string} raw
 * @param {{ src: string, what?: string }} where `src` is the absolute source
 *   path; `what` names the config key it came from, when there is one.
 * @returns {string} the sanitized markup
 */
export function sanitizeBrowserFacingSvg(raw, { src, what }) {
  const named = what ? `${what} ${src}` : src;
  let text, removed;
  try {
    ({ text, removed } = sanitizeSvg(raw));
  } catch (e) {
    // The sanitizer parses, so a file that is not well-formed XML stops the
    // build instead of being copied. That is not a new restriction: XML is
    // draconian, so a browser asked to render this as image/svg+xml would
    // refuse it too — the build is just the first place that says so, and it
    // can name the file.
    throw new Error(`gen-schema: ${named} is not a usable SVG.\n  ${e.message}`, { cause: e });
  }
  // Reported, not silent. The reference rule is an allowlist — a same-document
  // fragment or nothing — so it also removes things an operator may have meant,
  // most plausibly a `data:` image inlined in a logo. A warning naming the file
  // is what turns "my logo lost its picture" from a mystery into one line.
  if (removed.length)
    console.warn(
      `gen-schema: sanitized ${named}\n  removed: ${removed.join("; ")}\n` +
        `  (browser-facing SVGs keep only same-document '#fragment' references; ` +
        `see docs/config.md's SVG asset trust model)`
    );
  return text;
}
