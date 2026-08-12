// Compatibility checks for an SVG destined for OpenSCAD's geometry-only
// `import()`. `code` is a stable identifier; a finding's human-readable
// message/hint live in src/lib/svgPrepText.ts, resolved from `code` + `vars`
// at render time. This module stays i18n-free on purpose (see CLAUDE.md) so
// it runs unchanged under the Node test suite.

import {
  ACTIVE_TAGS,
  IGNORED_TAGS,
  SHAPE_TAGS,
  TEXT_TAGS,
  iterElements,
  localName,
  paint,
  trappedLayers,
} from "./dom";
import {
  CSS_IMPORT_RE,
  CSS_URL_RE,
  cssUnsafeReason,
  isSameDocumentRef,
  normalizeCssEscapes,
  urlRefValue,
} from "../cssRefs.mjs";
import { canvasBackgrounds } from "./background";
import { contentBbox, parseViewBox } from "./geometry";
import { deriveRegions, effectiveFill, groupIndex, shapesUnder } from "./regions";
import { MAX_RELIABLE_REGIONS } from "./limits";
import type { Finding, Level, Region, Vars } from "./types";

/** Every code `check()` can emit, as the single source of truth: the `push`
 *  helper below types each call site against it, so a typo or a code missing
 *  from this list fails to compile, and src/lib/svgPrepText.ts's own
 *  table-coverage test (tests/svgPrepText.test.mjs) asserts against this
 *  export too, so a code ADDED here without a matching catalogue entry fails
 *  a test instead of shipping silently. */
export const FIND_CODES = [
  "no-viewbox",
  "viewbox-origin",
  "no-geometry",
  "text",
  "stroke-only",
  "open-paths",
  "covers-canvas",
  "active-content",
  "ignored",
  "styled-fill",
  "inkscape-trap",
  "regions-available",
  "too-many-regions",
  "shapes-outside-regions",
  "region-is-label",
  "region-missing",
  "content-outside-viewbox",
  "undersized",
] as const;
export type FindCode = (typeof FIND_CODES)[number];

function push(findings: Finding[], level: Level, code: FindCode, vars?: Vars): void {
  findings.push({ level, code, vars });
}

/**
 * Run every compatibility check.
 * @param root    the SVG root element
 * @param layers  region ids to verify (from parseLayersArg)
 * @param regions the derived regions, when the caller already has them.
 *   `analyze`/`prepareSvg` do, and deriving is a full tree walk plus a
 *   shapesUnder walk per candidate group — re-deriving here made a single
 *   analyze() pay for it three times over.
 */
