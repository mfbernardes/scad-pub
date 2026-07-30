// Unit tests for the schema generator (scripts/gen-schema.mjs). Drives generate()
// against the fixtures in tests/fixtures/ into a temp output dir, so the real
// src/generated and public/scad trees are untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  symlinkSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generate,
  KNOWN_TOP_LEVEL_KEYS,
  firstSentence,
  parseEnumHint,
  parseAfterExport,
  parseColors,
  parseLicenses,
  parseFileImport,
  parsePopup,
  parseFormat,
  parseViewer,
  parseNotices,
  parseUi,
  parseParams,
  parseFontFallback,
  parseLang,
  parseDir,
  parsePwa,
  parsePwaThemeColor,
  parseRender,
  parseStringArray,
  parseStrings,
  renderFontsConf,
  resolveHelp,
  resolveFileField,
  isRiskyExternalFontCopy,
} from "../scripts/gen-schema.mjs";
import { sanitizeSvg } from "../scripts/lib/svg-sanitize.mjs";
import { componentVersions } from "../scripts/lib/dep-versions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");

function run(configName) {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  const schema = generate({
    configPath: join(FIXTURES, configName),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "scad"),
  });
  return { schema, out };
}

const param = (schema, name) =>
  schema.designs[0].params.find((p) => p.name === name);

test("parses params, types and hints from a design", () => {
  const { schema } = run("widget.config.json");
  assert.equal(schema.designs.length, 1);
  const d = schema.designs[0];
  assert.equal(d.id, "widget");
  assert.equal(d.file, "widget.scad");
  assert.deepEqual(d.sections, ["Main"]); // [Hidden] excluded

  // string
  assert.deepEqual(param(schema, "label").type, "string");
  // number range "1:0.5:6"
  assert.deepEqual(
    { ...param(schema, "thickness") },
    {
      name: "thickness",
      section: "Main",
      description: "Plate thickness in millimetres.", // first sentence only
      help: "Plate thickness in millimetres. Thicker is sturdier but uses more material.",
      type: "number",
      default: 2,
      min: 1,
      step: 0.5,
      max: 6,
    }
  );
  // boolean
  assert.equal(param(schema, "hole").type, "boolean");
  assert.equal(param(schema, "hole").default, false);
  // a [Hidden] param must not leak
  assert.equal(param(schema, "secret"), undefined);
});

test("captures camelCase, PascalCase and leading-underscore param names", () => {
  // OpenSCAD identifiers aren't all lowercase; the Customizer accepts any of
  // these, so the schema must expose them rather than silently dropping them.
  const { schema } = run("widget.config.json");
  assert.equal(param(schema, "wallThickness").type, "number");
  assert.equal(param(schema, "wallThickness").min, 0.5);
  assert.equal(param(schema, "FontSize").type, "number");
  assert.equal(param(schema, "FontSize").default, 10);
  assert.equal(param(schema, "_offset").type, "number");
  assert.equal(param(schema, "_offset").default, 0);
});

test("a pathological trailing-whitespace line parses in well under a second", () => {
  // PARAM_RE used to backtrack O(n²) on a line that fails to match (garbage
  // after a long run of whitespace): two adjacent `\s*` quantifiers around an
  // optional hint group. A 50k-char run took ~5s before the fix.
  const dir = mkdtempSync(join(tmpdir(), "gen-schema-perf-"));
  const file = join(dir, "f.scad");
  writeFileSync(
    file,
    `/* [Main] */\n` + `a = b;${" ".repeat(50000)}//x\n`
  );
  const t0 = Date.now();
  parseParams(file);
  const elapsed = Date.now() - t0;
  rmSync(dir, { recursive: true, force: true });
  assert.ok(elapsed < 2000, `parseParams took ${elapsed}ms, expected < 2000ms`);
});

test("// @collapsed marks sections collapsed; others stay open", () => {
  const { schema } = run("collapse.config.json");
  const d = schema.designs[0];
  assert.deepEqual(d.sections, ["Basics", "Shape", "Advanced"]);
  // "Basics" is annotated before the very first header (the section === null edge).
  assert.deepEqual(d.collapsedSections, ["Basics", "Advanced"]);
  // collapsible.scad has no sibling .json, so no presets are auto-detected.
  assert.deepEqual(d.presets, []);
});

test("collapsedSections is empty when nothing is annotated", () => {
  const { schema } = run("widget-autodeps.config.json");
  assert.deepEqual(schema.designs[0].collapsedSections, []);
});

test("a section-shaped comment after a param on the same line doesn't create a section", () => {
  const dir = mkdtempSync(join(tmpdir(), "gen-schema-section-"));
  const file = join(dir, "f.scad");
  writeFileSync(
    file,
    `/* [Main] */\n` +
      // The default string embeds a "/* [Legacy] */"-shaped substring. Only a
      // line consisting SOLELY of a section comment should be treated as one.
      `shape = "square /* [Legacy] */"; // [square, circle]\n`
  );
  const { params, sections } = parseParams(file);
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(sections, ["Main"]);
  const shape = params.find((p) => p.name === "shape");
  assert.ok(shape, "param must not vanish");
  assert.equal(shape.type, "enum");
  assert.equal(shape.default, "square /* [Legacy] */");
});

test("@showIf is parsed out of the doc block, not into the label", () => {
  const { schema } = run("widget.config.json");
  const hole_d = param(schema, "hole_d");
  assert.equal(hole_d.showIf, "hole");
  // the directive must not leak into the label or help text
  assert.equal(hole_d.description, "Hole diameter in millimetres.");
  assert.ok(!/showIf/.test(hole_d.help));
  // params without the directive have no showIf
  assert.equal(param(schema, "label").showIf, undefined);
});

test("number hint forms: min:step:max, min:max, max-only; empty segments are rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "gen-schema-numhint-"));
  const file = join(dir, "f.scad");
  writeFileSync(
    file,
    `/* [Main] */\n` +
      `a = 3; // [1:0.5:6]\n` +
      `b = 3; // [1:6]\n` +
      // OpenSCAD's single-value shorthand: a 0..max slider, no step.
      `c = 3; // [10]\n` +
      // Empty step segment: NOT the same as an explicit step of 0.
      `d = 3; // [1::10]\n` +
      // Empty min segment: NOT the same as an explicit min of 0.
      `e = 3; // [:10]\n`
  );
  const { params } = parseParams(file);
  rmSync(dir, { recursive: true, force: true });
  const byName = Object.fromEntries(params.map((p) => [p.name, p]));
  assert.deepEqual(
    { min: byName.a.min, step: byName.a.step, max: byName.a.max },
    { min: 1, step: 0.5, max: 6 }
  );
  assert.deepEqual({ min: byName.b.min, max: byName.b.max }, { min: 1, max: 6 });
  assert.equal(byName.b.step, undefined);
  assert.deepEqual({ min: byName.c.min, max: byName.c.max }, { min: 0, max: 10 });
  // Invalid (empty-segment) hints fall back to a plain number input: no
  // min/max/step, just the default.
  assert.equal(byName.d.min, undefined);
  assert.equal(byName.d.max, undefined);
  assert.equal(byName.d.type, "number");
  assert.equal(byName.e.min, undefined);
  assert.equal(byName.e.max, undefined);
  assert.equal(byName.e.type, "number");
});

test("enum hint forms: bare, labelled, quoted", () => {
  const { schema } = run("widget.config.json");
  // bare list -> dropdown, label = value
  assert.deepEqual(param(schema, "arrow").choices, [
    { value: "up", label: "up" },
    { value: "down", label: "down" },
    { value: "left", label: "left" },
    { value: "right", label: "right" },
  ]);
  // "val:Label"
  assert.deepEqual(param(schema, "style").choices, [
    { value: "flat", label: "Flat" },
    { value: "raised", label: "Raised" },
  ]);
  // quoted strings
  assert.deepEqual(param(schema, "font").choices, [
    { value: "Sans", label: "Sans" },
    { value: "Mono", label: "Mono" },
  ]);
});

test("a string logo is used for both themes (copied to the served tree)", () => {
  const { schema, out } = run("widget.config.json");
  assert.equal(schema.title, "Widget Studio");
  assert.deepEqual(schema.logo, { light: "scad/logo.svg", dark: "scad/logo.svg" });
  assert.ok(existsSync(join(out, "scad", "logo.svg")));
});

test("a per-theme logo with one side omitted falls back to the other", () => {
  const { schema } = run("widget-logo-fallback.config.json");
  assert.deepEqual(schema.logo, { light: "scad/logo.svg", dark: "scad/logo.svg" });
});

test("title defaults when omitted; no logo or fileImport by default", () => {
  const { schema } = run("widget-autodeps.config.json");
  assert.equal(typeof schema.title, "string");
  assert.equal(schema.logo, null);
  assert.equal(schema.fileImport, null);
});

test("config-driven features, fonts; presets auto-detected by sibling name", () => {
  const { schema, out } = run("widget.config.json");
  assert.deepEqual(schema.features, ["textmetrics"]);
  assert.deepEqual(schema.fonts, ["Foo.ttf"]);
  // The fixture enables the generic file-import button with defaults.
  assert.deepEqual(schema.fileImport, {});
  // src/widget.json sits next to src/widget.scad, so it's bundled automatically.
  assert.deepEqual(schema.designs[0].presets, ["widget.json"]);
  assert.equal(schema.designs[0].heavy, true); // per-design heavy flag passes through
  assert.equal(schema.designs[0].group, "Gadgets"); // dropdown group passes through
  // preset + design files copied into the output scad tree
  assert.ok(existsSync(join(out, "scad", "widget.scad")));
  assert.ok(existsSync(join(out, "scad", "widget.json")));
});

test("unknown top-level config key fails the build", () => {
  // A whole-key typo ("popups") is rejected rather than silently ignored.
  assert.throws(() => run("widget-unknown-key.config.json"), /unknown config key 'popups'/);
});

test("the shipped example config uses only known top-level keys", () => {
  // Guards the KNOWN_TOP_LEVEL_KEYS <-> readers drift hazard: if a future key is
  // read (e.g. in pwa-assets.mjs) and used in scadpub.config.json but never added
  // to the set, this trips here instead of failing a downstream user's build.
  const config = JSON.parse(
    readFileSync(join(HERE, "..", "scadpub.config.json"), "utf-8")
  );
  for (const key of Object.keys(config))
    assert.ok(
      KNOWN_TOP_LEVEL_KEYS.has(key),
      `scadpub.config.json key '${key}' is missing from KNOWN_TOP_LEVEL_KEYS`
    );
});

test("lang/dir default to en/ltr and pass through to the schema", () => {
  const { schema: def } = run("widget-autodeps.config.json");
  assert.equal(def.lang, "en");
  assert.equal(def.dir, "ltr");
  const { schema } = run("widget-designmeta.config.json");
  assert.equal(schema.lang, "pt-BR");
  assert.equal(schema.dir, "rtl");
});

test("render tuning and defaultDesign pass through to the schema", () => {
  const { schema } = run("widget-designmeta.config.json");
  assert.deepEqual(schema.render, { heavyMs: 9000, cache: { maxEntries: 4, persistent: false } });
  assert.equal(schema.defaultDesign, "collapsible");
  assert.deepEqual(schema.fileImport, { note: "Upload a font or an SVG." });
  assert.equal(schema.viewer.controls.fullscreen, false);
  assert.equal(schema.ui.saveImage, false);
});

test("defaultDesign must name a configured design", () => {
  assert.throws(() => run("widget-bad-default.config.json"), /'defaultDesign' .* is not one of the configured design ids/);
});

test("duplicate design ids fail the build", () => {
  assert.throws(() => run("widget-dup-id.config.json"), /duplicate design id "widget"/);
});

test("a designs[] entry with an unrecognised key fails the build, naming the design and the valid keys", () => {
  assert.throws(
    () => run("widget-designs-unknownkey.config.json"),
    /'designs\[widget\]': unknown key 'shadow'\.\s*\n\s*Valid keys: id, label, file, heavy, group, presets/
  );
});

test("a designs[] entry's stale flat 'icon' fails the build instead of being silently dropped", () => {
  assert.throws(
    () => run("widget-designs-stale-icon.config.json"),
    /'designs\[widget\]': unknown key 'icon'\.\s*\n\s*Valid keys: id, label, file, heavy, group, presets/
  );
});

test("a designs[] entry's removed 'description'/'media'/'review' keys fail the build like any other unrecognised key", () => {
  // Design metadata (description/icon/image/doc/review labels/note) comes only
  // from the design's own .scad annotations now — these config-level fields
  // were removed entirely, not just deprecated, so they fail the ordinary
  // unknown-key check like any stale key.
  assert.throws(
    () => run("widget-designs-stale-description.config.json"),
    /'designs\[widget\]': unknown key 'description'\.\s*\n\s*Valid keys: id, label, file, heavy, group, presets/
  );
  assert.throws(
    () => run("widget-designs-stale-media.config.json"),
    /'designs\[widget\]': unknown key 'media'\.\s*\n\s*Valid keys: id, label, file, heavy, group, presets/
  );
  assert.throws(
    () => run("widget-designs-stale-review.config.json"),
    /'designs\[widget\]': unknown key 'review'\.\s*\n\s*Valid keys: id, label, file, heavy, group, presets/
  );
});

test("a design with no @review/@reviewNote annotations omits/nulls reviewLabels/reviewNote", () => {
  const { schema } = run("widget.config.json");
  assert.equal(schema.designs[0].reviewLabels, undefined);
  assert.equal(schema.designs[0].reviewNote ?? null, null);
});

test("reviewLabels/reviewNote: a design's own @review/@reviewNote annotations are the sole source", () => {
  const { schema } = run("widget-review-annot.config.json");
  const widget = schema.designs.find((d) => d.id === "widget");
  assert.deepEqual(widget.reviewLabels, { label: "Text", thickness: "Thickness" });
  assert.equal(widget.reviewNote, "Prints exactly as typed.");
  // The transient annotation flag never reaches a param's own object — it's
  // folded into reviewLabels above and stripped (src/openscad/types.ts's
  // ParamBase carries no such field).
  for (const p of widget.params) assert.equal(p.reviewLabel, undefined);
});

test("presetImages: a key matching a bundled preset name is resolved and copied", () => {
  const { schema, out } = run("widget-presetimages.config.json");
  const widget = schema.designs.find((d) => d.id === "widget");
  assert.deepEqual(widget.presetImages, { Tall: "scad/widget-preset-0.png" });
  assert.ok(existsSync(join(out, "scad", "widget-preset-0.png")));
});

test("a design with no configured presetImages omits the field", () => {
  const { schema } = run("widget.config.json");
  assert.equal(schema.designs[0].presetImages, undefined);
});

test("presetImages: a key not matching any bundled preset name fails the build", () => {
  assert.throws(
    () => run("widget-presetimages-badname.config.json"),
    /'presets\.images\["Nope"\]' does not match any bundled preset name/
  );
});

test("presets.images directory form: each preset's image is found by slug, trying .svg/.png/.webp in turn", (t) => {
  let logged = "";
  t.mock.method(console, "log", (msg) => {
    logged += msg + "\n";
  });
  const { schema, out } = run("widget-presetimages-dir.config.json");
  const design = schema.designs.find((d) => d.id === "presetdir");
  // "Salz (Deutsch)" has both a .svg and a .png in the directory — .svg wins
  // (the documented extension priority).
  assert.equal(design.presetImages["Salz (Deutsch)"], "scad/presetdir-preset-0.svg");
  assert.ok(existsSync(join(out, "scad", "presetdir-preset-0.svg")));
  assert.equal(design.presetImages["Office (English US)"], "scad/presetdir-preset-1.png");
  // The two punctuation-only names slug identically; only the FIRST one
  // (matching "...english-us.webp", no "-2" suffix) has a file in the
  // directory, so only it gets an image.
  assert.equal(
    design.presetImages["Punctuation | English UEB: - : ; ' (English US)"],
    "scad/presetdir-preset-2.webp"
  );
  assert.equal("Punctuation | English UEB: . , ? ! (English US)" in design.presetImages, false);
  // "No Image Here" has no matching file in the directory at all — legitimate
  // (preset images are optional per preset), not a build failure.
  assert.equal("No Image Here" in design.presetImages, false);
  // 3 of the 5 bundled presets matched an image — reported in the build log
  // so a wrong-but-existing directory (e.g. every name misspelled) is visible.
  assert.match(logged, /presets\.images: 3\/5 preset\(s\) matched an image in 'preset-images-dir'/);
});

test("presets.images directory form: a directory that doesn't exist fails the build", () => {
  assert.throws(
    () => run("widget-presetimages-dir-missing.config.json"),
    /presets\.images directory 'no-such-preset-images-dir' not found/
  );
});

test("presets.images directory form: a path that exists but isn't a directory fails the build", () => {
  assert.throws(
    () => run("widget-presetimages-dir-notadir.config.json"),
    /'presets\.images' 'src\/presetdir\.scad' is not a directory/
  );
});

test("presets.images: a blank string fails the build like the map form's blank values", () => {
  assert.throws(
    () => run("widget-presetimages-dir-blank.config.json"),
    /'presets\.images' must be a non-empty string or object/
  );
});

test("strings: a key that exists in en.json overrides the built-in text", () => {
  const { schema } = run("widget-strings.config.json");
  assert.deepEqual(schema.strings, { "action.export": "Download now" });
});

test("a config with no 'strings' key yields an empty object", () => {
  const { schema } = run("widget.config.json");
  assert.deepEqual(schema.strings, {});
});

test("strings: an unknown key fails the build, pointing at the catalogue", () => {
  assert.throws(
    () => run("widget-strings-badkey.config.json"),
    /unknown 'strings' key 'action.exprot'.*See src\/locales\/en\.json/s
  );
});

