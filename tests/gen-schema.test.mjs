// Unit tests for the schema generator (scripts/gen-schema.mjs). Drives generate()
// against the fixtures in tests/fixtures/ into a temp output dir, so the real
// src/generated and public/scad trees are untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generate,
  KNOWN_TOP_LEVEL_KEYS,
  firstSentence,
  parseEnumHint,
  parseColors,
  parseLicenses,
  parseFileImport,
  parsePopup,
  parseFormat,
  parseNotices,
  parseUi,
  parseParams,
  parseFontFallback,
  parseLang,
  parseDir,
  parseRender,
  renderFontsConf,
} from "../scripts/gen-schema.mjs";

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
  // The fixture configures the generic file-import button directly.
  assert.deepEqual(schema.fileImport, {
    accept: ".ttf,.otf",
    label: "Import Foo font",
  });
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
  assert.deepEqual(schema.fileImport, { maxBytes: 1048576 });
  assert.equal(schema.ui.fullscreen, false);
});

test("defaultDesign must name a configured design", () => {
  assert.throws(() => run("widget-bad-default.config.json"), /'defaultDesign' .* is not one of the configured design ids/);
});

test("per-design description + icon are parsed, copied and served", () => {
  const { schema, out } = run("widget-designmeta.config.json");
  const widget = schema.designs.find((d) => d.id === "widget");
  const collapsible = schema.designs.find((d) => d.id === "collapsible");
  // Config `designs[]` values win over the design's own annotations.
  assert.equal(widget.description, "A little widget.");
  assert.equal(widget.icon, "scad/widget-icon.svg");
  assert.ok(existsSync(join(out, "scad", "widget-icon.svg")));
  // collapsible sets no config description/icon, so it falls back to the
  // `// @description` / `// @icon` annotations in its .scad (the icon path is
  // resolved relative to the design file and copied under <id>-icon.<ext>).
  assert.equal(collapsible.description, "A collapsible gadget.");
  assert.equal(collapsible.icon, "scad/collapsible-icon.svg");
  assert.ok(existsSync(join(out, "scad", "collapsible-icon.svg")));
});

test("parseParams captures file-level @description / @icon metadata", () => {
  const { meta } = parseParams(join(FIXTURES, "src", "collapsible.scad"));
  assert.deepEqual(meta, { description: "A collapsible gadget.", icon: "assets/emblem.svg" });
  // A design file with no such annotations reports nulls.
  const plain = parseParams(join(FIXTURES, "mini.scad"));
  assert.deepEqual(plain.meta, { description: null, icon: null });
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
  // widget's from the config, collapsible's from its `// @icon` annotation.
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
    "wasm/openscad.js",
    "fonts/fonts.conf",
    "scad/widget.scad",
    "scad/widget.json",
    "scad/lib/core.scad",
    "scad/lib/util.scad",
    "scad/logo.svg",
  ]) {
    assert.ok(precache.shell.includes(path), `${path} should be shell-precached`);
  }
  // The big binaries (WASM + font files) go to the render worker's own
  // versioned cache, not the shell cache.
  assert.ok(!precache.shell.includes("wasm/openscad.wasm"));
  assert.ok(!precache.shell.includes("fonts/Foo.ttf"));
  assert.match(precache.bin.cache, /^openscad-wasm-bin-/);
  assert.ok(precache.bin.urls.includes("wasm/openscad.wasm"));
  assert.ok(precache.bin.urls.includes("fonts/Foo.ttf"));
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
  // themeColor/themeColorLight/backgroundColor are interpolated into generated
  // SVG/HTML, so they must pass the same COLOR_VALUE_RE as every other colour.
  assert.throws(() => run("widget-bad-color.config.json"), /'themeColor' must be a CSS colour/);
});

test("rejects a design id with unsafe characters", () => {
  assert.throws(() => run("widget-bad-id.config.json"), /design id .* must match/);
});

