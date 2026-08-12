// Safe, appearance-preserving fixes applied in place. Each returns the list of
// changes it made, coded the same way check.ts's findings are (see types.ts);
// src/lib/svgPrepText.ts resolves a Change to display text.

import { canvasBackgrounds } from "./background";
import {
  ACTIVE_TAGS,
  SHAPE_TAGS,
  SVG_NS,
  iterElements,
  localName,
  trappedLayers,
} from "./dom";
import { CSS_IMPORT_RE, CSS_URL_RE, cssUnsafeReason, isSameDocumentRef } from "../cssRefs.mjs";
import { gFormat, parseViewBox } from "./geometry";
import type { Change, Vars } from "./types";

/** Every Change code this module can emit, as the single source of truth: the
 *  `change` helper below types each call site against it, so a typo or a code
 *  missing from this list fails to compile, and src/lib/svgPrepText.ts's own
 *  table-coverage test (tests/svgPrepText.test.mjs) asserts against this
 *  export too, so a code ADDED here without a matching catalogue entry fails
 *  a test instead of shipping silently. groupByColor.ts's own "grouped-colour"
 *  Change isn't in this list — it's minted where it's emitted, not here. */
export const CHANGE_CODES = [
  "layer-kept",
  "layer-usable",
  "layer-renamed",
  "recentred",
  "removed-background",
  "removed-active",
  "removed-external",
  "removed-unsafe-attrs",
  "removed-unsafe-style",
  "style-fills",
] as const;
export type FixChangeCode = (typeof CHANGE_CODES)[number];

function change(code: FixChangeCode, vars?: Vars): Change {
  return { code, vars };
}

/** Rename each Inkscape layer's id to its label so it is selectable. Only touches
 *  layer groups whose label differs from the id, sanitises the label into a
 *  valid id first, and skips a rename that would collide with an id already in
 *  use. */
export function fixInkscapeIds(root: Element): Change[] {
  const changes: Change[] = [];
  const els = iterElements(root);
  const existing = new Set<string>();
  for (const el of els) {
    const id = el.getAttribute("id");
    if (id) existing.add(id);
  }
  for (const { el, label, id: gid, target } of trappedLayers(els)) {
    if (existing.has(target)) {
      changes.push(change("layer-kept", { label }));
      continue;
    }
    el.setAttribute("id", target);
    if (gid) existing.delete(gid);
    existing.add(target);
    changes.push(
      target === label ? change("layer-usable", { label }) : change("layer-renamed", { label, target }),
    );
  }
  return changes;
}

/** Normalise a non-zero viewBox origin to 0 0 by wrapping the content in a
 *  translate, preserving appearance. */
export function fixViewBoxOrigin(root: Element): Change[] {
  const vb = parseViewBox(root);
  if (vb === null) return [];
  const [minx, miny, w, h] = vb;
  if (Math.abs(minx) <= 1e-6 && Math.abs(miny) <= 1e-6) return [];

  const doc = root.ownerDocument!;
  const wrapper = doc.createElementNS(SVG_NS, "g");
  wrapper.setAttribute("transform", `translate(${gFormat(-minx)},${gFormat(-miny)})`);
  // Document metadata stays OUTSIDE: <title>/<desc> are the drawing's
  // accessible name and description, which belong to the <svg> element, and
  // burying them a level down changes what assistive tech reads.
  const METADATA = new Set(["title", "desc", "metadata"]);
  const metadata: Node[] = [];
  while (root.firstChild) {
    const child = root.firstChild;
    if (child.nodeType === 1 && METADATA.has(localName(child as Element))) metadata.push(child);
    wrapper.appendChild(child);
  }
  for (const node of metadata) root.appendChild(node);
  root.appendChild(wrapper);
  root.setAttribute("viewBox", `0 0 ${gFormat(w)} ${gFormat(h)}`);
  return [change("recentred")];
}

// Whether the element sets its own fill (a `fill=` attribute or a `fill:` in its
// `style` attribute). In which case a stylesheet rule must not override it.
function hasOwnFill(el: Element): boolean {
  if (/(?:^|;)\s*fill\s*:/i.test(el.getAttribute("style") ?? "")) return true;
  return el.getAttribute("fill") !== null;
}

interface FillRule {
  /** Specificity rank: 0 = element/tag, 1 = class, 2 = id. */
  rank: 0 | 1 | 2;
  name: string;
  fill: string;
}

// Parse `<style>` text for plain `selector { … fill: X … }` rules using a
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
        // anything else is a compound/complex selector: left for `check` to flag
      }
    }
  }
  return rules;
}

/** The fill an element inherits from a matching `<style>` rule (id beats class
 *  beats tag; a later rule wins a tie), or null when none applies. */
function styleRuleFill(el: Element, rules: FillRule[]): string | null {
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

/** Resolve plain `<style>` class/id/tag fill rules onto the shapes and groups
 *  that rely on them (setting an inline `fill`), so colour derivation reads the
 *  drawing's real colours instead of defaulting to black. Appearance-preserving
 *  and geometry-neutral (OpenSCAD ignores both the stylesheet and the fill). */
export function resolveStyleFills(root: Element): Change[] {
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
  return count ? [change("style-fills", { count })] : [];
}

/** Drop any full-canvas background rectangle. OpenSCAD fills every shape, so a
 *  rectangle covering the whole viewBox would bury the drawing in one solid
 *  block; removing it is what a tactile relief actually wants (the raised shapes
 *  need open space around them). Only runs when other geometry remains, so the
 *  drawing never ends up empty. */
function removeCanvasBackground(root: Element): Change[] {
  const backgrounds = canvasBackgrounds(root);
  let count = 0;
  for (const el of backgrounds) {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
      count += 1;
    }
  }
  return count ? [change("removed-background", { count })] : [];
}

