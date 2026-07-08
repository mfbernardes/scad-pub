// Safe, appearance-preserving fixes applied in place. Each returns a list of
// human-readable change strings.

import { canvasBackgrounds } from "./background";
import { SHAPE_TAGS, SVG_NS, inkAttr, iterElements, localName } from "./dom";
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

// Whether the element sets its own fill (a `fill=` attribute or a `fill:` in its
// `style` attribute) — in which case a stylesheet rule must not override it.
export function hasOwnFill(el: Element): boolean {
  if (/(?:^|;)\s*fill\s*:/i.test(el.getAttribute("style") ?? "")) return true;
  return el.getAttribute("fill") !== null;
}

interface FillRule {
  /** Specificity rank: 0 = element/tag, 1 = class, 2 = id. */
  rank: 0 | 1 | 2;
  name: string;
  fill: string;
}

// Parse `<style>` text for simple `selector { … fill: X … }` rules using a
// class (`.c`), id (`#i`) or element (`tag`) selector. OpenSCAD's import ignores
// `<style>` entirely, so these fills are invisible to it and to colour
// derivation; resolving them onto the shapes is what keeps a CSS-styled export
// (common from Illustrator/Inkscape) from deriving every region as black.
// Compound/complex selectors are skipped (they're reported by `check`).
function parseStyleFillRules(root: Element): FillRule[] {
  const rules: FillRule[] = [];
  for (const el of iterElements(root)) {
    if (localName(el) !== "style") continue;
    const css = (el.textContent ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const block of css.split("}")) {
      const brace = block.indexOf("{");
      if (brace < 0) continue;
      const fillMatch = /(?:^|;)\s*fill\s*:\s*([^;]+)/i.exec(block.slice(brace + 1));
      if (!fillMatch) continue;
      const fill = fillMatch[1].trim();
      for (const sel of block.slice(0, brace).split(",")) {
        const s = sel.trim();
        if (/^\.[-\w]+$/.test(s)) rules.push({ rank: 1, name: s.slice(1), fill });
        else if (/^#[-\w]+$/.test(s)) rules.push({ rank: 2, name: s.slice(1), fill });
        else if (/^[a-zA-Z][\w-]*$/.test(s)) rules.push({ rank: 0, name: s.toLowerCase(), fill });
        // anything else is a compound/complex selector — left for `check` to flag
      }
    }
  }
  return rules;
}

/** The fill an element inherits from a matching `<style>` rule (id beats class
 *  beats tag; a later rule wins a tie), or null when none applies. */
export function styleRuleFill(el: Element, rules: FillRule[]): string | null {
  const classes = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
  const id = el.getAttribute("id");
  const tag = localName(el);
  let best: FillRule | null = null;
  for (const r of rules) {
    const matches =
      (r.rank === 2 && r.name === id) ||
      (r.rank === 1 && classes.includes(r.name)) ||
      (r.rank === 0 && r.name === tag);
    if (matches && (!best || r.rank >= best.rank)) best = r;
  }
  return best ? best.fill : null;
}

/** Resolve simple `<style>` class/id/tag fill rules onto the shapes and groups
 *  that rely on them (setting an inline `fill`), so colour derivation reads the
 *  drawing's real colours instead of defaulting to black. Appearance-preserving
 *  and geometry-neutral (OpenSCAD ignores both the stylesheet and the fill). */
export function resolveStyleFills(root: Element): string[] {
  const rules = parseStyleFillRules(root);
  if (rules.length === 0) return [];
  let count = 0;
  for (const el of iterElements(root)) {
    const tag = localName(el);
    if (tag !== "g" && !SHAPE_TAGS.has(tag)) continue;
    if (hasOwnFill(el)) continue;
    const fill = styleRuleFill(el, rules);
    if (fill) {
      el.setAttribute("fill", fill);
      count += 1;
    }
  }
  return count ? [`applied ${count} fill(s) from a <style> block onto their shapes`] : [];
}

/** Drop any full-canvas background rectangle. OpenSCAD fills every shape, so a
 *  rectangle covering the whole viewBox would bury the drawing in one solid
 *  block; removing it is what a tactile relief actually wants (the raised shapes
 *  need open space around them). Only runs when other geometry remains, so the
 *  drawing never ends up empty. */
export function removeCanvasBackground(root: Element): string[] {
  const backgrounds = canvasBackgrounds(root);
  let count = 0;
  for (const el of backgrounds) {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
      count += 1;
    }
  }
  return count
    ? [
        `removed ${count} full-canvas background rectangle(s) that would import as ` +
          "one solid block",
      ]
    : [];
}

export function applyFixes(root: Element): string[] {
  // Background removal first: it reasons about raw coordinates, before
  // fixViewBoxOrigin wraps the content in a translate.
  return [
    ...removeCanvasBackground(root),
    ...fixInkscapeIds(root),
    ...fixViewBoxOrigin(root),
    ...resolveStyleFills(root),
  ];
}
