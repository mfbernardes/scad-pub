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
import { CSS_IMPORT_RE, CSS_URL_RE, isSameDocumentRef, urlRefValue } from "../cssRefs.mjs";
import { canvasBackgrounds } from "./background";
import { contentBbox, parseViewBox } from "./geometry";
import { deriveRegions, effectiveFill, groupIndex, shapesUnder } from "./regions";
import { MAX_RELIABLE_REGIONS } from "./limits";
import type { Finding, Region } from "./types";

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
    findings.push({ level: "WARN", code: "no-viewbox" });
  } else {
    const [minx, miny] = vb;
    if (Math.abs(minx) > 1e-6 || Math.abs(miny) > 1e-6) {
      findings.push({ level: "WARN", code: "viewbox-origin" });
    }
  }

  const els = iterElements(root);
  const shapes = els.filter((el) => SHAPE_TAGS.has(localName(el)));
  if (shapes.length === 0) {
    findings.push({ level: "ERROR", code: "no-geometry" });
  }

  const texts = els.filter((el) => TEXT_TAGS.has(localName(el)));
  if (texts.length > 0) {
    findings.push({ level: "WARN", code: "text", vars: { count: texts.length } });
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
    findings.push({ level: "WARN", code: "stroke-only", vars: { count: strokeOnly.length } });
  }
  if (openPaths > 0) {
    findings.push({ level: "WARN", code: "open-paths", vars: { count: openPaths } });
  }

  // Canvas-background trap: OpenSCAD fills every shape, so a rectangle covering
  // the whole viewBox imports as one solid block that buries all other detail.
  // The drawing extrudes as a single featureless slab. The commonest cause of a
  // map/pictogram that renders as one block.
  const backgrounds = canvasBackgrounds(root);
  if (backgrounds.length > 0) {
    findings.push({ level: "WARN", code: "covers-canvas", vars: { count: backgrounds.length } });
  }

  // Active content: reported on its own terms, because the reason it matters
  // here is not "OpenSCAD will skip it" but "this file is untrusted input".
  // applyFixes strips these; see ACTIVE_TAGS.
  const active = els.filter((el) => ACTIVE_TAGS.has(localName(el)));
  // matchAll, not test(): both regexes are global, and `test` on a global regex
  // advances its lastIndex, so a second call over different text can miss.
  const fetching = els.filter((el) => {
    if (localName(el) !== "style") return false;
    const css = el.textContent ?? "";
    if ([...css.matchAll(CSS_IMPORT_RE)].length > 0) return true;
    return [...css.matchAll(CSS_URL_RE)].some((m) => !isSameDocumentRef(urlRefValue(m)));
  });
  if (active.length > 0 || fetching.length > 0) {
    const names = [
      ...new Set([...active, ...fetching].map((el) => `<${localName(el)}>`)),
    ].sort();
    findings.push({
      level: "WARN",
      code: "active-content",
      vars: { count: active.length + fetching.length, names },
    });
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
    findings.push({ level: "WARN", code: "ignored", vars: { tag: name, count: ignored.get(name)! } });
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
      findings.push({ level: "WARN", code: "styled-fill", vars: { count: styled.length } });
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
    findings.push({ level: "WARN", code: "inkscape-trap", vars: { count: trapped.length, names } });
  }

  // Only the ids deriveRegions can ACTUALLY emit, not every `<g id>` in the
  // file: `byId` includes wrapper groups that merely contain other id-groups
  // and groups holding no shapes at all, neither of which becomes a region.
  // Advertising those sent the visitor looking for a region the pipeline was
  // never going to produce.
  const derived = regions ?? deriveRegions(root);
  const regionIds = derived.map((r) => r.id).sort();
  if (regionIds.length > 0) {
    findings.push({ level: "INFO", code: "regions-available", vars: { regions: regionIds } });
  }

  // More regions than a slicer handles reliably (small regions merge or drop).
  // Raised here rather than only in the wizard's own JSX, so a non-wizard
  // consumer of `check` gets the caution too.
  if (regionIds.length > MAX_RELIABLE_REGIONS) {
    findings.push({
      level: "WARN",
      code: "too-many-regions",
      vars: { count: regionIds.length, max: MAX_RELIABLE_REGIONS },
    });
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
      findings.push({ level: "WARN", code: "shapes-outside-regions", vars: { count: orphans.length } });
    }
  }

  // The requested region names must resolve to a <g id=...>.
  for (const name of layers) {
    if (byId.has(name)) continue;
    if (byLabel.has(name)) {
      findings.push({ level: "ERROR", code: "region-is-label", vars: { name } });
    } else {
      // The "(none)" fallback for an empty region list is a display concern
      // (svgPrepText.ts), not this module's: `regions` is passed through as-is,
      // possibly empty.
      findings.push({ level: "ERROR", code: "region-missing", vars: { name, regions: regionIds } });
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
      findings.push({ level: "WARN", code: "content-outside-viewbox" });
    } else if (w > 0 && h > 0) {
      const fillFrac = ((bx1 - bx0) * (by1 - by0)) / (w * h);
      if (fillFrac < 0.5) {
        findings.push({ level: "INFO", code: "undersized" });
      }
    }
  }

  return findings;
}
