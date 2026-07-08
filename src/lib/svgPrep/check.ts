// Compatibility checks for an SVG destined for OpenSCAD's geometry-only
// `import()`. `code` values are stable identifiers; `message`/`hint` are
// human-readable guidance shown in the wizard.

import {
  IGNORED_TAGS,
  SHAPE_TAGS,
  TEXT_TAGS,
  hasAnyTransform,
  inkAttr,
  iterElements,
  localName,
  paint,
} from "./dom";
import { canvasBackgrounds } from "./background";
import { contentBbox, parseViewBox } from "./geometry";
import { effectiveFill, groupIndex } from "./regions";
import type { Finding } from "./types";

/**
 * Run every compatibility check.
 * @param root   the SVG root element
 * @param layers region ids to verify (from parseLayersArg)
 */
export function check(root: Element, layers: string[] = []): Finding[] {
  const findings: Finding[] = [];
  const hasTransforms = hasAnyTransform(root);

  const vb = parseViewBox(root);
  if (vb === null) {
    findings.push({
      level: "WARN",
      code: "no-viewbox",
      message: "the drawing has no canvas frame, so its size on the plate can't be judged reliably",
      hint: "export with a viewBox (most editors do this automatically) so it always scales the same way",
    });
  } else {
    const [minx, miny] = vb;
    if (Math.abs(minx) > 1e-6 || Math.abs(miny) > 1e-6) {
      findings.push({
        level: "WARN",
        code: "viewbox-origin",
        message:
          "the drawing's canvas doesn't start at the top-left corner, so parts of it " +
          "can land off the plate (especially with colour regions)",
        hint: "the Fix step re-centres the drawing for you",
      });
    }
  }

  const els = iterElements(root);
  const shapes = els.filter((el) => SHAPE_TAGS.has(localName(el)));
  if (shapes.length === 0) {
    findings.push({
      level: "ERROR",
      code: "no-geometry",
      message: "nothing to raise — the drawing has no shapes that can become relief",
      hint: "draw filled shapes (rectangles, circles, paths); only shapes can be raised, not text or images",
    });
  }

  const texts = els.filter((el) => TEXT_TAGS.has(localName(el)));
  if (texts.length > 0) {
    findings.push({
      level: "WARN",
      code: "text",
      message: `${texts.length} piece(s) of live text — text can't be raised into relief and will disappear`,
      hint:
        "convert the text to outlines in your editor (Inkscape: Object to Path; " +
        "Illustrator: Create Outlines), or add wording through the design's own label field instead",
    });
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
    findings.push({
      level: "WARN",
      code: "stroke-only",
      message:
        `${strokeOnly.length} outline-only shape(s) (a stroke with no fill) — ` +
        "every shape is raised as a filled shape, so these come out solid instead of as thin outlines",
      hint:
        "give the shape a fill, or convert its outline to a filled shape " +
        "(Inkscape: Stroke to Path; Illustrator: Outline Stroke) to keep a thin wall or outline",
    });
  }
  if (openPaths > 0) {
    findings.push({
      level: "WARN",
      code: "open-paths",
      message: `${openPaths} unclosed path(s) — an open path may come out as a thin sliver or not at all`,
      hint: "close every path in your editor",
    });
  }

  // Canvas-background trap: OpenSCAD fills every shape, so a rectangle covering
  // the whole viewBox imports as one solid block that buries all other detail —
  // the drawing extrudes as a single featureless slab. The commonest cause of a
  // map/pictogram that renders as one block.
  const backgrounds = canvasBackgrounds(root);
  if (backgrounds.length > 0) {
    findings.push({
      level: "WARN",
      code: "covers-canvas",
      message:
        `${backgrounds.length} shape(s) cover the whole canvas — a full-canvas background ` +
        "is raised as one solid block that buries everything on top of it",
      hint:
        "remove the background/artboard rectangle (the Fix step drops it); a tactile " +
        "relief needs open space around the raised shapes",
    });
  }

  const ignored = new Map<string, number>();
  for (const el of els) {
    const name = localName(el);
    if (IGNORED_TAGS.has(name)) ignored.set(name, (ignored.get(name) ?? 0) + 1);
  }
  for (const name of [...ignored.keys()].sort()) {
    findings.push({
      level: "WARN",
      code: `ignored:${name}`,
      message: `${ignored.get(name)} <${name}> element(s) — these aren't supported and won't be raised`,
      hint: "flatten or expand them into plain filled shapes if they carry artwork you need",
    });
  }

  // CSS-styled fills: OpenSCAD ignores <style> entirely, so a region painted only
  // through a stylesheet rule imports (and derives) as black. applyFixes resolves
  // simple .class/#id/tag rules onto the shapes; flag any shape that still has no
  // effective fill while a <style> block is present (an unresolved compound rule).
  if (els.some((el) => localName(el) === "style")) {
    const styled = shapes.filter(
      (el) => el.getAttribute("class") && !effectiveFill(el)[1],
    );
    if (styled.length > 0) {
      findings.push({
        level: "WARN",
        code: "styled-fill",
        message:
          `${styled.length} shape(s) get their colour from a stylesheet, which isn't ` +
          "read here — those regions are treated as black",
        hint:
          "give each shape a direct fill colour, or a simple class / id / tag colour " +
          "rule the Fix step can resolve",
      });
    }
  }

  // Inkscape layer trap: a layer carries its name in inkscape:label, but OpenSCAD
  // selects by the SVG id, so a layer named "walls" with id="layer1" is invisible.
  const { byId, byLabel } = groupIndex(root);
  const trapped: Array<[string, string | null]> = [];
  for (const el of els) {
    if (localName(el) === "g" && inkAttr(el, "groupmode") === "layer") {
      const label = inkAttr(el, "label");
      const gid = el.getAttribute("id");
      if (label && gid !== label) trapped.push([label, gid]);
    }
  }
  if (trapped.length > 0) {
    const names = trapped.map(([lab, gid]) => `"${lab}" (id=${gid})`).join(", ");
    findings.push({
      level: "WARN",
      code: "inkscape-trap",
      message: `Inkscape layer name(s) won't be matched as colour regions yet: ${names}`,
      hint:
        "the Fix step renames each layer so its name is used as the region, " +
        "or set an explicit name on the group",
    });
  }

  const regionIds = [...byId.keys()].sort();
  if (regionIds.length > 0) {
    findings.push({
      level: "INFO",
      code: "regions-available",
      message: `colourable regions found: ${regionIds.join(", ")}`,
    });
  }

  // The requested region names must resolve to a <g id=...>.
  for (const name of layers) {
    if (byId.has(name)) continue;
    if (byLabel.has(name)) {
      findings.push({
        level: "ERROR",
        code: "region-is-label",
        message:
          `the colour region "${name}" is an Inkscape layer name that won't be matched as-is`,
        hint: "the Fix step makes the layer name usable as a region",
      });
    } else {
      const avail = regionIds.join(", ") || "(none)";
      findings.push({
        level: "ERROR",
        code: "region-missing",
        message: `no region named "${name}" in the drawing; available: ${avail}`,
        hint:
          `group the shapes for this colour and name the group "${name}" ` +
          "(Inkscape: Object Properties; Illustrator: the layer name)",
      });
    }
  }

  // Coarse placement hints (approximate; transforms make them unreliable).
  const bbox = contentBbox(root);
  if (bbox && vb && !hasTransforms) {
    const [minx, miny, w, h] = vb;
    const [bx0, by0, bx1, by1] = bbox;
    if (
      bx0 < minx - 1e-6 ||
      by0 < miny - 1e-6 ||
      bx1 > minx + w + 1e-6 ||
      by1 > miny + h + 1e-6
    ) {
      findings.push({
        level: "WARN",
        code: "content-outside-viewbox",
        message: "some artwork sits outside the canvas — it may be cut off",
        hint: "move everything inside the canvas frame",
      });
    } else if (w > 0 && h > 0) {
      const fillFrac = ((bx1 - bx0) * (by1 - by0)) / (w * h);
      if (fillFrac < 0.5) {
        findings.push({
          level: "INFO",
          code: "undersized",
          message:
            "the drawing fills less than half its canvas — it may come out " +
            "small and, with colour regions, off-centre",
          hint: "draw the artwork out to the edges of the canvas",
        });
      }
    }
  }

  return findings;
}
