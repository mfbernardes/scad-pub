// Small DOM helpers shared by the SVG checks/fixes. The module operates on a
// standard DOM `Element` (the SVG root), so it runs unchanged with the browser's
// DOMParser and, in tests/Node, with @xmldom/xmldom: both implement this subset.

export const SVG_NS = "http://www.w3.org/2000/svg";
const INK_NS = "http://www.inkscape.org/namespaces/inkscape";

export const SHAPE_TAGS = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
]);

export const TEXT_TAGS = new Set(["text", "tspan", "textPath", "flowRoot", "flowPara"]);

// Elements OpenSCAD's SVG import ignores entirely (it reads only path/shape
// geometry). Their presence means part of the drawing will not come through.
export const IGNORED_TAGS = new Set([
  "image",
  "use",
  "filter",
  "mask",
  "clipPath",
  "marker",
  "pattern",
  "foreignObject",
]);

// Elements that can EXECUTE rather than describe geometry. OpenSCAD ignores
// them like everything in IGNORED_TAGS, but they are reported and stripped
// separately: a user-supplied drawing is the one SVG class ScadPub does not
// trust (see docs/config.md's trust model), and the invariant that keeps it
// safe — a wizard-prepared SVG is never rendered in the DOM, only mounted into
// the WASM filesystem — is one line of future code away from not holding.
// Stripping them makes the runtime path safe by construction rather than by
// circumstance.
//
// SMIL is here because `<animate attributeName="href" values="javascript:…">`
// sets at runtime what no static scan of the markup would show.
export const ACTIVE_TAGS = new Set([
  "script",
  // Also in IGNORED_TAGS, deliberately: `foreignObject` both fetches and, per
  // OpenSCAD, produces no geometry. check() resolves the overlap in favour of
  // this set.
  "foreignObject",
  "animate",
  "animateTransform",
  "animateMotion",
  "set",
  "handler",
]);
// This is a DENYLIST, unlike scripts/lib/svg-sanitize.mjs's ALLOWLIST of what
// may stay in a browser-facing asset: the two jobs differ (see that module's
// header) and so, deliberately, does the answer to "which elements". Only the
// reference PARSING is shared, via src/lib/cssRefs.mjs, because that answer
// genuinely does not depend on the job.

// `<style>` is deliberately NOT in ACTIVE_TAGS. CSS cannot execute, so the
// element is not an execution vector, and removing it would destroy the
// drawing's colours before resolveStyleFills has read them AND blind the
// post-fix `styled-fill` check to the stylesheet it exists to report. What a
// stylesheet CAN do is fetch — `@import` and an external `url()` — and that is
// what fixes.ts's removeActiveContent neutralises, leaving the rules
// themselves alone.

const ELEMENT_NODE = 1;
const COMMENT_NODE = 8;

/** The element's local name without any namespace prefix. */
export function localName(el: Element): string {
  return el.localName ?? "";
}

/** Every element in document order, including `root` itself. */
export function iterElements(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    out.push(el);
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i] as Node;
      if (n.nodeType === ELEMENT_NODE) walk(n as Element);
    }
  };
  walk(root);
  return out;
}

/** True when an element has at least one element or comment child. */
export function hasStructuralChildren(el: Element): boolean {
  const kids = el.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const t = (kids[i] as Node).nodeType;
    if (t === ELEMENT_NODE || t === COMMENT_NODE) return true;
  }
  return false;
}

/** Parse the `style="a:b;c:d"` attribute into a map. */
function styleProps(el: Element): Record<string, string> {
  const props: Record<string, string> = {};
  const style = el.getAttribute("style") ?? "";
  for (const part of style.split(";")) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    props[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return props;
}

/** Resolve a presentation property from the `style` attribute or its own attribute. */
export function paint(el: Element, prop: string): string | null {
  const value = styleProps(el)[prop];
  if (value !== undefined) return value;
  return el.getAttribute(prop);
}

/** Read an Inkscape attribute (`inkscape:label`/`inkscape:groupmode`) with a fallback. */
export function inkAttr(el: Element, name: string): string | null {
  const ns = el.getAttributeNS?.(INK_NS, name);
  if (ns !== null && ns !== undefined && ns !== "") return ns;
  return el.getAttribute(`inkscape:${name}`);
}

// An Inkscape layer label is free text ("Ground floor, walls"); an id is not.
// A space makes an id that no `id=` selector in a consuming design matches, and
// a comma or colon shreds the layers spec that carries the id. Unicode letters
// and digits stay: they are valid NCName characters, and mangling them would
// rename every non-English layer for nothing.
const NCNAME_INVALID_RE = /[^\p{L}\p{N}._-]/gu;
const NCNAME_START_RE = /^[\p{L}_]/u;

/** `label` as an XML NCName — what `fixInkscapeIds` will actually adopt as the
 *  id, and therefore what `check` must compare against to decide whether a
 *  layer is still trapped. */
function toNCName(label: string): string {
  const s = label.replace(NCNAME_INVALID_RE, "_");
  return NCNAME_START_RE.test(s) ? s : `_${s}`;
}

/** Every Inkscape layer group whose name is not yet its id, with the id
 *  `fixInkscapeIds` would adopt. The single statement of the "trapped layer"
 *  rule: `check` reports these as `inkscape-trap` and `applyFixes` renames
 *  exactly these, and two independent scans of one rule is how one of them ends
 *  up reporting a trap the other no longer fixes. */
export function trappedLayers(
  els: Element[]
): { el: Element; label: string; id: string | null; target: string }[] {
  const out: { el: Element; label: string; id: string | null; target: string }[] = [];
  for (const el of els) {
    if (localName(el) !== "g" || inkAttr(el, "groupmode") !== "layer") continue;
    const label = inkAttr(el, "label");
    if (!label) continue;
    const id = el.getAttribute("id");
    const target = toNCName(label);
    if (id === target) continue;
    out.push({ el, label, id, target });
  }
  return out;
}
