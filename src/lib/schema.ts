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
  }
  if (s.id !== undefined && typeof s.id !== "string") fail("'id' must be a string");
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
  if (s.help != null) {
    const h = s.help as Record<string, unknown>;
    const isSection = (x: unknown) =>
      !!x &&
      typeof (x as Record<string, unknown>).title === "string" &&
      typeof (x as Record<string, unknown>).body === "string";
    const isSectionList = (x: unknown) => Array.isArray(x) && x.every(isSection);
    if (typeof h !== "object" || Array.isArray(h))
      fail("'help' must be { intro?, sections?, tabs? } or null");
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