test("per-design description + icon come from the design's own annotations", () => {
  const { schema, out } = run("widget-designmeta.config.json");
  const widget = schema.designs.find((d) => d.id === "widget");
  const collapsible = schema.designs.find((d) => d.id === "collapsible");
  // widget's `// @description` / `// @icon` annotations (the icon path is
  // resolved relative to the design file and copied under <id>-icon.<ext>).
  assert.equal(widget.description, "A little widget.");
  assert.equal(widget.icon, "scad/widget-icon.svg");
  assert.ok(existsSync(join(out, "scad", "widget-icon.svg")));
  // collapsible's own `// @description` / `// @icon` annotations.
  assert.equal(collapsible.description, "A collapsible gadget.");
  assert.equal(collapsible.icon, "scad/collapsible-icon.svg");
  assert.ok(existsSync(join(out, "scad", "collapsible-icon.svg")));
});

test("per-design @doc is resolved, copied and served (annotation paths)", () => {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  const schema = generate({
    configPath: join(FIXTURES, "widget-designmeta.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "public", "scad"),
    outPublicDir: join(out, "public"),
  });
  const widget = schema.designs.find((d) => d.id === "widget");
  const collapsible = schema.designs.find((d) => d.id === "collapsible");
  // Both designs' docs come from their own `// @doc` annotation (resolved
  // relative to the design file), copied under <id>-doc.md.
  assert.equal(widget.doc, "scad/widget-doc.md");
  assert.ok(existsSync(join(out, "public", "scad", "widget-doc.md")));
  assert.equal(collapsible.doc, "scad/collapsible-doc.md");
  assert.ok(existsSync(join(out, "public", "scad", "collapsible-doc.md")));
  // Both docs are precached for offline use.
  const precache = JSON.parse(
    readFileSync(join(out, "public", "precache-manifest.json"), "utf-8")
  );
  assert.ok(precache.shell.includes("scad/widget-doc.md"));
  assert.ok(precache.shell.includes("scad/collapsible-doc.md"));
});

test("a design with no @doc annotation has doc null and no button target", () => {
  const { schema } = run("widget.config.json");
  assert.equal(schema.designs[0].doc ?? null, null);
});

test("a missing @doc target fails the build", () => {
  assert.throws(
    () => run("widget-baddoc.config.json"),
    /design 'widget' doc/
  );
});

test("parseParams captures file-level @description / @icon / @doc metadata", () => {
  const { meta } = parseParams(join(FIXTURES, "src", "collapsible.scad"));
  assert.deepEqual(meta, {
    description: "A collapsible gadget.",
    icon: "assets/emblem.svg",
    image: null,
    doc: "collapsible-doc.md",
    reviewNote: null,
  });
  // A design file with no such annotations reports nulls.
  const plain = parseParams(join(FIXTURES, "mini.scad"));
  assert.deepEqual(plain.meta, {
    description: null,
    icon: null,
    image: null,
    doc: null,
    reviewNote: null,
  });
});

test("lang/dir + per-design shortcut icons + screenshot fields reach the manifest", () => {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  generate({
    configPath: join(FIXTURES, "widget-designmeta.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "public", "scad"),
    outPublicDir: join(out, "public"),
  });
  const manifest = JSON.parse(
    readFileSync(join(out, "public", "manifest.webmanifest"), "utf-8")
  );
  assert.equal(manifest.lang, "pt-BR");
  assert.equal(manifest.dir, "rtl");
  // Two designs -> auto-derived shortcuts, each carrying its design's icon —
  // each design's own `// @icon` annotation.
  const widgetShortcut = manifest.shortcuts.find((s) => s.url === "./#d=widget");
  assert.deepEqual(widgetShortcut.icons, [
    { src: "scad/widget-icon.svg", sizes: "any", type: "image/svg+xml" },
  ]);
  const collapsibleShortcut = manifest.shortcuts.find((s) => s.url === "./#d=collapsible");
  assert.deepEqual(collapsibleShortcut.icons, [
    { src: "scad/collapsible-icon.svg", sizes: "any", type: "image/svg+xml" },
  ]);
  // Screenshot label/platform are passed through.
  assert.equal(manifest.screenshots[0].label, "Home screen");
  assert.equal(manifest.screenshots[0].platform, "android");
});

test("a PNG design icon is served as-is and its real pixel size reaches the manifest", () => {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  const schema = generate({
    configPath: join(FIXTURES, "widget-pngicon.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "public", "scad"),
    outPublicDir: join(out, "public"),
  });
  // PNG copied verbatim (no rasterization) preserving its extension.
  assert.equal(schema.designs.find((d) => d.id === "widget").icon, "scad/widget-icon.png");
  assert.ok(existsSync(join(out, "public", "scad", "widget-icon.png")));
  // The derived shortcut icon advertises the PNG's real 48x24 size (not "any").
  const manifest = JSON.parse(
    readFileSync(join(out, "public", "manifest.webmanifest"), "utf-8")
  );
  const shortcut = manifest.shortcuts.find((s) => s.url === "./#d=widget");
  assert.deepEqual(shortcut.icons, [
    { src: "scad/widget-icon.png", sizes: "48x24", type: "image/png" },
  ]);
});

test("heavy defaults to false when unset", () => {
  const { schema } = run("widget-autodeps.config.json");
  assert.equal(schema.designs[0].heavy, false);
});

test("group defaults to null when unset", () => {
  const { schema } = run("widget-autodeps.config.json");
  assert.equal(schema.designs[0].group, null);
});

test("a source-relative font path is referenced by basename", () => {
  // A design repo can bundle its own font by giving a path into the source tree;
  // the schema (and /fonts URL) reference it by basename.
  const { schema } = run("widget-fontpath.config.json");
  assert.deepEqual(schema.fonts, ["Bar.ttf"]);
});

test("a configured font that resolves to no file fails a real build", () => {
  // The existence check only bites in a real build (outPublicDir present) —
  // that's the only context where "already in public/fonts" is checkable.
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  assert.throws(
    () =>
      generate({
        configPath: join(FIXTURES, "widget-font-missing.config.json"),
        outSchemaDir: join(out, "schema"),
        outScadDir: join(out, "public", "scad"),
        outPublicDir: join(out, "public"),
      }),
    /font 'NoSuchFont\.ttf' not found/
  );
});

test("source defaults to '.' (designs beside the config) when omitted", () => {
  // default-source.config.json sets no `source`; mini.scad sits next to it.
  const { schema } = run("default-source.config.json");
  assert.equal(schema.designs.length, 1);
  assert.equal(schema.designs[0].id, "mini");
  assert.equal(schema.designs[0].file, "mini.scad");
  assert.deepEqual(schema.designs[0].sections, ["Basics"]);
});

test("missing design/asset/preset paths fail with a clear error", () => {
  assert.throws(() => run("widget-missing-design.config.json"), /source file 'nope\.scad' not found/);
});

test("assets: a directory bundles all .scad under it", () => {
  const { schema, out } = run("widget.config.json");
  assert.deepEqual(schema.assets, ["lib/core.scad", "lib/util.scad"]);
  assert.ok(existsSync(join(out, "scad", "lib", "core.scad")));
  assert.ok(existsSync(join(out, "scad", "lib", "util.scad")));
});

test("without `assets`, deps are discovered via use/include", () => {
  const { schema } = run("widget-autodeps.config.json");
  // widget.scad -> lib/core.scad -> util.scad (resolved relative to lib/)
  assert.deepEqual(schema.assets, ["lib/core.scad", "lib/util.scad"]);
});

test("assets: globs match files (including non-.scad, recursively)", () => {
  const { schema, out } = run("widget-glob.config.json");
  // "lib/*.scad" matches the two .scad but NOT lib/notes.txt; "**/*.svg"
  // reaches the nested assets/emblem.svg anywhere in the tree.
  assert.deepEqual(schema.assets, [
    "assets/emblem.svg",
    "lib/core.scad",
    "lib/util.scad",
  ]);
  assert.ok(existsSync(join(out, "scad", "assets", "emblem.svg")));
  assert.ok(existsSync(join(out, "scad", "lib", "core.scad")));
  assert.ok(!existsSync(join(out, "scad", "lib", "notes.txt")));
});

test("assets: a glob matching nothing fails with a clear error", () => {
  assert.throws(
    () => run("widget-glob-empty.config.json"),
    /asset pattern 'lib\/\*\.nope' matched no files/
  );
});

test("a use/include dep that escapes the source root fails the build", () => {
  assert.throws(() => run("widget-escape.config.json"), /escapes the source root/);
});

test("an `assets` entry that escapes the source root fails the build", () => {
  assert.throws(() => run("widget-escape-asset.config.json"), /escapes the source root/);
});

test("a design `file` that escapes the source root fails the build", () => {
  assert.throws(() => run("widget-escape-file.config.json"), /escapes the source root/);
});

test("a missing use/include target names the missing path and the referencing file", () => {
  assert.throws(
    () => run("widget-missingdep.config.json"),
    /dependency 'lib\/nope\.scad' not found[\s\S]*referenced by missingdep-design\.scad/
  );
});

// ── explicit `assets` no longer skips the use/include walk entirely ────────
//
// Before this, an explicit `assets` list made collectDeps irrelevant: a
// design whose use/include graph reached a file the operator forgot to list
// (or deliberately left out) built green and only failed once the
// OpenSCAD-WASM worker tried to mount it in a browser, since the render
// sandbox only ever gets the configured `assets`. generate() now always
// walks (collectDeps), then — only in explicit-assets mode — checks the walk
// against the configured set.

test("explicit `assets` that omits a use/include dependency fails the build with a distinct coverage error", () => {
  // widget.scad -> lib/core.scad -> lib/util.scad (collectDeps' own walk);
  // this fixture's `assets` covers only lib/util.scad, so lib/core.scad is
  // reachable but not bundled — exactly the gap checkAssetCoverage exists for.
  let caught;
  try {
    run("widget-assets-missing-dep.config.json");
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "expected generate() to throw");
  // Names both the design id and the missing relative path.
  assert.match(caught.message, /design 'widget'/);
  assert.match(caught.message, /lib\/core\.scad/);
  // A distinct diagnosis from collectDeps' own "dependency '...' not found:
  // ... (referenced by ...)" (a dependency missing from disk entirely) — this
  // dependency DOES exist on disk, it's just not in `assets`, so the two
  // causes must never read the same. (collectDeps' message is quoted, for
  // context, inside this error's own explanatory parenthetical, so match on
  // its distinguishing "referenced by" rather than the more generic "not
  // found" text that quoting necessarily repeats.)
  assert.match(caught.message, /not covered by 'assets'/);
  assert.doesNotMatch(caught.message, /referenced by/);
});

test("explicit `assets` that DOES cover every use/include dependency still builds (no false positive)", () => {
  // widget-glob.config.json's `assets` ("lib/*.scad", "**/*.svg") covers both
  // of widget.scad's walked dependencies (lib/core.scad, lib/util.scad) plus
  // its @icon asset — see the "assets: globs match files" test above for the
  // full assertion. Re-run here only to pin down that adding the coverage
  // check didn't turn a previously-green explicit-assets build red.
  const { schema } = run("widget-glob.config.json");
  assert.deepEqual(schema.assets, ["assets/emblem.svg", "lib/core.scad", "lib/util.scad"]);
});

test("schema.json is written to the output dir", () => {
  const { out } = run("widget.config.json");
  const written = JSON.parse(
    readFileSync(join(out, "schema", "designs.json"), "utf-8")
  );
  assert.equal(written.designs[0].id, "widget");
});

test("public precache manifest lists generated runtime assets", () => {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  generate({
    configPath: join(FIXTURES, "widget.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "public", "scad"),
    outPublicDir: join(out, "public"),
  });
  const precache = JSON.parse(
    readFileSync(join(out, "public", "precache-manifest.json"), "utf-8")
  );
  assert.equal(precache.version, 2);
  for (const path of [
    "icon.svg",
    "manifest.webmanifest",
    "scad/widget.scad",
    "scad/widget.json",
    "scad/lib/core.scad",
    "scad/lib/util.scad",
    "scad/logo.svg",
  ]) {
    assert.ok(precache.shell.includes(path), `${path} should be shell-precached`);
  }
  // H3: the render worker fetches the WASM glue and fonts.conf content-
  // addressed, so the shell precaches the SAME ?v=<digest> URLs (Cache Storage
  // matches the query string, so an unversioned entry would miss the worker's
  // versioned request offline). This fixture has no real openscad.js on disk,
  // so its glue digest is absent and the URL stays plain; fonts.conf IS a
  // generated file, so its shell URL must carry a digest query.
  assert.ok(
    precache.shell.some((u) => u === "wasm/openscad.js" || /^wasm\/openscad\.js\?v=[0-9a-f]+$/.test(u)),
    `glue must be shell-precached, got: ${JSON.stringify(precache.shell)}`
  );
  assert.ok(
    precache.shell.some((u) => /^fonts\/fonts\.conf\?v=[0-9a-f]+$/.test(u)),
    `expected a digest-versioned fonts.conf shell URL, got: ${JSON.stringify(precache.shell)}`
  );
  // The big binaries (WASM + font files) go to the render worker's own
  // versioned cache, not the shell cache.
  assert.ok(!precache.shell.includes("wasm/openscad.wasm"));
  assert.ok(!precache.shell.includes("fonts/Foo.ttf"));
  assert.match(precache.bin.cache, /^openscad-wasm-bin-/);
  // H4: content-addressed via a `?v=<digest>` query — see versionedPath in
  // gen-schema.mjs. This fixture has no real openscad.wasm on disk, so its
  // digest is absent and the URL stays plain; Foo.ttf IS a real bundled file,
  // so its URL must carry a digest query.
  assert.ok(precache.bin.urls.includes("wasm/openscad.wasm"));
  assert.ok(
    precache.bin.urls.some((u) => /^fonts\/Foo\.ttf\?v=[0-9a-f]+$/.test(u)),
    `expected a digest-versioned Foo.ttf URL, got: ${JSON.stringify(precache.bin.urls)}`
  );
});

test("manifest carries the PWA install fields (id, launch_handler, maskable icon)", () => {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  generate({
    configPath: join(FIXTURES, "widget.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "public", "scad"),
    outPublicDir: join(out, "public"),
  });
  const manifest = JSON.parse(
    readFileSync(join(out, "public", "manifest.webmanifest"), "utf-8")
  );
  assert.equal(manifest.id, "/scadpub/");
  assert.deepEqual(manifest.launch_handler, { client_mode: "navigate-existing" });
  assert.ok(
    manifest.icons.some((i) => i.purpose === "maskable" && i.type === "image/png"),
    "a maskable PNG icon must be present"
  );
  // Single-design configs derive no shortcuts.
  assert.equal(manifest.shortcuts, undefined);
});

test("config shortcuts are validated and folded into the manifest", () => {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  generate({
    configPath: join(FIXTURES, "widget-shortcuts.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "public", "scad"),
    outPublicDir: join(out, "public"),
  });
  const manifest = JSON.parse(
    readFileSync(join(out, "public", "manifest.webmanifest"), "utf-8")
  );
  // The well-formed shortcut is kept; the entry missing a url is dropped.
  assert.deepEqual(manifest.shortcuts, [
    { name: "Open help", short_name: "Help", url: "./#help" },
  ]);
});

test("rejects a PWA colour that isn't a safe CSS colour string", () => {
  // pwa.themeColor/pwa.backgroundColor are interpolated into generated
  // SVG/HTML, so they must pass the same COLOR_VALUE_RE as every other colour.
  assert.throws(() => run("widget-bad-color.config.json"), /'pwa\.themeColor\.dark' must be a CSS colour/);
});

test("rejects a design id with unsafe characters", () => {
  assert.throws(() => run("widget-bad-id.config.json"), /design id .* must match/);
});

test("rejects an app-level id with unsafe characters", () => {
  // The app id reaches index.html's inline pre-paint script as a string
  // literal (%APP_THEME_KEY%), so it gets the same charset check as design ids.
  assert.throws(() => run("widget-bad-app-id.config.json"), /config 'id' .* must match/);
});

test("'pwa.categories' must be an array of strings when present", () => {
  // Asserts the corrected 'pwa.categories' path (not the stale bare
  // 'categories' this used to say — see parseStringArray's own fix).
  assert.throws(
    () => run("widget-bad-categories.config.json"),
    /'pwa\.categories' must be an array of non-empty strings/
  );
});

test("'render.features'/'pwa.categories': an explicit null is treated as unset, not an error", () => {
  // Both used to throw ("must be an array of non-empty strings (got null)")
  // because parseStringArray only checked `undefined` — every other
  // render/pwa field already treats null == absent (see applyGroupSpec's own
  // comment). Building must succeed, matching a config that omits both keys.
  assert.doesNotThrow(() => run("widget-features-categories-null.config.json"));
});

test("'features' must be an array of strings when present", () => {
  assert.throws(
    () => run("widget-bad-features.config.json"),
    /'render\.features' must be an array of non-empty strings/
  );
});

test("iOS splash images are generated and described in the schema", () => {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  const schema = generate({
    configPath: join(FIXTURES, "widget.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "public", "scad"),
    outPublicDir: join(out, "public"),
  });
  // Resvg is a devDependency, so splashes are generated in this test env.
  assert.ok(Array.isArray(schema.appleSplash) && schema.appleSplash.length > 0);
  for (const sp of schema.appleSplash) {
    assert.match(sp.media, /orientation: portrait/);
    assert.ok(existsSync(join(out, "public", sp.href)), `${sp.href} should exist on disk`);
  }
  // And every splash is precached for offline launch.
  const precache = JSON.parse(
    readFileSync(join(out, "public", "precache-manifest.json"), "utf-8")
  );
  for (const sp of schema.appleSplash) assert.ok(precache.shell.includes(sp.href));
});

test("regenerating cleans the scad output dir so removed files don't linger", () => {
  // outScadDir is entirely generated; a file from a prior config/build must not
  // survive a regenerate (otherwise a removed/renamed design could still ship).
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  const outScadDir = join(out, "scad");
  const opts = {
    configPath: join(FIXTURES, "widget.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir,
  };
  generate(opts);
  // Simulate a stale artifact left by a previous build.
  const stale = join(outScadDir, "old-removed.scad");
  writeFileSync(stale, "// stale\n");
  assert.ok(existsSync(stale));
  generate(opts);
  assert.ok(!existsSync(stale), "stale file should be cleaned on regenerate");
  // The current design's files are still present after the clean+copy.
  assert.ok(existsSync(join(outScadDir, "widget.scad")));
  rmSync(out, { recursive: true, force: true });
});

test("per-theme logos with the same basename don't overwrite each other", () => {
  // branding/light/logo.svg and branding/dark/logo.svg both end in logo.svg;
  // a flat basename would clobber one with the other.
  const { schema, out } = run("widget-logo-collide.config.json");
  assert.notEqual(schema.logo.light, schema.logo.dark);
  const lightAbs = join(out, schema.logo.light);
  const darkAbs = join(out, schema.logo.dark);
  assert.ok(existsSync(lightAbs));
  assert.ok(existsSync(darkAbs));
  // Each served file matches its own source (no overwrite).
  assert.match(readFileSync(lightAbs, "utf-8"), /#fff/);
  assert.match(readFileSync(darkAbs, "utf-8"), /#000/);
});

test("format defaults to 3mf, accepts stl, and rejects anything else", () => {
  assert.equal(parseFormat(undefined), "3mf");
  assert.equal(parseFormat(null), "3mf");
  assert.equal(parseFormat("3mf"), "3mf");
  assert.equal(parseFormat("stl"), "stl");
  assert.throws(() => parseFormat("obj"), /'render\.format' must be/);
  assert.throws(() => parseFormat("STL"), /'render\.format' must be/);
});

// `viewer` gathers every display-only viewer concern in one place: the
// presentation style, restOnGrid framing, the grid toggle's seed value, and
// per-control visibility (viewer.controls.*) — see this commit's message for
// why these used to be split across the top level and `ui`.
const VIEWER_DEFAULTS = {
  style: "plain",
  restOnGrid: false,
  grid: "off",
  controls: { measure: true, viewPicker: true, reset: true, zoom: false, fullscreen: true },
};

test("viewer defaults every field (style, restOnGrid, grid, controls), validates style, rejects junk", () => {
  assert.deepEqual(parseViewer(undefined), VIEWER_DEFAULTS);
  assert.deepEqual(parseViewer(null), VIEWER_DEFAULTS);
  assert.deepEqual(parseViewer({}), VIEWER_DEFAULTS);
  // An explicit null on a recognised key is "not set" too, same as omitting
  // the whole block (normalization: null == omitted, everywhere).
  assert.deepEqual(parseViewer({ style: null }), VIEWER_DEFAULTS);
  assert.deepEqual(parseViewer({ style: "studio" }), { ...VIEWER_DEFAULTS, style: "studio" });
  assert.deepEqual(parseViewer({ style: "plain" }), VIEWER_DEFAULTS);
  // Every message now uses the one "gen-schema: '<path>' ..." prefix — viewer
  // used to read "config.<path> ..." with no quotes, an accident of predating
  // the newer convention rather than a meaningful distinction.
  assert.throws(() => parseViewer("studio"), /gen-schema: 'viewer' must be an object/);
  assert.throws(() => parseViewer(["studio"]), /gen-schema: 'viewer' must be an object/);
  // Enum errors always say what they got now (used to be viewer/popup only).
  assert.throws(() => parseViewer({ style: "toon" }), /'viewer\.style' must be one of .* \(got "toon"\)/);
  assert.throws(
    () => parseViewer({ shadow: true }),
    /'viewer': unknown key 'shadow'.*Valid keys: style, restOnGrid, grid, controls/s
  );
});

test("viewer.restOnGrid defaults to false, accepts booleans, and rejects anything else", () => {
  assert.equal(parseViewer(undefined).restOnGrid, false);
  assert.equal(parseViewer({ restOnGrid: true }).restOnGrid, true);
  assert.equal(parseViewer({ restOnGrid: false }).restOnGrid, false);
  assert.throws(() => parseViewer({ restOnGrid: "true" }), /'viewer\.restOnGrid' must be a boolean/);
  assert.throws(() => parseViewer({ restOnGrid: 1 }), /'viewer\.restOnGrid' must be a boolean/);
});

test("viewer.grid defaults to off, accepts on/off, rejects anything else", () => {
  assert.equal(parseViewer(undefined).grid, "off");
  assert.equal(parseViewer({ grid: "on" }).grid, "on");
  assert.equal(parseViewer({ grid: "off" }).grid, "off");
  assert.throws(() => parseViewer({ grid: "yes" }), /'viewer\.grid' must be one of "off", "on"/);
  assert.throws(() => parseViewer({ grid: true }), /'viewer\.grid' must be one of "off", "on"/);
});

test("viewer.controls.* each default independently and reject non-booleans", () => {
  assert.deepEqual(parseViewer(undefined).controls, VIEWER_DEFAULTS.controls);
  // Every default is always present, even when the config never mentions
  // `viewer` (or `viewer.controls`) at all — matching the flat `ui.*`
  // booleans these fields replace, which were always present too.
  assert.deepEqual(parseViewer({}).controls, VIEWER_DEFAULTS.controls);
  assert.deepEqual(parseViewer({ controls: {} }).controls, VIEWER_DEFAULTS.controls);
  assert.equal(parseViewer({ controls: { measure: false } }).controls.measure, false);
  assert.equal(parseViewer({ controls: { viewPicker: false } }).controls.viewPicker, false);
  assert.equal(parseViewer({ controls: { reset: false } }).controls.reset, false);
  assert.equal(parseViewer({ controls: { zoom: true } }).controls.zoom, true);
  assert.equal(parseViewer({ controls: { fullscreen: false } }).controls.fullscreen, false);
  assert.throws(
    () => parseViewer({ controls: { measure: "no" } }),
    /'viewer\.controls\.measure' must be a boolean/
  );
  assert.throws(
    () => parseViewer({ controls: { zoom: 1 } }),
    /'viewer\.controls\.zoom' must be a boolean/
  );
  assert.throws(
    () => parseViewer({ controls: { shadow: true } }),
    /'viewer\.controls': unknown key 'shadow'/
  );
});

test("viewer is emitted to the schema and absent from renderHash (display-only)", () => {
  // Nothing under `viewer` changes the exported bytes, so it must reach the
  // schema without disturbing renderHash.
  const a = run("widget.config.json").schema; // defaults throughout
  assert.deepEqual(a.viewer, VIEWER_DEFAULTS);
});

test("format is emitted to the schema and folded into renderHash", () => {
  // Two configs identical but for `format` (widget-stl is a copy with stl): the
  // format must reach the schema and, because it changes OpenSCAD's output, the
  // renderHash too.
  const a = run("widget.config.json").schema; // default -> 3mf
  const b = run("widget-stl.config.json").schema;
  assert.equal(a.format, "3mf");
  assert.equal(b.format, "stl");
  assert.notEqual(a.renderHash, b.renderHash);
});

test("the ScadPub version stamp reaches the schema and stays out of renderHash", () => {
  // The stamp identifies the ScadPub build behind a deployment (shown in the
  // open-source licenses modal). It's display-only: folding it into renderHash
  // would throw away every persisted render on each commit.
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  const stamped = generate({
    configPath: join(FIXTURES, "widget.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "scad"),
    version: "v1.4.0-3-gab12cd6",
  });
  assert.equal(stamped.scadpubVersion, "v1.4.0-3-gab12cd6");
  assert.equal(
    JSON.parse(readFileSync(join(out, "schema", "designs.json"), "utf-8")).scadpubVersion,
    "v1.4.0-3-gab12cd6"
  );

  const other = generate({
    configPath: join(FIXTURES, "widget.config.json"),
    outSchemaDir: join(out, "schema2"),
    outScadDir: join(out, "scad2"),
    version: "v2.0.0",
  });
  assert.equal(stamped.renderHash, other.renderHash);
});

test("a build with no resolvable version omits the stamp entirely", () => {
  // What a git-less build tree (release tarball, vendored copy) with no
  // $SCADPUB_VERSION override produces — passed as "" here since an `undefined`
  // argument would just re-trigger generate()'s own default lookup. The key is
  // absent rather than null/"", so the licenses modal shows no version line.
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  const schema = generate({
    configPath: join(FIXTURES, "widget.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "scad"),
    version: "",
  });
  assert.equal("scadpubVersion" in schema, false);
  assert.equal(
    "scadpubVersion" in
      JSON.parse(readFileSync(join(out, "schema", "designs.json"), "utf-8")),
    false
  );
});

test("bundled package versions are read from the install and reach the schema", () => {
  // The licenses modal reads these instead of carrying version literals, so the
  // schema must carry whatever the build's node_modules actually hold.
  const { schema } = run("widget.config.json");
  assert.deepEqual(schema.componentVersions, componentVersions());
  assert.match(schema.componentVersions.three, /^\d+\.\d+\.\d+/);

  // Injectable, and — like the ScadPub stamp — display-only, so a dependency
  // bump doesn't throw away every cached render.
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  const withDeps = (components, dir) =>
    generate({
      configPath: join(FIXTURES, "widget.config.json"),
      outSchemaDir: join(out, `schema-${dir}`),
      outScadDir: join(out, `scad-${dir}`),
      components,
    });
  const a = withDeps({ three: "0.185.1" }, "a");
  const b = withDeps({ three: "0.190.0" }, "b");
  assert.deepEqual(a.componentVersions, { three: "0.185.1" });
  assert.equal(a.renderHash, b.renderHash);
});

test("renderHash is stable for an unchanged config (so a rebuild doesn't bust the cache)", () => {
  // The whole point of renderHash is to invalidate persisted geometry only when
  // a render input actually changes. A non-deterministic hash would needlessly
  // re-render everything on every deploy — pin determinism here.
  assert.equal(run("widget.config.json").schema.renderHash, run("widget.config.json").schema.renderHash);
});

test("renderHash folds in the render features so an --enable change invalidates it", () => {
  // widget-features is widget plus one extra OpenSCAD feature; features are
  // passed as --enable flags and change the geometry, so the hash must move.
  const a = run("widget.config.json").schema;
  const b = run("widget-features.config.json").schema;
  assert.deepEqual(a.features, ["textmetrics"]);
  assert.deepEqual(b.features, ["textmetrics", "lazy-union"]);
  assert.notEqual(a.renderHash, b.renderHash);
});

test("renderHash folds in the bundled font set (glyph outlines drive text geometry)", () => {
  // widget-fonts swaps Foo.ttf for Bar.ttf; a different font yields different
  // text() geometry, so swapping it must invalidate cached renders. Note the
  // font set only enters the hash in a real build (outPublicDir present) — the
  // bare run() helper omits it — so generate with a public dir here.
  const hashWithFonts = (config) => {
    const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
    return generate({
      configPath: join(FIXTURES, config),
      outSchemaDir: join(out, "schema"),
      outScadDir: join(out, "public", "scad"),
      outPublicDir: join(out, "public"),
    }).renderHash;
  };
  assert.notEqual(hashWithFonts("widget.config.json"), hashWithFonts("widget-fonts.config.json"));
});

test("ui.showVarName defaults to false, accepts a boolean, rejects non-booleans", () => {
  assert.equal(parseUi(undefined).showVarName, false);
  assert.equal(parseUi({}).showVarName, false);
  assert.equal(parseUi({ showVarName: true }).showVarName, true);
  assert.equal(parseUi({ showVarName: false }).showVarName, false);
  assert.throws(() => parseUi({ showVarName: "yes" }), /'ui\.showVarName' must be a boolean/);
  assert.throws(() => parseUi({ showVarName: 1 }), /'ui\.showVarName' must be a boolean/);
});

test("ui.presetsLabel / parametersLabel moved to the i18n catalogue (strings['presets.title']/['settings.title'])", () => {
  // These used to be `ui` fields (parseUi); they're plain chrome copy now,
  // resolved via src/lib/i18n.ts's t() and overridable through the config's
  // `strings` block like any other catalogue key.
  assert.equal(parseUi(undefined).presetsLabel, undefined);
  assert.equal(parseUi(undefined).parametersLabel, undefined);
});

test("ui: an explicit null is equivalent to omitting the key, for every field kind (normalization: null == not set)", () => {
  // Most `ui` fields used to treat an explicit null as present-but-invalid
  // and throw; render's and fileImport's already treated it as omitted. That
  // split was an accident of five parsers growing up separately — a
  // hand-written JSON config has no comments to delete a line with, so an
  // explicit null is how an author says "leave this alone", not a typo.
  assert.equal(parseUi({ showVarName: null }).showVarName, false); // boolean
  assert.equal(parsePwa({ install: null }).install, "auto"); // enum (pwa.install, moved from ui.install)
  assert.equal(parseUi({ saveImage: null }).saveImage, undefined); // no-default boolean
});

test("ui: unknown nested keys are rejected (newly enforced — used to be silently ignored)", () => {
  assert.throws(
    () => parseUi({ oops: true }),
    /'ui': unknown key 'oops'\.\s*\n\s*Valid keys: panelSide, panelDefault/
  );
});

test("notices are off by default (omitted -> [])", () => {
  assert.deepEqual(parseNotices(undefined), []);
  assert.deepEqual(parseNotices(null), []);
  assert.deepEqual(parseNotices([]), []);
  // The emitted schema carries an empty list when the key is omitted.
  const { schema } = run("widget.config.json");
  assert.deepEqual(schema.notices, []);
});

test("notices: normalises entries, defaults the label, keeps order", () => {
  assert.deepEqual(
    parseNotices([
      { marker: " note ", label: "  notes  ", color: " #3b82f6 " },
      { marker: "alert" }, // label defaults to the marker
    ]),
    [
      { marker: "note", label: { one: "notes", other: "notes" }, color: "#3b82f6" },
      { marker: "alert", label: { one: "alert", other: "alert" } },
    ]
  );
});

test("notices: validates shape, marker, label and colour", () => {
  assert.throws(() => parseNotices({}), /'notices' must be an array/);
  assert.throws(() => parseNotices([null]), /'notices\[0\]' must be an object/);
  assert.throws(
    () => parseNotices([{ label: "x" }]),
    /'notices\[0\]\.marker' is required/
  );
  assert.throws(
    () => parseNotices([{ marker: "n", label: "  " }]),
    /'notices\[0\]\.label' must be a non-empty string, or \{ one, other \}/
  );
  assert.throws(
    () => parseNotices([{ marker: "n", color: "#fff; } body { display:none" }]),
    /'notices\[0\]\.color' must be a plain CSS colour/
  );
});

test("notices: label accepts { one, other } — 'other' required, 'one' optional (falls back to 'other')", () => {
  assert.deepEqual(
    parseNotices([{ marker: "alert", label: { one: " alert ", other: " alerts " } }]),
    [{ marker: "alert", label: { one: "alert", other: "alerts" } }]
  );
  // `one` omitted -> falls back to `other`, matching the old labelOne-absent behaviour.
  assert.deepEqual(parseNotices([{ marker: "note", label: { other: "notes" } }]), [
    { marker: "note", label: { one: "notes", other: "notes" } },
  ]);
  assert.deepEqual(parseNotices([{ marker: "note" }]), [
    { marker: "note", label: { one: "note", other: "note" } },
  ]);
  assert.throws(
    () => parseNotices([{ marker: "n", label: { one: "  " } }]),
    /'notices\[0\]\.label\.other' is required/
  );
  assert.throws(
    () => parseNotices([{ marker: "n", label: { other: "x", subtitle: "y" } }]),
    /'notices\[0\]\.label': unknown key 'subtitle'\.\s*\n\s*Valid keys: one, other/
  );
  assert.throws(() => parseNotices([{ marker: "n", label: [] }]), /'notices\[0\]\.label' must be a string/);
});

test("notices: the old labelOne field is no longer accepted (reshaped to label: { one, other })", () => {
  assert.throws(
    () => parseNotices([{ marker: "alert", label: "alerts", labelOne: "alert" }]),
    /'notices\[0\]\.labelOne' is no longer supported.*label.*\{ one, other \}/s
  );
});

test("notices: subsumedByFont is optional and must be a boolean", () => {
  assert.deepEqual(
    parseNotices([{ marker: "alert", label: "alerts", attention: true, subsumedByFont: true }]),
    [{ marker: "alert", label: { one: "alerts", other: "alerts" }, attention: true, subsumedByFont: true }]
  );
  assert.deepEqual(parseNotices([{ marker: "alert", subsumedByFont: false }]), [
    { marker: "alert", label: { one: "alert", other: "alert" }, subsumedByFont: false },
  ]);
  // Omitted entirely -> absent from the emitted category (the app treats
  // absent as false).
  assert.deepEqual(parseNotices([{ marker: "alert" }]), [
    { marker: "alert", label: { one: "alert", other: "alert" } },
  ]);
  assert.throws(
    () => parseNotices([{ marker: "n", subsumedByFont: "yes" }]),
    /'notices\[0\]\.subsumedByFont' must be a boolean/
  );
});

test("notices: an explicit null on attention/subsumedByFont means unset, same as an absent one", () => {
  assert.deepEqual(parseNotices([{ marker: "alert", attention: null, subsumedByFont: null }]), [
    { marker: "alert", label: { one: "alert", other: "alert" } },
  ]);
});

test("notices: duplicate markers (case-insensitive) fail the build", () => {
  assert.throws(
    () => parseNotices([{ marker: "alert" }, { marker: "Alert" }]),
    /'notices\[1\]\.marker' duplicates 'notices\[0\]\.marker' — both match "Alert" case-insensitively/
  );
  // Three entries: the second AND third both collide with the first.
  assert.throws(
    () => parseNotices([{ marker: "alert" }, { marker: "Alert" }, { marker: "ALERT" }]),
    /'notices\[1\]\.marker' duplicates 'notices\[0\]\.marker'/
  );
  // Distinct markers are unaffected.
  assert.deepEqual(
    parseNotices([{ marker: "alert" }, { marker: "note" }]).map((n) => n.marker),
    ["alert", "note"]
  );
});

test("renderHash folds in the renderer source so flag changes invalidate it", () => {
  // With outPublicDir + rendererFiles, a change to the renderer's render
  // contract (e.g. an OpenSCAD flag in worker.ts) must change renderHash.
  const base = mkdtempSync(join(tmpdir(), "gen-schema-"));
  const renderer = join(base, "worker.ts");
  writeFileSync(renderer, "// flags: --backend=manifold\n");
  const gen = () => {
    const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
    return generate({
      configPath: join(FIXTURES, "widget.config.json"),
      outSchemaDir: join(out, "schema"),
      outScadDir: join(out, "public", "scad"),
      outPublicDir: join(out, "public"),
      rendererFiles: [renderer],
    }).renderHash;
  };
  const before = gen();
  writeFileSync(renderer, "// flags: --backend=cgal\n");
  const after = gen();
  assert.notEqual(before, after);
  rmSync(base, { recursive: true, force: true });
});

test("renderHash folds in the design routing map, so swapping two designs' files invalidates it", () => {
  // H3: two configs mounting the SAME set of .scad files (widget.scad,
  // collapsible.scad) but routing the design ids to opposite files. The
  // scadFiles set is identical either way, so only the routing map itself can
  // account for a hash difference — proving id->file is a hashed input, not
  // just the file set.
  const gen = (aFile, bFile) => {
    const root = mkdtempSync(join(tmpdir(), "gen-schema-"));
    writeFileSync(
      join(root, "c.config.json"),
      JSON.stringify({
        title: "T",
        source: join(FIXTURES, "src"),
        designs: [
          { id: "a", label: "A", file: aFile },
          { id: "b", label: "B", file: bFile },
        ],
      })
    );
    const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
    return generate({
      configPath: join(root, "c.config.json"),
      outSchemaDir: join(out, "schema"),
      outScadDir: join(out, "scad"),
    });
  };
  const straight = gen("widget.scad", "collapsible.scad");
  const swapped = gen("collapsible.scad", "widget.scad");
  // Same mounted file set either way.
  assert.deepEqual([...straight.designs.map((d) => d.file)].sort(), [...swapped.designs.map((d) => d.file)].sort());
  assert.notEqual(straight.renderHash, swapped.renderHash);
});

test("renderHash folds in the openscad.js glue bytes, so a corrupted/updated glue file invalidates it (M12)", () => {
  const gen = (glueContent) => {
    const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
    mkdirSync(join(out, "public", "wasm"), { recursive: true });
    writeFileSync(join(out, "public", "wasm", "openscad.js"), glueContent);
    return generate({
      configPath: join(FIXTURES, "widget.config.json"),
      outSchemaDir: join(out, "schema"),
      outScadDir: join(out, "public", "scad"),
      outPublicDir: join(out, "public"),
    }).renderHash;
  };
  assert.notEqual(gen("export default function A() {}\n"), gen("export default function B() {}\n"));
});

test("renderHash is unaffected by presentation-only config fields (title/help/notices/theme/ui labels)", () => {
  // H3: labels, help prose, notices, theme colours and UI copy must not
  // invalidate persisted geometry — only the render contract (routing,
  // sources, features, format, fonts, renderer code, binaries) should.
  const base = {
    source: "src",
    designs: [{ id: "widget", label: "Widget" }],
  };
  const gen = (overrides) => {
    const root = mkdtempSync(join(tmpdir(), "gen-schema-"));
    writeFileSync(join(root, "c.config.json"), JSON.stringify({ ...base, source: join(FIXTURES, "src"), ...overrides }));
    const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
    return generate({
      configPath: join(root, "c.config.json"),
      outSchemaDir: join(out, "schema"),
      outScadDir: join(out, "scad"),
    }).renderHash;
  };
  const plain = gen({ title: "Plain Title" });
  const dressedUp = gen({
    title: "A Whole Different Title",
    pwa: { themeColor: "#123456" },
    help: "<p>Different help copy entirely.</p>",
    notices: [{ marker: "note", label: "A note", color: "#3b82f6" }],
    strings: { "presets.title": "Styles", "settings.title": "Options" },
    designs: [{ id: "widget", label: "A Very Different Label" }],
  });
  assert.equal(plain, dressedUp);
});

test("renderHash is unaffected by sourcing prose from a file instead of writing it inline", () => {
  // popup.bodyFile / fileImport.noteFile / licenses[].textFile / help.file all
  // just inline file content into fields that were already outside renderHash
  // (popup/fileImport/licenses/help are all presentation-only) — confirm the
  // file-sourced forms land at the exact same hash as a config with none of
  // that content configured at all.
  const baseline = run("widget-autodeps.config.json").schema.renderHash;
  for (const fixture of [
    "widget-popup-file.config.json",
    "widget-fileimport-file.config.json",
    "widget-licenses-file.config.json",
    "widget-help-file.config.json",
    "widget-help-tabs-file.config.json",
  ]) {
    assert.equal(run(fixture).schema.renderHash, baseline, `${fixture} changed renderHash`);
  }
});

test("firstSentence does not break on decimals or abbreviations", () => {
  assert.equal(firstSentence("Depth (mm). Must be >= 0.4 mm."), "Depth (mm).");
  assert.equal(
    firstSentence("Border, i.e. the edge clearance, in mm."),
    "Border, i.e. the edge clearance, in mm."
  );
});

test("firstSentence splits before a sentence that opens with a quote", () => {
  // The case the capital/paren-only lookahead used to miss entirely: a design
  // documenting an enum by naming its values kept the whole paragraph as the
  // control's label.
  assert.equal(
    firstSentence(
      'Text alignment. "center" (default) centres both the raised lettering ' +
        'and the Braille row; "left" and "right" flush both to that edge.'
    ),
    "Text alignment."
  );
  assert.equal(
    firstSentence('Top-edge treatment. "Square" leaves a flat top.'),
    "Top-edge treatment."
  );
  // Typographic quotes count too.
  assert.equal(firstSentence("Mounting holes. “none” leaves a clean back."), "Mounting holes.");
});

test("firstSentence does not split an abbreviation followed by a quote", () => {
  // The regression the quote-aware lookahead would otherwise introduce: the
  // token before the dot is an abbreviation, not the end of a sentence.
  assert.equal(
    firstSentence('Enter the floor number or control name (e.g. "1 OG").'),
    'Enter the floor number or control name (e.g. "1 OG").'
  );
  assert.equal(
    firstSentence('Primary label (z.B. "Ausgang"). Keep it short.'),
    'Primary label (z.B. "Ausgang").'
  );
  // …and it resumes scanning rather than giving up at the first abbreviation:
  // the real boundary after the parenthetical is still found.
  assert.equal(
    firstSentence('Label text (e.g. "1 OG"). "left" flushes it to that edge.'),
    'Label text (e.g. "1 OG").'
  );
});

test("firstSentence returns a block with no interior boundary unchanged", () => {
  const one = 'Enter the letters to practise: one tile per character ("abc" -> 3 tiles).';
  assert.equal(firstSentence(one), one);
  assert.equal(firstSentence(""), "");
});

test("colors: per-theme overrides pass through to the schema", () => {
  const { schema } = run("widget-colors.config.json");
  assert.deepEqual(schema.colors, {
    dark: { accent: "#ff7849", "viewer-model": "#ff7849" },
    light: { accent: "#b8430f" },
  });
});

test("colors default to null when omitted", () => {
  const { schema } = run("widget-autodeps.config.json");
  assert.equal(schema.colors, null);
});

test("extraCss: the stylesheet is copied and its URL recorded", () => {
  const { schema, out } = run("widget-extracss.config.json");
  assert.equal(schema.extraCss, "scad/extra.css");
  assert.ok(existsSync(join(out, "scad", "extra.css")));
});

test("extraCss defaults to null when omitted", () => {
  const { schema } = run("widget-autodeps.config.json");
  assert.equal(schema.extraCss, null);
});

test("a missing extraCss path fails with a clear error", () => {
  assert.throws(
    () => run("widget-extracss-missing.config.json"),
    /extraCss 'nope\.css' not found/
  );
});

test("extraCss is listed in the public precache manifest", () => {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  generate({
    configPath: join(FIXTURES, "widget-extracss.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "public", "scad"),
    outPublicDir: join(out, "public"),
  });
  const precache = JSON.parse(
    readFileSync(join(out, "public", "precache-manifest.json"), "utf-8")
  );
  assert.ok(precache.shell.includes("scad/extra.css"));
});

test("parseColors validates tokens and values", () => {
  // null / empty -> null
  assert.equal(parseColors(undefined), null);
  assert.equal(parseColors({}), null);
  assert.equal(parseColors({ dark: {} }), null);
  // trims values and keeps only the configured themes
  assert.deepEqual(parseColors({ light: { accent: "  #fff " } }), {
    light: { accent: "#fff" },
  });
  // accepts rgb()/hsl()/named colours
  assert.deepEqual(parseColors({ dark: { bg: "rgb(10, 20, 30)" } }), {
    dark: { bg: "rgb(10, 20, 30)" },
  });
  // unknown token -> clear error
  assert.throws(() => parseColors({ dark: { accnt: "#fff" } }), /unknown colour token/);
  // value that could break out of the <style> rule -> rejected
  assert.throws(
    () => parseColors({ dark: { bg: "#fff; } body { display:none" } }),
    /plain CSS colour/
  );
  // wrong shapes -> errors
  assert.throws(() => parseColors([]), /'colors' must be an object/);
  assert.throws(() => parseColors({ dark: "#fff" }), /'colors\.dark' must be an object/);
});

test("colors: an explicit null token means unset, same as an absent one", () => {
  assert.deepEqual(parseColors({ dark: { bg: null } }), null);
  assert.deepEqual(parseColors({ dark: { bg: null, accent: "#fff" } }), {
    dark: { accent: "#fff" },
  });
  // An unknown token is still rejected even when its value is null — the
  // null-means-unset rule is about VALUES, not about excusing a typo'd key.
  assert.throws(() => parseColors({ dark: { accnt: null } }), /unknown colour token/);
});

test("colors: success/success-bg/warn-bg are accepted colour tokens", () => {
  assert.deepEqual(
    parseColors({ dark: { success: "#4ade80", "success-bg": "#142615", "warn-bg": "#332812" } }),
    { dark: { success: "#4ade80", "success-bg": "#142615", "warn-bg": "#332812" } }
  );
});

test("help: tabs pass through to the schema verbatim", () => {
  const { schema } = run("widget-help-tabs.config.json");
  assert.equal(schema.help.intro, "Shared intro shown above every tab.");
  assert.equal(schema.help.tabs.length, 2);
  assert.equal(schema.help.tabs[0].label, "Getting started");
  assert.deepEqual(schema.help.tabs[1].sections, [
    { title: "Material", body: "Use **PLA**." },
    { title: "Supports", body: "Usually none needed." },
  ]);
});

test("help defaults to null when omitted", () => {
  const { schema } = run("widget-autodeps.config.json");
  assert.equal(schema.help, null);
});

test("help.file: a single-pane help sources its intro/sections from a Markdown file", () => {
  const { schema } = run("widget-help-file.config.json");
  assert.equal(schema.help.title, "User guide");
  assert.equal(schema.help.intro, "Configure a widget and export a model.");
  assert.deepEqual(schema.help.sections, [
    { title: "Pick a design", body: "Use the dropdown." },
    { title: "Adjust parameters", body: "The panel lists what you can change." },
  ]);
  // The 'file' key itself never reaches the generated schema.
  assert.equal("file" in schema.help, false);
});

test("help.tabs[].file: one tab may source from a file while a sibling tab stays inline", () => {
  const { schema } = run("widget-help-tabs-file.config.json");
  assert.equal(schema.help.tabs.length, 2);
  assert.equal(schema.help.tabs[0].label, "Getting started");
  assert.equal(schema.help.tabs[0].intro, "How to begin.");
  assert.deepEqual(schema.help.tabs[0].sections, [{ title: "Step 1", body: "Pick a design." }]);
  assert.equal("file" in schema.help.tabs[0], false);
  assert.equal(schema.help.tabs[1].label, "Printing");
  assert.deepEqual(schema.help.tabs[1].sections, [{ title: "Material", body: "Use **PLA**." }]);
});

test("resolveHelp: 'file' set alongside 'sections' or 'intro' fails the build, naming both", () => {
  const mustExist = (abs) => abs;
  assert.throws(
    () => resolveHelp({ file: "x.md", sections: [] }, "/cfg", mustExist),
    /both 'help\.sections' and 'help\.file' are set/
  );
  assert.throws(
    () => resolveHelp({ file: "x.md", intro: "Hi" }, "/cfg", mustExist),
    /both 'help\.intro' and 'help\.file' are set/
  );
  assert.throws(
    () => resolveHelp({ tabs: [{ label: "T", file: "x.md", sections: [] }] }, "/cfg", mustExist),
    /both 'help\.tabs\[0\]\.sections' and 'help\.tabs\[0\]\.file' are set/
  );
});

test("resolveHelp: a missing 'file' fails the build with the usual not-found message", () => {
  assert.throws(
    () => run("widget-help-file-missing.config.json"),
    /help\.file 'nope\.md' not found/
  );
});

test("resolveHelp: a non-string top-level 'file' fails validation before resolving, not a raw Node error", () => {
  const mustExist = () => {
    throw new Error("mustExist should not be called for an invalid 'file' value");
  };
  assert.throws(
    () => resolveHelp({ file: 5 }, "/cfg", mustExist),
    /'help\.file', when set, must be a non-empty string/
  );
});

test("resolveHelp: a blank top-level 'file' fails validation, not a confusing 'not found'", () => {
  const mustExist = () => {
    throw new Error("mustExist should not be called for a blank 'file' value");
  };
  assert.throws(
    () => resolveHelp({ file: "   " }, "/cfg", mustExist),
    /'help\.file', when set, must be a non-empty string/
  );
});

test("resolveHelp: a non-string 'help.tabs[].file' fails validation before resolving", () => {
  const mustExist = () => {
    throw new Error("mustExist should not be called for an invalid 'file' value");
  };
  assert.throws(
    () => resolveHelp({ tabs: [{ label: "T", file: 5 }] }, "/cfg", mustExist),
    /'help\.tabs\[0\]\.file', when set, must be a non-empty string/
  );
});

test("resolveHelp: a blank 'help.tabs[].file' fails validation before resolving", () => {
  const mustExist = () => {
    throw new Error("mustExist should not be called for a blank 'file' value");
  };
  assert.throws(
    () => resolveHelp({ tabs: [{ label: "T", file: "   " }] }, "/cfg", mustExist),
    /'help\.tabs\[0\]\.file', when set, must be a non-empty string/
  );
});

test("licenses: extra entries are appended, sanitised, and unknown keys dropped", () => {
  const { schema } = run("widget-licenses.config.json");
  assert.equal(schema.licenses.length, 2);
  // Known fields are kept; the unrecognised "ignored" key is stripped.
  assert.deepEqual(schema.licenses[0], {
    name: "Acme Widget Library",
    version: "3.1",
    license: "MIT",
    copyright: "Copyright (c) 2024 Acme Corp",
    url: "https://example.com/acme",
    licenseUrl: "https://example.com/acme/LICENSE",
    note: "Bundled helper geometry.",
  });
  assert.equal(schema.licenses[1].sourceUrl, "https://example.com/widgetron/src");
});

test("licenses default to an empty array when omitted", () => {
  const { schema } = run("widget-autodeps.config.json");
  assert.deepEqual(schema.licenses, []);
});

test("licenses[].textFile: the referenced file's contents become 'text'", () => {
  const { schema } = run("widget-licenses-file.config.json");
  assert.equal(schema.licenses[0].text, "MIT License\n\nFull text goes here.");
  assert.equal("textFile" in schema.licenses[0], false);
});

test("parseLicenses validates shape and required fields", () => {
  assert.deepEqual(parseLicenses(undefined), []);
  assert.deepEqual(parseLicenses(null), []);
  // a complete entry round-trips (optional fields preserved)
  const ok = [
    {
      name: "Lib",
      license: "MIT",
      copyright: "(c) X",
      url: "https://x",
      licenseUrl: "https://x/LICENSE",
      version: "1.0",
    },
  ];
  assert.deepEqual(parseLicenses(ok), ok);
  // wrong container / element shapes
  assert.throws(() => parseLicenses({}), /'licenses' must be an array/);
  assert.throws(() => parseLicenses([null]), /'licenses\[0\]' must be an object/);
  // missing required field
  assert.throws(
    () => parseLicenses([{ name: "Lib", license: "MIT", copyright: "(c)", url: "https://x" }]),
    /'licenses\[0\]\.licenseUrl' is required/
  );
  // empty required field
  assert.throws(
    () =>
      parseLicenses([
        { name: "  ", license: "MIT", copyright: "(c)", url: "https://x", licenseUrl: "https://x/L" },
      ]),
    /'licenses\[0\]\.name' is required/
  );
  // non-string optional field
  assert.throws(
    () =>
      parseLicenses([
        {
          name: "Lib",
          license: "MIT",
          copyright: "(c)",
          url: "https://x",
          licenseUrl: "https://x/L",
          note: 5,
        },
      ]),
    /'licenses\[0\]\.note' must be a string/
  );
});

test("licenses: an explicit null on an optional field means unset, same as an absent one", () => {
  const REQUIRED = {
    name: "Lib",
    license: "MIT",
    copyright: "(c) X",
    url: "https://x",
    licenseUrl: "https://x/LICENSE",
  };
  assert.deepEqual(
    parseLicenses([{ ...REQUIRED, version: null, text: null, sourceUrl: null, note: null }]),
    [REQUIRED]
  );
});

test("parseFileImport: true/object, defaults and errors", () => {
  // Absent -> null; explicit false -> null.
  assert.equal(parseFileImport(undefined), null);
  assert.equal(parseFileImport(false), null);
  // true -> defaults (an empty options object).
  assert.deepEqual(parseFileImport(true), {});
  // Object form: known string field passes through; undefined is dropped.
  assert.deepEqual(parseFileImport({ note: "Add a font.", noteFile: undefined }), {
    note: "Add a font.",
  });
  // Wrong shapes -> clear errors.
  assert.throws(() => parseFileImport([]), /'fileImport' must be true/);
  assert.throws(
    () => parseFileImport({ note: 5 }),
    /'fileImport\.note', when set, must be a non-empty string/
  );
  // Blank/whitespace-only is rejected; what's kept is trimmed.
  assert.throws(
    () => parseFileImport({ note: "   " }),
    /'fileImport\.note', when set, must be a non-empty string/
  );
  assert.deepEqual(parseFileImport({ note: "  Add a font.  " }), { note: "Add a font." });
  // `accept`/`label`/`maxBytes` are gone, not merely deprecated: they no
  // longer drove any generic import button (each contextual control applies
  // its own picker filter and size guard — see docs/config.md's Import file
  // section), so a config still setting one fails the ordinary unknown-key
  // check exactly like any other typo.
  assert.throws(
    () => parseFileImport({ accept: ".svg" }),
    /'fileImport': unknown key 'accept'\.\s*\n\s*Valid keys: note, noteFile/
  );
  assert.throws(
    () => parseFileImport({ oops: true }),
    /'fileImport': unknown key 'oops'\.\s*\n\s*Valid keys: note, noteFile/
  );
});

test("parseLang / parseDir: defaults, validation and errors", () => {
  assert.equal(parseLang(undefined), "en");
  assert.equal(parseLang("pt-BR"), "pt-BR");
  assert.equal(parseLang("  zh-Hant  "), "zh-Hant");
  assert.throws(() => parseLang("en_US"), /'lang' must be a BCP-47/); // underscore isn't a tag char
  assert.throws(() => parseLang('en"><script'), /'lang' must be a BCP-47/);
  assert.throws(() => parseLang(5), /'lang' must be a BCP-47/);

  assert.equal(parseDir(undefined), "ltr");
  for (const d of ["ltr", "rtl", "auto"]) assert.equal(parseDir(d), d);
  assert.throws(() => parseDir("sideways"), /'dir' must be one of/);
});

test("parseRender: heavyMs + cache tuning, defaults and errors", () => {
  assert.equal(parseRender(undefined), null);
  assert.equal(parseRender(null), null);
  assert.equal(parseRender({}), null); // no recognised keys -> null (all defaults)
  // `features`/`format`/`fonts`/`fontFallback` are recognised nested keys (so
  // they don't fail the unknown-key check below) but are `custom: true` —
  // parseRender ignores them entirely; gen-schema.mjs reads them straight off
  // `config.render` itself (see the 'config-driven features, fonts' test and
  // 'format is emitted to the schema' test, further down, for the real
  // end-to-end behaviour). A render block containing ONLY one of these still
  // collapses to null, same as an empty `{}`.
  assert.equal(parseRender({ format: "stl", features: ["textmetrics"] }), null);
  assert.deepEqual(parseRender({ heavyMs: 8000 }), { heavyMs: 8000 });
  assert.deepEqual(
    parseRender({ heavyMs: 3000, cache: { maxEntries: 4, maxBytes: 1024, maxEntryBytes: 512, persistent: false } }),
    { heavyMs: 3000, cache: { maxEntries: 4, maxBytes: 1024, maxEntryBytes: 512, persistent: false } }
  );
  // Nulls inside cache are dropped; an all-null cache disappears.
  assert.deepEqual(parseRender({ cache: { maxEntries: null } }), null);
  // Bad shapes / values -> clear errors.
  assert.throws(() => parseRender([]), /'render' must be an object/);
  assert.throws(() => parseRender({ heavyMs: -1 }), /'render\.heavyMs' must be a non-negative number/);
  assert.throws(() => parseRender({ cache: 5 }), /'render\.cache' must be an object/);
  assert.throws(() => parseRender({ cache: { maxBytes: "lots" } }), /'render\.cache\.maxBytes' must be a non-negative number/);
  assert.throws(() => parseRender({ cache: { persistent: "yes" } }), /'render\.cache\.persistent' must be a boolean/);
  // Unknown keys -> rejected (newly enforced — used to be silently ignored),
  // one level down (render.cache) and at render's own level.
  assert.throws(
    () => parseRender({ cache: { oops: 1 } }),
    /'render\.cache': unknown key 'oops'\.\s*\n\s*Valid keys: maxEntries, maxBytes, maxEntryBytes, persistent/
  );
  assert.throws(
    () => parseRender({ oops: 1 }),
    /'render': unknown key 'oops'\.\s*\n\s*Valid keys: features, format, fonts, fontFallback, heavyMs, cache/
  );
});

test("parseStrings: absent -> {}, a known key overrides, an unknown key fails with a suggestion", () => {
  const validKeys = ["action.export", "action.share", "review.title"];
  assert.deepEqual(parseStrings(undefined, validKeys), {});
  assert.deepEqual(parseStrings(null, validKeys), {});
  assert.deepEqual(
    parseStrings({ "action.export": "Download now" }, validKeys),
    { "action.export": "Download now" }
  );
  assert.throws(() => parseStrings([], validKeys), /'strings' must be an object/);
  assert.throws(
    () => parseStrings({ "action.exprot": "x" }, validKeys),
    /unknown 'strings' key 'action.exprot'\.\s*\n\s*See src\/locales\/en\.json/
  );
  assert.throws(
    () => parseStrings({ "action.export": 5 }, validKeys),
    /'strings\.action\.export' must be a string/
  );
});

test("parseUi: saveImage is absent by default, carried only when set, rejects non-booleans", () => {
  // Default is "shown": the key is not defaulted onto the object, so the app's
  // `ui.saveImage !== false` treats absent as true.
  assert.equal(parseUi(undefined).saveImage, undefined);
  assert.equal(parseUi({}).saveImage, undefined);
  assert.equal(parseUi({ saveImage: false }).saveImage, false);
  assert.equal(parseUi({ saveImage: true }).saveImage, true);
  assert.throws(() => parseUi({ saveImage: "no" }), /'ui\.saveImage' must be a boolean/);
  assert.throws(() => parseUi({ saveImage: 0 }), /'ui\.saveImage' must be a boolean/);
});

test("parseUi.afterExport: true/{} means defaults, an options object sets helpTab", () => {
  // `title`/`body` used to live here; removed — see CONFIG_SPEC's
  // AFTER_EXPORT_SPEC comment — they were only a second override path for the
  // catalogue's exportSuccess.title/.body keys (src/locales/en.json).
  assert.equal(parseUi(undefined).afterExport, undefined);
  assert.equal(parseUi({}).afterExport, undefined);
  assert.deepEqual(parseUi({ afterExport: true }).afterExport, {});
  assert.deepEqual(parseUi({ afterExport: {} }).afterExport, {});
  assert.deepEqual(parseUi({ afterExport: { helpTab: "Printing" } }).afterExport, { helpTab: "Printing" });
});

test("parseUi.afterExport rejects empty/wrong-typed fields, unknown keys and wrong shapes", () => {
  assert.throws(
    () => parseUi({ afterExport: { helpTab: 3 } }),
    /'ui\.afterExport\.helpTab', when set, must be a non-empty string/
  );
  assert.throws(
    () => parseUi({ afterExport: { subtitle: "x" } }),
    /'ui\.afterExport': unknown key 'subtitle'\.\s*\n\s*Valid keys: helpTab/
  );
  assert.throws(
    () => parseUi({ afterExport: "on" }),
    /'ui\.afterExport' must be true, an options object, or null/
  );
  assert.throws(() => parseUi({ afterExport: [] }), /'ui\.afterExport' must be true, an options object, or null/);
});

test("parseUi.afterExport: null/false are treated the same as absent (no panel)", () => {
  assert.equal(parseUi({ afterExport: null }).afterExport, undefined);
  assert.equal(parseUi({ afterExport: false }).afterExport, undefined);
  assert.equal(parseAfterExport(null), undefined);
  assert.equal(parseAfterExport(false), undefined);
  assert.equal(parseAfterExport(undefined), undefined);
});

test("ui.afterExport.helpTab: build succeeds when it names a real help tab, alongside a 'strings' override of the panel copy", () => {
  const { schema } = run("widget-afterexport-ok.config.json");
  assert.equal(schema.ui.afterExport.helpTab, "Printing");
  assert.equal(schema.ui.afterExport.title, undefined);
  assert.equal(schema.ui.afterExport.body, undefined);
  // The fixture overrides the panel's copy through `strings` instead — the
  // ONE mechanism for overriding this text now, not a second afterExport path.
  assert.equal(schema.strings["exportSuccess.title"], "Done");
  assert.equal(schema.strings["exportSuccess.body"], "Slice it.");
});

test("ui.afterExport.helpTab: build succeeds against the synthetic leading 'Overview' tab", () => {
  const { schema } = run("widget-afterexport-overview.config.json");
  assert.equal(schema.ui.afterExport.helpTab, "Overview");
});

test("ui.afterExport.helpTab: build fails when no help tab has that label", () => {
  assert.throws(
    () => run("widget-afterexport-bad.config.json"),
    /'ui\.afterExport\.helpTab' is "Nope", but no 'help' tab has that label/
  );
});

test("ui.afterExport.helpTab: build fails with a clear message when the config has no help tabs at all", () => {
  assert.throws(
    () => run("widget-afterexport-notabs.config.json"),
    /'ui\.afterExport\.helpTab' is "Printing", but no 'help' tab has that label/
  );
});

test("parsePopup: defaults, modes, links and errors", () => {
  // Absent -> null (no popup).
  assert.equal(parsePopup(undefined), null);
  assert.equal(parsePopup(null), null);
  // Minimal form: mode defaults to "once".
  assert.deepEqual(parsePopup({ header: "Hi", body: "Welcome." }), {
    header: "Hi",
    body: "Welcome.",
    mode: "once",
  });
  // Every mode is accepted; body may carry Markdown links.
  for (const mode of ["always", "once", "dismissible"]) {
    assert.deepEqual(
      parsePopup({ header: "H", body: "See [docs](https://x).", mode }),
      { header: "H", body: "See [docs](https://x).", mode }
    );
  }
  // An optional custom button label passes through; absent -> omitted (the app
  // defaults to "OK").
  assert.deepEqual(
    parsePopup({ header: "H", body: "B", mode: "once", button: "Start designing" }),
    { header: "H", body: "B", mode: "once", button: "Start designing" }
  );
  assert.equal("button" in parsePopup({ header: "H", body: "B" }), false);
  // An optional footnote passes through the same way; absent -> omitted.
  assert.deepEqual(
    parsePopup({ header: "H", body: "B", mode: "once", footnote: "Nothing is uploaded." }),
    { header: "H", body: "B", mode: "once", footnote: "Nothing is uploaded." }
  );
  assert.equal("footnote" in parsePopup({ header: "H", body: "B" }), false);
  // Wrong shapes / missing required fields / bad mode / blank button/footnote -> clear errors.
  assert.throws(() => parsePopup([]), /'popup' must be an object/);
  assert.throws(() => parsePopup({ body: "x" }), /'popup\.header' is required/);
  assert.throws(() => parsePopup({ header: "x" }), /'popup\.body' is required/);
  assert.throws(() => parsePopup({ header: " ", body: "x" }), /'popup\.header' is required/);
  assert.throws(
    () => parsePopup({ header: "x", body: "y", mode: "sometimes" }),
    /'popup\.mode' must be one of/
  );
  assert.throws(
    () => parsePopup({ header: "x", body: "y", button: "  " }),
    /'popup\.button', when set, must be a non-empty string/
  );
  assert.throws(
    () => parsePopup({ header: "x", body: "y", footnote: "  " }),
    /'popup\.footnote', when set, must be a non-empty string/
  );
  // An explicit null on button/footnote used to throw (str()'s old default
  // treated null as present-but-invalid); now it's equivalent to omitting
  // the key, same as every other field.
  assert.equal("button" in parsePopup({ header: "x", body: "y", button: null }), false);
  assert.equal("footnote" in parsePopup({ header: "x", body: "y", footnote: null }), false);
  // Unknown key -> rejected (newly enforced — used to be silently ignored).
  assert.throws(
    () => parsePopup({ header: "x", body: "y", oops: true }),
    /'popup': unknown key 'oops'\.\s*\n\s*Valid keys: header, body, bodyFile, mode, button, footnote/
  );
});

test("popup.footnote: a full build carries it through to the generated schema", () => {
  const { schema } = run("widget-popup.config.json");
  assert.equal(schema.popup.footnote, "Everything runs in your browser. Nothing is uploaded.");
});

test("popup.bodyFile: the referenced file's contents become 'body'", () => {
  const { schema } = run("widget-popup-file.config.json");
  assert.equal(schema.popup.body, "Configure a widget.");
  assert.equal("bodyFile" in schema.popup, false);
});

test("popup: both 'body' and 'bodyFile' set fails the build, naming both", () => {
  assert.throws(
    () => run("widget-popup-file-conflict.config.json"),
    /both 'popup\.body' and 'popup\.bodyFile' are set/
  );
});

test("fileImport.noteFile: the referenced file's contents become 'note'", () => {
  const { schema } = run("widget-fileimport-file.config.json");
  assert.equal(schema.fileImport.note, "Import a font or SVG here.");
  assert.equal("noteFile" in schema.fileImport, false);
});

// resolveFileField backs popup.bodyFile / fileImport.noteFile /
// licenses[].textFile alike (see prose-files.mjs) — each call site below
// mirrors exactly how gen-schema.mjs's generate() wires it (same field/
// fileField/path), so a non-string or blank value must fail validation
// with the shared optional-string message BEFORE resolve()/readFileSync()
// ever sees it, instead of escaping as a raw Node ERR_INVALID_ARG_TYPE.
const refusingMustExist = () => {
  throw new Error("mustExist should not be called for an invalid file-field value");
};

test("resolveFileField: popup.bodyFile — a non-string value fails validation before resolving", () => {
  assert.throws(
    () =>
      resolveFileField({
        obj: { header: "Notice", bodyFile: 123 },
        field: "body",
        fileField: "bodyFile",
        CONFIG_DIR: "/cfg",
        mustExist: refusingMustExist,
        path: "popup",
      }),
    /'popup\.bodyFile', when set, must be a non-empty string/
  );
});

test("resolveFileField: popup.bodyFile — a blank value fails validation, not a confusing 'not found'", () => {
  assert.throws(
    () =>
      resolveFileField({
        obj: { header: "Notice", bodyFile: "   " },
        field: "body",
        fileField: "bodyFile",
        CONFIG_DIR: "/cfg",
        mustExist: refusingMustExist,
        path: "popup",
      }),
    /'popup\.bodyFile', when set, must be a non-empty string/
  );
});

test("resolveFileField: fileImport.noteFile — a non-string value fails validation before resolving", () => {
  assert.throws(
    () =>
      resolveFileField({
        obj: { noteFile: 42 },
        field: "note",
        fileField: "noteFile",
        CONFIG_DIR: "/cfg",
        mustExist: refusingMustExist,
        path: "fileImport",
      }),
    /'fileImport\.noteFile', when set, must be a non-empty string/
  );
});

test("resolveFileField: fileImport.noteFile — a blank value fails validation before resolving", () => {
  assert.throws(
    () =>
      resolveFileField({
        obj: { noteFile: "   " },
        field: "note",
        fileField: "noteFile",
        CONFIG_DIR: "/cfg",
        mustExist: refusingMustExist,
        path: "fileImport",
      }),
    /'fileImport\.noteFile', when set, must be a non-empty string/
  );
});

test("resolveFileField: licenses[].textFile — a non-string value fails validation before resolving", () => {
  assert.throws(
    () =>
      resolveFileField({
        obj: { textFile: 7 },
        field: "text",
        fileField: "textFile",
        CONFIG_DIR: "/cfg",
        mustExist: refusingMustExist,
        path: "licenses[0]",
      }),
    /'licenses\[0\]\.textFile', when set, must be a non-empty string/
  );
});

test("resolveFileField: licenses[].textFile — a blank value fails validation before resolving", () => {
  assert.throws(
    () =>
      resolveFileField({
        obj: { textFile: "   " },
        field: "text",
        fileField: "textFile",
        CONFIG_DIR: "/cfg",
        mustExist: refusingMustExist,
        path: "licenses[0]",
      }),
    /'licenses\[0\]\.textFile', when set, must be a non-empty string/
  );
});

test("parseEnumHint ignores single-item and non-enum hints", () => {
  assert.equal(parseEnumHint("only"), null);
  assert.deepEqual(parseEnumHint("a, b"), [
    { value: "a", label: "a" },
    { value: "b", label: "b" },
  ]);
});

// --- Font handling (availability check, fallback rule) ---

// parseParams reads a real file, so write a tiny .scad to a temp dir.
function paramsOf(scad) {
  const dir = mkdtempSync(join(tmpdir(), "gen-schema-font-"));
  const file = join(dir, "f.scad");
  writeFileSync(file, scad);
  try {
    return parseParams(file).params;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Same as paramsOf, but returns the FULL parseParams() result — needed for
// file-level metadata (`@description`/`@icon`/`@reviewNote`/…) assertions,
// which live on `.meta` rather than `.params`.
function parseOf(scad) {
  const dir = mkdtempSync(join(tmpdir(), "gen-schema-font-"));
  const file = join(dir, "f.scad");
  writeFileSync(file, scad);
  try {
    return parseParams(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("only a string or enum param with an explicit @font is flagged isFont", () => {
  const params = paramsOf(
    `/* [Main] */\n` +
      `// Body face.\n` +
      `// @font\n` +
      `body = "Some Family";\n` +
      `// A conventional name is NOT auto-detected — annotation is required.\n` +
      `font = "Liberation Sans:style=Bold";\n` +
      `// Heading face.\n` +
      `label_font = "Mono";\n` +
      `// A @font on a dropdown keeps the enum and is flagged for the font check.\n` +
      `// @font\n` +
      `picker = "A"; // ["A", "B"]\n` +
      `// A dropdown without @font is a plain enum.\n` +
      `mode = "x"; // ["x", "y"]\n`
  );
  const byName = Object.fromEntries(params.map((p) => [p.name, p]));
  assert.equal(byName.body.isFont, true); // `@font` annotation on a string param
  // The @font line is consumed, not leaked into the help/label text.
  assert.ok(!byName.body.help.includes("@font"));
  // No annotation -> not flagged, regardless of the parameter name.
  assert.equal(byName.font.isFont, undefined);
  assert.equal(byName.label_font.isFont, undefined);
  // @font on an enum dropdown keeps the enum type AND flags it, so a design can
  // keep the desktop Customizer dropdown and still get the in-app font check.
  assert.equal(byName.picker.type, "enum");
  assert.equal(byName.picker.isFont, true);
  // A dropdown without @font stays an unflagged plain enum.
  assert.equal(byName.mode.type, "enum");
  assert.equal(byName.mode.isFont, undefined);
});

test("@info marks a param for the viewer panel, with optional label + unit", () => {
  const params = paramsOf(
    `/* [Main] */\n` +
      `// Engraved text.\n` +
      `// @info\n` +
      `label = "Hi";\n` +
      `// Font height.\n` +
      `// @info Text height | mm\n` +
      `text_size = 9; // [3:0.5:30]\n` +
      `// Plain param, no annotation.\n` +
      `width = 10; // [1:1:50]\n` +
      `// Custom label only.\n` +
      `// @info Diameter\n` +
      `dia = 5;\n`
  );
  const byName = Object.fromEntries(params.map((p) => [p.name, p]));
  // Bare `@info`: flagged, label/unit null (UI falls back to the description).
  assert.deepEqual(byName.label.info, { label: null, unit: null });
  // The annotation line is consumed, not leaked into the help/label text.
  assert.ok(!byName.label.help.includes("@info"));
  assert.equal(byName.label.description, "Engraved text.");
  // Custom label + unit, split on the single pipe.
  assert.deepEqual(byName.text_size.info, { label: "Text height", unit: "mm" });
  // Custom label only.
  assert.deepEqual(byName.dia.info, { label: "Diameter", unit: null });
  // No annotation -> no info field.
  assert.equal(byName.width.info, undefined);
});

test("@review sets a parameter's review-summary label; the quoted label is required", () => {
  const params = paramsOf(
    `/* [Main] */\n` +
      `// Engraved text.\n` +
      `// @review "Text"\n` +
      `label = "hi";\n` +
      `// Plain param, no annotation.\n` +
      `width = 10;\n`
  );
  const byName = Object.fromEntries(params.map((p) => [p.name, p]));
  assert.equal(byName.label.reviewLabel, "Text");
  // The annotation line is consumed, not leaked into the help/label text.
  assert.ok(!byName.label.help.includes("@review"));
  assert.equal(byName.label.description, "Engraved text.");
  // No annotation -> no reviewLabel field.
  assert.equal(byName.width.reviewLabel, undefined);
});

test("@label overrides the first-sentence control label and keeps the doc block as help", () => {
  const params = paramsOf(
    `/* [Main] */\n` +
      `// Choose the language and Braille standard for this sign.\n` +
      `// @label "Language & standard"\n` +
      `locale = "de";\n` +
      `// Plain param, no annotation.\n` +
      `width = 10;\n`
  );
  const byName = Object.fromEntries(params.map((p) => [p.name, p]));
  assert.equal(byName.locale.description, "Language & standard");
  // The explanation isn't lost — it stays as help, so ParamForm's ⓘ popover
  // still offers it (it only mounts when help differs from the label).
  assert.equal(byName.locale.help, "Choose the language and Braille standard for this sign.");
  // The annotation line is consumed, not leaked into the help/label text.
  assert.ok(!byName.locale.help.includes("@label"));
  // No annotation -> the first-sentence default still applies.
  assert.equal(byName.width.description, "Plain param, no annotation.");
});

test("@label requires a non-empty quoted label", () => {
  assert.throws(
    () => paramsOf(`/* [Main] */\n// Doc.\n// @label ""\nlabel = "hi";\n`),
    /@label annotation must have a non-empty quoted label/
  );
  // Unquoted is a malformed use of a KNOWN keyword, not an unknown annotation.
  assert.throws(
    () => paramsOf(`/* [Main] */\n// Doc.\n// @label Short\nlabel = "hi";\n`),
    /malformed @label annotation/
  );
});

test("@reviewNote sets a design's review-summary note; first occurrence wins, blank is ignored", () => {
  const { meta } = parseOf(
    `// @reviewNote "First note."\n` +
      `// @reviewNote "Second note (ignored)."\n` +
      `/* [Main] */\n` +
      `label = "hi";\n`
  );
  assert.equal(meta.reviewNote, "First note.");

  const blank = parseOf(`// @reviewNote ""\n/* [Main] */\nlabel = "hi";\n`);
  assert.equal(blank.meta.reviewNote, null);
});

test("@svg marks a string field for the wizard and captures the layers binding", () => {
  const params = paramsOf(
    `/* [Source] */\n` +
      `// The drawing to extrude.\n` +
      `// @svg layers=parts_layers\n` +
      `svg_file = "examples/plan.svg";\n` +
      `// Colours per region, filled by the wizard.\n` +
      `// @filledBy svg_file\n` +
      `parts_layers = "";\n` +
      `// A plain SVG field with no colour binding.\n` +
      `// @svg\n` +
      `icon_file = "examples/icon.svg";\n` +
      `// A plain string, no annotation.\n` +
      `note = "hello";\n`
  );
  const byName = Object.fromEntries(params.map((p) => [p.name, p]));
  // `@svg layers=<param>` captures the binding on a string param.
  assert.deepEqual(byName.svg_file.svg, { layers: "parts_layers", height: null });
  // The annotation line is consumed, not leaked into the help/label text.
  assert.ok(!byName.svg_file.help.includes("@svg"));
  assert.equal(byName.svg_file.description, "The drawing to extrude.");
  // Bare `@svg` (no binding) => layers is null.
  assert.deepEqual(byName.icon_file.svg, { layers: null, height: null });
  // `@filledBy` names the source @svg field and stays a normal (editable) param.
  assert.equal(byName.parts_layers.filledBy, "svg_file");
  assert.ok(!byName.parts_layers.help.includes("@filledBy"));
  // No annotation -> no svg / filledBy fields.
  assert.equal(byName.note.svg, undefined);
  assert.equal(byName.note.filledBy, undefined);
});

// ── M9: annotation grammar + cross-parameter validation ────────────────────

test("an unknown annotation keyword (typo) fails with file and line", () => {
  assert.throws(
    () => paramsOf(`/* [S] */\n// @shwoIf foo\nbar = 1;\n`),
    /f\.scad:2: unknown annotation '@shwoIf'/
  );
});

test("@showIf rejects an unsupported operator at generate time (not a silent always-hidden falsy lookup)", () => {
  assert.throws(
    () => paramsOf(`/* [S] */\nbar = 1;\n// @showIf bar > 0\nfoo = 1;\n`),
    /f\.scad:3: unsupported @showIf clause 'bar > 0'/
  );
  assert.throws(
    () => paramsOf(`/* [S] */\nbar = 1;\n// @showIf bar ~= 0\nfoo = 1;\n`),
    /f\.scad:3: unsupported @showIf clause/
  );
});

test("@showIf referencing an unknown parameter fails with file and line", () => {
  assert.throws(
    () => paramsOf(`/* [S] */\n// @showIf nope\nfoo = 1;\n`),
    /f\.scad:2: @showIf on 'foo' references unknown parameter 'nope'/
  );
});

test("an unknown @svg option fails instead of being accepted as a bare annotation", () => {
  assert.throws(
    () => paramsOf(`/* [S] */\n// @svg foo=bar\nsvg_file = "a.svg";\n`),
    /f\.scad:2: unknown @svg option 'foo=bar'/
  );
});

test("@svg height= binds the number a region's relief height defaults to", () => {
  const params = paramsOf(
    `/* [Source] */\n` +
      `// How far the relief stands proud.\n` +
      `relief = 1.5;\n` +
      `// The drawing to extrude.\n` +
      `// @svg height=relief layers=parts_layers\n` +
      `svg_file = "examples/plan.svg";\n` +
      `// Colours per region, filled by the wizard.\n` +
      `// @filledBy svg_file\n` +
      `parts_layers = "";\n`
  );
  const byName = Object.fromEntries(params.map((p) => [p.name, p]));
  // Both options are captured, in either order.
  assert.deepEqual(byName.svg_file.svg, { layers: "parts_layers", height: "relief" });
  assert.ok(!byName.svg_file.help.includes("@svg"));
});

test("@svg height= must name a real number parameter, and no option may repeat", () => {
  assert.throws(
    () => paramsOf(`/* [S] */\n// @svg height=nope\nsvg_file = "a.svg";\n`),
    /@svg height=nope on 'svg_file' references unknown parameter 'nope'/
  );
  assert.throws(
    () =>
      paramsOf(
        `/* [S] */\nlabel = "hi";\n// @svg height=label\nsvg_file = "a.svg";\n`
      ),
    /@svg height=label on 'svg_file' must reference a number parameter/
  );
  assert.throws(
    () => paramsOf(`/* [S] */\nh = 1;\n// @svg height=h height=h\nsvg_file = "a.svg";\n`),
    /f\.scad:3: @svg option 'height=' is given twice/
  );
});

test("a malformed @filledBy (no target) fails with file and line", () => {
  assert.throws(
    () => paramsOf(`/* [S] */\n// @filledBy\nlayers_param = "";\n`),
    /f\.scad:2: malformed @filledBy annotation/
  );
});

test("a malformed @review (no quoted label, or unquoted text) fails with file and line", () => {
  assert.throws(
    () => paramsOf(`/* [S] */\n// @review\nfoo = 1;\n`),
    /f\.scad:2: malformed @review annotation/
  );
  assert.throws(
    () => paramsOf(`/* [S] */\n// @review Text\nfoo = 1;\n`),
    /f\.scad:2: malformed @review annotation/
  );
});

test("@review with a blank quoted label fails with file and line", () => {
  assert.throws(
    () => paramsOf(`/* [S] */\n// @review ""\nfoo = 1;\n`),
    /f\.scad:2: @review annotation must have a non-empty quoted label/
  );
});

test("a malformed @reviewNote (missing quotes) fails with file and line", () => {
  assert.throws(
    () => parseOf(`// @reviewNote no quotes here\n/* [S] */\nfoo = 1;\n`),
    /f\.scad:1: malformed @reviewNote annotation/
  );
});

test("@svg layers= referencing a missing parameter fails with file and line", () => {
  assert.throws(
    () => paramsOf(`/* [S] */\n// @svg layers=missing\nsvg_file = "a.svg";\n`),
    /f\.scad:2: @svg layers=missing on 'svg_file' references unknown parameter 'missing'/
  );
});

test("@svg layers= referencing a wrong-typed (non-string) parameter fails", () => {
  assert.throws(
    () => paramsOf(`/* [S] */\n// @svg layers=count\nsvg_file = "a.svg";\ncount = 5;\n`),
    /f\.scad:2: @svg layers=count on 'svg_file' must reference a string parameter \(got 'count' of type number\)/
  );
});

test("@svg layers= missing its reciprocal @filledBy fails", () => {
  assert.throws(
    () => paramsOf(`/* [S] */\n// @svg layers=parts\nsvg_file = "a.svg";\nparts = "";\n`),
    /f\.scad:2: @svg layers=parts on 'svg_file' has no reciprocal '\/\/ @filledBy svg_file' on 'parts'/
  );
});

test("@filledBy referencing a parameter with no @svg annotation fails", () => {
  assert.throws(
    () => paramsOf(`/* [S] */\n// @filledBy plain\nparts = "";\nplain = "x";\n`),
    /f\.scad:2: @filledBy plain on 'parts' references 'plain', which has no '@svg' annotation/
  );
});

test("two @svg fields duplicating the same layers= target fail with file and line", () => {
  assert.throws(
    () =>
      paramsOf(
        `/* [S] */\n` +
          `// @svg layers=shared\n` +
          `a_file = "a.svg";\n` +
          `// @svg layers=shared\n` +
          `b_file = "b.svg";\n` +
          `// @filledBy a_file\n` +
          `shared = "";\n`
      ),
    /f\.scad:4: @svg layers=shared on 'b_file' duplicates the binding already declared by 'a_file'/
  );
});

test("a self-referential @svg layers= binding is rejected as cyclic", () => {
  assert.throws(
    () => paramsOf(`/* [S] */\n// @svg layers=svg_file\nsvg_file = "a.svg";\n`),
    /f\.scad:2: @svg layers=svg_file on 'svg_file' is cyclic: it targets itself/
  );
});

test("a self-referential @filledBy binding is rejected as cyclic", () => {
  assert.throws(
    () => paramsOf(`/* [S] */\n// @filledBy loop\nloop = "";\n`),
    /f\.scad:2: @filledBy loop on 'loop' is cyclic: it targets itself/
  );
});

test("@svg / @filledBy on a non-string parameter fails instead of silently dropping the annotation", () => {
  assert.throws(
    () => paramsOf(`/* [S] */\n// @svg\ncount = 5;\n`),
    /f\.scad:2: @svg on 'count' must be a string parameter \(got type number\)/
  );
  assert.throws(
    () => paramsOf(`/* [S] */\n// @filledBy svg_file\ncount = 5;\n// @svg layers=count\nsvg_file = "a.svg";\n`),
    /f\.scad:2: @filledBy on 'count' must be a string parameter \(got type number\)/
  );
});

test("the well-formed @svg/@filledBy fixture (existing test above) still passes full annotation validation", () => {
  // Sanity: the reciprocal-binding validator doesn't reject the documented,
  // correctly-paired usage from docs/annotations.md.
  assert.doesNotThrow(() =>
    paramsOf(
      `/* [Source] */\n` +
        `// @svg layers=svg_layers\n` +
        `svg_file = "plan.svg";\n` +
        `// @filledBy svg_file\n` +
        `svg_layers = "";\n`
    )
  );
});

// ── @editOnModel (on-model editable text) ──────────────────────────────────

test("@editOnModel flags a plain string param and is consumed, not leaked", () => {
  const params = paramsOf(
    `/* [Text] */\n` +
      `// Text to emboss on the tag.\n` +
      `// @editOnModel\n` +
      `label = "ScadPub";\n` +
      `// A plain string with no annotation.\n` +
      `note = "hi";\n`
  );
  const byName = Object.fromEntries(params.map((p) => [p.name, p]));
  assert.equal(byName.label.editOnModel, true);
  assert.equal(byName.label.type, "string");
  // The annotation line is consumed, not leaked into the help/label text.
  assert.ok(!byName.label.help.includes("@editOnModel"));
  assert.equal(byName.label.description, "Text to emboss on the tag.");
  // No annotation -> not flagged.
  assert.equal(byName.note.editOnModel, undefined);
});

test("@editOnModel on a non-string parameter fails with file and line", () => {
  // number
  assert.throws(
    () => paramsOf(`/* [S] */\n// @editOnModel\nsize = 5;\n`),
    /f\.scad:2: @editOnModel on 'size' must be a string parameter \(got type number\)/
  );
  // boolean
  assert.throws(
    () => paramsOf(`/* [S] */\n// @editOnModel\nflag = true;\n`),
    /f\.scad:2: @editOnModel on 'flag' must be a string parameter \(got type boolean\)/
  );
});

test("@editOnModel on an enum (dropdown) parameter fails", () => {
  assert.throws(
    () => paramsOf(`/* [S] */\n// @editOnModel\nmode = "a"; // [a, b, c]\n`),
    /f\.scad:2: @editOnModel on 'mode' must be a string parameter \(got type enum\)/
  );
});

test("@editOnModel on a @font parameter fails (a font string isn't editable on the model)", () => {
  assert.throws(
    () =>
      paramsOf(
        `/* [S] */\n` +
          `// @font\n` +
          `// @editOnModel\n` +
          `font = "Liberation Sans:style=Bold";\n`
      ),
    /f\.scad:3: @editOnModel on 'font' cannot be a font parameter/
  );
});

test("@editOnModel declared on two params fails, naming the first owner", () => {
  assert.throws(
    () =>
      paramsOf(
        `/* [Text] */\n` +
          `// @editOnModel\n` +
          `label = "a";\n` +
          `// @editOnModel\n` +
          `subtitle = "b";\n`
      ),
    /f\.scad:4: @editOnModel is already declared on 'label'; only one parameter per design may be @editOnModel/
  );
});

test("a bare @editOnModel with trailing text fails as a malformed annotation", () => {
  assert.throws(
    () => paramsOf(`/* [S] */\n// @editOnModel please\nlabel = "a";\n`),
    /f\.scad:2: malformed @editOnModel annotation/
  );
});

test("parseFontFallback accepts a trimmed string or null; rejects empty", () => {
  assert.equal(parseFontFallback(undefined), null);
  assert.equal(parseFontFallback(null), null);
  assert.equal(parseFontFallback("  Liberation Mono  "), "Liberation Mono");
  assert.throws(() => parseFontFallback(""), /'render\.fontFallback' must be a non-empty string/);
  assert.throws(() => parseFontFallback(42), /'render\.fontFallback' must be a non-empty string/);
});

test("parseStringArray: absent or null -> [], every entry must be a non-empty string", () => {
  assert.deepEqual(parseStringArray(undefined, "features"), []);
  // `null` reads as "unset" too, same as every other render/pwa field (see
  // applyGroupSpec) — it used to only check `undefined` and threw instead.
  assert.deepEqual(parseStringArray(null, "render.features"), []);
  assert.deepEqual(parseStringArray(null, "pwa.categories"), []);
  assert.deepEqual(parseStringArray(["a", "b"], "features"), ["a", "b"]);
  assert.throws(() => parseStringArray("a", "features"), /'features' must be an array of non-empty strings/);
  assert.throws(() => parseStringArray([""], "features"), /'features' must be an array of non-empty strings/);
  assert.throws(() => parseStringArray([1], "categories"), /'categories' must be an array of non-empty strings/);
});

test("parsePwaThemeColor: string shorthand sets both themes; object form defaults each side independently", () => {
  assert.deepEqual(parsePwaThemeColor(undefined), { light: "#ffffff", dark: "#1f2229" });
  assert.deepEqual(parsePwaThemeColor(null), { light: "#ffffff", dark: "#1f2229" });
  assert.deepEqual(parsePwaThemeColor("#123456"), { light: "#123456", dark: "#123456" });
  assert.deepEqual(parsePwaThemeColor({ dark: "#000000" }), { light: "#ffffff", dark: "#000000" });
  assert.deepEqual(parsePwaThemeColor({ light: "#f0f0f0", dark: "#000000" }), { light: "#f0f0f0", dark: "#000000" });
  assert.throws(
    () => parsePwaThemeColor("#fff;}<script>"),
    /'pwa\.themeColor' must be a CSS colour string/
  );
  assert.throws(
    () => parsePwaThemeColor({ dark: "#fff;}<script>" }),
    /'pwa\.themeColor\.dark' must be a CSS colour string/
  );
  assert.throws(
    () => parsePwaThemeColor({ bogus: "#000000" }),
    /'pwa\.themeColor': unknown key 'bogus'\.\s*\n\s*Valid keys: light, dark/
  );
  assert.throws(
    () => parsePwaThemeColor(5),
    /'pwa\.themeColor' must be a CSS colour string, or an object with optional 'light'\/'dark' colour strings/
  );
});

test("renderFontsConf emits the base dirs, and a weak fallback only when set", () => {
  const base = renderFontsConf(null);
  assert.ok(base.includes("<dir>/fonts</dir>"));
  assert.ok(base.includes("<cachedir>/fontconfig-cache</cachedir>"));
  assert.ok(!base.includes("<match"));

  const withFallback = renderFontsConf("Liberation Mono");
  assert.ok(withFallback.includes('<edit name="family" mode="append_last" binding="weak">'));
  assert.ok(withFallback.includes("<string>Liberation Mono</string>"));

  // The family is XML-escaped so it can't break out of the rule.
  assert.ok(renderFontsConf("A & B").includes("<string>A &amp; B</string>"));
});

test("a real build records the bundled fonts' embedded families + writes fonts.conf", () => {
  // A real build (outPublicDir present) copies each bundled font into the served
  // tree and parses its embedded family. Build a self-contained source dir with a
  // real TTF so the copy + parse path is exercised end-to-end.
  const REAL_TTF = join(HERE, "..", "public", "fonts", "LiberationSans-Regular.ttf");
  const src = mkdtempSync(join(tmpdir(), "gen-schema-src-"));
  const out = mkdtempSync(join(tmpdir(), "gen-schema-pub-"));
  writeFileSync(join(src, "d.scad"), `/* [Main] */\n// Font.\nfont = "Liberation Sans";\n`);
  copyFileSync(REAL_TTF, join(src, "Face.ttf"));
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({
      title: "T",
      source: ".",
      render: { fonts: ["Face.ttf"], fontFallback: "Liberation Sans" },
      designs: [{ id: "d", label: "D" }],
    })
  );
  const schema = generate({
    configPath: join(src, "c.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "public", "scad"),
    outPublicDir: join(out, "public"),
  });
  assert.deepEqual(schema.fontFamilies, ["Liberation Sans"]);
  // The face description ({ family, style }) rides along for the app's font
  // selector — REAL_TTF is the Liberation Sans regular face.
  assert.deepEqual(schema.fontFaces, [{ family: "Liberation Sans", style: "Regular" }]);
  // fonts.conf is generated into the served tree, with the configured fallback.
  const conf = readFileSync(join(out, "public", "fonts", "fonts.conf"), "utf-8");
  assert.ok(conf.includes("<string>Liberation Sans</string>"));
});

// ── M9: the transient-external-font-copy warning ────────────────────────────
// isRiskyExternalFontCopy is the boolean gen-schema.mjs's bundleFonts warns on
// (see its own comment). `git` is injected so these drive the decision
// without a real subprocess or a real git checkout on disk.

test("isRiskyExternalFontCopy: no git repo at outPublicDir -> false", () => {
  const git = () => ""; // `git rev-parse --show-toplevel` fails everywhere
  assert.equal(isRiskyExternalFontCopy("/some/public", "/elsewhere/Font.ttf", git), false);
});

test("isRiskyExternalFontCopy: detached HEAD (a disposable build clone) -> false", () => {
  // Mirrors tools/build-site.sh in a consumer repo: `git checkout --detach`
  // into a gitignored ScadPub clone built purely to build against ITS OWN
  // config. `git symbolic-ref` fails on a detached HEAD.
  const git = (dir, args) =>
    args[0] === "rev-parse" ? "/checkout" : "";
  assert.equal(isRiskyExternalFontCopy("/checkout/public", "/elsewhere/Font.ttf", git), false);
});

test("isRiskyExternalFontCopy: attached branch + font from inside the checkout -> false", () => {
  // A design bundling a new font from within ScadPub's own source tree (not
  // yet copied to public/fonts) is an ordinary same-repo change to commit,
  // not a stray deployment artifact.
  const git = (dir, args) =>
    args[0] === "rev-parse" ? "/checkout" : "main";
  assert.equal(
    isRiskyExternalFontCopy("/checkout/public", "/checkout/examples/Font.ttf", git),
    false
  );
});

test("isRiskyExternalFontCopy: attached branch + font from outside the checkout -> true", () => {
  const git = (dir, args) =>
    args[0] === "rev-parse" ? "/checkout" : "main";
  assert.equal(
    isRiskyExternalFontCopy("/checkout/public", "/elsewhere/Font.ttf", git),
    true
  );
});

test("bundleFonts warns exactly once, naming the font, when a real build copies an external font from an actively-developed checkout", () => {
  // Drives the real generate() -> bundleFonts path (not just the boolean).
  // isRiskyExternalFontCopy shells out to git itself (no seam to inject a
  // stub through generate()), so this test builds its OWN throwaway git
  // checkout — an `outPublicDir` inside a fresh `git init` repo with an
  // attached HEAD — rather than pointing outPublicDir at this repo's real
  // public/ dir, which would risk writing a font into the actual checkout
  // under test.
  const checkout = mkdtempSync(join(tmpdir(), "gen-schema-extfont-checkout-"));
  execFileSync("git", ["init", "-q", checkout]);
  const outPublicDir = join(checkout, "public");
  mkdirSync(outPublicDir, { recursive: true });

  const src = mkdtempSync(join(tmpdir(), "gen-schema-extfont-src-")); // outside `checkout`
  const REAL_TTF = join(HERE, "..", "public", "fonts", "LiberationSans-Regular.ttf");
  writeFileSync(join(src, "d.scad"), `/* [Main] */\n// Font.\nfont = "Liberation Sans";\n`);
  copyFileSync(REAL_TTF, join(src, "Face.ttf"));
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({
      title: "T",
      source: ".",
      render: { fonts: ["Face.ttf"], fontFallback: "Liberation Sans" },
      designs: [{ id: "d", label: "D" }],
    })
  );

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    generate({
      configPath: join(src, "c.config.json"),
      outSchemaDir: join(checkout, "schema"),
      outScadDir: join(checkout, "scad"),
      outPublicDir,
    });
  } finally {
    console.warn = originalWarn;
  }
  const hits = warnings.filter((w) => w.includes("Face.ttf"));
  assert.equal(
    hits.length,
    1,
    `expected exactly one warning naming Face.ttf, got: ${JSON.stringify(warnings)}`
  );
  assert.ok(hits[0].includes("transient"));
  assert.ok(hits[0].includes("git add"));
});

test("bundleFonts does not warn when the destination checkout's HEAD is detached (a disposable build clone)", () => {
  // Mirrors tools/build-site.sh in a consumer repo: a ScadPub clone checked
  // out `--detach`, built purely to build against the consumer's OWN config.
  const checkout = mkdtempSync(join(tmpdir(), "gen-schema-extfont-detached-"));
  execFileSync("git", ["init", "-q", checkout]);
  execFileSync("git", [
    "-C",
    checkout,
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=Test",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  ]);
  execFileSync("git", ["-C", checkout, "checkout", "-q", "--detach", "HEAD"]);
  const outPublicDir = join(checkout, "public");
  mkdirSync(outPublicDir, { recursive: true });

  const src = mkdtempSync(join(tmpdir(), "gen-schema-extfont-src2-"));
  const REAL_TTF = join(HERE, "..", "public", "fonts", "LiberationSans-Regular.ttf");
  writeFileSync(join(src, "d.scad"), `/* [Main] */\n// Font.\nfont = "Liberation Sans";\n`);
  copyFileSync(REAL_TTF, join(src, "Face.ttf"));
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({
      title: "T",
      source: ".",
      render: { fonts: ["Face.ttf"], fontFallback: "Liberation Sans" },
      designs: [{ id: "d", label: "D" }],
    })
  );

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    generate({
      configPath: join(src, "c.config.json"),
      outSchemaDir: join(checkout, "schema"),
      outScadDir: join(checkout, "scad"),
      outPublicDir,
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.filter((w) => w.includes("Face.ttf")).length, 0);
});

// ── H5: symlink containment ────────────────────────────────────────────────
// Symlinks are built at test runtime (fs.symlinkSync) into a fresh temp
// source tree rather than committed, per the review's guidance.

test("a file symlink resolving outside SOURCE fails the build", () => {
  const root = mkdtempSync(join(tmpdir(), "gen-schema-symlink-"));
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  const outside = join(root, "outside");
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "secret.scad"), "function secret() = 1;\n");
  writeFileSync(join(src, "design.scad"), `/* [Main] */\nuse <linked.scad>\nx = 1;\n`);
  symlinkSync(join(outside, "secret.scad"), join(src, "linked.scad"));
  writeFileSync(
    join(root, "c.config.json"),
    JSON.stringify({ title: "T", source: "src", designs: [{ id: "design", label: "D" }] })
  );
  assert.throws(
    () =>
      generate({
        configPath: join(root, "c.config.json"),
        outSchemaDir: join(root, "out", "schema"),
        outScadDir: join(root, "out", "scad"),
      }),
    /escapes the source root/
  );
});

test("a directory symlink resolving outside SOURCE fails the build", () => {
  const root = mkdtempSync(join(tmpdir(), "gen-schema-symlink-"));
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "design.scad"), `/* [Main] */\nx = 1;\n`);
  const outsideLib = join(root, "outside-lib");
  mkdirSync(outsideLib, { recursive: true });
  writeFileSync(join(outsideLib, "core.scad"), "function core() = 1;\n");
  symlinkSync(outsideLib, join(src, "lib"), "dir");
  writeFileSync(
    join(root, "c.config.json"),
    JSON.stringify({
      title: "T",
      source: "src",
      assets: ["lib"],
      designs: [{ id: "design", label: "D" }],
    })
  );
  assert.throws(
    () =>
      generate({
        configPath: join(root, "c.config.json"),
        outSchemaDir: join(root, "out", "schema"),
        outScadDir: join(root, "out", "scad"),
      }),
    /escapes the source root/
  );
});

test("in-root symlinks (file and directory) work, mounted at their lexical path", () => {
  const root = mkdtempSync(join(tmpdir(), "gen-schema-symlink-"));
  const src = join(root, "src");
  mkdirSync(join(src, "real"), { recursive: true });
  writeFileSync(join(src, "real", "util.scad"), "function util() = 42;\n");
  writeFileSync(join(src, "design.scad"), `/* [Main] */\nx = 1;\n`);
  // A directory symlink under SOURCE, resolving to another directory still
  // under SOURCE.
  symlinkSync(join(src, "real"), join(src, "alias"), "dir");
  // A file symlink under SOURCE, resolving to a file still under SOURCE.
  symlinkSync(join(src, "real", "util.scad"), join(src, "shortcut.scad"));
  writeFileSync(
    join(root, "c.config.json"),
    JSON.stringify({
      title: "T",
      source: "src",
      assets: ["alias", "shortcut.scad"],
      designs: [{ id: "design", label: "D" }],
    })
  );
  const out = join(root, "out");
  const schema = generate({
    configPath: join(root, "c.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "scad"),
  });
  // Destinations mirror the symlink's own (lexical) location, not the
  // resolved target's location.
  assert.deepEqual(schema.assets, ["alias/util.scad", "shortcut.scad"]);
  assert.equal(
    readFileSync(join(out, "scad", "alias", "util.scad"), "utf-8"),
    "function util() = 42;\n"
  );
  assert.equal(
    readFileSync(join(out, "scad", "shortcut.scad"), "utf-8"),
    "function util() = 42;\n"
  );
});

test("a glob emits every distinct lexical path, even when a symlink aliases an already-walked directory", () => {
  const root = mkdtempSync(join(tmpdir(), "gen-schema-alias-"));
  const src = join(root, "src");
  mkdirSync(join(src, "real"), { recursive: true });
  writeFileSync(join(src, "real", "util.scad"), "function util() = 42;\n");
  writeFileSync(join(src, "design.scad"), `/* [Main] */\nx = 1;\n`);
  // 'alias' resolves to the same real directory as 'real'. A realpath-keyed
  // global visited set would emit only whichever of real/ or alias/ the walk
  // reached first (order-dependent); a design importing the omitted lexical
  // path would then fail at render time. Both must be emitted.
  symlinkSync(join(src, "real"), join(src, "alias"), "dir");
  writeFileSync(
    join(root, "c.config.json"),
    JSON.stringify({
      title: "T",
      source: "src",
      assets: ["**/util.scad"], // matches BOTH real/util.scad and alias/util.scad
      designs: [{ id: "design", label: "D" }],
    })
  );
  const out = join(root, "out");
  const schema = generate({
    configPath: join(root, "c.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "scad"),
  });
  assert.ok(schema.assets.includes("real/util.scad"), `got: ${JSON.stringify(schema.assets)}`);
  assert.ok(schema.assets.includes("alias/util.scad"), `got: ${JSON.stringify(schema.assets)}`);
  assert.ok(existsSync(join(out, "scad", "real", "util.scad")));
  assert.ok(existsSync(join(out, "scad", "alias", "util.scad")));
});

test("a symlink cycle through a directory's own descendant fails cleanly", () => {
  const root = mkdtempSync(join(tmpdir(), "gen-schema-symlink-"));
  const src = join(root, "src");
  mkdirSync(join(src, "a"), { recursive: true });
  writeFileSync(join(src, "a", "f.scad"), "function f() = 1;\n");
  writeFileSync(join(src, "design.scad"), `/* [Main] */\nx = 1;\n`);
  // 'loop' inside 'a' points back at 'a' itself: walking it never terminates
  // without cycle detection.
  symlinkSync(join(src, "a"), join(src, "a", "loop"), "dir");
  writeFileSync(
    join(root, "c.config.json"),
    JSON.stringify({
      title: "T",
      source: "src",
      assets: ["a"],
      designs: [{ id: "design", label: "D" }],
    })
  );
  assert.throws(
    () =>
      generate({
        configPath: join(root, "c.config.json"),
        outSchemaDir: join(root, "out", "schema"),
        outScadDir: join(root, "out", "scad"),
      }),
    /symlink cycle/
  );
});

test("a symlink pointing at itself (ELOOP) fails cleanly during directory traversal", () => {
  const root = mkdtempSync(join(tmpdir(), "gen-schema-symlink-"));
  const src = join(root, "src");
  mkdirSync(join(src, "a"), { recursive: true });
  writeFileSync(join(src, "design.scad"), `/* [Main] */\nx = 1;\n`);
  // A relative symlink named 'sub' whose target is the literal string 'sub'
  // — resolves to itself, so realpath() must hit ELOOP rather than hang.
  symlinkSync("sub", join(src, "a", "sub"));
  writeFileSync(
    join(root, "c.config.json"),
    JSON.stringify({
      title: "T",
      source: "src",
      assets: ["a"],
      designs: [{ id: "design", label: "D" }],
    })
  );
  assert.throws(
    () =>
      generate({
        configPath: join(root, "c.config.json"),
        outSchemaDir: join(root, "out", "schema"),
        outScadDir: join(root, "out", "scad"),
      }),
    /symlink cycle/
  );
});

// ── H6: destination-ownership collisions ────────────────────────────────────

test("extraCss colliding with a design's own output name fails, naming both owners", () => {
  assert.throws(
    () => run("widget-collide-extracss.config.json"),
    /generated output collision[\s\S]*already written by: source file 'widget\.scad'[\s\S]*also requested by:\s+extraCss/
  );
});

test("two `fonts` entries sharing a basename from different directories collide", () => {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  assert.throws(
    () =>
      generate({
        configPath: join(FIXTURES, "widget-font-collide.config.json"),
        outSchemaDir: join(out, "schema"),
        outScadDir: join(out, "public", "scad"),
        outPublicDir: join(out, "public"),
      }),
    /generated output collision[\s\S]*fonts-a\/Dup\.ttf[\s\S]*fonts-b\/Dup\.ttf/
  );
});

// ── H6/M8: a failed generation leaves the previous output intact ───────────

test("a failed generation leaves outScadDir's previous complete output intact", () => {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  const outScadDir = join(out, "public", "scad");
  const opts = {
    outSchemaDir: join(out, "schema"),
    outScadDir,
    outPublicDir: join(out, "public"),
  };
  generate({ ...opts, configPath: join(FIXTURES, "widget.config.json") });
  const before = readdirSync(outScadDir).sort();
  const beforeWidget = readFileSync(join(outScadDir, "widget.scad"));
  assert.throws(
    () => generate({ ...opts, configPath: join(FIXTURES, "widget-missingdep.config.json") }),
    /dependency/
  );
  // Unchanged: neither wiped, nor partially repopulated with the failed
  // config's (partial) output.
  assert.deepEqual(readdirSync(outScadDir).sort(), before);
  assert.deepEqual(readFileSync(join(outScadDir, "widget.scad")), beforeWidget);
  assert.ok(!existsSync(join(outScadDir, "missingdep-design.scad")));
});

// ── M8: generated PWA/font output lifecycle ────────────────────────────────

test("removing a font/screenshot from config leaves no orphan generated file; manifest matches disk", () => {
  const REAL_TTF = join(HERE, "..", "public", "fonts", "LiberationSans-Regular.ttf");
  const root = mkdtempSync(join(tmpdir(), "gen-schema-lifecycle-"));
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "d.scad"), `/* [Main] */\nx = 1;\n`);
  copyFileSync(REAL_TTF, join(src, "Face.ttf"));
  writeFileSync(join(root, "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const outPublicDir = join(root, "public");
  const base = {
    outSchemaDir: join(root, "schema"),
    outScadDir: join(outPublicDir, "scad"),
    outPublicDir,
  };

  const cfgWith = join(root, "with.config.json");
  writeFileSync(
    cfgWith,
    JSON.stringify({
      title: "T",
      source: "src",
      render: { fonts: ["Face.ttf"] },
      pwa: { screenshots: [{ src: "shot.png", sizes: "1x1", form_factor: "narrow" }] },
      designs: [{ id: "d", label: "D" }],
    })
  );
  generate({ ...base, configPath: cfgWith });
  const fontDest = join(outPublicDir, "fonts", "Face.ttf");
  const shotDest = join(outPublicDir, "shot.png");
  assert.ok(existsSync(fontDest));
  assert.ok(existsSync(shotDest));
  // The manifest lives ABOVE public/ (so Vite never ships it) and stores paths
  // relative to public/ (never host-absolute — no checkout-path leak, and a
  // stray manifest can't authorize deletes outside the output root).
  const manifestPath = join(outPublicDir, "..", ".gen-manifest.json");
  const relTo = (abs) => relative(outPublicDir, abs);
  assert.ok(!existsSync(join(outPublicDir, ".gen-manifest.json")), "manifest must not sit inside public/");
  const manifest1 = JSON.parse(readFileSync(manifestPath, "utf-8"));
  assert.ok(manifest1.every((e) => !isAbsolute(e)), "manifest entries must be relative, not absolute");
  assert.ok(manifest1.includes(relTo(fontDest)));
  assert.ok(manifest1.includes(relTo(shotDest)));

  // Reconfigure without the font/screenshot — as if the config entry was
  // removed or renamed.
  const cfgWithout = join(root, "without.config.json");
  writeFileSync(
    cfgWithout,
    JSON.stringify({ title: "T", source: "src", designs: [{ id: "d", label: "D" }] })
  );
  generate({ ...base, configPath: cfgWithout });
  assert.ok(!existsSync(fontDest), "stale generated font copy should be removed");
  assert.ok(!existsSync(shotDest), "stale screenshot should be removed");

  // Final manifest matches disk: every recorded path still exists, and
  // nothing recorded is stale.
  const manifest2 = JSON.parse(readFileSync(manifestPath, "utf-8"));
  assert.ok(!manifest2.includes(relTo(fontDest)));
  assert.ok(!manifest2.includes(relTo(shotDest)));
  for (const p of manifest2)
    assert.ok(existsSync(join(outPublicDir, p)), `manifest entry missing on disk: ${p}`);
});

test("a malformed configured icon fails the build instead of shipping a missing/mislabeled PNG", () => {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  const outPublicDir = join(out, "public");
  assert.throws(
    () =>
      generate({
        configPath: join(FIXTURES, "widget-badicon.config.json"),
        outSchemaDir: join(out, "schema"),
        outScadDir: join(outPublicDir, "scad"),
        outPublicDir,
      }),
    /icon rasterization failed/
  );
  // No PNG was advertised or left mislabeled: none of the sizes exist, and
  // there's no precache/manifest to reference them either way.
  for (const f of ["icon-192.png", "icon-512.png", "icon-512-maskable.png", "icon-180.png"]) {
    assert.ok(!existsSync(join(outPublicDir, f)), `${f} should not exist after a failed rasterization`);
  }
  assert.ok(!existsSync(join(outPublicDir, "manifest.webmanifest")));
  assert.ok(!existsSync(join(outPublicDir, "precache-manifest.json")));
});

test("a catch-all `assets` entry that re-includes a design's own .scad is idempotent, not a collision", () => {
  const root = mkdtempSync(join(tmpdir(), "gen-schema-idem-"));
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "d.scad"), `/* [Main] */\nx = 1;\n`);
  const cfg = join(root, "c.config.json");
  writeFileSync(
    cfg,
    JSON.stringify({
      title: "T",
      source: "src",
      // The catch-all picks up d.scad, which buildDesigns already copied — the
      // same source to the same destination. That must NOT be a collision.
      assets: ["."],
      designs: [{ id: "d", label: "D" }],
    })
  );
  const outPublicDir = join(root, "public");
  const schema = generate({
    configPath: cfg,
    outSchemaDir: join(root, "schema"),
    outScadDir: join(outPublicDir, "scad"),
    outPublicDir,
  });
  assert.ok(existsSync(join(outPublicDir, "scad", "d.scad")));
  assert.ok(schema.assets.includes("d.scad"));
});

test("a PWA/icon failure after a prior successful build leaves the previous output intact (transactional)", () => {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-txn-"));
  const outPublicDir = join(out, "public");
  const outScadDir = join(outPublicDir, "scad");
  const outSchemaDir = join(out, "schema");
  const base = { outSchemaDir, outScadDir, outPublicDir };
  // A good build first.
  generate({ ...base, configPath: join(FIXTURES, "widget.config.json") });
  const beforeScad = readdirSync(outScadDir).sort();
  const beforeSchema = readFileSync(join(outSchemaDir, "designs.json"));
  const iconPath = join(outPublicDir, "icon-192.png");
  const beforeIcon = existsSync(iconPath) ? readFileSync(iconPath) : null;

  // A build whose configured icon can't rasterize fails AFTER staging the new
  // scad but before the commit — so scad, schema, and the icons must all stay
  // exactly as the last good build left them (no new-scad/old-schema mismatch,
  // no clobbered/deleted last-good icon).
  assert.throws(
    () => generate({ ...base, configPath: join(FIXTURES, "widget-badicon.config.json") }),
    /icon rasterization failed/
  );
  assert.deepEqual(readdirSync(outScadDir).sort(), beforeScad);
  assert.deepEqual(readFileSync(join(outSchemaDir, "designs.json")), beforeSchema);
  if (beforeIcon) assert.deepEqual(readFileSync(iconPath), beforeIcon);
});

// A failure LATER in generatePwaAssets than icon rasterization — the
// `pwa.screenshots[].src` existence check, which used to run after
// pwa-assets.mjs had already written the (successfully rasterized) icon/
// splash PNGs directly to outPublicDir. That's the gap the deferred-write
// batch (pwa-assets.mjs's `batch`/commitPwaBatch, flushed only at generate()'s
// single commit point) closes: unlike the widget-badicon case above — which
// already failed BEFORE anything was written even under the old code, since
// rasterization itself is the failure — this fixture's icon is valid, so the
// icon/splash batch fully rasterizes, and only the screenshot check after it
// fails. Under the pre-fix code that meant new icon/splash bytes landing on
// disk paired with the OLD scad tree/schema/manifest; this asserts they don't.
test("a failing screenshot leaves the previous PWA icon/splash/manifest files byte-identical (deferred-write batch)", () => {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-pwatxn-"));
  const outPublicDir = join(out, "public");
  const outScadDir = join(outPublicDir, "scad");
  const outSchemaDir = join(out, "schema");
  const base = { outSchemaDir, outScadDir, outPublicDir };

  // A good build first, so there is a previous icon/splash/manifest set to protect.
  generate({ ...base, configPath: join(FIXTURES, "widget.config.json") });
  const PWA_FILES = [
    "icon.svg",
    "icon-192.png",
    "icon-512.png",
    "icon-512-maskable.png",
    "icon-180.png",
    "apple-splash-1290x2796.png",
    "apple-splash-750x1334.png",
    "manifest.webmanifest",
  ];
  const snapshot = () =>
    Object.fromEntries(
      PWA_FILES.map((f) => {
        const p = join(outPublicDir, f);
        return [f, existsSync(p) ? readFileSync(p) : null];
      })
    );
  const before = snapshot();
  // Sanity: the rasterizer actually ran, so this test exercises the deferred
  // batch rather than vacuously passing on all-null snapshots either way.
  assert.ok(before["icon-192.png"], "fixture setup expects @resvg/resvg-js to be installed");

  // A config with a VALID icon (so the icon+splash batch fully rasterizes and
  // queues real bytes) but a `pwa.screenshots[].src` that doesn't exist.
  assert.throws(
    () => generate({ ...base, configPath: join(FIXTURES, "widget-screenshot-missing.config.json") }),
    /screenshot 'no-such-screenshot\.png' not found/
  );

  const after = snapshot();
  for (const f of PWA_FILES) {
    assert.deepEqual(after[f], before[f], `${f} must be byte-identical to the pre-run state`);
  }
});

test("changing a font then failing a later step leaves the prior font bytes and fonts.conf unchanged", () => {
  const REGULAR = join(HERE, "..", "public", "fonts", "LiberationSans-Regular.ttf");
  const BOLD = join(HERE, "..", "public", "fonts", "LiberationSans-Bold.ttf");
  const root = mkdtempSync(join(tmpdir(), "gen-schema-fonttxn-"));
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "d.scad"), `/* [Main] */\nx = 1;\n`);
  copyFileSync(REGULAR, join(src, "Face.ttf"));

  const outPublicDir = join(root, "public");
  const base = {
    outSchemaDir: join(root, "schema"),
    outScadDir: join(outPublicDir, "scad"),
    outPublicDir,
  };

  // Good build with the Regular face and one fallback.
  const good = join(root, "good.config.json");
  writeFileSync(
    good,
    JSON.stringify({
      title: "T",
      source: "src",
      render: { fonts: ["Face.ttf"], fontFallback: "Alpha" },
      designs: [{ id: "d", label: "D" }],
    })
  );
  generate({ ...base, configPath: good });
  const fontDest = join(outPublicDir, "fonts", "Face.ttf");
  const confDest = join(outPublicDir, "fonts", "fonts.conf");
  const beforeFont = readFileSync(fontDest);
  const beforeConf = readFileSync(confDest);

  // Now swap Face.ttf to the Bold bytes and change the fallback (both would
  // rewrite the live font tree), but make the build fail at PWA rasterization
  // via a malformed icon — after bundleFonts, before the commit.
  copyFileSync(BOLD, join(src, "Face.ttf"));
  writeFileSync(join(root, "bad.svg"), `<svg xmlns="http://www.w3.org/2000/svg"><not-closed`);
  const bad = join(root, "bad.config.json");
  writeFileSync(
    bad,
    JSON.stringify({
      title: "T",
      source: "src",
      render: { fonts: ["Face.ttf"], fontFallback: "Beta" },
      pwa: { icon: "bad.svg" },
      designs: [{ id: "d", label: "D" }],
    })
  );
  assert.throws(() => generate({ ...base, configPath: bad }), /icon rasterization failed/);

  // The last-good font bytes and fonts.conf must be untouched.
  assert.deepEqual(readFileSync(fontDest), beforeFont, "font bytes must survive the failed build");
  assert.deepEqual(readFileSync(confDest), beforeConf, "fonts.conf must survive the failed build");
  // Sanity: the Bold source really is different bytes, so the assertion above is meaningful.
  assert.notDeepEqual(readFileSync(BOLD), beforeFont);
});

// M13 — browser-facing SVGs (logo, PWA icon, design picker icon) are run
// through scripts/lib/svg-sanitize.mjs; render-input SVGs (config `assets` /
// a design's use/include graph, copied into public/scad/ for OpenSCAD's
// import()/surface()) are deliberately left byte-for-byte untouched. See
// docs/config.md "SVG asset trust model".
test("a hostile logo/icon SVG is sanitized; a hostile render-input SVG asset is not", () => {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  const outPublicDir = join(out, "public");
  const schema = generate({
    configPath: join(FIXTURES, "widget-hostile-svg.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(outPublicDir, "scad"),
    outPublicDir,
  });

  const hostileMarkers = [
    "<script",
    "onload=",
    "onclick=",
    "javascript:",
    "https://evil.example",
  ];

  // Logo (both themes resolve to the same copied file here).
  const logoPath = join(outPublicDir, schema.logo.light);
  assert.ok(existsSync(logoPath));
  const logoText = readFileSync(logoPath, "utf-8");
  for (const marker of hostileMarkers)
    assert.ok(!logoText.includes(marker), `logo should not contain ${marker}`);
  assert.ok(!logoText.includes("<foreignObject"));
  // Same-document fragment refs (safe, used for gradients/<use>/clip-paths)
  // are preserved.
  assert.ok(logoText.includes('href="#local-safe-ref"'));
  // Inert visual content survives sanitization.
  assert.ok(logoText.includes('<rect width="10" height="10" fill="red"/>'));

  // Design picker icon.
  const designIcon = schema.designs.find((d) => d.id === "widget").icon;
  const designIconPath = join(outPublicDir, designIcon);
  assert.ok(existsSync(designIconPath));
  const designIconText = readFileSync(designIconPath, "utf-8");
  for (const marker of hostileMarkers)
    assert.ok(!designIconText.includes(marker), `design icon should not contain ${marker}`);
  assert.ok(!designIconText.includes("<foreignObject"));

  // PWA app icon (config `icon`).
  const pwaIconPath = join(outPublicDir, "icon.svg");
  assert.ok(existsSync(pwaIconPath));
  const pwaIconText = readFileSync(pwaIconPath, "utf-8");
  for (const marker of hostileMarkers)
    assert.ok(!pwaIconText.includes(marker), `PWA icon should not contain ${marker}`);
  assert.ok(!pwaIconText.includes("<foreignObject"));

  // Render-input SVG (a config `assets` entry, mounted for OpenSCAD's
  // import()/surface()) is copied verbatim — sanitizing it risks perturbing
  // geometry, and it's covered by the operator-trust boundary + response
  // headers instead (public/_headers), not build-time rewriting.
  const renderAssetPath = join(outPublicDir, "scad", "hostile-assets", "hostile-render.svg");
  assert.ok(existsSync(renderAssetPath));
  const renderAssetText = readFileSync(renderAssetPath, "utf-8");
  const sourceText = readFileSync(
    join(FIXTURES, "hostile-src", "hostile-assets", "hostile-render.svg"),
    "utf-8"
  );
  assert.equal(renderAssetText, sourceText);
  assert.ok(renderAssetText.includes("<script>alert('xss')</script>"));
});

test("sanitizeSvg strips script/event-handlers/foreignObject/off-document hrefs, leaves the rest alone", () => {
  const { text, removed } = sanitizeSvg(
    readFileSync(join(FIXTURES, "hostile.svg"), "utf-8")
  );
  assert.ok(removed.length > 0);
  assert.ok(!text.includes("<script"));
  assert.ok(!text.includes("onload="));
  assert.ok(!text.includes("onclick="));
  assert.ok(!text.includes("javascript:"));
  assert.ok(!text.includes("https://evil.example"));
  assert.ok(!text.includes("<foreignObject"));
  // Same-document fragment reference (safe) survives untouched.
  assert.ok(text.includes('href="#local-safe-ref"'));
  // Non-attacker markup (the rect it draws) survives untouched.
  assert.ok(text.includes('<rect width="10" height="10" fill="red"/>'));
});

test("sanitizeSvg is a no-op on an already-inert SVG", () => {
  const clean = readFileSync(join(FIXTURES, "logo.svg"), "utf-8");
  const { text, removed } = sanitizeSvg(clean);
  assert.equal(text, clean);
  assert.deepEqual(removed, []);
});

test("sanitizeSvg strips a data: href but keeps a same-file fragment href", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg">' +
    '<image href="data:image/svg+xml;base64,PHNjcmlwdD4="/>' +
    '<use href="#ok"/>' +
    "</svg>";
  const { text } = sanitizeSvg(svg);
  assert.ok(!text.includes("data:"));
  assert.ok(text.includes('href="#ok"'));
});

// --- `picker` means the chooser, and only the chooser --------------------
// It used to fall back to a plain notice below two designs, so one config value
// stood for two different UIs and every consumer had to know which. Enforcing
// the invariant here is what lets them all just read the mode.
test("popup.mode 'picker' with fewer than two designs fails the build", () => {
  assert.throws(
    () => run("widget-popup-picker-one-design.config.json"),
    /'popup\.mode: "picker"' is the design chooser, so it needs at least two designs[\s\S]*this config has 1[\s\S]*Use 'popup\.mode: "once"'/
  );
});

test("popup.mode 'picker' with something to choose between builds fine", () => {
  const { schema } = run("widget-popup-picker.config.json");
  assert.equal(schema.popup.mode, "picker");
  assert.equal(schema.designs.length, 2);
});

test("popup.mode 'picker' with fewer than two designs fails the build", () => {
  assert.throws(
    () => run("widget-popup-picker-one-design.config.json"),
    /'popup\.mode: "picker"' is the design chooser, so it needs at least two designs[\s\S]*this config has 1[\s\S]*Use 'popup\.mode: "once"'/
  );
});

test("popup.mode 'picker' with something to choose between builds fine", () => {
  const { schema } = run("widget-popup-picker.config.json");
  assert.equal(schema.popup.mode, "picker");
  assert.equal(schema.designs.length, 2);
});
