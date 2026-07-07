// Wrap every not-yet-grouped shape into one <g id> per fill colour, so painting
// alone defines the regions. Shapes already inside a named <g id> region are
// left alone (re-running is a no-op).
// Refuses (returns an error, no change) when a loose shape sits under a
// transform/clip/mask, since moving it would shift the geometry — group by
// colour in the editor instead.

import { SHAPE_TAGS, SVG_NS, hasStructuralChildren, iterElements, localName } from "./dom";
import { colorKey, displayColor, parseColor, slugForColor } from "./colors";
import { effectiveFill } from "./regions";

const ELEMENT_NODE = 1;

export interface GroupByColorResult {
  changes: string[];
  error: string | null;
}

function pruneEmptyGroups(root: Element): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const el of iterElements(root)) {
      if (
        el !== root &&
        localName(el) === "g" &&
        !hasStructuralChildren(el) &&
        el.parentNode
      ) {
        el.parentNode.removeChild(el);
        changed = true;
        break;
      }
    }
  }
}

/** Whether the shape already sits inside a `<g id>` — a named region the
 *  designer (or an earlier group-by-colour run) chose. Such shapes are left
 *  where they are, which also makes group-by-colour idempotent. */
function inNamedRegion(sh: Element, root: Element): boolean {
  let node: Node | null = sh.parentNode;
  while (node !== null && node !== root && node.nodeType === ELEMENT_NODE) {
    const el = node as Element;
    if (localName(el) === "g" && el.getAttribute("id")) return true;
    node = el.parentNode;
  }
  return false;
}

/** The element's ancestors up to the root, outermost first. */
function ancestorChain(el: Element, root: Element): Element[] {
  const chain: Element[] = [];
  let node: Node | null = el.parentNode;
  while (node !== null && node.nodeType === ELEMENT_NODE) {
    chain.push(node as Element);
    if (node === root) break;
    node = node.parentNode;
  }
  return chain.reverse();
}

/** The deepest element containing every shape (root when they share nothing
 *  deeper). */
function deepestCommonAncestor(shapes: Element[], root: Element): Element {
  let common: Element[] | null = null;
  for (const sh of shapes) {
    const chain = ancestorChain(sh, root);
    if (common === null) {
      common = chain;
      continue;
    }
    let keep = 0;
    while (keep < common.length && keep < chain.length && common[keep] === chain[keep]) {
      keep += 1;
    }
    common = common.slice(0, keep);
  }
  return common && common.length > 0 ? common[common.length - 1] : root;
}

export function groupByColor(root: Element): GroupByColorResult {
  const allShapes = iterElements(root).filter((el) => SHAPE_TAGS.has(localName(el)));
  if (allShapes.length === 0) return { changes: [], error: "no shapes to group" };
  const shapes = allShapes.filter((sh) => !inNamedRegion(sh, root));
  if (shapes.length === 0) {
    return {
      changes: [],
      error: "every shape is already inside a named <g id> region — nothing to regroup",
    };
  }

  // New groups are created in the shapes' deepest common ancestor — moving a
  // shape within one container is safe, and OpenSCAD's import(id=…) applies
  // ancestor transforms, so a container-level transform (e.g. the
  // viewBox-origin fix's wrapper) keeps the regions registered. Only a
  // transform/clip/mask strictly between that container and a shape blocks
  // the move.
  const container = deepestCommonAncestor(shapes, root);
  for (const sh of shapes) {
    let node: Node | null = sh.parentNode;
    while (node !== null && node !== container && node.nodeType === ELEMENT_NODE) {
      const el = node as Element;
      if (
        el.getAttribute("transform") ||
        el.getAttribute("clip-path") ||
        el.getAttribute("mask")
      ) {
        return {
          changes: [],
          error:
            "shapes sit under a transform/clip/mask, so regrouping could " +
            "move them — group by colour in your editor instead",
        };
      }
      node = el.parentNode;
    }
  }

  const order: string[] = [];
  const buckets = new Map<string, { token: string; shapes: Element[] }>();
  for (const sh of shapes) {
    const [token] = effectiveFill(sh);
    const key = colorKey(token);
    if (!buckets.has(key)) {
      buckets.set(key, { token, shapes: [] });
      order.push(key);
    }
    buckets.get(key)!.shapes.push(sh);
  }

  if (order.length < 2 && shapes.length === allShapes.length) {
    return {
      changes: [],
      error: "only one fill colour found — nothing to separate",
    };
  }

  for (const sh of shapes) sh.parentNode?.removeChild(sh);

  const doc = root.ownerDocument!;
  const taken = new Set<string>();
  for (const el of iterElements(root)) {
    const id = el.getAttribute("id");
    if (id) taken.add(id);
  }
  const changes: string[] = [];
  for (const key of order) {
    const bucket = buckets.get(key)!;
    const gid = slugForColor(bucket.token, taken);
    const group = doc.createElementNS(SVG_NS, "g");
    group.setAttribute("id", gid);
    const disp = displayColor(parseColor(bucket.token), bucket.token);
    // The shapes' fill may have been inherited from the group they were lifted
    // out of; restating it here keeps the region's colour readable.
    group.setAttribute("fill", disp);
    for (const sh of bucket.shapes) group.appendChild(sh);
    container.appendChild(group);
    changes.push(
      `grouped ${bucket.shapes.length} shape(s) filled ${disp} into <g id="${gid}">`,
    );
  }
  pruneEmptyGroups(root);
  return { changes, error: null };
}
