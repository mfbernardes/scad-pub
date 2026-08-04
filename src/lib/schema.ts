// schema.ts: runtime validation of the generated designs.json. It's produced
// by scripts/gen-schema.mjs and imported as a typed JSON blob; validating its
// shape on load turns generator/type drift into a clear, immediate error instead
// of a confusing failure deep inside a render.
//
// Deliberately limited to LOAD-BEARING INVARIANTS — the shapes the app indexes
// into and would crash or silently misbehave on. Not full structural
// re-validation of every optional presentation field: designs.json is bundled
// into the same chunk that reads it, so it cannot go stale against the code.
// When adding a field, ask whether the app would MISBEHAVE rather than merely
// look wrong if the generator emitted the wrong thing; if not, add nothing here.
// docs/config-pipeline.md records that decision, the alternative that was
// rejected, and where designs.json mirrors the config's grouping (and where it
// deliberately does not).
import type { Schema, Design, Param } from "../openscad/types";
import { checkHelpShape } from "./helpShape.mjs";

const PARAM_TYPES = ["number", "boolean", "enum", "string"];

// Enum value lists mirrored from scripts/lib/config-spec.mjs's own CONFIG_SPEC
// (the single declarative source for each of these), since designs.json
// carries the resolved value, not the spec node, and this runtime check has
// no other way to know what's valid. Exported so tests/config-spec.test.mjs
// can cross-check each pair against CONFIG_SPEC directly rather than trusting
// two hand-typed lists to stay in sync, see that test for the drift guard.
export const POPUP_MODES = ["always", "once", "dismissible", "picker"];
export const TEXT_DIRECTIONS = ["ltr", "rtl", "auto"];
export const FORMATS = ["3mf", "stl"];
export const PANEL_SIDES = ["left", "right"];
export const PANEL_DEFAULTS = ["open", "collapsed"];
export const OUTPUT_DEFAULTS = ["closed", "open"];
export const VIEWER_STYLES = ["plain", "studio"];
export const VIEWER_GRID_DEFAULTS = ["off", "on"];
export const INSTALL_MODES = ["auto", "off"];

function fail(msg: string): never {
  throw new Error(`Invalid designs schema: ${msg}`);
}

/** Shared shape check for a field that must be a plain object mapping string
 *  keys to string values (presetImages, reviewLabels, strings). The three call
 *  sites differ only in wording and in whether an empty value is allowed, so
 *  the messages are supplied by the caller verbatim. */
