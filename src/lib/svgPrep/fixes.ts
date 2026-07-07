// Safe, appearance-preserving fixes applied in place. Each returns a list of
// human-readable change strings.

import { SVG_NS, inkAttr, iterElements, localName } from "./dom";
import { gFormat, parseViewBox } from "./geometry";

/** Rename each Inkscape layer's id to its label so it is selectable. Only touches
 *  layer groups whose label differs from the id, and skips a rename that would
 *  collide with an id already in use. */
export function fixInkscapeIds(root: Element): string[] {
  const changes: string[] = [];
  const existing = new Set<string>();
  for (const el of iterElements(root)) {
    const id = el.getAttribute("id");
    if (id) existing.add(id);
  }
  for (const el of iterElements(root)) {
    if (localName(el) !== "g" || inkAttr(el, "groupmode") !== "layer") continue;
    const label = inkAttr(el, "label");
    const gid = el.getAttribute("id");
    if (!label || gid === label) continue;
    if (existing.has(label) && label !== gid) {
      changes.push(`skip layer "${label}": id "${label}" already in use`);
      continue;
    }
    el.setAttribute("id", label);
    if (gid) existing.delete(gid);
    existing.add(label);
    changes.push(`renamed layer id "${gid}" -> "${label}"`);
  }
  return changes;
}

/** Normalise a non-zero viewBox origin to 0 0 by wrapping the content in a
 *  translate, preserving appearance. */
export function fixViewBoxOrigin(root: Element): string[] {
  const vb = parseViewBox(root);
  if (vb === null) return [];
  const [minx, miny, w, h] = vb;
  if (Math.abs(minx) <= 1e-6 && Math.abs(miny) <= 1e-6) return [];

  const doc = root.ownerDocument!;
  const wrapper = doc.createElementNS(SVG_NS, "g");
  wrapper.setAttribute("transform", `translate(${gFormat(-minx)},${gFormat(-miny)})`);
  while (root.firstChild) wrapper.appendChild(root.firstChild);
  root.appendChild(wrapper);
  root.setAttribute("viewBox", `0 0 ${gFormat(w)} ${gFormat(h)}`);
  return [
    `normalised viewBox origin (${gFormat(minx)}, ${gFormat(miny)}) -> 0 0 ` +
      "(wrapped content in a translate)",
  ];
}

export function applyFixes(root: Element): string[] {
  return [...fixInkscapeIds(root), ...fixViewBoxOrigin(root)];
}
