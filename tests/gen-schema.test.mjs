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
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generate,
  firstSentence,
  parseEnumHint,
  parseColors,
  parseLicenses,
  parseFilePrompts,
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

test("title defaults when omitted; no logo or filePrompts by default", () => {
  const { schema } = run("widget-autodeps.config.json");
  assert.equal(typeof schema.title, "string");
  assert.equal(schema.logo, null);
  assert.deepEqual(schema.filePrompts, []);
});

test("config-driven features, fonts; presets auto-detected by sibling name", () => {
  const { schema, out } = run("widget.config.json");
  assert.deepEqual(schema.features, ["textmetrics"]);
  assert.deepEqual(schema.fonts, ["Foo.ttf"]);
  // The fixture uses the legacy single `fontPrompt`, mapped to one font entry.
  assert.deepEqual(schema.filePrompts, [
    {
      kind: "font",
      url: "https://example/Foo.ttf",
      label: "Foo font",
      family: "Foo",
    },
  ]);
  // src/widget.json sits next to src/widget.scad, so it's bundled automatically.
  assert.deepEqual(schema.designs[0].presets, ["widget.json"]);
  assert.equal(schema.designs[0].heavy, true); // per-design heavy flag passes through
  // preset + design files copied into the output scad tree
  assert.ok(existsSync(join(out, "scad", "widget.scad")));
  assert.ok(existsSync(join(out, "scad", "widget.json")));
});

test("heavy defaults to false when unset", () => {
  const { schema } = run("widget-autodeps.config.json");
  assert.equal(schema.designs[0].heavy, false);
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
  for (const path of [
    "icon.svg",
    "manifest.webmanifest",
    "wasm/openscad.js",
    "fonts/fonts.conf",
    "fonts/Foo.ttf",
    "scad/widget.scad",
    "scad/widget.json",
    "scad/lib/core.scad",
    "scad/lib/util.scad",
    "scad/logo.svg",
  ]) {
    assert.ok(precache.includes(path), `${path} should be precached`);
  }
  assert.ok(!precache.includes("wasm/openscad.wasm"));
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
  assert.ok(precache.includes("scad/extra.css"));
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

test("parseFilePrompts: array form, legacy fontPrompt, defaults and errors", () => {
  // Absent -> [].
  assert.deepEqual(parseFilePrompts(undefined, undefined), []);
  // Legacy single fontPrompt -> one kind:"font" entry.
  assert.deepEqual(
    parseFilePrompts(undefined, { url: "https://x/f.ttf", label: "DIN" }),
    [{ kind: "font", url: "https://x/f.ttf", label: "DIN" }]
  );
  // Array form: kind defaults to "file"; known string fields pass through.
  assert.deepEqual(
    parseFilePrompts(
      [
        { kind: "font", url: "https://x/f.ttf", family: "DIN 32986" },
        { label: "Logo", accept: ".svg", url: "https://x/logo.svg" },
      ],
      undefined
    ),
    [
      { kind: "font", url: "https://x/f.ttf", family: "DIN 32986" },
      { kind: "file", label: "Logo", accept: ".svg", url: "https://x/logo.svg" },
    ]
  );
  // The new array form wins over a legacy fontPrompt if both are present.
  assert.deepEqual(
    parseFilePrompts([{ kind: "file", label: "A" }], { url: "https://x/f.ttf" }),
    [{ kind: "file", label: "A" }]
  );
  // startup boolean is preserved.
  assert.deepEqual(parseFilePrompts([{ startup: false }], undefined), [
    { kind: "file", startup: false },
  ]);
  // Wrong shapes -> clear errors.
  assert.throws(() => parseFilePrompts({}, undefined), /'filePrompts' must be an array/);
  assert.throws(() => parseFilePrompts([null], undefined), /'filePrompts\[0\]' must be an object/);
  assert.throws(
    () => parseFilePrompts([{ kind: "image" }], undefined),
    /'filePrompts\[0\]\.kind' must be one of/
  );
  assert.throws(
    () => parseFilePrompts([{ label: 5 }], undefined),
    /'filePrompts\[0\]\.label' must be a string/
  );
  assert.throws(
    () => parseFilePrompts([{ startup: "yes" }], undefined),
    /'filePrompts\[0\]\.startup' must be a boolean/
  );
});

test("parseEnumHint ignores single-item and non-enum hints", () => {
  assert.equal(parseEnumHint("only"), null);
  assert.deepEqual(parseEnumHint("a, b"), [
    { value: "a", label: "a" },
    { value: "b", label: "b" },
  ]);
});