test("rejects an app-level id with unsafe characters", () => {
  // The app id reaches index.html's inline pre-paint script as a string
  // literal (%APP_THEME_KEY%), so it gets the same charset check as design ids.
  assert.throws(() => run("widget-bad-app-id.config.json"), /config 'id' .* must match/);
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
  assert.throws(() => parseFormat("obj"), /config\.format must be/);
  assert.throws(() => parseFormat("STL"), /config\.format must be/);
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

test("ui.measure defaults to true, accepts a boolean, rejects non-booleans", () => {
  assert.equal(parseUi(undefined).measure, true);
  assert.equal(parseUi({}).measure, true);
  assert.equal(parseUi({ measure: true }).measure, true);
  assert.equal(parseUi({ measure: false }).measure, false);
  assert.throws(() => parseUi({ measure: "no" }), /'ui\.measure' must be a boolean/);
  assert.throws(() => parseUi({ measure: 0 }), /'ui\.measure' must be a boolean/);
});

test("ui.viewPicker defaults to true, accepts a boolean, rejects non-booleans", () => {
  assert.equal(parseUi(undefined).viewPicker, true);
  assert.equal(parseUi({}).viewPicker, true);
  assert.equal(parseUi({ viewPicker: false }).viewPicker, false);
  assert.throws(() => parseUi({ viewPicker: "no" }), /'ui\.viewPicker' must be a boolean/);
  assert.throws(() => parseUi({ viewPicker: 1 }), /'ui\.viewPicker' must be a boolean/);
});

test("ui.reset defaults to true, accepts a boolean, rejects non-booleans", () => {
  assert.equal(parseUi(undefined).reset, true);
  assert.equal(parseUi({}).reset, true);
  assert.equal(parseUi({ reset: false }).reset, false);
  assert.throws(() => parseUi({ reset: "no" }), /'ui\.reset' must be a boolean/);
  assert.throws(() => parseUi({ reset: 1 }), /'ui\.reset' must be a boolean/);
});

test("ui.zoom defaults to false, accepts a boolean, rejects non-booleans", () => {
  assert.equal(parseUi(undefined).zoom, false);
  assert.equal(parseUi({}).zoom, false);
  assert.equal(parseUi({ zoom: true }).zoom, true);
  assert.throws(() => parseUi({ zoom: "no" }), /'ui\.zoom' must be a boolean/);
  assert.throws(() => parseUi({ zoom: 1 }), /'ui\.zoom' must be a boolean/);
});

test("ui.presetsLabel / parametersLabel default, trim, and reject empty/non-strings", () => {
  assert.equal(parseUi(undefined).presetsLabel, "Presets");
  assert.equal(parseUi(undefined).parametersLabel, "Customize");
  assert.equal(parseUi({ presetsLabel: "  Styles  " }).presetsLabel, "Styles");
  assert.equal(parseUi({ parametersLabel: "Options" }).parametersLabel, "Options");
  assert.throws(() => parseUi({ presetsLabel: "  " }), /'ui\.presetsLabel' must be a non-empty string/);
  assert.throws(() => parseUi({ parametersLabel: 5 }), /'ui\.parametersLabel' must be a non-empty string/);
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
      { marker: "note", label: "notes", color: "#3b82f6" },
      { marker: "alert", label: "alert" },
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
    /'notices\[0\]\.label' must be a non-empty string/
  );
  assert.throws(
    () => parseNotices([{ marker: "n", color: "#fff; } body { display:none" }]),
    /'notices\[0\]\.color' must be a plain CSS colour/
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

test("firstSentence does not break on decimals or abbreviations", () => {
  assert.equal(firstSentence("Depth (mm). Must be >= 0.4 mm."), "Depth (mm).");
  assert.equal(
    firstSentence("Border, i.e. the edge clearance, in mm."),
    "Border, i.e. the edge clearance, in mm."
  );
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

test("parseFileImport: true/object, defaults and errors", () => {
  // Absent -> null; explicit false -> null.
  assert.equal(parseFileImport(undefined), null);
  assert.equal(parseFileImport(false), null);
  // true -> defaults (an empty options object).
  assert.deepEqual(parseFileImport(true), {});
  // Object form: known string fields pass through; nulls/undefined dropped.
  assert.deepEqual(
    parseFileImport({ accept: ".svg", label: "Add SVG", note: undefined }),
    { accept: ".svg", label: "Add SVG" }
  );
  // maxBytes: a positive number passes through; bad values fail.
  assert.deepEqual(parseFileImport({ maxBytes: 1024 }), { maxBytes: 1024 });
  assert.deepEqual(parseFileImport({ accept: ".ttf", maxBytes: null }), { accept: ".ttf" });
  assert.throws(() => parseFileImport({ maxBytes: 0 }), /'fileImport\.maxBytes' must be a positive number/);
  assert.throws(() => parseFileImport({ maxBytes: -5 }), /'fileImport\.maxBytes' must be a positive number/);
  assert.throws(() => parseFileImport({ maxBytes: "big" }), /'fileImport\.maxBytes' must be a positive number/);
  // Wrong shapes -> clear errors.
  assert.throws(() => parseFileImport([]), /'fileImport' must be true/);
  assert.throws(
    () => parseFileImport({ accept: 5 }),
    /'fileImport\.accept' must be a string/
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
});

test("parseUi: fullscreen defaults true and validates", () => {
  assert.equal(parseUi(undefined).fullscreen, true);
  assert.equal(parseUi({}).fullscreen, true);
  assert.equal(parseUi({ fullscreen: false }).fullscreen, false);
  assert.throws(() => parseUi({ fullscreen: "no" }), /'ui\.fullscreen' must be a boolean/);
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
  // Wrong shapes / missing required fields / bad mode / blank button -> clear errors.
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

test("parseFontFallback accepts a trimmed string or null; rejects empty", () => {
  assert.equal(parseFontFallback(undefined), null);
  assert.equal(parseFontFallback(null), null);
  assert.equal(parseFontFallback("  Liberation Mono  "), "Liberation Mono");
  assert.throws(() => parseFontFallback(""), /'fontFallback' must be a non-empty string/);
  assert.throws(() => parseFontFallback(42), /'fontFallback' must be a non-empty string/);
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
      fonts: ["Face.ttf"],
      fontFallback: "Liberation Sans",
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
