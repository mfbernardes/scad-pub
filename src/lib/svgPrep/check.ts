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
import { t } from "../i18n";

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
      message: t("svgprep.noViewboxMessage"),
      hint: t("svgprep.noViewboxHint"),
    });
  } else {
    const [minx, miny] = vb;
    if (Math.abs(minx) > 1e-6 || Math.abs(miny) > 1e-6) {
      findings.push({
        level: "WARN",
        code: "viewbox-origin",
        message: t("svgprep.viewboxOriginMessage"),
        hint: t("svgprep.viewboxOriginHint"),
      });
    }
  }

  const els = iterElements(root);
  const shapes = els.filter((el) => SHAPE_TAGS.has(localName(el)));
  if (shapes.length === 0) {
    findings.push({
      level: "ERROR",
      code: "no-geometry",
      message: t("svgprep.noGeometryMessage"),
      hint: t("svgprep.noGeometryHint"),
    });
  }

  const texts = els.filter((el) => TEXT_TAGS.has(localName(el)));
  if (texts.length > 0) {
    findings.push({
      level: "WARN",
      code: "text",
      message: t("svgprep.textMessage", { count: texts.length }),
      hint: t("svgprep.textHint"),
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
      message: t("svgprep.strokeOnlyMessage", { count: strokeOnly.length }),
      hint: t("svgprep.strokeOnlyHint"),
    });
  }
  if (openPaths > 0) {
    findings.push({
      level: "WARN",
      code: "open-paths",
      message: t("svgprep.openPathsMessage", { count: openPaths }),
      hint: t("svgprep.openPathsHint"),
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
      message: t("svgprep.coversCanvasMessage", { count: backgrounds.length }),
      hint: t("svgprep.coversCanvasHint"),
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
      message: t("svgprep.ignoredMessage", { count: ignored.get(name) ?? 0, tag: name }),
      hint: t("svgprep.ignoredHint"),
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
        message: t("svgprep.styledFillMessage", { count: styled.length }),
        hint: t("svgprep.styledFillHint"),
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
      message: t("svgprep.inkscapeTrapMessage", { names }),
      hint: t("svgprep.inkscapeTrapHint"),
    });
  }

  const regionIds = [...byId.keys()].sort();
  if (regionIds.length > 0) {
    findings.push({
      level: "INFO",
      code: "regions-available",
      message: t("svgprep.regionsAvailableMessage", { regions: regionIds.join(", ") }),
    });
  }

  // The requested region names must resolve to a <g id=...>.
  for (const name of layers) {
    if (byId.has(name)) continue;
    if (byLabel.has(name)) {
      findings.push({
        level: "ERROR",
        code: "region-is-label",
        message: t("svgprep.regionIsLabelMessage", { name }),
        hint: t("svgprep.regionIsLabelHint"),
      });
    } else {
      const avail = regionIds.join(", ") || t("svgprep.regionMissingNone");
      findings.push({
        level: "ERROR",
        code: "region-missing",
        message: t("svgprep.regionMissingMessage", { name, available: avail }),
        hint: t("svgprep.regionMissingHint", { name }),
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
        message: t("svgprep.contentOutsideMessage"),
        hint: t("svgprep.contentOutsideHint"),
      });
    } else if (w > 0 && h > 0) {
      const fillFrac = ((bx1 - bx0) * (by1 - by0)) / (w * h);
      if (fillFrac < 0.5) {
        findings.push({
          level: "INFO",
          code: "undersized",
          message: t("svgprep.undersizedMessage"),
          hint: t("svgprep.undersizedHint"),
        });
      }
    }
  }

  return findings;
}
