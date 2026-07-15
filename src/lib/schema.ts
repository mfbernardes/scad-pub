// schema.ts — runtime validation of the generated designs.json. It's produced
// by scripts/gen-schema.mjs and imported as a typed JSON blob; validating its
// shape on load turns generator/type drift into a clear, immediate error instead
// of a confusing failure deep inside a render.
import type { Schema, Design, Param } from "../openscad/types";

const PARAM_TYPES = ["number", "boolean", "enum", "string"];

function fail(msg: string): never {
  throw new Error(`Invalid designs schema: ${msg}`);
}

function checkParam(p: unknown, designId: string): void {
  const where = `design '${designId}'`;
  if (!p || typeof p !== "object") fail(`${where} has a non-object param`);
  const param = p as Record<string, unknown>;
  if (typeof param.name !== "string") fail(`${where} has a param without a name`);
  const at = `${where} param '${String(param.name)}'`;
  if (typeof param.section !== "string") fail(`${at} has no section`);
  if (typeof param.type !== "string" || !PARAM_TYPES.includes(param.type))
    fail(`${at} has invalid type '${String(param.type)}'`);
  if (param.type === "enum" && !Array.isArray(param.choices))
    fail(`${at} is an enum without choices`);
  if (param.default === undefined) fail(`${at} has no default`);
  if (param.info !== undefined && (typeof param.info !== "object" || param.info === null))
    fail(`${at} has a non-object info annotation`);
}

function checkDesign(d: unknown): void {
  if (!d || typeof d !== "object") fail("designs[] contains a non-object");
  const design = d as Record<string, unknown>;
  if (typeof design.id !== "string") fail("a design has no id");
  const id = design.id;
  if (typeof design.file !== "string") fail(`design '${id}' has no file`);
  if (typeof design.label !== "string") fail(`design '${id}' has no label`);
  for (const key of ["sections", "params", "presets"] as const) {
    if (!Array.isArray(design[key])) fail(`design '${id}' '${key}' must be an array`);
  }
  if (design.heavy !== undefined && typeof design.heavy !== "boolean")
    fail(`design '${id}' 'heavy' must be a boolean`);
  if (design.description != null && typeof design.description !== "string")
    fail(`design '${id}' 'description' must be a string`);
  if (design.icon != null && typeof design.icon !== "string")
    fail(`design '${id}' 'icon' must be a string URL`);
  if (design.doc != null && typeof design.doc !== "string")
    fail(`design '${id}' 'doc' must be a string URL`);
  if (
    design.collapsedSections !== undefined &&
    (!Array.isArray(design.collapsedSections) ||
      !design.collapsedSections.every((s) => typeof s === "string"))
  )
    fail(`design '${id}' 'collapsedSections' must be an array of strings`);
  for (const p of design.params as unknown[]) checkParam(p, id);
}