// Attributes whose value is CSS and can therefore carry a fetching `url()`:
// `style` plus the SVG presentation attributes that take a <paint>, <filter>
// or reference. Mirrors svg-sanitize.mjs's CSS_VALUE_ATTRS.
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

/** Remove every element that can execute (see ACTIVE_TAGS), strip every
 *  fetch/execute vector off what survives — event-handler attributes,
 *  non-same-document `href`/`xlink:href`, `ping`, `xml:base`, and external
 *  `url()` in style/presentation attributes — and neutralise what a `<style>`
 *  block can fetch (`@import`, an external `url()`), leaving its rules — and
 *  therefore the drawing's colours — untouched. The result is inert by
 *  construction rather than by the accident of never being rendered: see
 *  ACTIVE_TAGS's comment in dom.ts for why that accident isn't something to
 *  lean on. None of it becomes geometry, and a user-supplied drawing is the one
 *  SVG class ScadPub does not trust. */
export function removeActiveContent(root: Element): Change[] {
  const changes: Change[] = [];
  // One walk: on a 2 MB drawing a second full traversal is ~50k nodes for a
  // filter this pass already has in hand.
  const els = iterElements(root);
  const active = els.filter((el) => ACTIVE_TAGS.has(localName(el)));
  let count = 0;
  for (const el of active) {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
      count += 1;
    }
  }
  if (count) changes.push(change("removed-active", { count }));

  // Make what survives inert too, mirroring svg-sanitize.mjs's attribute
  // rules: an event handler executes; a non-same-document href/xlink:href
  // (localName strips the prefix) navigates or fetches; `ping` beacons on
  // activation; `xml:base` rebases a kept reference; and an external `url()`
  // in a style or presentation attribute fetches (a same-document `url(#id)`
  // paint reference is routine and kept). Descendants of the elements just
  // removed are skipped so the count reflects only what stayed in the drawing.
  const removed = new Set<Element>();
  for (const el of active) for (const d of iterElements(el)) removed.add(d);
  let unsafeAttrs = 0;
  for (const el of els) {
    if (removed.has(el)) continue;
    const attrs = el.attributes;
    if (!attrs) continue;
    const toRemove: string[] = [];
    const toSet: [string, string][] = [];
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      const local = (attr.localName ?? attr.name).toLowerCase();
      const name = attr.name.toLowerCase();
      const value = attr.value ?? "";
      if (local.startsWith("on") || local === "ping" || name === "xml:base") {
        toRemove.push(attr.name);
      } else if (local === "href" && !isSameDocumentRef(value)) {
        toRemove.push(attr.name);
      } else if (CSS_VALUE_ATTRS.has(local)) {
        // Escape-hidden or otherwise unvouched-for CSS (see cssUnsafeReason)
        // can't be trusted to a same-document/foreign url() rewrite: drop the
        // whole attribute rather than ship it half-scrubbed.
        if (cssUnsafeReason(value)) {
          toRemove.push(attr.name);
        } else {
          const cleaned = value.replace(CSS_URL_RE, (m, dq: string, sq: string, bare: string) =>
            isSameDocumentRef(dq ?? sq ?? bare ?? "") ? m : "none"
          );
          if (cleaned !== value) toSet.push([attr.name, cleaned]);
        }
      }
    }
    for (const name of toRemove) {
      el.removeAttribute(name);
      unsafeAttrs += 1;
    }
    for (const [name, value] of toSet) {
      el.setAttribute(name, value);
      unsafeAttrs += 1;
    }
  }
  if (unsafeAttrs) changes.push(change("removed-unsafe-attrs", { count: unsafeAttrs }));

  let fetches = 0;
  let unsafeStyles = 0;
  for (const el of els) {
    if (localName(el) !== "style") continue;
    const css = el.textContent ?? "";
    // Mirrors svg-sanitize.mjs: escape-hidden references and constructs
    // outside the closed safe-function/@media allowlist (a quoted string —
    // how image-set() carries a URL with no url() in sight — a disallowed
    // function, another at-rule) can't be trusted to the url()/@import
    // rewrite below, so the whole block goes rather than half-scrubbed.
    if (cssUnsafeReason(css)) {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
        unsafeStyles += 1;
      }
      continue;
    }
    const cleaned = css
      .replace(CSS_IMPORT_RE, () => {
        fetches += 1;
        return "";
      })
      .replace(CSS_URL_RE, (m, dq: string, sq: string, bare: string) => {
        if (isSameDocumentRef(dq ?? sq ?? bare ?? "")) return m; // a same-document reference is routine
        fetches += 1;
        return "none";
      });
    if (cleaned !== css) el.textContent = cleaned;
  }
  if (fetches) changes.push(change("removed-external", { count: fetches }));
  if (unsafeStyles) changes.push(change("removed-unsafe-style", { count: unsafeStyles }));
  return changes;
}

export function applyFixes(root: Element): Change[] {
  // Background removal first: it reasons about raw coordinates, before
  // fixViewBoxOrigin wraps the content in a translate.
  return [
    ...removeCanvasBackground(root),
    ...fixInkscapeIds(root),
    ...fixViewBoxOrigin(root),
    // Before resolveStyleFills, not after: an `@import` sits in the same text
    // parseStyleFillRules reads selectors out of, and takes the following rule's
    // selector down with it. Scrubbing the fetches first is also why `<style>`
    // is neutralised rather than removed — the rules still have to be readable.
    ...removeActiveContent(root),
    ...resolveStyleFills(root),
  ];
}
