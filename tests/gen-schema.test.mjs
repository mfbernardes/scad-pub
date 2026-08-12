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
import { createHash } from "node:crypto";
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
  COLOR_TOKENS,
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
  parseLanguages,
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
  isTrackedFile,
  extOf,
  parseDesignStrings,
} from "../scripts/gen-schema.mjs";
import { validateSchema } from "../src/lib/schema.ts";
import { sanitizeSvg } from "../scripts/lib/svg-sanitize.mjs";
import { colorStyle } from "../src/lib/configCss.ts";
import { componentVersions } from "../scripts/lib/dep-versions.mjs";
import { LOCALE_TAGS } from "../src/lib/localeRegistry.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");

function run(configName) {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  const schema = generate({
    configPath: join(FIXTURES, configName),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "scad"),
    outArtDir: join(out, "art"),
  });
  return { schema, out };
}

// Same as run(), plus an outPublicDir so the font/PWA/precache steps actually
// execute (they are skipped entirely without one).
function runWithPublic(configName) {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  const outPublicDir = join(out, "public");
  const schema = generate({
    configPath: join(FIXTURES, configName),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(outPublicDir, "scad"),
    outArtDir: join(outPublicDir, "art"),
    outPublicDir,
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

test("a large top-level literal parses in well under a second", () => {
  // The source-order scanner tested `buf.trim()` per character while `buf`
  // accumulated the whole statement, which is quadratic in its length. A
  // 20k-element point table — ordinary OpenSCAD, and this runs on every
  // predev/prebuild/pretest — took 25s; the 60k case never finished.
  const dir = mkdtempSync(join(tmpdir(), "gen-schema-perf-"));
  const file = join(dir, "f.scad");
  const pts = Array.from({ length: 20000 }, (_, i) => `[${i},${i}]`).join(",");
  writeFileSync(file, `/* [Main] */\n// P.\npts = [${pts}];\n// A.\na = 1;\n`);
  const t0 = Date.now();
  const { params } = parseParams(file);
  const elapsed = Date.now() - t0;
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(params.map((p) => p.name), ["pts", "a"], "and still parses it correctly");
  assert.ok(elapsed < 1000, `parseParams took ${elapsed}ms, expected < 1000ms`);

  // The other shape that could go quadratic: every `<` asks whether the buffer
  // is a pending use/include, so that question has to be O(1) rather than an
  // inspection of everything collected so far.
  const many = Array.from({ length: 20000 }, (_, i) => `a${i} = ${i} < ${i + 1};`).join("\n");
  const file2 = join(mkdtempSync(join(tmpdir(), "gen-schema-perf-")), "f.scad");
  writeFileSync(file2, `/* [Main] */\n${many}\n`);
  const t1 = Date.now();
  const { params: lts } = parseParams(file2);
  const lessThans = Date.now() - t1;
  assert.equal(lts.length, 20000, "every less-than statement is still a parameter");
  assert.ok(lessThans < 2000, `20k less-thans took ${lessThans}ms, expected < 2000ms`);
});

test("// @collapsed marks sections collapsed; others stay open", () => {
  const { schema } = run("collapse.config.json");
  const d = schema.designs[0];
  assert.deepEqual(d.sections, ["Basics", "Shape", "Advanced"]);
  // "Basics" is annotated before the first header (the section === null edge).
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
  // min/max/step, only the default.
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
  assert.deepEqual(schema.logo, { light: "art/logo.svg", dark: "art/logo.svg" });
  assert.ok(existsSync(join(out, "art", "logo.svg")));
});

test("a per-theme logo with one side omitted falls back to the other", () => {
  const { schema } = run("widget-logo-fallback.config.json");
  assert.deepEqual(schema.logo, { light: "art/logo.svg", dark: "art/logo.svg" });
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

test("languages: omitted + a shipped 'lang' (default 'en') defaults to every registry tag, default first", () => {
  const { schema } = run("widget.config.json");
  assert.deepEqual(schema.languages, [...LOCALE_TAGS]);
});

test("languages: omitted + an unshipped 'lang' (e.g. \"fr\") defaults to a single \"en\" tag", () => {
  // Not `["fr"]`: src/lib/i18n.ts's `defaultTag` resolves an unshipped `lang`
  // to "en" (collapseToAvailable(...) ?? "en"), and `languages`' single entry
  // must name that SAME tag so src/lib/localeStore.ts's `enabledTags` and the
  // locale the app actually boots into can never disagree — see
  // parseLanguages's own comment (scripts/lib/config-parsers.mjs).
  const { schema } = run("widget-lang-unshipped.config.json");
  assert.equal(schema.lang, "fr");
  assert.deepEqual(schema.languages, ["en"]);
});

test("languages: an explicit array is normalised to registry tags, default locale first", () => {
  const { schema } = run("widget-languages.config.json");
  assert.deepEqual(schema.languages, ["en", "de"]);
});

test("languages: an entry that isn't a shipped locale fails the build, naming the entry and the valid tags", () => {
  const validTags = new RegExp(`Valid tags: ${LOCALE_TAGS.join(", ")}`);
  assert.throws(() => run("widget-languages-badtag.config.json"), (err) => {
    assert.match(
      err.message,
      /'languages\[1\]' \("fr"\) is not a locale ScadPub ships a chrome translation for\./
    );
    assert.match(err.message, validTags);
    return true;
  });
});

test("languages: omitting the deployment's default locale fails the build", () => {
  assert.throws(
    () => run("widget-languages-missing-default.config.json"),
    /'languages' must include "de" — the deployment's resolved default locale \(from 'lang' when shipped, else "en"\) must always be offered/
  );
});

test("languages: an empty array fails the build (must be non-empty)", () => {
  assert.throws(
    () => run("widget-languages-empty.config.json"),
    /'languages' must be a non-empty array of locale tags/
  );
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

test("defaultDesign runs through the descriptor-driven type check", () => {
  // A non-string defaultDesign used to reach the membership check raw and
  // fail with "42 is not one of the configured design ids" — a type error
  // reported as a membership error.
  assert.throws(
    () => run("widget-bad-defaultdesign.config.json"),
    /'defaultDesign', when set, must be a non-empty string/
  );
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
  // from the design's own .scad annotations now: these config-level fields
  // were removed entirely, not only deprecated, so they fail the ordinary
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
  // The transient annotation flag never reaches a param's own object: it's
  // folded into reviewLabels above and stripped (src/openscad/types.ts's
  // ParamBase carries no such field).
  for (const p of widget.params) assert.equal(p.reviewLabel, undefined);
});

test("presetImages: a key matching a bundled preset name is resolved and copied", () => {
  const { schema, out } = run("widget-presetimages.config.json");
  const widget = schema.designs.find((d) => d.id === "widget");
  assert.deepEqual(widget.presetImages, { Tall: "art/widget-preset-0.png" });
  assert.ok(existsSync(join(out, "art", "widget-preset-0.png")));
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
  // "Salz (Deutsch)" has both a .svg and a .png in the directory: .svg wins
  // (the documented extension priority).
  assert.equal(design.presetImages["Salz (Deutsch)"], "art/presetdir-preset-0.svg");
  assert.ok(existsSync(join(out, "art", "presetdir-preset-0.svg")));
  assert.equal(design.presetImages["Office (English US)"], "art/presetdir-preset-1.png");
  // The two punctuation-only names slug identically; only the FIRST one
  // (matching "...english-us.webp", no "-2" suffix) has a file in the
  // directory, so only it gets an image.
  assert.equal(
    design.presetImages["Punctuation | English UEB: - : ; ' (English US)"],
    "art/presetdir-preset-2.webp"
  );
  assert.equal("Punctuation | English UEB: . , ? ! (English US)" in design.presetImages, false);
  // "No Image Here" has no matching file in the directory at all: legitimate
  // (preset images are optional per preset), not a build failure.
  assert.equal("No Image Here" in design.presetImages, false);
  // 3 of the 5 bundled presets matched an image: reported in the build log
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
  assert.deepEqual(schema.strings, {
    "action.export": "Download now",
    // The core-flow strings a white-label deployment cannot ship without
    // overriding: the render hard-failure toast, the SW/offline notices, the
    // install hint and the file add/remove announcements all bypassed the
    // catalogue until they were routed through t().
    "notice.offline": "No connection — you can still build and download.",
    "install.hint": "Add to your home screen?",
    "files.added": "Added {name}",
    "error.renderHardFailed": "Something went wrong building the preview",
  });
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

test("strings: a per-locale object value lands in the schema verbatim", () => {
  const { schema } = run("widget-strings-locale.config.json");
  assert.deepEqual(schema.strings, {
    "action.export": { en: "Download now", de: "Jetzt herunterladen" },
  });
});

test("strings: a per-locale object value naming a locale outside this deployment's languages fails the build", () => {
  assert.throws(
    () => run("widget-strings-locale-badtag.config.json"),
    // The fixture omits `languages`, so the enabled set is the real registry.
    new RegExp(
      `'strings\\.action\\.export' has an entry for locale "fr", which isn't one of this deployment's enabled locales\\.\\s*\\n\\s*Valid tags: ${LOCALE_TAGS.join(", ")}`
    )
  );
});

test("strings: a per-locale object value naming a locale outside a RESTRICTED single-locale 'languages' fails the build", () => {
  // The deployment restricts itself to ["en"], so an override entry for "de"
  // — a locale ScadPub ships, but this deployment doesn't enable — is
  // rejected exactly like an entry for an unshipped tag would be.
  assert.throws(
    () => run("widget-strings-locale-restricted.config.json"),
    /'strings\.action\.export' has an entry for locale "de", which isn't one of this deployment's enabled locales\.\s*\n\s*Valid tags: en/
  );
});

test("per-design description + icon come from the design's own annotations", () => {
  const { schema, out } = run("widget-designmeta.config.json");
  const widget = schema.designs.find((d) => d.id === "widget");
  const collapsible = schema.designs.find((d) => d.id === "collapsible");
  // widget's `// @description` / `// @icon` annotations (the icon path is
  // resolved relative to the design file and copied under <id>-icon.<ext>).
  assert.equal(widget.description, "A little widget.");
  assert.equal(widget.icon, "art/widget-icon.svg");
  assert.ok(existsSync(join(out, "art", "widget-icon.svg")));
  // collapsible's own `// @description` / `// @icon` annotations.
  assert.equal(collapsible.description, "A collapsible gadget.");
  assert.equal(collapsible.icon, "art/collapsible-icon.svg");
  assert.ok(existsSync(join(out, "art", "collapsible-icon.svg")));
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
  // Two designs -> auto-derived shortcuts, each carrying its design's icon:
  // each design's own `// @icon` annotation.
  const widgetShortcut = manifest.shortcuts.find((s) => s.url === "./#d=widget");
  assert.deepEqual(widgetShortcut.icons, [
    { src: "art/widget-icon.svg", sizes: "any", type: "image/svg+xml" },
  ]);
  const collapsibleShortcut = manifest.shortcuts.find((s) => s.url === "./#d=collapsible");
  assert.deepEqual(collapsibleShortcut.icons, [
    { src: "art/collapsible-icon.svg", sizes: "any", type: "image/svg+xml" },
  ]);
  // Screenshot label/platform are passed through.
  assert.equal(manifest.screenshots[0].label, "Home screen");
  assert.equal(manifest.screenshots[0].platform, "android");
});

test("a derived shortcut's name/short_name project a LocalizableText design label to the default locale, never the raw object", () => {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  generate({
    configPath: join(FIXTURES, "widget-shortcut-locale-label.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "public", "scad"),
    outPublicDir: join(out, "public"),
  });
  const manifest = JSON.parse(
    readFileSync(join(out, "public", "manifest.webmanifest"), "utf-8")
  );
  const widgetShortcut = manifest.shortcuts.find((s) => s.url === "./#d=widget");
  // "en" is this fixture's resolved default locale (languages[0]).
  assert.equal(widgetShortcut.name, "Widget");
  assert.equal(widgetShortcut.short_name, "Widget");
  assert.equal(typeof widgetShortcut.name, "string");
  // A plain-string label (the pre-existing shape) is unaffected.
  const collapsibleShortcut = manifest.shortcuts.find((s) => s.url === "./#d=collapsible");
  assert.equal(collapsibleShortcut.name, "Collapsible");
  assert.equal(collapsibleShortcut.short_name, "Collapsible");
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
  assert.equal(schema.designs.find((d) => d.id === "widget").icon, "art/widget-icon.png");
  assert.ok(existsSync(join(out, "public", "art", "widget-icon.png")));
  // The derived shortcut icon advertises the PNG's real 48x24 size (not "any").
  const manifest = JSON.parse(
    readFileSync(join(out, "public", "manifest.webmanifest"), "utf-8")
  );
  const shortcut = manifest.shortcuts.find((s) => s.url === "./#d=widget");
  assert.deepEqual(shortcut.icons, [
    { src: "art/widget-icon.png", sizes: "48x24", type: "image/png" },
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

// `group`'s pre-LocalizableText leniency is deliberately preserved (see
// parseGroupLocalizable's own comment): a blank/whitespace-only string or a
// non-string, non-object value silently collapses to null (unset) rather
// than failing the build — a STRICTER build was considered and rejected here
// specifically, unlike help/notices/licenses[].note/designs[].label, which
// now do reject a malformed value (see docs/config.md's Localizing-config-
// text "stricter than before" note).
test("group: a blank/whitespace string or a non-string, non-object value silently becomes null, not a build error", () => {
  const { schema } = run("widget-group-lenient.config.json");
  assert.equal(schema.designs.find((d) => d.id === "widget").group, null);
  assert.equal(schema.designs.find((d) => d.id === "collapsible").group, null);
});

test("a source-relative font path is referenced by basename", () => {
  // A design repo can bundle its own font by giving a path into the source tree;
  // the schema (and /fonts URL) reference it by basename.
  const { schema } = run("widget-fontpath.config.json");
  assert.deepEqual(schema.fonts, ["Bar.ttf"]);
});

test("a configured font that resolves to no file fails a real build", () => {
  // The existence check only bites in a real build (outPublicDir present):
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
// walks (collectDeps), then (only in explicit-assets mode) checks the walk
// against the configured set.

test("explicit `assets` that omits a use/include dependency fails the build with a distinct coverage error", () => {
  // widget.scad -> lib/core.scad -> lib/util.scad (collectDeps' own walk);
  // this fixture's `assets` covers only lib/util.scad, so lib/core.scad is
  // reachable but not bundled: exactly the gap checkAssetCoverage exists for.
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
  // ... (referenced by ...)" (a dependency missing from disk entirely): this
  // dependency DOES exist on disk, it is not in `assets`, so the two
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
  // its @icon asset, see the "assets: globs match files" test above for the
  // full assertion. Re-run here to pin down that the coverage check leaves a
  // valid explicit-assets build green.
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
    "art/logo.svg",
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
  // H4: content-addressed via a `?v=<digest>` query, see versionedPath in
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

test("pwa.shortName names the installed app; pwa.iconMaskable is a separate rasterization source", () => {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  const schema = generate({
    configPath: join(FIXTURES, "widget-pwa.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "public", "scad"),
    outPublicDir: join(out, "public"),
  });
  const manifest = JSON.parse(
    readFileSync(join(out, "public", "manifest.webmanifest"), "utf-8")
  );
  assert.equal(manifest.name, "Widget Studio");
  assert.equal(manifest.short_name, "Widgets");
  // The app reads the same value off designs.json for the Apple web-app title.
  assert.equal(schema.shortName, "Widgets");

  // The maskable PNG must come from `iconMaskable`, not the main icon: with a
  // distinct source the two 512s differ, and without one they're identical.
  const png = (dir, name) => readFileSync(join(dir, "public", name));
  assert.notDeepEqual(png(out, "icon-512-maskable.png"), png(out, "icon-512.png"));

  const plain = mkdtempSync(join(tmpdir(), "gen-schema-"));
  generate({
    configPath: join(FIXTURES, "widget-pwa-nomaskable.config.json"),
    outSchemaDir: join(plain, "schema"),
    outScadDir: join(plain, "public", "scad"),
    outPublicDir: join(plain, "public"),
  });
  assert.deepEqual(png(plain, "icon-512-maskable.png"), png(plain, "icon-512.png"));
});

test("pwa.shortName falls back to the title when unset", () => {
  const out = mkdtempSync(join(tmpdir(), "gen-schema-"));
  const schema = generate({
    configPath: join(FIXTURES, "widget-pwa-nomaskable.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "public", "scad"),
    outPublicDir: join(out, "public"),
  });
  const manifest = JSON.parse(
    readFileSync(join(out, "public", "manifest.webmanifest"), "utf-8")
  );
  assert.equal(manifest.short_name, "Widget Studio");
  assert.equal(schema.shortName, "Widget Studio");
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
  // The error names the full 'pwa.categories' path, not a bare 'categories'.
  assert.throws(
    () => run("widget-bad-categories.config.json"),
    /'pwa\.categories' must be an array of non-empty strings/
  );
});

test("'render.features'/'pwa.categories': an explicit null is treated as unset, not an error", () => {
  // Both used to throw ("must be an array of non-empty strings (got null)")
  // because parseStringArray only checked `undefined`: every other
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
// per-control visibility (viewer.controls.*).
const VIEWER_DEFAULTS = {
  style: "plain",
  restOnGrid: false,
  grid: "off",
  controls: { measure: true, viewPicker: true, reset: true, zoom: true, fullscreen: true },
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
  // Every message now uses the one "gen-schema: '<path>' ..." prefix. Viewer
  // used to read "config.<path> ..." with no quotes, an accident of predating
  // the newer convention rather than a meaningful distinction.
  assert.throws(() => parseViewer("studio"), /gen-schema: 'viewer' must be an object/);
  assert.throws(() => parseViewer(["studio"]), /gen-schema: 'viewer' must be an object/);
  // Enum errors always say what they got, in every group.
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
  // `viewer` (or `viewer.controls`) at all, matching the flat `ui.*`
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
  // $SCADPUB_VERSION override produces: passed as "" here since an `undefined`
  // argument would only re-trigger generate()'s own default lookup. The key is
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

  // Injectable, and (like the ScadPub stamp) display-only, so a dependency
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
  // re-render everything on every deploy: pin determinism here.
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
  // font set only enters the hash in a real build (outPublicDir present): the
  // bare run() helper omits it, so generate with a public dir here.
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

test("ui.panelSide / panelDefault / outputDefault default, accept their enum, and reject anything else", () => {
  for (const [field, dflt, other] of [
    ["panelSide", "left", "right"],
    ["panelDefault", "open", "collapsed"],
    ["outputDefault", "closed", "open"],
  ]) {
    assert.equal(parseUi(undefined)[field], dflt);
    assert.equal(parseUi({})[field], dflt);
    assert.equal(parseUi({ [field]: null })[field], dflt);
    assert.equal(parseUi({ [field]: other })[field], other);
    assert.throws(
      () => parseUi({ [field]: "sideways" }),
      new RegExp(`'ui\\.${field}' must be one of .* \\(got "sideways"\\)`)
    );
    assert.throws(() => parseUi({ [field]: true }), new RegExp(`'ui\\.${field}' must be one of`));
  }
});

test("ui.gallery / essentials default to false, accept booleans, and reject non-booleans", () => {
  for (const field of ["gallery", "essentials"]) {
    assert.equal(parseUi(undefined)[field], false);
    assert.equal(parseUi({})[field], false);
    assert.equal(parseUi({ [field]: null })[field], false);
    assert.equal(parseUi({ [field]: true })[field], true);
    assert.throws(() => parseUi({ [field]: "yes" }), new RegExp(`'ui\\.${field}' must be a boolean`));
    assert.throws(() => parseUi({ [field]: 1 }), new RegExp(`'ui\\.${field}' must be a boolean`));
  }
});

test("the ui block reaches the generated schema, not just the parser", () => {
  const { schema } = run("widget-ui.config.json");
  assert.equal(schema.ui.panelSide, "right");
  assert.equal(schema.ui.panelDefault, "collapsed");
  assert.equal(schema.ui.outputDefault, "open");
  assert.equal(schema.ui.gallery, true);
  assert.equal(schema.ui.essentials, true);
});

test("ui.presetsLabel / parametersLabel moved to the i18n catalogue (strings['presets.title']/['settings.title'])", () => {
  // Plain chrome copy, not `ui` fields: resolved via src/lib/i18n.ts's t() and
  // overridable through the config's `strings` block like any catalogue key.
  assert.equal(parseUi(undefined).presetsLabel, undefined);
  assert.equal(parseUi(undefined).parametersLabel, undefined);
});

test("ui: an explicit null is equivalent to omitting the key, for every field kind (normalization: null == not set)", () => {
  // Most `ui` fields used to treat an explicit null as present-but-invalid
  // and throw; render's and fileImport's already treated it as omitted. That
  // split was an accident of five parsers growing up separately: a
  // hand-written JSON config has no comments to delete a line with, so an
  // explicit null is how an author says "leave this alone", not a typo.
  assert.equal(parseUi({ showVarName: null }).showVarName, false); // boolean
  assert.equal(parsePwa({ install: null }).install, "auto"); // enum (pwa.install, moved from ui.install)
  assert.equal(parseUi({ saveImage: null }).saveImage, undefined); // no-default boolean
});

test("ui: unknown nested keys are rejected", () => {
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
  // `one` omitted -> falls back to `other`.
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
  // Adversarial shape: a locale-tag map at the OUTER `label` level (as if
  // `label` itself, rather than each of its `one`/`other` leaves, were the
  // LocalizableText value). This is structurally disjoint from `{ one, other
  // }` — "en"/"de" are neither key — so it's caught by the ordinary
  // unknown-key check, not silently accepted or misread as the wrong axis.
  assert.throws(
    () => parseNotices([{ marker: "n", label: { en: "alert", de: "Warnung" } }]),
    /'notices\[0\]\.label': unknown key 'en'\.\s*\n\s*Valid keys: one, other/
  );
});

test("notices: labelOne is rejected, pointing at label: { one, other }", () => {
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
  // account for a hash difference: proving id->file is a hashed input, not
  // only the file set.
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
  // invalidate persisted geometry, only the render contract (routing,
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
    help: { title: "Help", sections: [{ title: "T", body: "Different help copy entirely." }] },
    notices: [{ marker: "note", label: "A note", color: "#3b82f6" }],
    strings: { "presets.title": "Styles", "settings.title": "Options" },
    designs: [{ id: "widget", label: "A Very Different Label" }],
  });
  assert.equal(plain, dressedUp);
});

test("renderHash is unaffected by sourcing prose from a file instead of writing it inline", () => {
  // popup.bodyFile / fileImport.noteFile / licenses[].textFile / help.file all
  // only inline file content into fields that were already outside renderHash
  // (popup/fileImport/licenses/help are all presentation-only): confirm the
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
  // A capital/paren-only lookahead misses this entirely, keeping the whole
  // paragraph as the control's label for a design that documents an enum by
  // naming its values.
  assert.equal(
    firstSentence(
      'Text alignment. "center" (default) centres both the raised lettering ' +
        'and the logo row; "left" and "right" flush both to that edge.'
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

test("parseColors rejects url() and protocol-relative values though the charset allows them", () => {
  // Neither shape needs a ':', so the charset regex alone can't catch them —
  // isSafeColorValue's explicit url()/// guard is what rejects these.
  assert.throws(
    () => parseColors({ dark: { bg: "url(//evil/x)" } }),
    /'colors\.dark\.bg' must be a plain CSS colour/,
  );
  assert.throws(
    () => parseColors({ dark: { bg: "//evil" } }),
    /'colors\.dark\.bg' must be a plain CSS colour/,
  );
  assert.throws(
    () => parseColors({ dark: { bg: "URL(#x)" } }),
    /'colors\.dark\.bg' must be a plain CSS colour/,
    "case-insensitive",
  );
  // Real CSS colour functions still pass.
  assert.deepEqual(parseColors({ dark: { bg: "rgb(0 0 0 / 50%)" } }), {
    dark: { bg: "rgb(0 0 0 / 50%)" },
  });
  assert.deepEqual(parseColors({ dark: { bg: "oklch(.7 .1 200)" } }), {
    dark: { bg: "oklch(.7 .1 200)" },
  });
});

test("colors: an explicit null token means unset, same as an absent one", () => {
  assert.deepEqual(parseColors({ dark: { bg: null } }), null);
  assert.deepEqual(parseColors({ dark: { bg: null, accent: "#fff" } }), {
    dark: { accent: "#fff" },
  });
  // An unknown token is still rejected even when its value is null: the
  // null-means-unset rule is about VALUES, not about excusing a typo'd key.
  assert.throws(() => parseColors({ dark: { accnt: null } }), /unknown colour token/);
});

test("colors: success/success-bg/warn-bg are accepted colour tokens", () => {
  assert.deepEqual(
    parseColors({ dark: { success: "#4ade80", "success-bg": "#142615", "warn-bg": "#332812" } }),
    { dark: { success: "#4ade80", "success-bg": "#142615", "warn-bg": "#332812" } }
  );
});

test("every COLOR_TOKENS entry is settable, including the non-colour ones", () => {
  // COLOR_TOKENS carries radii, an elevation shadow and two font stacks
  // alongside the actual colours, and they all go through the one
  // COLOR_VALUE_RE. A token that regex cannot express would be advertised in
  // docs/config.md and the JSON Schema while failing every build that set it.
  const sample = {
    radius: "12px",
    "radius-sm": "0.5rem",
    elevation: "0 1px 2px rgba(0, 0, 0, 0.2)",
    "font-sans": "Inter, system-ui, sans-serif",
    "font-display": "Space Grotesk, Inter, sans-serif",
  };
  const dark = Object.fromEntries(COLOR_TOKENS.map((t) => [t, sample[t] ?? "#123456"]));
  assert.deepEqual(parseColors({ dark }), { dark });
  assert.match(colorStyle({ dark }), /--font-display: Space Grotesk, Inter, sans-serif;/);
});

test("a quoted font family is rejected: COLOR_VALUE_RE admits no quotes", () => {
  // Documented limitation rather than an oversight — the value is interpolated
  // into a generated <style> block, and the regex is what keeps it inert. Use
  // an unquoted family name (CSS allows it for identifiers-with-spaces).
  assert.throws(
    () => parseColors({ dark: { "font-display": '"Space Grotesk", sans-serif' } }),
    /'colors\.dark\.font-display' must be a plain CSS colour/
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
    /'licenses\[0\]\.note' must be a non-empty string, or an object of locale tag: string pairs/
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
    /'fileImport\.note' must be a non-empty string, or an object of locale tag: string pairs/
  );
  // Blank/whitespace-only is rejected; what's kept is trimmed.
  assert.throws(
    () => parseFileImport({ note: "   " }),
    /'fileImport\.note', when set, must be a non-empty string/
  );
  assert.deepEqual(parseFileImport({ note: "  Add a font.  " }), { note: "Add a font." });
  // `accept`/`label`/`maxBytes` are gone, not merely deprecated: they no
  // longer drove any generic import button (each contextual control applies
  // its own picker filter and size guard, see docs/config.md's Import file
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
  // they don't fail the unknown-key check below) but are `custom: true`.
  // ParseRender ignores them entirely; gen-schema.mjs reads them straight off
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
  // Unknown keys are rejected one level down (render.cache) and at render's
  // own level.
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

test("parseStrings: a per-locale object value validates each key against enabledTags", () => {
  const validKeys = ["action.export", "action.share", "review.title"];
  assert.deepEqual(
    parseStrings({ "action.export": { en: "Download now", de: "Jetzt herunterladen" } }, validKeys, [
      "en",
      "de",
    ]),
    { "action.export": { en: "Download now", de: "Jetzt herunterladen" } }
  );
  assert.throws(
    () => parseStrings({ "action.export": {} }, validKeys, ["en", "de"]),
    /'strings\.action\.export' must have at least one locale entry/
  );
  assert.throws(
    () => parseStrings({ "action.export": { fr: "x" } }, validKeys, ["en", "de"]),
    /'strings\.action\.export' has an entry for locale "fr", which isn't one of this deployment's enabled locales\.\s*\n\s*Valid tags: en, de/
  );
  assert.throws(
    () => parseStrings({ "action.export": { en: 5 } }, validKeys, ["en"]),
    /'strings\.action\.export\.en' must be a string \(got 5\)/
  );
  assert.throws(
    () => parseStrings({ "action.export": ["en"] }, validKeys, ["en"]),
    /'strings\.action\.export' must be a string, or an object of locale tag: string pairs/
  );
});

test("parseLanguages: default rules — shipped 'lang' offers every registry tag, unshipped 'lang' is single-locale \"en\"", () => {
  assert.deepEqual(parseLanguages(null, ["en", "de"], "en"), ["en", "de"]);
  assert.deepEqual(parseLanguages(undefined, ["en", "de"], "de"), ["de", "en"]);
  assert.deepEqual(parseLanguages(null, ["en", "de"], "fr"), ["en"]);
  // A region-flavored 'lang' collapses to its registry tag before deriving
  // the default: "de-AT" ships as "de", not a distinct unshipped locale.
  assert.deepEqual(parseLanguages(null, ["en", "de"], "de-AT"), ["de", "en"]);
});

test("parseLanguages: an explicit array is validated, normalised, deduplicated and default-first", () => {
  assert.deepEqual(parseLanguages(["de", "en"], ["en", "de"], "en"), ["en", "de"]);
  assert.deepEqual(parseLanguages(["de-AT"], ["en", "de"], "de"), ["de"]);
  assert.throws(
    () => parseLanguages([], ["en", "de"], "en"),
    /'languages' must be a non-empty array of locale tags/
  );
  assert.throws(
    () => parseLanguages("en", ["en", "de"], "en"),
    /'languages' must be a non-empty array of locale tags/
  );
  assert.throws(
    () => parseLanguages(["en", "fr"], ["en", "de"], "en"),
    /'languages\[1\]' \("fr"\) is not a locale ScadPub ships a chrome translation for/
  );
  assert.throws(
    () => parseLanguages(["en", "de", "de-AT"], ["en", "de"], "en"),
    /'languages\[2\]' \("de-AT"\) duplicates locale "de"/
  );
  assert.throws(
    () => parseLanguages(["en"], ["en", "de"], "de"),
    /'languages' must include "de" — the deployment's resolved default locale \(from 'lang' when shipped, else "en"\) must always be offered/
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
  // No `title`/`body` here: that copy lives in the catalogue's
  // exportSuccess.title/.body keys (src/locales/en.json).
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
  // The fixture overrides the panel's copy through `strings` instead: the
  // ONE mechanism for overriding this text now, not a second afterExport path.
  assert.equal(schema.strings["exportSuccess.title"], "Done");
  assert.equal(schema.strings["exportSuccess.body"], "Slice it.");
});

test("ui.afterExport.helpTab: build succeeds against the synthetic leading 'Overview' tab", () => {
  const { schema } = run("widget-afterexport-overview.config.json");
  assert.equal(schema.ui.afterExport.helpTab, "Overview");
});

test("ui.afterExport.helpTab: build fails when no help tab has that id or label", () => {
  assert.throws(
    () => run("widget-afterexport-bad.config.json"),
    /'ui\.afterExport\.helpTab' is "Nope", but no 'help' tab has that id or label/
  );
});

test("ui.afterExport.helpTab: build fails with a clear message when the config has no help tabs at all", () => {
  assert.throws(
    () => run("widget-afterexport-notabs.config.json"),
    /'ui\.afterExport\.helpTab' is "Printing", but no 'help' tab has that id or label/
  );
});

test("ui.afterExport.helpTab: resolves by tab id, ahead of label", () => {
  const { schema } = run("widget-helptab-id.config.json");
  assert.equal(schema.ui.afterExport.helpTab, "printing");
  assert.equal(schema.help.tabs[1].id, "printing");
});

test("ui.afterExport.helpTab: a stale id fails the build, listing the available ids", () => {
  assert.throws(
    () => run("widget-helptab-stale-id.config.json"),
    /'ui\.afterExport\.helpTab' is "printing", but no 'help' tab has that id or label.\s*\n\s*Available: "start"/
  );
});

test("help.tabs[].id: must be unique, and \"overview\" is reserved for the synthetic Overview tab", () => {
  const mustExist = (abs) => abs;
  assert.throws(
    () =>
      resolveHelp(
        {
          tabs: [
            { id: "a", label: "One", sections: [{ title: "T", body: "B" }] },
            { id: "a", label: "Two", sections: [{ title: "T", body: "B" }] },
          ],
        },
        "/cfg",
        mustExist
      ),
    /'help\.tabs\[1\]\.id' \("a"\) duplicates an earlier tab's id/
  );
  assert.throws(
    () =>
      resolveHelp(
        { tabs: [{ id: "overview", label: "One", sections: [{ title: "T", body: "B" }] }] },
        "/cfg",
        mustExist
      ),
    /'help\.tabs\[0\]\.id' is "overview", which is reserved/
  );
  assert.throws(
    () =>
      resolveHelp({ tabs: [{ id: "  ", label: "One", sections: [{ title: "T", body: "B" }] }] }, "/cfg", mustExist),
    /'help\.tabs\[0\]\.id', when set, must be a non-empty string/
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
  // Unknown key -> rejected.
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

// Full-build LocalizableText coverage: popup (incl. a per-locale bodyFile —
// this is also the load-bearing Risk-3 guard for generate()'s parseIdentity
// -> resolveProseFields reorder, since resolving a per-locale bodyFile needs
// LANGUAGES already resolved), notices[].label, licenses[].note,
// designs[].label/group, and help (title/intro/tabs[].label/sections).
test("LocalizableText: a full build resolves every touched field to its per-locale object form", () => {
  const { schema } = run("widget-prose-i18n.config.json");
  assert.deepEqual(schema.popup.header, { en: "Welcome", de: "Willkommen" });
  assert.deepEqual(schema.popup.body, {
    en: "Configure a widget and export a model. Nothing is uploaded.",
    de: "Konfiguriere ein Widget und exportiere ein Modell. Nichts wird hochgeladen.",
  });
  assert.equal("bodyFile" in schema.popup, false);
  assert.deepEqual(schema.popup.button, { en: "Start", de: "Los geht's" });
  assert.deepEqual(schema.popup.footnote, {
    en: "Runs in your browser.",
    de: "Läuft in deinem Browser.",
  });
  assert.deepEqual(schema.notices[0].label, {
    one: { en: "alert", de: "Warnung" },
    other: { en: "alerts", de: "Warnungen" },
  });
  assert.deepEqual(schema.licenses[0].note, {
    en: "Bundled helper geometry.",
    de: "Gebündelte Hilfsgeometrie.",
  });
  assert.deepEqual(schema.designs[0].label, { en: "Widget", de: "Gerät" });
  assert.deepEqual(schema.designs[0].group, { en: "Tools", de: "Werkzeuge" });
  assert.deepEqual(schema.help.title, { en: "User guide", de: "Anleitung" });
  assert.deepEqual(schema.help.intro, { en: "Shared intro.", de: "Gemeinsame Einleitung." });
  assert.equal(schema.help.tabs[0].id, "start");
  assert.deepEqual(schema.help.tabs[0].label, { en: "Getting started", de: "Erste Schritte" });
  assert.deepEqual(schema.help.tabs[0].sections[0].title, { en: "Step 1", de: "Schritt 1" });
  assert.deepEqual(schema.help.tabs[0].sections[0].body, {
    en: "Pick a design.",
    de: "Wähle ein Design.",
  });
});

test("LocalizableText: an object entry naming a locale outside 'languages' fails the build", () => {
  assert.throws(
    () => run("widget-prose-i18n-bad-tag.config.json"),
    /'popup\.header' has an entry for locale "fr", which isn't one of this deployment's enabled locales/
  );
});

test("LocalizableText: an object missing the deployment's default-locale entry fails the build", () => {
  assert.throws(
    () => run("widget-prose-i18n-missing-default.config.json"),
    /'popup\.header' must include an entry for "en", this deployment's default locale/
  );
});

test("help.tabs[].file: a per-locale object splits each locale's file independently into one LocalizableText intro/sections", () => {
  const { schema } = run("widget-help-locale.config.json");
  const tab = schema.help.tabs[0];
  assert.deepEqual(tab.intro, { en: "Shared intro.", de: "Gemeinsame Einleitung." });
  assert.equal(tab.sections.length, 2);
  assert.deepEqual(tab.sections[0].title, { en: "Pick a design", de: "Design wählen" });
  assert.deepEqual(tab.sections[0].body, { en: "Use the dropdown.", de: "Nutze das Dropdown." });
  assert.deepEqual(tab.sections[1].title, { en: "Adjust parameters", de: "Parameter anpassen" });
  assert.deepEqual(tab.sections[1].body, {
    en: "The panel lists what you can change.",
    de: "Das Panel listet, was du ändern kannst.",
  });
});

test("help.tabs[].file: a locale's file splitting into a different number of '##' sections fails the build", () => {
  assert.throws(
    () => run("widget-help-locale-mismatch.config.json"),
    /'help\.tabs\[0\]\.file' locale "de" splits into 1 section\(s\).*but "en" splits into 2/s
  );
});

test("help.tabs[].file: a non-default locale's missing intro just leaves that locale out of the intro map", () => {
  // "en" (default) has an intro, "de" has none (nothing before its first
  // '##'): the resulting intro map carries only "en" — a visitor on "de"
  // falls back to it via lx()'s own map[tag] ?? map[defaultTag] rule.
  const { schema } = run("widget-help-locale-nointro-de.config.json");
  assert.deepEqual(schema.help.tabs[0].intro, { en: "Shared intro." });
});

test("help.tabs[].file: intro is omitted entirely when the DEFAULT locale's file has none, even if another locale's does", () => {
  // "en" (default) has no intro; "de" does. Per the documented rule (see
  // docs/config.md's Sourcing-help-from-Markdown-files section), intro only
  // ever appears when the default locale's file supplies one, so "de"'s
  // intro text is dropped here rather than producing an object missing the
  // default tag (which would violate LocalizableText's own invariant).
  const { schema } = run("widget-help-locale-nointro-en.config.json");
  assert.equal("intro" in schema.help.tabs[0], false);
});

test("resolveFileField: licenses[].textFile rejects a per-locale object — this field doesn't support per-locale forms", () => {
  assert.throws(
    () =>
      resolveFileField({
        obj: { textFile: { en: "a.md", de: "b.md" } },
        field: "text",
        fileField: "textFile",
        CONFIG_DIR: "/cfg",
        mustExist: refusingMustExist,
        path: "licenses[0]",
      }),
    /'licenses\[0\]\.textFile' must be a file path \(this field doesn't support per-locale forms\)/
  );
});

// resolveFileField backs popup.bodyFile / fileImport.noteFile /
// licenses[].textFile alike (see prose-files.mjs): each call site below
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

// Same as paramsOf, but returns the FULL parseParams() result: needed for
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

test("@font on a non-string/non-enum parameter fails instead of silently no-oping", () => {
  // number
  assert.throws(
    () => paramsOf(`/* [S] */\n// @font\nsize = 5;\n`),
    /f\.scad:2: @font on 'size' must be a string or enum parameter \(got type number\)/
  );
  // boolean
  assert.throws(
    () => paramsOf(`/* [S] */\n// @font\nflag = true;\n`),
    /f\.scad:2: @font on 'flag' must be a string or enum parameter \(got type boolean\)/
  );
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
      `// Choose the material and finish standard for this bracket.\n` +
      `// @label "Material & finish"\n` +
      `locale = "de";\n` +
      `// Plain param, no annotation.\n` +
      `width = 10;\n`
  );
  const byName = Object.fromEntries(params.map((p) => [p.name, p]));
  assert.equal(byName.locale.description, "Material & finish");
  // The explanation isn't lost: it stays as help, so ParamForm's ⓘ popover
  // still offers it (it only mounts when help differs from the label).
  assert.equal(byName.locale.help, "Choose the material and finish standard for this bracket.");
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
  // applyGroupSpec), rather than throwing.
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
  // selector: REAL_TTF is the Liberation Sans regular face.
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
  // Drives the real generate() -> bundleFonts path (not only the boolean).
  // isRiskyExternalFontCopy shells out to git itself (no seam to inject a
  // stub through generate()), so this test builds its OWN throwaway git
  // checkout: an `outPublicDir` inside a fresh `git init` repo with an
  // attached HEAD. Rather than pointing outPublicDir at this repo's real
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
  writeFileSync(join(root, "..shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

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
      pwa: {
        screenshots: [
          { src: "shot.png", sizes: "1x1", form_factor: "narrow" },
          // A leading-dot name is ordinary, and a `startsWith("..")`
          // containment test read it as traversal: copied on the first build,
          // then unreconcilable forever after.
          { src: "..shot.png", sizes: "1x1", form_factor: "narrow" },
        ],
      },
      designs: [{ id: "d", label: "D" }],
    })
  );
  generate({ ...base, configPath: cfgWith });
  const fontDest = join(outPublicDir, "fonts", "Face.ttf");
  const shotDest = join(outPublicDir, "shot.png");
  const dottedDest = join(outPublicDir, "..shot.png");
  assert.ok(existsSync(fontDest));
  assert.ok(existsSync(shotDest));
  assert.ok(existsSync(dottedDest), "a leading-dot screenshot is copied like any other");
  // The manifest lives ABOVE public/ (so Vite never ships it) and stores paths
  // relative to public/ (never host-absolute: no checkout-path leak, and a
  // stray manifest can't authorize deletes outside the output root).
  const manifestPath = join(outPublicDir, "..", ".gen-manifest.json");
  const relTo = (abs) => relative(outPublicDir, abs);
  assert.ok(!existsSync(join(outPublicDir, ".gen-manifest.json")), "manifest must not sit inside public/");
  // Each entry is { path, sha256 }: the digest is what keeps reconciliation
  // from deleting a path whose bytes somebody else replaced since.
  const paths = (m) => m.map((e) => e.path);
  const manifest1 = JSON.parse(readFileSync(manifestPath, "utf-8"));
  assert.ok(paths(manifest1).every((e) => !isAbsolute(e)), "manifest entries must be relative, not absolute");
  assert.ok(manifest1.every((e) => /^[0-9a-f]{64}$/.test(e.sha256)), "every entry carries its digest");
  assert.ok(paths(manifest1).includes(relTo(fontDest)));
  assert.ok(paths(manifest1).includes(relTo(shotDest)));
  assert.ok(paths(manifest1).includes(relTo(dottedDest)), "and is recorded as owned");

  // Reconfigure without the font/screenshot, as if the config entry was
  // removed or renamed.
  const cfgWithout = join(root, "without.config.json");
  writeFileSync(
    cfgWithout,
    JSON.stringify({ title: "T", source: "src", designs: [{ id: "d", label: "D" }] })
  );
  generate({ ...base, configPath: cfgWithout });
  assert.ok(!existsSync(fontDest), "stale generated font copy should be removed");
  assert.ok(!existsSync(shotDest), "stale screenshot should be removed");
  assert.ok(!existsSync(dottedDest), "and so should a stale leading-dot one");

  // Final manifest matches disk: every recorded path still exists, and
  // nothing recorded is stale.
  const manifest2 = JSON.parse(readFileSync(manifestPath, "utf-8"));
  assert.ok(!paths(manifest2).includes(relTo(fontDest)));
  assert.ok(!paths(manifest2).includes(relTo(shotDest)));
  assert.ok(!paths(manifest2).includes(relTo(dottedDest)));
  for (const p of paths(manifest2))
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
      // The catch-all picks up d.scad, which buildDesigns already copied: the
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
  const outArtDir = join(outPublicDir, "art");
  const outSchemaDir = join(out, "schema");
  const base = { outSchemaDir, outScadDir, outArtDir, outPublicDir };
  // A good build first.
  generate({ ...base, configPath: join(FIXTURES, "widget.config.json") });
  const beforeScad = readdirSync(outScadDir).sort();
  const beforeArt = readdirSync(outArtDir).sort();
  const beforeSchema = readFileSync(join(outSchemaDir, "designs.json"));
  const iconPath = join(outPublicDir, "icon-192.png");
  const beforeIcon = existsSync(iconPath) ? readFileSync(iconPath) : null;

  // A build whose configured icon can't rasterize fails AFTER staging the new
  // scad/art trees but before the commit, so scad, art, schema, and the icons
  // must all stay exactly as the last good build left them (no new-scad/
  // old-schema mismatch, no clobbered/deleted last-good icon).
  assert.throws(
    () => generate({ ...base, configPath: join(FIXTURES, "widget-badicon.config.json") }),
    /icon rasterization failed/
  );
  assert.deepEqual(readdirSync(outScadDir).sort(), beforeScad);
  assert.deepEqual(readdirSync(outArtDir).sort(), beforeArt);
  assert.deepEqual(readFileSync(join(outSchemaDir, "designs.json")), beforeSchema);
  if (beforeIcon) assert.deepEqual(readFileSync(iconPath), beforeIcon);
});

// A failure LATER in generatePwaAssets than icon rasterization: the
// `pwa.screenshots[].src` existence check, which used to run after
// pwa-assets.mjs had already written the (successfully rasterized) icon/
// splash PNGs directly to outPublicDir. That's the gap the deferred-write
// batch (pwa-assets.mjs's `batch`/commitPwaBatch, flushed only at generate()'s
// single commit point) closes: unlike the widget-badicon case above, where
// rasterization itself is the failure, so nothing is written either way. This
// fixture's icon is valid, so the icon/splash batch fully rasterizes and only
// the screenshot check after it fails. Without the batch that lands new
// icon/splash bytes beside the STALE scad tree/schema/manifest; this asserts
// it doesn't.
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
      render: { fonts: ["Face.ttf"], fontFallback: "Liberation Sans" },
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
  // via a malformed icon: after bundleFonts, before the commit.
  copyFileSync(BOLD, join(src, "Face.ttf"));
  // A real SVG that resvg refuses (zero size), so the failure lands at
  // RASTERIZATION (after bundleFonts, before the commit) rather than at the
  // sanitizer's parse — which is the window this test is about. See
  // tests/fixtures/bad-icon.svg.
  writeFileSync(
    join(root, "bad.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>`
  );
  const bad = join(root, "bad.config.json");
  writeFileSync(
    bad,
    JSON.stringify({
      title: "T",
      source: "src",
      // A different string for the same bundled family: fonts.conf's rendered
      // text changes (so a commit would rewrite it) while the fallback still
      // names a family this build ships.
      render: { fonts: ["Face.ttf"], fontFallback: "liberation sans" },
      pwa: { icon: "bad.svg" },
      designs: [{ id: "d", label: "D" }],
    })
  );
  assert.throws(() => generate({ ...base, configPath: bad }), /icon rasterization failed/);

  // The last-good font bytes and fonts.conf must be untouched.
  assert.deepEqual(readFileSync(fontDest), beforeFont, "font bytes must survive the failed build");
  assert.deepEqual(readFileSync(confDest), beforeConf, "fonts.conf must survive the failed build");
  // Sanity: the Bold source is genuinely different bytes, so the assertion above is meaningful.
  assert.notDeepEqual(readFileSync(BOLD), beforeFont);
});

// M13: browser-facing SVGs (logo, PWA icon, design picker icon — the first
// and third land in public/art/, the PWA icon at the served root) are run
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
  // import()/surface()) is copied verbatim: sanitizing it risks perturbing
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
// the invariant here is what lets them all read the mode.
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

// ── a config font may not shadow a tracked bundled one ─────────────────────
// bundleFonts keys the destination on the font's basename, so a config listing
// `myfonts/LiberationSans-Regular.ttf` aims at a file the repo tracks. Letting
// that copy through recorded a TRACKED path in .gen-manifest.json, and the next
// build against a config without the entry deleted repo content.

test("isTrackedFile reports what git tracks, and false outside a working tree", () => {
  assert.equal(isTrackedFile("/repo/public/fonts/F.ttf", () => "public/fonts/F.ttf"), true);
  assert.equal(isTrackedFile("/repo/public/fonts/F.ttf", () => ""), false);
});

// A throwaway checkout with a tracked public/fonts/<name>, so the collision is
// the real one rather than a stub's opinion.
function checkoutWithTrackedFont(prefix, name) {
  const checkout = mkdtempSync(join(tmpdir(), prefix));
  execFileSync("git", ["init", "-q", checkout]);
  const outPublicDir = join(checkout, "public");
  mkdirSync(join(outPublicDir, "fonts"), { recursive: true });
  copyFileSync(
    join(HERE, "..", "public", "fonts", "LiberationSans-Regular.ttf"),
    join(outPublicDir, "fonts", name)
  );
  execFileSync("git", ["-C", checkout, "add", "-A"]);
  execFileSync("git", [
    "-C", checkout,
    "-c", "user.email=test@example.com",
    "-c", "user.name=Test",
    "commit", "-q", "-m", "bundled font",
  ]);
  return { checkout, outPublicDir };
}

function externalFontConfig(prefix, fontEntry, fontFileName) {
  const src = mkdtempSync(join(tmpdir(), prefix));
  const dir = dirname(join(src, fontEntry));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(src, "d.scad"), `/* [Main] */\n// Font.\nfont = "Liberation Sans";\n`);
  copyFileSync(
    join(HERE, "..", "public", "fonts", fontFileName),
    join(src, fontEntry)
  );
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({
      title: "T",
      source: ".",
      render: { fonts: [fontEntry], fontFallback: "Liberation Sans" },
      designs: [{ id: "d", label: "D" }],
    })
  );
  return src;
}

test("a config font whose basename shadows a tracked bundled font fails the build", () => {
  const { checkout, outPublicDir } = checkoutWithTrackedFont(
    "gen-schema-fontshadow-",
    "LiberationSans-Regular.ttf"
  );
  const src = externalFontConfig(
    "gen-schema-fontshadow-src-",
    "myfonts/LiberationSans-Regular.ttf",
    "LiberationSans-Regular.ttf"
  );
  assert.throws(
    () =>
      generate({
        configPath: join(src, "c.config.json"),
        outSchemaDir: join(checkout, "schema"),
        outScadDir: join(checkout, "scad"),
        outPublicDir,
      }),
    /would overwrite the bundled font/
  );
  // …and left the tracked file untouched.
  assert.equal(
    execFileSync("git", ["-C", checkout, "status", "--porcelain", "--", "public"], {
      encoding: "utf8",
    }),
    ""
  );
});

test("an external-config font copy is cleaned up by the next build, and never a changed file", () => {
  const { checkout, outPublicDir } = checkoutWithTrackedFont(
    "gen-schema-reconcile-",
    "LiberationSans-Regular.ttf"
  );
  const withFont = externalFontConfig(
    "gen-schema-reconcile-src-",
    "Face.ttf",
    "LiberationSans-Bold.ttf"
  );
  const build = (configPath) =>
    generate({
      configPath,
      outSchemaDir: join(checkout, "schema"),
      outScadDir: join(checkout, "scad"),
      outPublicDir,
    });

  build(join(withFont, "c.config.json"));
  const copied = join(outPublicDir, "fonts", "Face.ttf");
  assert.ok(existsSync(copied), "the external font was copied in");

  // A config of this checkout's own, listing no external font.
  const own = mkdtempSync(join(tmpdir(), "gen-schema-reconcile-own-"));
  writeFileSync(join(own, "d.scad"), `/* [Main] */\n// Size.\nsize = 1;\n`);
  writeFileSync(
    join(own, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", designs: [{ id: "d", label: "D" }] })
  );
  build(join(own, "c.config.json"));
  assert.ok(!existsSync(copied), "the transient copy was reconciled away");

  // Same round trip, except the copy is replaced between builds: those bytes
  // are somebody else's now, so reconciliation must leave them alone.
  build(join(withFont, "c.config.json"));
  writeFileSync(copied, "not the font this tool wrote");
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    build(join(own, "c.config.json"));
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(existsSync(copied), "a changed file is not this tool's to delete");
  assert.ok(warnings.some((w) => w.includes("Face.ttf")), "and it says so");

  // The window gen-schema's own external-font warning describes: the transient
  // copy is committed UNCHANGED. It wasn't tracked when it was copied, so the
  // copy-time guard never saw it, and its bytes still digest clean, so the
  // digest guard passes it through. Only a tracked-at-delete-time check saves
  // it — without one, a build silently deletes a committed file.
  build(join(withFont, "c.config.json"));
  execFileSync("git", ["-C", checkout, "add", "--", "public/fonts/Face.ttf"]);
  // The identity is supplied explicitly, like every other commit in this file:
  // a CI runner has no global user.name/user.email, so a bare `git commit`
  // fails there with "empty ident name" while passing on any developer machine.
  execFileSync("git", [
    "-C", checkout,
    "-c", "user.email=test@example.com",
    "-c", "user.name=Test",
    "commit", "-q", "-m", "add font",
  ]);
  const trackedWarnings = [];
  console.warn = (msg) => trackedWarnings.push(msg);
  try {
    build(join(own, "c.config.json"));
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(existsSync(copied), "a git-tracked file is not this tool's to delete");
  assert.ok(
    trackedWarnings.some((w) => w.includes("Face.ttf") && w.includes("tracked by git")),
    "and it says why"
  );
});

// ── a pwa.screenshots[].src may not shadow a tracked file ──────────────────
// copy() (pwa-assets.mjs) resolves the destination from the source's bare
// basename, same as the font path above; a screenshot named e.g. `shots/sw.js`
// aimed at the tracked public/sw.js, and the collision entered
// .gen-manifest.json so the next build reconciled (deleted) it.
test("a pwa screenshot whose basename shadows a tracked file fails the build", () => {
  const checkout = mkdtempSync(join(tmpdir(), "gen-schema-shotshadow-"));
  execFileSync("git", ["init", "-q", checkout]);
  const outPublicDir = join(checkout, "public");
  mkdirSync(outPublicDir, { recursive: true });
  const trackedBytes = "// the real service worker\n";
  writeFileSync(join(outPublicDir, "sw.js"), trackedBytes);
  execFileSync("git", ["-C", checkout, "add", "-A"]);
  execFileSync("git", [
    "-C", checkout,
    "-c", "user.email=test@example.com",
    "-c", "user.name=Test",
    "commit", "-q", "-m", "tracked sw.js",
  ]);

  const src = mkdtempSync(join(tmpdir(), "gen-schema-shotshadow-src-"));
  mkdirSync(join(src, "shots"), { recursive: true });
  writeFileSync(join(src, "d.scad"), `/* [Main] */\n// Size.\nsize = 1;\n`);
  writeFileSync(join(src, "shots", "sw.js"), "not a screenshot at all");
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({
      title: "T",
      source: ".",
      designs: [{ id: "d", label: "D" }],
      pwa: { screenshots: [{ src: "shots/sw.js", sizes: "1x1", form_factor: "wide" }] },
    })
  );

  assert.throws(
    () =>
      generate({
        configPath: join(src, "c.config.json"),
        outSchemaDir: join(checkout, "schema"),
        outScadDir: join(checkout, "scad"),
        outPublicDir,
      }),
    /screenshot 'shots\/sw\.js'.*would overwrite the tracked file.*sw\.js/s
  );
  assert.equal(readFileSync(join(outPublicDir, "sw.js"), "utf8"), trackedBytes);
});

// ── build-time validation gaps ─────────────────────────────────────────────
// Each of these built green and failed later — in vite-config, in the browser,
// or not at all — rather than as a named gen-schema error at the key.

test("top-level scalars are validated against their CONFIG_SPEC descriptors", () => {
  // The descriptors existed but were inert, so `"title": 42` reached
  // vite-config as a raw TypeError instead of naming the key.
  assert.throws(() => run("widget-bad-title.config.json"), /'title'/);
  assert.throws(() => run("widget-bad-source.config.json"), /'source'/);
  assert.throws(() => run("widget-bad-extracss.config.json"), /'extraCss'/);
});

test("a wrongly-typed designs/assets fails instead of silently auto-discovering", () => {
  // `Array.isArray(x) && x.length` fell through to auto-discovery for both
  // "absent" and "present but wrong", the one place the fail-fast convention
  // was inverted: the list its author wrote was silently ignored.
  assert.throws(() => run("widget-designs-notarray.config.json"), /'designs', when set/);
  assert.throws(() => run("widget-designs-empty.config.json"), /'designs', when set/);
  assert.throws(() => run("widget-assets-notarray.config.json"), /'assets', when set/);
  // Omitting the key entirely still auto-discovers.
  assert.ok(run("default-source.config.json").schema.designs.length > 0);
});

test("a malformed help block fails the build, not the browser", () => {
  // resolveHelp passed a non-object through verbatim; src/lib/schema.ts then
  // threw at runtime, so `"help": 42` shipped.
  assert.throws(() => run("widget-help-notobject.config.json"), /'help', when set/);
  assert.throws(() => run("widget-help-badtab.config.json"), /'help\.tabs\[0\]'/);
});

// The build and the runtime must agree about `help`, in both directions. The
// test above shared its name with that claim while checking two shapes; these
// check the property itself, against the validator that would otherwise be the
// one to find out — at app-module initialisation, so several of these did not
// break a modal, they stopped the app booting at all.
// A real generated schema, so validateSchema is judging only the `help` swapped
// into it — every other key is whatever the repo's own build produced.
const MINIMAL_SCHEMA = JSON.parse(
  readFileSync(join(HERE, "..", "src", "generated", "designs.json"), "utf-8")
);

const MALFORMED_HELP = [
  ["neither sections nor tabs", {}],
  ["a non-array tabs", { tabs: "bad" }],
  ["a section whose title is not a string", { sections: [{ title: 42, body: "x" }] }],
  ["a section with no body", { sections: [{ title: "T" }] }],
  ["a tab with no label", { tabs: [{ sections: [] }] }],
  ["a tab whose sections are missing", { tabs: [{ label: "T" }] }],
  ["a tab section that is not a section", { tabs: [{ label: "T", sections: [{ body: "x" }] }] }],
  ["a non-string title", { title: 42, sections: [] }],
  ["a non-string intro", { intro: 42, sections: [] }],
  ["an array", []],
];

test("every help shape the app rejects at startup is rejected by the build", () => {
  const mustExist = (abs) => abs;
  for (const [what, help] of MALFORMED_HELP) {
    assert.throws(() => resolveHelp(help, "/cfg", mustExist), /gen-schema:/, what);
    // And it really is what the runtime would have rejected, not a build-only
    // opinion: the same shape must fail validateSchema too.
    assert.throws(
      () => validateSchema({ ...MINIMAL_SCHEMA, help }),
      /Invalid designs schema/,
      what
    );
  }
});

test("a well-formed help block passes both, including a file-derived one", () => {
  const mustExist = (abs) => abs;
  for (const help of [
    { sections: [{ title: "T", body: "B" }] },
    { title: "Help", intro: "Hi", sections: [{ title: "T", body: "B" }] },
    { tabs: [{ label: "Basics", sections: [{ title: "T", body: "B" }] }] },
    { tabs: [{ label: "Basics", intro: "Hi", sections: [{ title: "T", body: "B" }] }] },
    { sections: [{ title: "T", body: "B" }], tabs: [{ label: "More", sections: [] }] },
  ]) {
    const resolved = resolveHelp(help, "/cfg", mustExist);
    assert.deepEqual(resolved, help);
    assert.doesNotThrow(() => validateSchema({ ...MINIMAL_SCHEMA, help: resolved }));
  }
});

test("a help block whose sections come from a file is checked AFTER resolution", () => {
  // `{ file }` carries neither `sections` nor `tabs` until splitHelpMarkdown
  // has run, so checking the raw config would reject every file-sourced pane.
  const dir = mkdtempSync(join(tmpdir(), "gen-schema-help-"));
  writeFileSync(join(dir, "help.md"), "Intro line.\n\n## Setup\n\nDo the thing.\n");
  const resolved = resolveHelp({ file: "help.md" }, dir, (abs) => abs);
  assert.deepEqual(resolved.sections, [{ title: "Setup", body: "Do the thing." }]);
  assert.doesNotThrow(() => validateSchema({ ...MINIMAL_SCHEMA, help: resolved }));
});

test("render.fontFallback must name one of the bundled families", () => {
  // docs/config.md states the rule; nothing enforced it, so a typo pinned
  // fonts.conf's last-resort family to a name Fontconfig cannot resolve.
  assert.throws(
    () => runWithPublic("widget-fontfallback-unknown.config.json"),
    /not one of the bundled font families/
  );
});

test("an id of dots alone is rejected, charset notwithstanding", () => {
  assert.throws(() => run("widget-dot-id.config.json"), /not be dots alone/);
});

test("a design's file must be a .scad path", () => {
  // Otherwise its `<name>.json` sibling is read as parameterSets while the
  // design itself is parsed as OpenSCAD: both roles inverted.
  assert.throws(() => run("widget-file-notscad.config.json"), /must be a \.scad path/);
});

test("a malformed parameterSets file names itself in the error", () => {
  assert.throws(
    () => run("widget-badpreset-json.config.json"),
    /parameterSets file 'badpreset\.json' is not valid JSON/
  );
});

test("a browser-facing SVG that is not well-formed names its file, at BOTH entry points", () => {
  // docs/config.md promises "fails the build, naming the file". copyBrowserFacing
  // wrapped the sanitizer to do that; pwa-assets called it bare, so a broken
  // `pwa.icon` produced a raw parser error naming neither the key nor the path.
  // Neither throw path had a test.
  const root = mkdtempSync(join(tmpdir(), "gen-schema-badsvg-"));
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "widget.scad"), `/* [Main] */\n// A.\na = 1;\n`);
  writeFileSync(join(root, "broken.svg"), `<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>`);

  const build = (extra) => {
    const out = mkdtempSync(join(tmpdir(), "gen-schema-out-"));
    const cfg = join(root, `${Object.keys(extra)[0]}.config.json`);
    writeFileSync(
      cfg,
      JSON.stringify({ title: "T", source: "src", designs: [{ id: "widget", label: "W" }], ...extra })
    );
    return () =>
      generate({
        configPath: cfg,
        outSchemaDir: join(out, "schema"),
        outScadDir: join(out, "public", "scad"),
        outPublicDir: join(out, "public"),
      });
  };

  // The logo path (copyBrowserFacing).
  assert.throws(build({ logo: "broken.svg" }), (e) => {
    assert.match(e.message, /is not a usable SVG/);
    assert.match(e.message, /broken\.svg/, "the message must name the file");
    return true;
  });
  // The PWA icon path (pwa-assets), which used to throw a bare parser error.
  assert.throws(build({ pwa: { icon: "broken.svg" } }), (e) => {
    assert.match(e.message, /is not a usable SVG/);
    assert.match(e.message, /broken\.svg/, "the message must name the file");
    assert.match(e.message, /icon/, "and say which config key it came from");
    return true;
  });
});

test("a well-formed document that is not an SVG fails the build and names the file", () => {
  // It used to be emptied rather than refused: every element failed the
  // allowlist, and what shipped was a file with no root. Now the build stops,
  // through each of the three browser-facing entry points.
  const root = mkdtempSync(join(tmpdir(), "gen-schema-notsvg-"));
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "widget.scad"), `/* [Main] */\n// A.\na = 1;\n`);
  const NOTSVG = `<notsvg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></notsvg>`;
  writeFileSync(join(root, "notsvg.svg"), NOTSVG);
  writeFileSync(join(src, "notsvg.svg"), NOTSVG);
  // The design icon comes from the source's own `// @icon` annotation.
  writeFileSync(
    join(src, "iconed.scad"),
    `// @icon notsvg.svg\n/* [Main] */\n// A.\na = 1;\n`
  );

  // Each entry names the destination that path would have written, so "no
  // husk" is asked about the file this case could actually have left behind.
  for (const [what, extra, dest] of [
    ["logo", { logo: "notsvg.svg" }, ["public", "art", "notsvg.svg"]],
    ["pwa.icon", { pwa: { icon: "notsvg.svg" } }, ["public", "icon.svg"]],
    ["a design @icon", { designs: [{ id: "iconed", label: "I" }] }, ["public", "art", "notsvg.svg"]],
  ]) {
    const out = mkdtempSync(join(tmpdir(), "gen-schema-out-"));
    const cfg = join(root, `notsvg-${what.replace(/\W/g, "")}.config.json`);
    writeFileSync(
      cfg,
      JSON.stringify({ title: "T", source: "src", designs: [{ id: "widget", label: "W" }], ...extra })
    );
    assert.throws(
      () =>
        generate({
          configPath: cfg,
          outSchemaDir: join(out, "schema"),
          outScadDir: join(out, "public", "scad"),
          outPublicDir: join(out, "public"),
        }),
      (e) => {
        assert.match(e.message, /root must be <svg/, what);
        assert.match(e.message, /notsvg\.svg/, `${what}: the message names the file`);
        return true;
      },
      what
    );
    // And nothing was left behind for a server to hand out — not at the
    // destination, and not in the staging directory the commit would have
    // moved into place either.
    assert.ok(
      !existsSync(join(out, ...dest)),
      `${what}: no husk of an asset survives the refusal (${dest.join("/")})`
    );
    const strays = readdirSync(join(out, "public"), { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.svg$/i.test(d.name))
      .map((d) => join(d.parentPath ?? d.path, d.name));
    assert.deepEqual(strays, [], `${what}: nor anywhere under public/, staging included`);
  }
});

test("an SVG screenshot is sanitized too, not just the icon", () => {
  // The rule belongs to "operator file that lands in the served root", not to
  // `pwa.icon`. A screenshot is copied to a navigable same-origin URL by the
  // same helper, and it used to go out byte-for-byte.
  const root = mkdtempSync(join(tmpdir(), "gen-schema-shotsvg-"));
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "widget.scad"), `/* [Main] */\n// A.\na = 1;\n`);
  writeFileSync(
    join(root, "shot.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">` +
      `<script>fetch("https://evil.invalid/x")</script>` +
      `<rect width="64" height="64" fill="#123456"/></svg>`
  );
  const out = mkdtempSync(join(tmpdir(), "gen-schema-out-"));
  const cfg = join(root, "shotsvg.config.json");
  writeFileSync(
    cfg,
    JSON.stringify({
      title: "T",
      source: "src",
      designs: [{ id: "widget", label: "W" }],
      pwa: { screenshots: [{ src: "shot.svg", sizes: "64x64", form_factor: "narrow" }] },
    })
  );
  generate({
    configPath: cfg,
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "public", "scad"),
    outPublicDir: join(out, "public"),
  });
  const shipped = readFileSync(join(out, "public", "shot.svg"), "utf-8");
  assert.doesNotMatch(shipped, /script|evil\.invalid/, "the script is gone from what ships");
  assert.match(shipped, /#123456/, "and the artwork survives");

  // And the manifest describes what it actually shipped. `type` was hardcoded
  // to image/png for every screenshot whatever its format, which is the one
  // thing a launcher reads to decide whether it can display the image at all.
  const manifest = JSON.parse(readFileSync(join(out, "public", "manifest.webmanifest"), "utf-8"));
  assert.deepEqual(manifest.screenshots, [
    { src: "shot.svg", sizes: "64x64", type: "image/svg+xml", form_factor: "narrow" },
  ]);
});

test("a screenshot's manifest type follows its real format", () => {
  const root = mkdtempSync(join(tmpdir(), "gen-schema-shottype-"));
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "widget.scad"), `/* [Main] */\n// A.\na = 1;\n`);
  for (const name of ["a.png", "b.jpg", "c.bin"])
    writeFileSync(join(root, name), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const out = mkdtempSync(join(tmpdir(), "gen-schema-out-"));
  const cfg = join(root, "shottype.config.json");
  writeFileSync(
    cfg,
    JSON.stringify({
      title: "T",
      source: "src",
      designs: [{ id: "widget", label: "W" }],
      pwa: {
        screenshots: ["a.png", "b.jpg", "c.bin"].map((s) => ({
          src: s,
          sizes: "64x64",
          form_factor: "narrow",
        })),
      },
    })
  );
  generate({
    configPath: cfg,
    outSchemaDir: join(out, "schema"),
    outScadDir: join(out, "public", "scad"),
    outPublicDir: join(out, "public"),
  });
  const { screenshots } = JSON.parse(
    readFileSync(join(out, "public", "manifest.webmanifest"), "utf-8")
  );
  assert.deepEqual(
    screenshots.map((s) => [s.src, s.type]),
    // An extension this doesn't know carries no `type` at all — the member is
    // optional, and no claim beats a false one.
    [
      ["a.png", "image/png"],
      ["b.jpg", "image/jpeg"],
      ["c.bin", undefined],
    ]
  );
  assert.ok(!("type" in screenshots[2]), "the key is absent, not present-and-undefined");
});

test("a browser-facing SVG that IS sanitized says so, at BOTH entry points", () => {
  // The throw path above was shared; the removal-reporting path was not, so
  // sanitizing `pwa.icon` was silent: the external reference was stripped and
  // the operator learned nothing. Both go through sanitizeBrowserFacingSvg now,
  // and this asserts the warning AND the bytes that reach disk.
  const root = mkdtempSync(join(tmpdir(), "gen-schema-scrubsvg-"));
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "widget.scad"), `/* [Main] */\n// A.\na = 1;\n`);
  // Well-formed and renderable, but carries an off-document reference the
  // allowlist removes.
  writeFileSync(
    join(root, "dirty.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">` +
      `<image href="https://example.invalid/p.png" width="64" height="64"/>` +
      `<rect width="64" height="64" fill="#123456"/></svg>`
  );

  const build = (extra, name) => {
    const out = mkdtempSync(join(tmpdir(), "gen-schema-out-"));
    const cfg = join(root, `${name}.config.json`);
    writeFileSync(
      cfg,
      JSON.stringify({ title: "T", source: "src", designs: [{ id: "widget", label: "W" }], ...extra })
    );
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...a) => warnings.push(a.join(" "));
    try {
      generate({
        configPath: cfg,
        outSchemaDir: join(out, "schema"),
        outScadDir: join(out, "public", "scad"),
        outPublicDir: join(out, "public"),
      });
    } finally {
      console.warn = realWarn;
    }
    return { out, warnings };
  };

  for (const [what, extra, written] of [
    ["logo", { logo: "dirty.svg" }, ["public", "art", "dirty.svg"]],
    ["pwa icon", { pwa: { icon: "dirty.svg" } }, ["public", "icon.svg"]],
  ]) {
    const { out, warnings } = build(extra, `dirty-${what.replace(/\W/g, "")}`);
    const sanitized = warnings.filter((w) => w.includes("sanitized"));
    assert.equal(sanitized.length, 1, `${what}: exactly one sanitize warning (got ${warnings})`);
    assert.match(sanitized[0], /dirty\.svg/, `${what}: the warning names the source file`);
    assert.match(sanitized[0], /removed:.*\S/, `${what}: and says what it removed`);
    // And the file that ships carries the scrub, not the original bytes.
    const text = readFileSync(join(out, ...written), "utf-8");
    assert.ok(!text.includes("example.invalid"), `${what}: the external reference is gone`);
    assert.ok(text.includes("#123456"), `${what}: the rest of the artwork survives`);
  }
  // The key name only exists on the pwa path; assert it there specifically.
  const { warnings } = build({ pwa: { icon: "dirty.svg" } }, "dirty-key");
  assert.ok(
    warnings.some((w) => w.includes("sanitized") && w.includes("pwa 'icon'")),
    "the pwa warning names the config key, not just the path"
  );
});

test("pwa.screenshots: a valid entry reaches the manifest, a null or partial one does not", () => {
  // The sibling `shortcuts` path already guarded null; screenshots threw a bare
  // "cannot read properties of null". But "generate() did not throw" is all the
  // previous assertion checked, so a regression that emitted `{src: undefined}`
  // — or one that dropped the VALID screenshot too — shipped green. The
  // manifest is what the browser reads, so read the manifest.
  const { out } = runWithPublic("widget-screenshot-null.config.json");
  const manifest = JSON.parse(
    readFileSync(join(out, "public", "manifest.webmanifest"), "utf-8")
  );
  const shots = manifest.screenshots ?? [];
  assert.equal(shots.length, 1, `exactly the one complete entry survives: ${JSON.stringify(shots)}`);
  assert.equal(shots[0].sizes, "640x480");
  assert.equal(shots[0].form_factor, "wide");
  assert.ok(shots[0].src, "and it carries a real src");
  assert.ok(!/undefined/.test(JSON.stringify(shots)), "nothing undefined reaches the manifest");
  // The copied file is really there, or the entry points at a 404.
  assert.ok(
    existsSync(join(out, "public", shots[0].src)),
    `${shots[0].src} should have been copied into the served tree`
  );
});

test("extOf refuses an extension that could steer a generated write", () => {
  // The result is spliced into `${id}-icon${ext}`; only a real extension may
  // reach that name.
  assert.equal(extOf("art/icon.svg"), ".svg");
  assert.equal(extOf("art/icon"), "");
  assert.equal(extOf(".gitignore"), "");
  assert.equal(extOf("art/icon.svg/../../escape"), "");
});

test("the precache manifest covers gallery artwork and preset thumbnails", () => {
  // A deployment using either renders a broken screen offline without them.
  const { out } = runWithPublic("widget-presetimages-dir.config.json");
  const manifest = JSON.parse(
    readFileSync(join(out, "public", "precache-manifest.json"), "utf-8")
  );
  const schema = JSON.parse(readFileSync(join(out, "schema", "designs.json"), "utf-8"));
  for (const d of schema.designs) {
    if (d.image) assert.ok(manifest.shell.includes(d.image), `image ${d.image} precached`);
    for (const url of Object.values(d.presetImages ?? {}))
      assert.ok(manifest.shell.includes(url), `preset image ${url} precached`);
  }
  // The fixture must actually exercise it, or this test proves nothing.
  assert.ok(
    schema.designs.some((d) => Object.keys(d.presetImages ?? {}).length > 0),
    "fixture has preset images"
  );
});

// ── Customizer parser hardening ────────────────────────────────────────────
// Each case below either dropped a real parameter, invented one that `-D`
// cannot reach, or corrupted a value that contained the parser's own
// separators.

const parseError = (body) => {
  try {
    parseOf(body);
  } catch (e) {
    return e.message;
  }
  return null;
};

test("a trailing free-text comment doesn't drop the parameter", () => {
  // `wall = 2; // in mm` matched neither PARAM_RE nor a doc line, so the
  // parameter silently vanished from the form while staying a real variable.
  const { params } = parseOf(
    `/* [Main] */\n` +
      `// Wall thickness.\n` +
      `wall = 2; // in mm\n` +
      `// Depth.\n` +
      `depth = 3; /* mm */\n` +
      `// Mode.\n` +
      `mode = "a"; // [a, b]\n`
  );
  assert.deepEqual(
    params.map((p) => [p.name, p.type, p.default]),
    [
      ["wall", "number", 2],
      ["depth", "number", 3],
      ["mode", "enum", "a"],
    ]
  );
  // The real hint still wins over the free-text branch.
  assert.deepEqual(
    params.find((p) => p.name === "mode").choices.map((c) => c.value),
    ["a", "b"]
  );
});

test("assignments inside a block comment or a module body are not parameters", () => {
  // Both are invisible to `-D`, so a control for either does nothing.
  const { params } = parseOf(
    `/* [Main] */\n` +
      `// Real.\n` +
      `real = 1;\n` +
      `/*\n` +
      `// Commented out.\n` +
      `ghost = 2;\n` +
      `*/\n` +
      `module thing() {\n` +
      `  // Local.\n` +
      `  local = 3;\n` +
      `}\n` +
      `function f(x) = let(inner = 4) x;\n` +
      `// After.\n` +
      `after = 5;\n`
  );
  assert.deepEqual(
    params.map((p) => p.name),
    ["real", "after"]
  );
});

test("a brace inside a string doesn't open a scope", () => {
  const { params } = parseOf(
    `/* [Main] */\n// Label.\nlabel = "a { b";\n// Size.\nsize = 1;\n`
  );
  assert.deepEqual(
    params.map((p) => p.name),
    ["label", "size"]
  );
});

test("enum choices and @showIf clauses split outside quotes", () => {
  // `["a,b", "c"]` became three choices; `mode=="a||b"` became two clauses,
  // the second ungrammatical.
  const { params } = parseOf(
    `/* [Main] */\n` +
      `// Mode.\n` +
      `mode = "a,b"; // ["a,b", "c"]\n` +
      `// Label.\n` +
      `// @showIf mode=="a,b"\n` +
      `label = "x";\n`
  );
  assert.deepEqual(
    params.find((p) => p.name === "mode").choices.map((c) => c.value),
    ["a,b", "c"]
  );
  assert.equal(params.find((p) => p.name === "label").showIf, 'mode=="a,b"');
  // A quoted `||` inside a comparison is a value, not a clause separator.
  assert.equal(parseError(`/* [Main] */\n// A.\na = "x";\n// B.\n// @showIf a=="p||q"\nb = 1;\n`), null);
});

test("a value-shaped label keeps its colon; only the separator splits", () => {
  const { params } = parseOf(
    `/* [Main] */\n// Ratio.\nratio = "1:2"; // ["1:2":Half as wide, "2:1":Twice as wide]\n`
  );
  assert.deepEqual(
    params[0].choices,
    [
      { value: '"1:2"', label: "Half as wide" },
      { value: '"2:1"', label: "Twice as wide" },
    ]
  );
});

test("string defaults are matched non-greedily and unescaped", () => {
  const { params } = parseOf(
    `/* [Main] */\n` +
      `// Concatenation.\n` +
      `joined = "a" + "b";\n` +
      `// Quoted.\n` +
      `quoted = "a\\"b";\n` +
      `// Newline.\n` +
      `multi = "a\\nb";\n`
  );
  const by = Object.fromEntries(params.map((p) => [p.name, p]));
  // An expression is an expression, not the literal `a" + "b`.
  assert.equal(by.joined.raw, true);
  assert.equal(by.joined.default, '"a" + "b"');
  assert.equal(by.quoted.default, 'a"b');
  assert.equal(by.multi.default, "a\nb");
});

test("a duplicate parameter name fails the build, naming both lines", () => {
  const msg = parseError(`/* [Main] */\n// A.\nwidth = 1;\n// Again.\nwidth = 2;\n`);
  assert.match(msg, /duplicate parameter 'width'/);
  assert.match(msg, /line 3/);
});

test("a wrapped comparison is not an assignment", () => {
  // `echo(…)` and `assert(…)` calls long enough to wrap put `name == …` at the
  // start of a line ending in `;`, which matched as an assignment and produced
  // a phantom parameter shadowing the real control of the same name.
  const { params } = parseOf(
    `/* [Main] */\n` +
      `// L.\n` +
      `label = "x";\n` +
      `echo("@review", "label",\n` +
      `     label == "" ? "no text" : label);\n` +
      `assert(\n` +
      `  label != "forbidden", "nope");\n`
  );
  assert.deepEqual(
    params.map((p) => [p.name, p.default]),
    [["label", "x"]]
  );
});

test("only CONTROLS collide: an assignment elsewhere sharing the name is fine", () => {
  // Every parameter is set with `-D`, and `-D` overrides an in-file assignment
  // wherever it appears — so a `[Hidden]` or preamble assignment of the same
  // name does NOT defeat the control, and rejecting one would fail a program
  // the engine runs correctly. scripts/check-scad-semantics.mjs asserts that
  // against the pinned build rather than leaving it as a belief.
  for (const src of [
    `/* [Main] */\n// W.\nwidth = 1;\n/* [Hidden] */\nwidth = 2;\n`,
    `/* [Hidden] */\nwidth = 2;\n/* [Main] */\n// W.\nwidth = 1;\n`,
    `$fn = 64;\nwidth = 0;\n/* [Main] */\n// W.\nwidth = 1;\n`,
    // Repeated assignment with no control involved at all: ordinary OpenSCAD.
    `/* [Hidden] */\nstep = 1;\nstep = 2;\n/* [Main] */\n// W.\nwidth = 1;\n`,
  ]) {
    assert.equal(parseError(src), null, src);
  }
  // The control is still declared exactly once.
  const { params } = parseOf(`/* [Main] */\n// W.\nwidth = 1;\n/* [Hidden] */\nwidth = 2;\n`);
  assert.deepEqual(
    params.map((p) => p.name),
    ["width"]
  );
  // Two real controls of one name remains a build failure: both write the same
  // variable, so the second silently shadows the first in the form.
  assert.match(
    parseError(`/* [Main] */\n// W.\nwidth = 1;\n// Again.\nwidth = 2;\n`),
    /duplicate parameter 'width'/
  );
});

test("two assignments on one line are two parameters, not one corrupted one", () => {
  // PARAM_RE's value group is lazy, so it stops at the first `;` — unless what
  // follows is neither whitespace nor a comment, in which case it backtracks
  // and swallows the `;` too. `d = 1; e = 2;` produced a single `d` whose
  // default was the string `1; e = 2`, and `e` never appeared at all.
  const { params } = parseOf(
    `/* [Main] */\n` +
      `// D.\n` +
      `d = 1; e = 2;\n` +
      `// F.\n` +
      `f = 3;\n`
  );
  assert.deepEqual(
    params.map((p) => [p.name, p.type, p.default]),
    [
      ["d", "number", 1],
      ["e", "number", 2],
      ["f", "number", 3],
    ]
  );
  // The doc block belongs to the first statement on the line; the second has
  // none, which is right — there was nowhere to write one.
  assert.equal(params[0].description, "D.");
  assert.equal(params[1].description, "");
});

test("a doc block above a non-parameter top-level statement doesn't leak onto the next parameter", () => {
  // A comment block sitting above a statement that isn't a Customizer
  // parameter (a bare call here) must not survive as pending state: it used
  // to stay pending and become the label/help of whatever parameter came
  // next.
  const params = paramsOf(
    `/* [Main] */\n` +
      `// Not a parameter's doc.\n` +
      `translate([0, 0, 1]);\n` +
      `// Real doc.\n` +
      `a = 1;\n`
  );
  assert.equal(params.length, 1);
  assert.equal(params[0].name, "a");
  assert.equal(params[0].description, "Real doc.");
});

test("a doc block above a bare function-call statement doesn't leak onto the next parameter", () => {
  // Another statement shape that fails PARAM_RE — same category as an
  // assignment sitting inside [Hidden] (both are top-level statements
  // pushParam never runs on). A later section's own header always
  // reset()s, so the leak is only observable within one still-open
  // section, as here.
  const params = paramsOf(
    `/* [Main] */\n` +
      `// Not a parameter's doc.\n` +
      `echo("debug");\n` +
      `// Real doc.\n` +
      `a = 1;\n`
  );
  assert.deepEqual(params.map((p) => p.name), ["a"]);
  assert.equal(params[0].description, "Real doc.");
});

test("code resumes after a block comment that closed mid-line", () => {
  // `a = 1; /* why */ b = 2;` is two parameters. Treating `/*` as the end of
  // the line's code — which it is for `//`, but not for a comment that closes —
  // lost `b` entirely.
  const { params } = parseOf(
    `/* [Main] */\n// A.\na = 1; /* explanatory */ b = 2;\n// C.\nc = 3;\n`
  );
  assert.deepEqual(
    params.map((p) => [p.name, p.default]),
    [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]
  );
  // An UNCLOSED block comment still ends the line; scanScope carries that state
  // to the next line.
  const { params: open } = parseOf(`/* [Main] */\n// A.\na = 1; /* opens here\nb = 2;\n*/\n`);
  assert.deepEqual(open.map((p) => p.name), ["a"]);
});

test("a block comment is whitespace wherever it sits in an assignment", () => {
  // OpenSCAD reads every one of these as an ordinary assignment — asserted
  // against the pinned build by scripts/check-scad-semantics.mjs, not assumed.
  // ScadPub read the first as a raw-string default of `/* c */ 1` and lost the
  // second and fourth entirely.
  const { params } = parseOf(
    `/* [Main] */\n` +
      `// A.\na = /* c */ 1;\n` +
      `// B.\nb /* c */ = 2;\n` +
      `// C.\nc = 3 /* c */;\n` +
      `// D.\nd = /* multi\n  line */ 4;\n`
  );
  assert.deepEqual(
    params.map((p) => [p.name, p.type, p.default]),
    [
      ["a", "number", 1],
      ["b", "number", 2],
      ["c", "number", 3],
      ["d", "number", 4],
    ]
  );
});

test("a multi-line comment inside an assignment keeps the whole parameter", () => {
  // Asserting the COMPLETE object, not [name, type, default]: the parameter was
  // produced correctly while its description, help and every annotation were
  // silently discarded, because resuming after the comment reset the pending
  // doc block as if this were an unrelated line.
  const { params } = parseOf(
    `/* [Main] */\n` +
      `// D label. More help.\n` +
      `// @advanced\n` +
      `// @info Dimension | mm\n` +
      `d = /* multi\n line */ 4;\n`
  );
  assert.equal(params.length, 1);
  assert.deepEqual(params[0], {
    name: "d",
    section: "Main",
    description: "D label.",
    help: "D label. More help.",
    type: "number",
    default: 4,
    advanced: true,
    info: { label: "Dimension", unit: "mm" },
  });
});

test("statements survive on both sides of a multi-line comment", () => {
  // The resumed line used to be matched against PARAM_RE directly rather than
  // being split into statements, so everything after the comment was swallowed
  // into the first parameter's default.
  for (const src of [
    `/* [Main] */\n// A.\na = 1; /* multi\n line */ b = 2;\n`,
    `/* [Main] */\n// A.\na = /* multi\n line */ 1; b = 2;\n`,
  ]) {
    const { params } = parseOf(src);
    assert.deepEqual(
      params.map((p) => [p.name, p.type, p.default]),
      [
        ["a", "number", 1],
        ["b", "number", 2],
      ],
      src
    );
  }
});

test("a multi-line comment inside a module does not swallow the tail after it", () => {
  // The code before an unclosed comment was carried to wherever it closed —
  // including when that code opened a module body, so `} b = 2;` was read as
  // `module m() { … b = 2;` and matched nothing.
  const { params } = parseOf(
    `/* [Main] */\nmodule m() { /* multi\n line */ inner = 9;\n} b = 2;\n// C.\nc = 3;\n`
  );
  assert.deepEqual(
    params.map((p) => [p.name, p.default]),
    [
      ["b", 2],
      ["c", 3],
    ]
  );
  assert.ok(!params.some((p) => p.name === "inner"), "a module's own local is not a control");
});

test("a multi-line comment before a module's brace does not eat the tail after it", () => {
  // The sibling of the module-tail case above, with the `{` on the line that
  // CLOSES the comment rather than the one that opens it. The continuation was
  // started at depth 0 (correctly, the line had not entered a body yet) and
  // then never cleared when the closing line raised the depth, so `} h = 3;`
  // was read as `module foo() … h = 3;` and h vanished.
  for (const [what, src] of [
    ["no comment", `/* [Main] */\nmodule foo() {\n q = 2;\n} h = 3;\n`],
    ["comment before the brace", `/* [Main] */\nmodule foo() /* c */ {\n q = 2;\n} h = 3;\n`],
    ["multi-line comment, brace on the closing line", `/* [Main] */\nmodule foo() /* c\nc */ {\n q = 2;\n} h = 3;\n`],
  ]) {
    const { params } = parseOf(src);
    assert.deepEqual(params.map((p) => [p.name, p.default]), [["h", 3]], what);
  }
});

test("a module neither hides what precedes it nor leaks what is inside it", () => {
  // The old line-wise scanner asked "did this LINE end at depth 0", so an
  // assignment sharing a line with a module lost — before it, after it, or
  // both — while a module local on its own line could be collected as a
  // control. The scanner is source-order now; each shape's expected controls
  // are pinned against the pinned engine too (scripts/check-scad-semantics.mjs).
  for (const [what, body, expected] of [
    ["before a module", `a = 1; module m() { z = 9; }`, ["a"]],
    ["either side", `a = 1; module m() { z = 9; } b = 2;`, ["a", "b"]],
    ["a body with its own semicolons", `a = 1; module m() { p = 1; q = 2; } b = 2;`, ["a", "b"]],
    ["two modules around one", `module m() { z = 1; } a = 1; module n() { y = 2; }`, ["a"]],
    ["nested braces, then a tail", `module m() { if (true) { z = 9; } } a = 1;`, ["a"]],
    ["a continued assignment before a module", `a = /* x\ny */ 1; module m() { z = 9; } b = 2;`, ["a", "b"]],
    ["a continued assignment after a module", `module m() { z = 9; } a = /* x\ny */ 1;`, ["a"]],
    ["a function definition, then an assignment", `function f(x) = x*2; a = f(2);`, ["a"]],
  ]) {
    const { params } = parseOf(`/* [Main] */\n${body}\n`);
    assert.deepEqual(params.map((p) => p.name), expected, what);
  }
});

test("use/include end at '>', not at a semicolon", () => {
  // They are the one statement form with no terminator the scanner would
  // otherwise recognise, so without this the rest of the file accumulated into
  // one never-ending statement and every section header after it was lost.
  // The gap before `<` is arbitrary whitespace, and a bound on how much of the
  // buffer the scanner would look at broke on it: `include` is already seven
  // characters, so two spaces stopped it being recognised and everything after
  // it — section headers included — vanished into one unterminated statement.
  for (const directive of [
    "use <dep.scad>",
    "include <dep.scad>",
    "include  <dep.scad>",
    "include\t\t<dep.scad>",
    "use      <dep.scad>",
    "include\n<dep.scad>",
    // No comment-inside-the-directive case: OpenSCAD's lexer reads `use <…>`
    // as one token and refuses the file (scripts/check-scad-semantics.mjs).
  ])
    // Before the first section header and after it: the first is what hides a
    // header, the second is what swallows the parameters under one.
    for (const [where, src] of [
      ["before the header", `${directive}\n/* [Main] */\n// A.\na = 1;\n/* [More] */\n// B.\nb = 2;\n`],
      ["after the header", `/* [Main] */\n${directive}\n// A.\na = 1;\n/* [More] */\n// B.\nb = 2;\n`],
    ]) {
      const { params, sections } = parseOf(src);
      const what = `${JSON.stringify(directive)} ${where}`;
      assert.deepEqual(
        params.map((p) => [p.name, p.section]),
        [["a", "Main"], ["b", "More"]],
        what
      );
      assert.ok(sections.includes("More"), `${what}: the later section header survives`);
    }

  // And the token is still matched exactly: a `<` that is less-than, and a
  // name that merely starts with one of the keywords, are untouched.
  assert.deepEqual(
    parseOf(`/* [Main] */\n// A.\na = 1 < 2 ? 3 : 4;\n// U.\nusex = 5;\n`).params.map((p) => p.name),
    ["a", "usex"]
  );
});

test("a comment marker inside a string is not a comment", () => {
  // The blanking pass is quote-aware, or a value would lose its own text.
  const { params } = parseOf(
    `/* [Main] */\n// A.\na = "keep /* this */ text";\n// B.\nb = "and // this";\n`
  );
  assert.deepEqual(
    params.map((p) => [p.name, p.default]),
    [
      ["a", "keep /* this */ text"],
      ["b", "and // this"],
    ]
  );
});

test("a semicolon inside a value or a comment is not a statement boundary", () => {
  // The split has to be quote-aware, and has to stop at a comment: a hint is
  // part of the statement it follows, not a statement of its own.
  const { params } = parseOf(
    `/* [Main] */\n` +
      `// Label.\n` +
      `label = "a;b";\n` +
      `// Mode.\n` +
      `mode = "a"; // [a, b]\n` +
      `// Wall.\n` +
      `wall = 2; // in mm; really\n`
  );
  const by = Object.fromEntries(params.map((p) => [p.name, p]));
  assert.equal(by.label.default, "a;b");
  assert.deepEqual(by.mode.choices.map((c) => c.value), ["a", "b"], "the hint still binds");
  assert.equal(by.wall.default, 2);
  assert.deepEqual(params.map((p) => p.name), ["label", "mode", "wall"]);
});

test("a parameter is read past a comment or block that closed on its own line", () => {
  // Desktop OpenSCAD reads all three; the scanner tracked the scope but only
  // ever consulted the tail on a line that STARTED inside one, so the
  // single-line forms silently dropped the parameter.
  const { params } = parseOf(
    `/* [Main] */\n` +
      `// A.\n` +
      `/* mm */ a = 1;\n` +
      `// B.\n` +
      `module m() { inner = 9; } b = 2;\n` +
      `// C.\n` +
      `c = 3; /* trailing */\n`
  );
  assert.deepEqual(
    params.map((p) => [p.name, p.default]),
    [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]
  );
  // The doc block above the line still belongs to it.
  assert.equal(params[0].description, "A.");
  // And the module's own body is still not Customizer surface.
  assert.ok(!params.some((p) => p.name === "inner"));
});

test("a section marker survives a blank line before its header", () => {
  // Both markers apply to the NEXT section header, and a blank line between
  // the two is how anyone writes it. Inside a section blank lines already kept
  // the pending state; before the first one they cleared it.
  const advanced = parseOf(`// @advanced\n\n/* [Tuning] */\n// A.\na = 1;\n`);
  assert.equal(advanced.params[0].advanced, true);
  const collapsed = parseOf(`// @collapsed\n\n/* [Tuning] */\n// A.\na = 1;\n`);
  assert.deepEqual(collapsed.collapsedSections, ["Tuning"]);
});

test("@advanced above the first section header is honoured", () => {
  // Its own documentation names this placement; the null-section guard dropped
  // it silently.
  const { params } = parseOf(
    `// @advanced\n/* [Tuning] */\n// A.\na = 1;\n/* [Main] */\n// B.\nb = 2;\n`
  );
  assert.equal(params.find((p) => p.name === "a").advanced, true);
  assert.equal(params.find((p) => p.name === "b").advanced, undefined);
});

test("a malformed @collapsed gets its own message, not the unknown-annotation one", () => {
  // The unknown-annotation error listed @collapsed among the valid annotations
  // while being the error that rejected it.
  const msg = parseError(`// @collapsed extra\n/* [Main] */\n// A.\na = 1;\n`);
  assert.match(msg, /malformed @collapsed annotation/);
  assert.doesNotMatch(msg, /unknown annotation/);
});

// ── Design translation sidecars (Phase 5) ───────────────────────────────────
// scripts/lib/design-strings.mjs's parseDesignStrings is unit-tested directly
// against a synthetic ctx first (no fixture tree needed); the gen-schema
// integration (sibling discovery, the unshipped-tag scan, i18n/<tag>.json
// emission, the assets-glob guard, renderHash isolation) is then exercised
// through generate() against throwaway temp source trees — NOT the shared
// tests/fixtures/src/widget.scad tree those error cases would otherwise have
// to add stray/malformed sidecar files next to, which every other
// widget-based fixture (70+ configs) also builds against.

function designStringsCtx(overrides = {}) {
  return {
    file: "d.strings.de.json",
    designId: "d",
    params: [
      { name: "label", choices: null, hasInfo: false },
      { name: "width", choices: null, hasInfo: true },
      { name: "style", choices: ["flat", "raised"], hasInfo: false },
    ],
    sections: ["Main"],
    hasDescription: true,
    reviewLabels: new Set(["label"]),
    hasReviewNote: true,
    ...overrides,
  };
}

test("parseDesignStrings: an empty object is a valid, warn-free no-op", () => {
  assert.deepEqual(parseDesignStrings({}, designStringsCtx()), {});
});

test("parseDesignStrings: rejects an unknown top-level key", () => {
  assert.throws(
    () => parseDesignStrings({ bogus: "x" }, designStringsCtx()),
    /'d\.strings\.de\.json' '\.' has unknown key 'bogus'/
  );
});

test("parseDesignStrings: rejects an unknown parameter name", () => {
  assert.throws(
    () => parseDesignStrings({ params: { nope: { description: "x" } } }, designStringsCtx()),
    /'params\["nope"\]' does not match any parameter in design 'd'/
  );
});

test("parseDesignStrings: rejects an unknown section name", () => {
  assert.throws(
    () => parseDesignStrings({ sections: { Nope: "x" } }, designStringsCtx()),
    /'sections\["Nope"\]' does not match any section in design 'd'/
  );
});

test("parseDesignStrings: rejects translating the canonical 'Hidden' section", () => {
  assert.throws(
    () => parseDesignStrings({ sections: { Hidden: "x" } }, designStringsCtx()),
    /names a canonical OpenSCAD section/
  );
});

test("parseDesignStrings: rejects two translations colliding on the same final section name", () => {
  assert.throws(
    () =>
      parseDesignStrings(
        { sections: { Size: "Größe", Style: "Größe" } },
        designStringsCtx({ sections: ["Size", "Style"] })
      ),
    /translates section "Size" and section "Style" to the same name "Größe" — translated section names must stay unique/
  );
});

test("parseDesignStrings: rejects a translation colliding with an untranslated sibling section's name", () => {
  assert.throws(
    () =>
      parseDesignStrings(
        { sections: { Size: "Style" } },
        designStringsCtx({ sections: ["Size", "Style"] })
      ),
    /translates section "Size" and section "Style" to the same name "Style" — translated section names must stay unique/
  );
});

test("parseDesignStrings: accepts distinct section translations that don't collide", () => {
  const out = parseDesignStrings(
    { sections: { Size: "Größe", Style: "Stil" } },
    designStringsCtx({ sections: ["Size", "Style"] })
  );
  assert.deepEqual(out.sections, { Size: "Größe", Style: "Stil" });
});

test("parseDesignStrings: rejects a choices key that isn't a declared choice value", () => {
  assert.throws(
    () => parseDesignStrings({ params: { style: { choices: { stale: "x" } } } }, designStringsCtx()),
    /'params\["style"\]\.choices\["stale"\]' is not a declared choice value/
  );
  // Same rule for a non-enum param: it has no declared choices at all.
  assert.throws(
    () => parseDesignStrings({ params: { label: { choices: { anything: "x" } } } }, designStringsCtx()),
    /not a declared choice value/
  );
});

test("parseDesignStrings: accepts a choices translation for a declared value", () => {
  const out = parseDesignStrings(
    { params: { style: { choices: { flat: "Flach" } } } },
    designStringsCtx()
  );
  assert.equal(out.params.style.choices.flat, "Flach");
});

test("parseDesignStrings: rejects an info translation for a param without @info", () => {
  assert.throws(
    () => parseDesignStrings({ params: { label: { info: { label: "x" } } } }, designStringsCtx()),
    /'label' carries no '\/\/ @info' annotation to translate/
  );
});

test("parseDesignStrings: accepts an info translation for a param that has @info", () => {
  const out = parseDesignStrings({ params: { width: { info: { label: "Breite" } } } }, designStringsCtx());
  assert.equal(out.params.width.info.label, "Breite");
});

test("parseDesignStrings: rejects a description translation when the design has no @description", () => {
  assert.throws(
    () => parseDesignStrings({ description: "x" }, designStringsCtx({ hasDescription: false })),
    /design 'd' has no '\/\/ @description' to translate/
  );
});

test("parseDesignStrings: rejects reviewLabels for a param without @review", () => {
  assert.throws(
    () => parseDesignStrings({ reviewLabels: { width: "x" } }, designStringsCtx()),
    /does not match any parameter carrying '\/\/ @review'/
  );
});

test("parseDesignStrings: rejects reviewNote when the design has no @reviewNote", () => {
  assert.throws(
    () => parseDesignStrings({ reviewNote: "x" }, designStringsCtx({ hasReviewNote: false })),
    /design 'd' has no '\/\/ @reviewNote' to translate/
  );
});

test("parseDesignStrings: every leaf value must be a non-empty string", () => {
  assert.throws(() => parseDesignStrings({ description: 5 }, designStringsCtx()), /must be a non-empty string/);
  assert.throws(() => parseDesignStrings({ description: "" }, designStringsCtx()), /must be a non-empty string/);
  assert.throws(
    () => parseDesignStrings({ params: { label: { description: "" } } }, designStringsCtx()),
    /must be a non-empty string/
  );
  assert.throws(
    () => parseDesignStrings({ echo: { "Total width": 5 } }, designStringsCtx()),
    /must be a non-empty string/
  );
});

test("parseDesignStrings: 'echo' is a free-form source-string map with no cross-check against the design", () => {
  const out = parseDesignStrings(
    { echo: { "Anything the design happens to echo": "Whatever it translates to" } },
    designStringsCtx()
  );
  assert.equal(out.echo["Anything the design happens to echo"], "Whatever it translates to");
});

// ── gen-schema integration: sibling discovery, emission, renderHash isolation

function i18nOutDirs(prefix) {
  const out = mkdtempSync(join(tmpdir(), `gen-schema-${prefix}-out-`));
  return { outSchemaDir: join(out, "schema"), outScadDir: join(out, "scad") };
}

test("the checked-in widget.scad sidecar fixture is discovered and folded into src/generated/i18n/<tag>.json for every registry tag", () => {
  const { schema, out } = run("widget-i18n.config.json");
  // Transient: never reaches designs.json.
  assert.equal(schema.designs[0].stringsByTag, undefined);
  const de = JSON.parse(readFileSync(join(out, "schema", "i18n", "de.json"), "utf-8"));
  assert.deepEqual(Object.keys(de.designs), ["widget"]);
  assert.equal(de.designs.widget.description, "Ein kleines Widget.");
  assert.equal(de.designs.widget.sections.Main, "Haupt");
  assert.equal(de.designs.widget.params.style.choices.flat, "Flach");
  assert.equal(de.designs.widget.echo["Total width"], "Gesamtbreite");
  // Written for EVERY registry tag, even one no design translated: the
  // fixture only ships a "de" sidecar, so every OTHER registry tag's file
  // must still exist and come out empty.
  for (const tag of LOCALE_TAGS) {
    if (tag === "de") continue;
    const bundle = JSON.parse(readFileSync(join(out, "schema", "i18n", `${tag}.json`), "utf-8"));
    assert.deepEqual(bundle, { designs: {} });
  }
});

test("renderHash is identical with and without a design's translation sidecar present", () => {
  const src = mkdtempSync(join(tmpdir(), "gen-schema-i18n-hash-"));
  writeFileSync(join(src, "d.scad"), `/* [Main] */\n// The label.\nlabel = "hi";\n`);
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", designs: [{ id: "d", label: "D" }] })
  );
  const gen = () => generate({ ...i18nOutDirs("hash"), configPath: join(src, "c.config.json") }).renderHash;

  const withoutSidecar = gen();
  writeFileSync(join(src, "d.strings.de.json"), "{}\n");
  const withSidecar = gen();
  rmSync(join(src, "d.strings.de.json"));
  const afterRemoval = gen();

  assert.equal(withSidecar, withoutSidecar, "a present sidecar must not change renderHash");
  assert.equal(afterRemoval, withoutSidecar);
});

test("a translation sidecar naming an unshipped locale tag fails the build, listing valid tags", () => {
  const src = mkdtempSync(join(tmpdir(), "gen-schema-i18n-badtag-"));
  writeFileSync(join(src, "d.scad"), `/* [Main] */\n// The label.\nlabel = "hi";\n`);
  writeFileSync(join(src, "d.strings.xx.json"), "{}\n");
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", designs: [{ id: "d", label: "D" }] })
  );
  assert.throws(
    () => generate({ ...i18nOutDirs("badtag"), configPath: join(src, "c.config.json") }),
    new RegExp(
      `translation sidecar 'd\\.strings\\.xx\\.json' names an unshipped locale tag 'xx'.*Valid tags: ${LOCALE_TAGS.join(", ")}`,
      "s"
    )
  );
});

test("a translation sidecar whose tag is a wrongly-cased shipped locale fails the build, naming the expected lowercase form", () => {
  // A case-insensitive filesystem (macOS, Windows) resolves this the same as
  // 'd.strings.de.json', so it must be caught explicitly rather than silently
  // loaded as (or silently ignored instead of) the "de" sidecar.
  const src = mkdtempSync(join(tmpdir(), "gen-schema-i18n-badcase-"));
  writeFileSync(join(src, "d.scad"), `/* [Main] */\n// The label.\nlabel = "hi";\n`);
  writeFileSync(join(src, "d.strings.DE.json"), "{}\n");
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", designs: [{ id: "d", label: "D" }] })
  );
  assert.throws(
    () => generate({ ...i18nOutDirs("badcase"), configPath: join(src, "c.config.json") }),
    /translation sidecar 'd\.strings\.DE\.json' names locale tag 'DE', but sidecar tags are matched case-sensitively\. Rename it to 'd\.strings\.de\.json'\./
  );
});

test("a translation sidecar with a wrongly-cased 'strings' infix fails the build, naming the canonical form", () => {
  // A case-insensitive filesystem loads 'd.Strings.de.json' as if it were
  // 'd.strings.de.json' with nothing else to say about it; on a
  // case-sensitive one it's silently inert instead. Reject both instead of
  // letting behaviour diverge across platforms.
  const src = mkdtempSync(join(tmpdir(), "gen-schema-i18n-badinfix-"));
  writeFileSync(join(src, "d.scad"), `/* [Main] */\n// The label.\nlabel = "hi";\n`);
  writeFileSync(join(src, "d.Strings.de.json"), "{}\n");
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", designs: [{ id: "d", label: "D" }] })
  );
  assert.throws(
    () => generate({ ...i18nOutDirs("badinfix"), configPath: join(src, "c.config.json") }),
    /translation sidecar 'd\.Strings\.de\.json' has the wrong case for 'strings'.*Rename it to 'd\.strings\.de\.json'\./
  );
});

test("a freshness-stamp file with a wrongly-cased 'stamps' tag fails the build, naming the canonical form", () => {
  const src = mkdtempSync(join(tmpdir(), "gen-schema-i18n-badstamps-"));
  writeFileSync(join(src, "d.scad"), `/* [Main] */\n// The label.\nlabel = "hi";\n`);
  writeFileSync(join(src, "d.strings.STAMPS.json"), "{}\n");
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", designs: [{ id: "d", label: "D" }] })
  );
  assert.throws(
    () => generate({ ...i18nOutDirs("badstamps"), configPath: join(src, "c.config.json") }),
    /translation sidecar 'd\.strings\.STAMPS\.json' has the wrong case for 'stamps'.*Rename it to 'd\.strings\.stamps\.json'\./
  );
});

test("an 'assets' entry directly naming a translation sidecar fails the build", () => {
  const src = mkdtempSync(join(tmpdir(), "gen-schema-i18n-directasset-"));
  writeFileSync(join(src, "d.scad"), `/* [Main] */\n// The label.\nlabel = "hi";\n`);
  writeFileSync(join(src, "d.strings.de.json"), "{}\n");
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({
      title: "T",
      source: ".",
      assets: ["d.strings.de.json"],
      designs: [{ id: "d", label: "D" }],
    })
  );
  assert.throws(
    () => generate({ ...i18nOutDirs("directasset"), configPath: join(src, "c.config.json") }),
    /asset 'd\.strings\.de\.json' names a design-translation sidecar/
  );
});

test("an orphaned sidecar-shaped file matching no design's basename warns, but does not fail the build", () => {
  // Simulates a design rename: 'widget.scad' became 'd.scad' (still the only
  // design), but its old translation sidecar was left behind under the old
  // basename. The per-design scan only ever looks for ITS OWN design's base
  // ('d'), so this must be caught by the separate orphan scan instead.
  const src = mkdtempSync(join(tmpdir(), "gen-schema-i18n-orphan-"));
  writeFileSync(join(src, "d.scad"), `/* [Main] */\n// The label.\nlabel = "hi";\n`);
  writeFileSync(join(src, "widget.strings.de.json"), "{}\n");
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", designs: [{ id: "d", label: "D" }] })
  );
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  let schema;
  try {
    schema = generate({ ...i18nOutDirs("orphan"), configPath: join(src, "c.config.json") });
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(schema.designs.length === 1); // the build still succeeds
  const hits = warnings.filter((w) => w.includes("widget.strings.de.json"));
  assert.equal(hits.length, 1, `expected exactly one orphan warning, got: ${JSON.stringify(warnings)}`);
  assert.ok(hits[0].includes("match no design in their directory"));
});

test("a glob 'assets' entry silently excludes translation sidecars, with a one-time warning", () => {
  // Config and SOURCE live in SEPARATE directories here (unlike the other
  // tests in this section): "**/*.json" globs the whole SOURCE tree, and a
  // sibling config.json would otherwise be swept up by it too, muddying the
  // "the sidecar was the glob's only match" assertion below.
  const root = mkdtempSync(join(tmpdir(), "gen-schema-i18n-globasset-"));
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "d.scad"), `/* [Main] */\n// The label.\nlabel = "hi";\n`);
  writeFileSync(join(src, "d.strings.de.json"), "{}\n");
  writeFileSync(
    join(root, "c.config.json"),
    JSON.stringify({
      title: "T",
      source: "src",
      assets: ["**/*.json"],
      designs: [{ id: "d", label: "D" }],
    })
  );
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  let schema;
  try {
    schema = generate({ ...i18nOutDirs("globasset"), configPath: join(root, "c.config.json") });
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(schema.assets, []); // the sidecar was the glob's only match
  const hits = warnings.filter((w) => w.includes("d.strings.de.json"));
  assert.equal(hits.length, 1, `expected exactly one warning naming the sidecar, got: ${JSON.stringify(warnings)}`);
  assert.ok(hits[0].includes("excluded 1 design-translation sidecar"));
});

test("a glob 'assets' entry silently excludes a doc translation too (the base doc itself still bundles as a plain asset)", () => {
  const root = mkdtempSync(join(tmpdir(), "gen-schema-i18n-globasset-doc-"));
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  // Named 'guide.md', not 'd-doc.md': the served base-doc copy is already
  // 'd-doc.md' (<id>-doc.md for id "d"), and this test also bundles the doc
  // as a plain asset via the glob below — a same-named source file would
  // collide with that served copy in outScadDir, which is a real but
  // unrelated hazard this test isn't about.
  writeFileSync(join(src, "d.scad"), `// @doc guide.md\n/* [Main] */\n// The label.\nlabel = "hi";\n`);
  writeFileSync(join(src, "guide.md"), "# D\n\nThe base doc.\n");
  writeFileSync(join(src, "guide.de.md"), "# D\n\nDie Basisdokumentation.\n");
  writeFileSync(
    join(root, "c.config.json"),
    JSON.stringify({
      title: "T",
      source: "src",
      assets: ["**/*.md"],
      designs: [{ id: "d", label: "D" }],
    })
  );
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  let schema;
  try {
    schema = generate({ ...i18nOutDirs("globasset-doc"), configPath: join(root, "c.config.json") });
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(schema.assets, ["guide.md"]);
  const hits = warnings.filter((w) => w.includes("guide.de.md"));
  assert.equal(
    hits.length,
    1,
    `expected exactly one warning naming the doc translation, got: ${JSON.stringify(warnings)}`
  );
  assert.ok(hits[0].includes("excluded 1 design-translation sidecar"));
});

// ── @doc per-locale sidecars, preset-name translation, freshness stamps
// (Phase 4) ──────────────────────────────────────────────────────────────
// Isolated throwaway source trees, exactly like the strings-sidecar
// integration tests above: tests/fixtures/src/ is shared by 70+ configs, so
// none of this touches it — see that section's own comment for why.

// A translation lives beside the DOC file, not the design: this fixture
// deliberately gives the doc a different basename ('d-doc.md') than the
// design ('d.scad') so a test using the design's own basename instead would
// visibly fail rather than passing by coincidence.
function docFixtureSrc(prefix) {
  const src = mkdtempSync(join(tmpdir(), `gen-schema-doc-${prefix}-`));
  writeFileSync(join(src, "d.scad"), `// @doc d-doc.md\n/* [Main] */\n// The label.\nlabel = "hi";\n`);
  writeFileSync(join(src, "d-doc.md"), "# D\n\nThe base doc.\n");
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", designs: [{ id: "d", label: "D" }] })
  );
  return src;
}

test("docLocales: a doc translation beside the doc file is discovered, copied to '<id>-doc.<tag>.md', and listed sorted", () => {
  const src = docFixtureSrc("basic");
  writeFileSync(join(src, "d-doc.de.md"), "# D\n\nDie Basisdokumentation.\n");
  const out = mkdtempSync(join(tmpdir(), "gen-schema-doc-basic-out-"));
  const outPublicDir = join(out, "public");
  const schema = generate({
    configPath: join(src, "c.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(outPublicDir, "scad"),
    outPublicDir,
  });
  const d = schema.designs[0];
  assert.deepEqual(d.docLocales, ["de"]);
  assert.equal(
    readFileSync(join(outPublicDir, "scad", "d-doc.de.md"), "utf-8"),
    "# D\n\nDie Basisdokumentation.\n"
  );
  const precache = JSON.parse(readFileSync(join(outPublicDir, "precache-manifest.json"), "utf-8"));
  assert.ok(precache.shell.includes("scad/d-doc.de.md"));
});

test("docLocales: a doc translation is found beside the doc file even when the doc lives in its own subdirectory, away from the .scad", () => {
  const src = mkdtempSync(join(tmpdir(), "gen-schema-doc-nested-"));
  mkdirSync(join(src, "docs", "guides"), { recursive: true });
  writeFileSync(join(src, "d.scad"), `// @doc docs/guides/d.md\n/* [Main] */\n// The label.\nlabel = "hi";\n`);
  writeFileSync(join(src, "docs", "guides", "d.md"), "# D\n\nThe base doc.\n");
  writeFileSync(join(src, "docs", "guides", "d.de.md"), "# D\n\nDie Basisdokumentation.\n");
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", designs: [{ id: "d", label: "D" }] })
  );
  const out = mkdtempSync(join(tmpdir(), "gen-schema-doc-nested-out-"));
  const outPublicDir = join(out, "public");
  const schema = generate({
    configPath: join(src, "c.config.json"),
    outSchemaDir: join(out, "schema"),
    outScadDir: join(outPublicDir, "scad"),
    outPublicDir,
  });
  const d = schema.designs[0];
  assert.deepEqual(d.docLocales, ["de"]);
  assert.equal(
    readFileSync(join(outPublicDir, "scad", "d-doc.de.md"), "utf-8"),
    "# D\n\nDie Basisdokumentation.\n"
  );
});

test("docLocales is absent when no doc translation exists", () => {
  const src = docFixtureSrc("absent");
  const schema = generate({ ...i18nOutDirs("doc-absent"), configPath: join(src, "c.config.json") });
  assert.equal(schema.designs[0].docLocales, undefined);
});

test("a doc translation naming a wrongly-cased shipped locale fails the build, naming the expected lowercase form", () => {
  const src = docFixtureSrc("badcase");
  writeFileSync(join(src, "d-doc.DE.md"), "# D\n");
  assert.throws(
    () => generate({ ...i18nOutDirs("doc-badcase"), configPath: join(src, "c.config.json") }),
    /doc translation 'd-doc\.DE\.md' names locale tag 'DE', but doc translation tags are matched case-sensitively\. Rename it to 'd-doc\.de\.md'\./
  );
});

test("a doc translation naming an unshipped locale tag fails the build, listing valid tags", () => {
  const src = docFixtureSrc("badtag");
  writeFileSync(join(src, "d-doc.xx.md"), "# D\n");
  assert.throws(
    () => generate({ ...i18nOutDirs("doc-badtag"), configPath: join(src, "c.config.json") }),
    new RegExp(
      `doc translation 'd-doc\\.xx\\.md' names an unshipped locale tag 'xx'.*Valid tags: ${LOCALE_TAGS.join(", ")}`,
      "s"
    )
  );
});

test("an old-style '<design>.doc.<tag>.md' translation beside a doc-bearing design fails the build, naming the new location beside the doc file", () => {
  const src = docFixtureSrc("migrate");
  writeFileSync(join(src, "d.doc.de.md"), "# D\n");
  assert.throws(
    () => generate({ ...i18nOutDirs("doc-migrate"), configPath: join(src, "c.config.json") }),
    /doc translation 'd\.doc\.de\.md' uses the retired '<design>\.doc\.<tag>\.md' naming.*move it to 'd-doc\.de\.md'/s
  );
});

test("an old-style '<design>.doc.<tag>.md' file beside a design with no '// @doc' fails the build", () => {
  const src = mkdtempSync(join(tmpdir(), "gen-schema-doc-nodocbase-"));
  writeFileSync(join(src, "d.scad"), `/* [Main] */\n// The label.\nlabel = "hi";\n`);
  writeFileSync(join(src, "d.doc.de.md"), "# D\n");
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", designs: [{ id: "d", label: "D" }] })
  );
  assert.throws(
    () => generate({ ...i18nOutDirs("doc-nodocbase"), configPath: join(src, "c.config.json") }),
    /'d\.doc\.de\.md' is named like a doc translation, but design 'd' has no '\/\/ @doc' to translate/
  );
});

test("an orphaned doc translation left behind by a doc rename warns, but does not fail the build", () => {
  // Simulate the state right after 'd-doc.md' was renamed to 'd-manual.md'
  // without its German translation following it: the '// @doc' now points
  // at 'd-manual.md', but 'd-doc.de.md' is still sitting in the directory.
  const src = mkdtempSync(join(tmpdir(), "gen-schema-doc-orphan-"));
  writeFileSync(join(src, "d.scad"), `// @doc d-manual.md\n/* [Main] */\n// The label.\nlabel = "hi";\n`);
  writeFileSync(join(src, "d-manual.md"), "# D\n\nThe base doc.\n");
  writeFileSync(join(src, "d-doc.de.md"), "# Alte Übersetzung\n");
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", designs: [{ id: "d", label: "D" }] })
  );
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  let schema;
  try {
    schema = generate({ ...i18nOutDirs("doc-orphan"), configPath: join(src, "c.config.json") });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(schema.designs.length, 1);
  assert.equal(schema.designs[0].docLocales, undefined); // 'd-manual.md' has no translation of its own
  const hits = warnings.filter((w) => w.includes("d-doc.de.md"));
  assert.equal(hits.length, 1, `expected exactly one orphan warning, got: ${JSON.stringify(warnings)}`);
  assert.ok(hits[0].includes("match no design's current"));
});

test("renderHash is identical with and without a design's doc translation present", () => {
  const src = docFixtureSrc("hash");
  const gen = () => generate({ ...i18nOutDirs("doc-hash"), configPath: join(src, "c.config.json") }).renderHash;
  const without = gen();
  writeFileSync(join(src, "d-doc.de.md"), "# D\n\nDie Basisdokumentation.\n");
  const withDoc = gen();
  rmSync(join(src, "d-doc.de.md"));
  const afterRemoval = gen();
  assert.equal(withDoc, without, "a present doc translation must not change renderHash");
  assert.equal(afterRemoval, without);
});

test("renderHash is identical with and without a '<design>.strings.stamps.json' file present", () => {
  const src = mkdtempSync(join(tmpdir(), "gen-schema-stamps-hash-"));
  writeFileSync(join(src, "d.scad"), `/* [Main] */\n// The label.\nlabel = "hi";\n`);
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", designs: [{ id: "d", label: "D" }] })
  );
  const gen = () => generate({ ...i18nOutDirs("stamps-hash"), configPath: join(src, "c.config.json") }).renderHash;
  const without = gen();
  writeFileSync(join(src, "d.strings.stamps.json"), JSON.stringify({ de: { description: "deadbeef" } }) + "\n");
  const withStamps = gen();
  rmSync(join(src, "d.strings.stamps.json"));
  const afterRemoval = gen();
  assert.equal(withStamps, without, "a present stamps file must not change renderHash");
  assert.equal(afterRemoval, without);
});

test("design-strings 'presets': a key matching a bundled preset name translates into src/generated/i18n/<tag>.json", () => {
  const src = mkdtempSync(join(tmpdir(), "gen-schema-presets-i18n-ok-"));
  writeFileSync(join(src, "d.scad"), `/* [Main] */\n// The label.\nlabel = "hi";\n`);
  writeFileSync(
    join(src, "d.json"),
    JSON.stringify({
      fileFormatVersion: "1",
      parameterSets: { "Signs | Door plate (Imperial)": { label: "hey" } },
    })
  );
  writeFileSync(
    join(src, "d.strings.de.json"),
    JSON.stringify({ presets: { "Signs | Door plate (Imperial)": "Schilder | Türschild (Imperial)" } })
  );
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", designs: [{ id: "d", label: "D" }] })
  );
  const out = i18nOutDirs("presets-ok");
  generate({ ...out, configPath: join(src, "c.config.json") });
  const de = JSON.parse(readFileSync(join(out.outSchemaDir, "i18n", "de.json"), "utf-8"));
  assert.equal(de.designs.d.presets["Signs | Door plate (Imperial)"], "Schilder | Türschild (Imperial)");
});

test("design-strings 'presets': a name not matching a bundled preset fails the build", () => {
  const src = mkdtempSync(join(tmpdir(), "gen-schema-presets-i18n-bad-"));
  writeFileSync(join(src, "d.scad"), `/* [Main] */\n// The label.\nlabel = "hi";\n`);
  writeFileSync(
    join(src, "d.json"),
    JSON.stringify({ fileFormatVersion: "1", parameterSets: { Tall: { label: "hey" } } })
  );
  writeFileSync(join(src, "d.strings.de.json"), JSON.stringify({ presets: { "Not A Real Preset": "x" } }));
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", designs: [{ id: "d", label: "D" }] })
  );
  assert.throws(
    () => generate({ ...i18nOutDirs("presets-bad"), configPath: join(src, "c.config.json") }),
    /'presets\["Not A Real Preset"\]' does not match any bundled preset in design 'd'/
  );
});

test("gen-schema warns (never fails) when a stamps file's recorded hash no longer matches the current source text", () => {
  const src = mkdtempSync(join(tmpdir(), "gen-schema-stamps-drift-"));
  writeFileSync(
    join(src, "d.scad"),
    `// @description Original text.\n/* [Main] */\n// The label.\nlabel = "hi";\n`
  );
  writeFileSync(join(src, "d.strings.de.json"), JSON.stringify({ description: "Originaltext." }));
  writeFileSync(
    join(src, "d.strings.stamps.json"),
    JSON.stringify({ de: { description: "not-the-real-hash" } })
  );
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", designs: [{ id: "d", label: "D" }] })
  );
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    generate({ ...i18nOutDirs("stamps-drift"), configPath: join(src, "c.config.json") });
  } finally {
    console.warn = originalWarn;
  }
  const hits = warnings.filter((w) => w.includes("de translation of description may be stale"));
  assert.equal(hits.length, 1, JSON.stringify(warnings));
});

test("gen-schema does not warn when a stamps file's recorded hash matches the current source text", () => {
  const src = mkdtempSync(join(tmpdir(), "gen-schema-stamps-nodrift-"));
  writeFileSync(
    join(src, "d.scad"),
    `// @description Original text.\n/* [Main] */\n// The label.\nlabel = "hi";\n`
  );
  writeFileSync(join(src, "d.strings.de.json"), JSON.stringify({ description: "Originaltext." }));
  writeFileSync(
    join(src, "d.strings.stamps.json"),
    JSON.stringify({ de: { description: createHash("sha256").update("Original text.", "utf8").digest("hex") } })
  );
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", designs: [{ id: "d", label: "D" }] })
  );
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    generate({ ...i18nOutDirs("stamps-nodrift"), configPath: join(src, "c.config.json") });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.filter((w) => w.includes("may be stale")).length, 0, JSON.stringify(warnings));
});