/** Validate the raw imported schema and return it typed; throws on drift. */
export function validateSchema(raw: unknown): Schema {
  if (!raw || typeof raw !== "object") fail("not an object");
  const s = raw as Record<string, unknown>;
  for (const key of ["features", "fonts", "assets"] as const) {
    if (!Array.isArray(s[key])) fail(`'${key}' must be an array`);
  }
  if (
    s.fontFamilies !== undefined &&
    (!Array.isArray(s.fontFamilies) || !s.fontFamilies.every((f) => typeof f === "string"))
  )
    fail("'fontFamilies' must be an array of strings");
  if (
    s.fontFaces !== undefined &&
    (!Array.isArray(s.fontFaces) ||
      !s.fontFaces.every(
        (f) =>
          !!f &&
          typeof (f as Record<string, unknown>).family === "string" &&
          typeof (f as Record<string, unknown>).style === "string"
      ))
  )
    fail("'fontFaces' must be an array of { family, style } strings");
  if (!Array.isArray(s.designs) || s.designs.length === 0)
    fail("'designs' must be a non-empty array");
  for (const d of s.designs) checkDesign(d);
  if (typeof s.title !== "string") fail("'title' must be a string");
  if (s.logo != null) {
    const lg = s.logo as Record<string, unknown>;
    if (typeof lg !== "object" || typeof lg.light !== "string" || typeof lg.dark !== "string")
      fail("'logo' must be { light, dark } URLs or null");
  }
  if (s.fileImport != null) {
    if (typeof s.fileImport !== "object" || Array.isArray(s.fileImport))
      fail("'fileImport' must be an object or null");
    const fi = s.fileImport as Record<string, unknown>;
    for (const key of ["accept", "label", "note"] as const) {
      if (fi[key] !== undefined && typeof fi[key] !== "string")
        fail(`'fileImport.${key}' must be a string`);
    }
    if (fi.maxBytes !== undefined && typeof fi.maxBytes !== "number")
      fail("'fileImport.maxBytes' must be a number");
  }
  if (s.popup != null) {
    if (typeof s.popup !== "object" || Array.isArray(s.popup))
      fail("'popup' must be an object or null");
    const p = s.popup as Record<string, unknown>;
    for (const key of ["header", "body"] as const) {
      if (typeof p[key] !== "string" || !p[key])
        fail(`'popup.${key}' must be a non-empty string`);
    }
    if (!["always", "once", "dismissible"].includes(p.mode as string))
      fail("'popup.mode' must be \"always\", \"once\" or \"dismissible\"");
    if (p.button !== undefined && (typeof p.button !== "string" || !p.button))
      fail("'popup.button', when set, must be a non-empty string");
  }
  if (s.notices !== undefined) {
    if (!Array.isArray(s.notices)) fail("'notices' must be an array");
    for (const n of s.notices) {
      if (!n || typeof n !== "object") fail("'notices' contains a non-object");
      const e = n as Record<string, unknown>;
      if (typeof e.marker !== "string" || !e.marker)
        fail("a notice category is missing required string 'marker'");
      if (typeof e.label !== "string" || !e.label)
        fail("a notice category is missing required string 'label'");
      if (e.color !== undefined && typeof e.color !== "string")
        fail("a notice 'color' must be a string");
    }
  }
  if (s.id !== undefined && typeof s.id !== "string") fail("'id' must be a string");
  if (s.lang !== undefined && typeof s.lang !== "string") fail("'lang' must be a string");
  if (s.dir !== undefined && !["ltr", "rtl", "auto"].includes(s.dir as string))
    fail("'dir' must be \"ltr\", \"rtl\" or \"auto\"");
  if (
    s.strings !== undefined &&
    (typeof s.strings !== "object" ||
      s.strings === null ||
      Array.isArray(s.strings) ||
      !Object.values(s.strings as Record<string, unknown>).every((v) => typeof v === "string"))
  )
    fail("'strings' must be an object of key: string pairs");
  if (s.defaultDesign != null) {
    if (typeof s.defaultDesign !== "string") fail("'defaultDesign' must be a string");
    if (!(s.designs as { id: string }[]).some((d) => d.id === s.defaultDesign))
      fail(`'defaultDesign' '${s.defaultDesign}' is not a configured design id`);
  }
  if (s.render != null) {
    if (typeof s.render !== "object" || Array.isArray(s.render))
      fail("'render' must be an object or null");
    const r = s.render as Record<string, unknown>;
    if (r.heavyMs !== undefined && typeof r.heavyMs !== "number")
      fail("'render.heavyMs' must be a number");
    if (r.cache !== undefined) {
      if (typeof r.cache !== "object" || Array.isArray(r.cache))
        fail("'render.cache' must be an object");
      const c = r.cache as Record<string, unknown>;
      for (const key of ["maxEntries", "maxBytes", "maxEntryBytes"] as const)
        if (c[key] !== undefined && typeof c[key] !== "number")
          fail(`'render.cache.${key}' must be a number`);
      if (c.persistent !== undefined && typeof c.persistent !== "boolean")
        fail("'render.cache.persistent' must be a boolean");
    }
  }
  if (s.format !== "3mf" && s.format !== "stl")
    fail("'format' must be \"3mf\" or \"stl\"");
  if (s.colors != null) {
    const c = s.colors as Record<string, unknown>;
    if (typeof c !== "object" || Array.isArray(c)) fail("'colors' must be an object or null");
    for (const theme of ["light", "dark"] as const) {
      const t = c[theme];
      if (t == null) continue;
      if (
        typeof t !== "object" ||
        Array.isArray(t) ||
        !Object.values(t as Record<string, unknown>).every((v) => typeof v === "string")
      )
        fail(`'colors.${theme}' must be an object of token: colour strings`);
    }
  }
  if (s.extraCss != null && typeof s.extraCss !== "string")
    fail("'extraCss' must be a string URL or null");
  if (s.ui != null) {
    if (typeof s.ui !== "object" || Array.isArray(s.ui)) fail("'ui' must be an object or null");
    const ui = s.ui as Record<string, unknown>;
    if (ui.panelSide !== undefined && !["left", "right"].includes(ui.panelSide as string))
      fail("'ui.panelSide' must be \"left\" or \"right\"");
    if (ui.panelDefault !== undefined && !["open", "collapsed"].includes(ui.panelDefault as string))
      fail("'ui.panelDefault' must be \"open\" or \"collapsed\"");
    if (ui.outputDefault !== undefined && !["closed", "open"].includes(ui.outputDefault as string))
      fail("'ui.outputDefault' must be \"closed\" or \"open\"");
    if (ui.install !== undefined && !["auto", "off"].includes(ui.install as string))
      fail("'ui.install' must be \"auto\" or \"off\"");
    if (ui.showVarName !== undefined && typeof ui.showVarName !== "boolean")
      fail("'ui.showVarName' must be a boolean");
    if (ui.measure !== undefined && typeof ui.measure !== "boolean")
      fail("'ui.measure' must be a boolean");
    if (ui.viewPicker !== undefined && typeof ui.viewPicker !== "boolean")
      fail("'ui.viewPicker' must be a boolean");
    if (ui.reset !== undefined && typeof ui.reset !== "boolean")
      fail("'ui.reset' must be a boolean");
    if (ui.zoom !== undefined && typeof ui.zoom !== "boolean")
      fail("'ui.zoom' must be a boolean");
    if (ui.fullscreen !== undefined && typeof ui.fullscreen !== "boolean")
      fail("'ui.fullscreen' must be a boolean");
    for (const key of ["presetsLabel", "parametersLabel"] as const)
      if (ui[key] !== undefined && typeof ui[key] !== "string")
        fail(`'ui.${key}' must be a string`);
  }
  if (s.help != null) {
    const h = s.help as Record<string, unknown>;
    const isSection = (x: unknown) =>
      !!x &&
      typeof (x as Record<string, unknown>).title === "string" &&
      typeof (x as Record<string, unknown>).body === "string";
    const isSectionList = (x: unknown) => Array.isArray(x) && x.every(isSection);
    if (typeof h !== "object" || Array.isArray(h))
      fail("'help' must be { title?, intro?, sections?, tabs? } or null");
    if (h.title !== undefined && typeof h.title !== "string")
      fail("'help.title' must be a string");
    if (h.sections !== undefined && !isSectionList(h.sections))
      fail("'help.sections' must be an array of { title, body }");
    if (h.tabs !== undefined) {
      if (
        !Array.isArray(h.tabs) ||
        !h.tabs.every(
          (t) =>
            !!t &&
            typeof (t as Record<string, unknown>).label === "string" &&
            isSectionList((t as Record<string, unknown>).sections)
        )
      )
        fail(
          "'help.tabs' must be an array of { label, intro?, sections: [{ title, body }] }"
        );
    }
    if (h.sections === undefined && h.tabs === undefined)
      fail("'help' must provide 'sections' or 'tabs'");
  }
  if (s.licenses != null) {
    if (!Array.isArray(s.licenses)) fail("'licenses' must be an array or null");
    for (const l of s.licenses) {
      if (!l || typeof l !== "object") fail("'licenses' contains a non-object");
      const e = l as Record<string, unknown>;
      for (const key of ["name", "license", "copyright", "url", "licenseUrl"] as const) {
        if (typeof e[key] !== "string")
          fail(`a license entry is missing required string '${key}'`);
      }
    }
  }
  return raw as Schema;
}

export type { Schema, Design, Param };