function checkStringMap(
  value: unknown,
  objectMsg: string,
  entryMsg: (key: string) => string,
  nonEmpty: boolean
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(objectMsg);
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "string" || (nonEmpty && !entry)) fail(entryMsg(key));
  }
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
  if (param.advanced !== undefined && typeof param.advanced !== "boolean")
    fail(`${at} has a non-boolean advanced annotation`);
  // `@editOnModel` is a string-only marker gen-schema only ever emits as `true`
  // (and only on a plain, non-font string param). Reject any other shape so a
  // hand-edited or drifted schema fails loudly rather than half-enabling the
  // on-model editor.
  if (param.editOnModel !== undefined) {
    if (param.editOnModel !== true) fail(`${at} 'editOnModel' must be true`);
    if (param.type !== "string") fail(`${at} has 'editOnModel' on a non-string param`);
  }
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
  if (design.image != null && typeof design.image !== "string")
    fail(`design '${id}' 'image' must be a string URL`);
  if (design.doc != null && typeof design.doc !== "string")
    fail(`design '${id}' 'doc' must be a string URL`);
  if (design.presetImages != null)
    checkStringMap(
      design.presetImages,
      `design '${id}' 'presetImages' must be an object`,
      (name) => `design '${id}' 'presetImages["${name}"]' must be a non-empty string URL`,
      true
    );
  if (
    design.collapsedSections !== undefined &&
    (!Array.isArray(design.collapsedSections) ||
      !design.collapsedSections.every((s) => typeof s === "string"))
  )
    fail(`design '${id}' 'collapsedSections' must be an array of strings`);
  if (design.reviewLabels != null)
    checkStringMap(
      design.reviewLabels,
      `design '${id}' 'reviewLabels' must be an object`,
      (name) => `design '${id}' 'reviewLabels["${name}"]' must be a non-empty string`,
      true
    );
  if (design.reviewNote != null && typeof design.reviewNote !== "string")
    fail(`design '${id}' 'reviewNote' must be a string`);
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
    if (fi.note !== undefined && typeof fi.note !== "string")
      fail("'fileImport.note' must be a string");
  }
  if (s.popup != null) {
    if (typeof s.popup !== "object" || Array.isArray(s.popup))
      fail("'popup' must be an object or null");
    const p = s.popup as Record<string, unknown>;
    for (const key of ["header", "body"] as const) {
      if (typeof p[key] !== "string" || !p[key])
        fail(`'popup.${key}' must be a non-empty string`);
    }
    if (!POPUP_MODES.includes(p.mode as string))
      fail("'popup.mode' must be \"always\", \"once\", \"dismissible\" or \"picker\"");
    if (p.button !== undefined && (typeof p.button !== "string" || !p.button))
      fail("'popup.button', when set, must be a non-empty string");
    if (p.footnote !== undefined && (typeof p.footnote !== "string" || !p.footnote))
      fail("'popup.footnote', when set, must be a non-empty string");
  }
  if (s.notices !== undefined) {
    if (!Array.isArray(s.notices)) fail("'notices' must be an array");
    for (const n of s.notices) {
      if (!n || typeof n !== "object") fail("'notices' contains a non-object");
      const e = n as Record<string, unknown>;
      if (typeof e.marker !== "string" || !e.marker)
        fail("a notice category is missing required string 'marker'");
      if (!e.label || typeof e.label !== "object" || Array.isArray(e.label))
        fail("a notice category is missing required object 'label' ({ one, other })");
      const label = e.label as Record<string, unknown>;
      for (const key of ["one", "other"] as const)
        if (typeof label[key] !== "string" || !label[key])
          fail(`a notice 'label.${key}' must be a non-empty string`);
      if (e.color !== undefined && typeof e.color !== "string")
        fail("a notice 'color' must be a string");
      if (e.attention !== undefined && typeof e.attention !== "boolean")
        fail("a notice 'attention' must be a boolean");
      if (e.subsumedByFont !== undefined && typeof e.subsumedByFont !== "boolean")
        fail("a notice 'subsumedByFont' must be a boolean");
    }
  }
  if (s.scadpubVersion !== undefined && typeof s.scadpubVersion !== "string")
    fail("'scadpubVersion' must be a string");
  if (s.componentVersions !== undefined) {
    const cv = s.componentVersions;
    if (
      !cv ||
      typeof cv !== "object" ||
      Array.isArray(cv) ||
      !Object.values(cv as Record<string, unknown>).every((v) => typeof v === "string")
    )
      fail("'componentVersions' must be an object of package: version strings");
  }
  if (s.id !== undefined && typeof s.id !== "string") fail("'id' must be a string");
  if (s.lang !== undefined && typeof s.lang !== "string") fail("'lang' must be a string");
  if (s.languages !== undefined) {
    if (!Array.isArray(s.languages) || s.languages.length === 0)
      fail("'languages' must be a non-empty array of strings");
    for (const tag of s.languages)
      if (typeof tag !== "string" || !tag) fail("'languages' entries must be non-empty strings");
  }
  if (s.strings !== undefined) {
    if (typeof s.strings !== "object" || s.strings === null || Array.isArray(s.strings))
      fail("'strings' must be an object of key: string, or key: (locale: string) pairs");
    for (const [key, value] of Object.entries(s.strings as Record<string, unknown>)) {
      if (typeof value === "string") continue;
      checkStringMap(
        value,
        `'strings.${key}' must be a string, or an object of locale: string pairs`,
        (tag) => `'strings.${key}.${tag}' must be a string`,
        false
      );
    }
  }
  if (s.dir !== undefined && !TEXT_DIRECTIONS.includes(s.dir as string))
    fail("'dir' must be \"ltr\", \"rtl\" or \"auto\"");
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
  if (!FORMATS.includes(s.format as string))
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
  if (s.themeColor !== undefined && typeof s.themeColor !== "string")
    fail("'themeColor' must be a string");
  if (s.themeColorLight !== undefined && typeof s.themeColorLight !== "string")
    fail("'themeColorLight' must be a string");
  if (s.ui != null) {
    if (typeof s.ui !== "object" || Array.isArray(s.ui)) fail("'ui' must be an object or null");
    const ui = s.ui as Record<string, unknown>;
    if (ui.panelSide !== undefined && !PANEL_SIDES.includes(ui.panelSide as string))
      fail("'ui.panelSide' must be \"left\" or \"right\"");
    if (ui.panelDefault !== undefined && !PANEL_DEFAULTS.includes(ui.panelDefault as string))
      fail("'ui.panelDefault' must be \"open\" or \"collapsed\"");
    if (ui.outputDefault !== undefined && !OUTPUT_DEFAULTS.includes(ui.outputDefault as string))
      fail("'ui.outputDefault' must be \"closed\" or \"open\"");
    if (ui.install !== undefined && !INSTALL_MODES.includes(ui.install as string))
      fail("'ui.install' must be \"auto\" or \"off\"");
    if (ui.showVarName !== undefined && typeof ui.showVarName !== "boolean")
      fail("'ui.showVarName' must be a boolean");
    if (ui.saveImage !== undefined && typeof ui.saveImage !== "boolean")
      fail("'ui.saveImage' must be a boolean");
    for (const key of ["gallery", "essentials"] as const)
      if (ui[key] !== undefined && typeof ui[key] !== "boolean")
        fail(`'ui.${key}' must be a boolean`);
    if (ui.afterExport != null) {
      if (typeof ui.afterExport !== "object" || Array.isArray(ui.afterExport))
        fail("'ui.afterExport' must be an object");
      const ae = ui.afterExport as Record<string, unknown>;
      if (ae.helpTab !== undefined && typeof ae.helpTab !== "string")
        fail("'ui.afterExport.helpTab' must be a string");
    }
  }
  // The 3D viewer's presentation, framing, and per-control visibility. Unlike
  // `ui` above this is required (see the Schema/ViewerConfig types): every
  // config produces one, since parseViewer always returns an object.
  if (typeof s.viewer !== "object" || s.viewer === null || Array.isArray(s.viewer))
    fail("'viewer' must be an object");
  {
    const v = s.viewer as Record<string, unknown>;
    if (!VIEWER_STYLES.includes(v.style as string))
      fail("'viewer.style' must be \"plain\" or \"studio\"");
    if (v.restOnGrid !== undefined && typeof v.restOnGrid !== "boolean")
      fail("'viewer.restOnGrid' must be a boolean");
    if (v.grid !== undefined && !VIEWER_GRID_DEFAULTS.includes(v.grid as string))
      fail("'viewer.grid' must be \"off\" or \"on\"");
    if (v.controls != null) {
      if (typeof v.controls !== "object" || Array.isArray(v.controls))
        fail("'viewer.controls' must be an object");
      const c = v.controls as Record<string, unknown>;
      for (const key of ["measure", "viewPicker", "reset", "zoom", "fullscreen"] as const)
        if (c[key] !== undefined && typeof c[key] !== "boolean")
          fail(`'viewer.controls.${key}' must be a boolean`);
    }
  }
  if (s.help != null) {
    // The contract lives in ./helpShape.mjs, shared with gen-schema: it used to
    // be stated here alone, so a `help` block that was merely object-shaped
    // built green and then failed HERE — during app-module initialisation, so
    // the whole app failed to boot rather than one modal misbehaving.
    checkHelpShape(s.help, fail);
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
