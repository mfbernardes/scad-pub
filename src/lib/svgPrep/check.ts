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
import { contentBbox, parseViewBox } from "./geometry";
import { groupIndex } from "./regions";
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
      message: "no usable viewBox; OpenSCAD will size the drawing by width/height/DPI",
      hint: 'set a viewBox="0 0 W H" so the drawing scales predictably',
    });
  } else {
    const [minx, miny] = vb;
    if (Math.abs(minx) > 1e-6 || Math.abs(miny) > 1e-6) {
      findings.push({
        level: "WARN",
        code: "viewbox-origin",
        message:
          `viewBox origin is (${g(minx)}, ${g(miny)}), not 0 0 — ` +
          "regions can land off the base (esp. with colour layers)",
        hint: 'use viewBox="0 0 W H" (the Fix step normalises it)',
      });
    }
  }

  const els = iterElements(root);
  const shapes = els.filter((el) => SHAPE_TAGS.has(localName(el)));
  if (shapes.length === 0) {
    findings.push({
      level: "ERROR",
      code: "no-geometry",
      message: "no importable geometry (path/rect/circle/ellipse/line/poly*) found",
      hint: "draw filled shapes; OpenSCAD imports only path and basic shapes",
    });
  }

  const texts = els.filter((el) => TEXT_TAGS.has(localName(el)));
  if (texts.length > 0) {
    findings.push({
      level: "WARN",
      code: "text",
      message: `${texts.length} text element(s) — OpenSCAD drops <text>, so it will vanish`,
      hint:
        "outline text (Inkscape Object to Path / Illustrator Create Outlines), " +
        "or add the label through a separate parameter instead of drawing it",
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
        `${strokeOnly.length} stroke-only shape(s) (fill:none) — ` +
        "OpenSCAD fills every closed shape, so these import as SOLID blocks",
      hint:
        "convert the stroke to a filled shape (Inkscape Stroke to Path / " +
        "Illustrator Outline Stroke) for a thin wall or outline",
    });
  }
  if (openPaths > 0) {
    findings.push({
      level: "WARN",
      code: "open-paths",
      message: `${openPaths} open path subpath(s) (no Z) — may import as a sliver or nothing`,
      hint: "close every path",
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
      message: `${ignored.get(name)} <${name}> element(s) — OpenSCAD ignores these on import`,
      hint: "flatten/expand them to plain shapes if they carry visible geometry",
    });
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
      message: `Inkscape layer name(s) are labels, not ids: ${names}`,
      hint:
        "the region binding matches the SVG id — the Fix step renames each " +
        "id to its label, or use groups with an explicit id",
    });
  }

  const regionIds = [...byId.keys()].sort();
  if (regionIds.length > 0) {
    findings.push({
      level: "INFO",
      code: "regions-available",
      message: `named regions available by id: ${regionIds.join(", ")}`,
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
          `region "${name}" is an Inkscape layer label, not an id — ` +
          "the region binding will not find it",
        hint: "the Fix step renames the layer id to its label",
      });
    } else {
      const avail = regionIds.join(", ") || "(none)";
      findings.push({
        level: "ERROR",
        code: "region-missing",
        message: `no region <g id="${name}"> in the SVG; available: ${avail}`,
        hint:
          "group the shapes for this colour and set the group id to " +
          `"${name}" (Inkscape Object Properties / Illustrator layer name)`,
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
        message: "content extends outside the viewBox — it may be clipped",
        hint: "fit the artwork inside the viewBox",
      });
    } else if (w > 0 && h > 0) {
      const fillFrac = ((bx1 - bx0) * (by1 - by0)) / (w * h);
      if (fillFrac < 0.5) {
        findings.push({
          level: "INFO",
          code: "undersized",
          message:
            "the drawing fills less than half its canvas — it will render " +
            "small and, with colour layers, off-centre (approximate)",
          hint: "draw the content out to the canvas edges",
        });
      }
    }
  }

  return findings;
}

// `%g`-style integer/short formatting for the viewBox-origin message.
function g(n: number): string {
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toPrecision(6)));
}