export function check(root: Element, layers: string[] = [], regions?: Region[]): Finding[] {
  const findings: Finding[] = [];

  const vb = parseViewBox(root);
  if (vb === null) {
    push(findings, "WARN", "no-viewbox");
  } else {
    const [minx, miny] = vb;
    if (Math.abs(minx) > 1e-6 || Math.abs(miny) > 1e-6) {
      push(findings, "WARN", "viewbox-origin");
    }
  }

  const els = iterElements(root);
  const shapes = els.filter((el) => SHAPE_TAGS.has(localName(el)));
  if (shapes.length === 0) {
    push(findings, "ERROR", "no-geometry");
  }

  const texts = els.filter((el) => TEXT_TAGS.has(localName(el)));
  if (texts.length > 0) {
    push(findings, "WARN", "text", { count: texts.length });
  }

  const strokeOnly: Element[] = [];
  let openPaths = 0;
  for (const el of shapes) {
    const fill = paint(el, "fill");
    const stroke = paint(el, "stroke");
    if (fill === "none" && stroke !== null && stroke !== "none" && stroke !== "") {
      strokeOnly.push(el);
    }
    if (localName(el) === "path") {
      const d = el.getAttribute("d") ?? "";
      const opens =
        (d.match(/[Mm]/g)?.length ?? 0) - (d.match(/[Zz]/g)?.length ?? 0);
      if (opens > 0) openPaths += opens;
    }
  }
  if (strokeOnly.length > 0) {
    push(findings, "WARN", "stroke-only", { count: strokeOnly.length });
  }
  if (openPaths > 0) {
    push(findings, "WARN", "open-paths", { count: openPaths });
  }

  // Canvas-background trap: OpenSCAD fills every shape, so a rectangle covering
  // the whole viewBox imports as one solid block that buries all other detail.
  // The drawing extrudes as a single featureless slab. The commonest cause of a
  // map/pictogram that renders as one block.
  const backgrounds = canvasBackgrounds(root);
  if (backgrounds.length > 0) {
    push(findings, "WARN", "covers-canvas", { count: backgrounds.length });
  }

  // Active content: reported on its own terms, because the reason it matters
  // here is not "OpenSCAD will skip it" but "this file is untrusted input".
  // applyFixes strips these; see ACTIVE_TAGS.
  const active = els.filter((el) => ACTIVE_TAGS.has(localName(el)));
  // matchAll, not test(): both regexes are global, and `test` on a global regex
  // advances its lastIndex, so a second call over different text can miss.
  // Matched on an escape-normalized copy (u\72 l(...), @\69 mport) so a
  // CSS-escaped spelling is found exactly as a CSS tokenizer would resolve
  // it, not just a literal one; cssUnsafeReason additionally catches what
  // that escape-normalized match alone can't see (image-set()'s bare
  // quoted-string URL, an unlisted function, another at-rule).
  const fetching = els.filter((el) => {
    if (localName(el) !== "style") return false;
    const css = el.textContent ?? "";
    if (cssUnsafeReason(css)) return true;
    const normalized = normalizeCssEscapes(css);
    if ([...normalized.matchAll(CSS_IMPORT_RE)].length > 0) return true;
    return [...normalized.matchAll(CSS_URL_RE)].some((m) => !isSameDocumentRef(urlRefValue(m)));
  });
  if (active.length > 0 || fetching.length > 0) {
    const names = [
      ...new Set([...active, ...fetching].map((el) => `<${localName(el)}>`)),
    ].sort();
    push(findings, "WARN", "active-content", { count: active.length + fetching.length, names });
  }

  const ignored = new Map<string, number>();
  for (const el of els) {
    const name = localName(el);
    // ACTIVE_TAGS wins where the two sets overlap (`foreignObject` is in both):
    // active-content above already named it, and this finding's advice —
    // flatten it into filled shapes — is wrong for something the Fix step
    // deletes outright.
    if (IGNORED_TAGS.has(name) && !ACTIVE_TAGS.has(name))
      ignored.set(name, (ignored.get(name) ?? 0) + 1);
  }
  for (const name of [...ignored.keys()].sort()) {
    push(findings, "WARN", "ignored", { tag: name, count: ignored.get(name)! });
  }

  // CSS-styled fills: OpenSCAD ignores <style> entirely, so a region painted only
  // through a stylesheet rule imports (and derives) as black. applyFixes resolves
  // plain .class/#id/tag rules onto the shapes; flag any shape that still has no
  // effective fill while a <style> block is present (an unresolved compound rule).
  if (els.some((el) => localName(el) === "style")) {
    const styled = shapes.filter(
      (el) => el.getAttribute("class") && !effectiveFill(el)[1],
    );
    if (styled.length > 0) {
      push(findings, "WARN", "styled-fill", { count: styled.length });
    }
  }

  // Inkscape layer trap: a layer carries its name in inkscape:label, but OpenSCAD
  // selects by the SVG id, so a layer named "walls" with id="layer1" is invisible.
  const { byId, byLabel } = groupIndex(root);
  const trapped = trappedLayers(els);
  if (trapped.length > 0) {
    // Pre-composed technical notation ("label" (id=x)), not prose: kept
    // locale-invariant on purpose (see CLAUDE.md's D3 rule) since it names the
    // drawing's own ids, which never translate.
    const names = trapped.map((t) => `"${t.label}" (id=${t.id})`);
    push(findings, "WARN", "inkscape-trap", { count: trapped.length, names });
  }

  // Only the ids deriveRegions can ACTUALLY emit, not every `<g id>` in the
  // file: `byId` includes wrapper groups that merely contain other id-groups
  // and groups holding no shapes at all, neither of which becomes a region.
  // Advertising those sent the visitor looking for a region the pipeline was
  // never going to produce.
  const derived = regions ?? deriveRegions(root);
  const regionIds = derived.map((r) => r.id).sort();
  if (regionIds.length > 0) {
    push(findings, "INFO", "regions-available", { regions: regionIds });
  }

  // More regions than a slicer handles reliably (small regions merge or drop).
  // Raised here rather than only in the wizard's own JSX, so a non-wizard
  // consumer of `check` gets the caution too.
  if (regionIds.length > MAX_RELIABLE_REGIONS) {
    push(findings, "WARN", "too-many-regions", { count: regionIds.length, max: MAX_RELIABLE_REGIONS });
  }

  // Shapes that belong to no region at all. With regions in play these vanish
  // from a per-region consumer without a word, which reads as the drawing
  // having silently lost detail.
  if (regionIds.length > 0) {
    // Through byId (groupIndex, above) rather than re-finding each group: a
    // find-per-region re-walked the whole tree R times, which measured as 37%
    // of a check() pass on a 40k-element drawing.
    const claimed = new Set(
      derived.flatMap((r) => {
        const group = byId.get(r.id);
        return group ? shapesUnder(group) : [];
      })
    );
    const orphans = shapes.filter((sh) => !claimed.has(sh));
    if (orphans.length > 0) {
      push(findings, "WARN", "shapes-outside-regions", { count: orphans.length });
    }
  }

  // The requested region names must resolve to a <g id=...>.
  for (const name of layers) {
    if (byId.has(name)) continue;
    if (byLabel.has(name)) {
      push(findings, "ERROR", "region-is-label", { name });
    } else {
      // The svgPrep.noneAvailable fallback for an empty region list is a
      // display concern (svgPrepText.ts), not this module's: `regions` is
      // passed through as-is, possibly empty.
      push(findings, "ERROR", "region-missing", { name, regions: regionIds });
    }
  }

  // Coarse placement hints (approximate; transforms make them unreliable).
  const bbox = contentBbox(root);
  // No `hasTransforms` gate: contentBbox composes the transforms it can measure
  // through and returns null for the rest, so a non-null bbox is already in
  // root's own frame. Gating on "any transform at all" went blind after
  // fixViewBoxOrigin wrapped the drawing in one — and, worse, once the wrapper
  // was exempted by name, reported content outside a viewBox it was inside.
  if (bbox && vb) {
    const [minx, miny, w, h] = vb;
    const [bx0, by0, bx1, by1] = bbox;
    if (
      bx0 < minx - 1e-6 ||
      by0 < miny - 1e-6 ||
      bx1 > minx + w + 1e-6 ||
      by1 > miny + h + 1e-6
    ) {
      push(findings, "WARN", "content-outside-viewbox");
    } else if (w > 0 && h > 0) {
      const fillFrac = ((bx1 - bx0) * (by1 - by0)) / (w * h);
      if (fillFrac < 0.5) {
        push(findings, "INFO", "undersized");
      }
    }
  }

  return findings;
}
