// Small DOM helpers shared by the SVG checks/fixes. The module operates on a
// standard DOM `Element` (the SVG root), so it runs unchanged with the browser's
// DOMParser and, in tests/Node, with @xmldom/xmldom — both implement this subset.

export const SVG_NS = "http://www.w3.org/2000/svg";
export const INK_NS = "http://www.inkscape.org/namespaces/inkscape";
export const SODIPODI_NS = "http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd";
export const XLINK_NS = "http://www.w3.org/1999/xlink";

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

/** Direct child elements only. */
export function elementChildren(el: Element): Element[] {
  const out: Element[] = [];
  const kids = el.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i] as Node;
    if (n.nodeType === ELEMENT_NODE) out.push(n as Element);
  }
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

/** The first direct child element with the given local name (+ optional namespace). */
export function firstChildNamed(
  el: Element,
  name: string,
  ns?: string,
): Element | null {
  for (const child of elementChildren(el)) {
    if (localName(child) !== name) continue;
    if (ns !== undefined && child.namespaceURI !== ns) continue;
    return child;
  }
  return null;
}

/** Parse the `style="a:b;c:d"` attribute into a map. */
export function styleProps(el: Element): Record<string, string> {
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

export function hasAnyTransform(root: Element): boolean {
  return iterElements(root).some((el) => el.getAttribute("transform"));
}
