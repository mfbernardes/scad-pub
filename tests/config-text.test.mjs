// Unit tests for the opt-in `text` config key (scripts/lib/config-text.mjs,
// docs/config.md "Localizing config text"): the fold's validation matrix,
// driven against throwaway temp-tree fixtures (the same style
// tests/config-spec.test.mjs's null-agreement sweep uses), plus the
// load-bearing equivalence test — a config expressed with inline prose and
// the same deployment expressed as structure + text files must produce a
// deep-equal designs.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "../scripts/gen-schema.mjs";
import { flattenTextLeaves, configTextCoverage, computeTextStamps, textDrift } from "../scripts/lib/config-text.mjs";
import { buildConfigTextSchema } from "../scripts/gen-config-schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FIXTURES = join(HERE, "fixtures");

// One design (a single "label" parameter) plus scaffolding for a base
// config-text deployment: popup + a tabbed help (one inline-sections tab, one
// file-backed tab) + a notice + a design label. Each test starts from this
// and overrides what it needs.
function baseTree() {
  const root = mkdtempSync(join(tmpdir(), "config-text-"));
  writeFileSync(join(root, "widget.scad"), `/* [Main] */\n// A demo parameter.\nlabel = "hi";\n`);
  writeFileSync(join(root, "printing.md"), "Printing notes.\n");
  writeFileSync(join(root, "printing.de.md"), "Druckhinweise.\n");
  return root;
}

function writeConfig(root, config) {
  writeFileSync(join(root, "c.config.json"), JSON.stringify(config, null, 2));
}

function writeText(root, name, obj) {
  writeFileSync(join(root, name), JSON.stringify(obj, null, 2));
}

function build(root) {
  const outSchemaDir = join(root, "out", "schema");
  const outScadDir = join(root, "out", "scad");
  return generate({ configPath: join(root, "c.config.json"), outSchemaDir, outScadDir });
}

function baseConfig(extra = {}) {
  return {
    languages: ["en", "de"],
    text: { en: "text.en.json", de: "text.de.json" },
    designs: [{ id: "widget" }],
    popup: { mode: "dismissible" },
    help: { tabs: [{ id: "walkthrough" }, { id: "printing" }] },
    notices: [{ marker: "alert", color: "#e0a458" }],
    ...extra,
  };
}

function baseTextEn(extra = {}) {
  return {
    popup: { header: "Welcome", body: "Body EN" },
    help: {
      tabs: {
        walkthrough: { label: "Walkthrough", sections: [{ title: "One", body: "Body one EN" }] },
        printing: { label: "Printing", file: "printing.md" },
      },
    },
    ...extra,
  };
}

function baseTextDe(extra = {}) {
  return {
    popup: { header: "Willkommen", body: "Body DE" },
    help: {
      tabs: {
        walkthrough: { label: "Rundgang", sections: [{ title: "Eins", body: "Body eins DE" }] },
        printing: { label: "Druck", file: "printing.de.md" },
      },
    },
    ...extra,
  };
}

test("happy path: both locales fold into LocalizableText maps", () => {
  const root = baseTree();
  writeConfig(root, baseConfig());
  writeText(root, "text.en.json", baseTextEn());
  writeText(root, "text.de.json", baseTextDe());
  const schema = build(root);
  assert.deepEqual(schema.popup.header, { en: "Welcome", de: "Willkommen" });
  assert.deepEqual(schema.popup.body, { en: "Body EN", de: "Body DE" });
  const walkthrough = schema.help.tabs.find((t) => t.id === "walkthrough");
  assert.deepEqual(walkthrough.label, { en: "Walkthrough", de: "Rundgang" });
  assert.deepEqual(walkthrough.sections[0].title, { en: "One", de: "Eins" });
  const printing = schema.help.tabs.find((t) => t.id === "printing");
  assert.deepEqual(printing.label, { en: "Printing", de: "Druck" });
  assert.deepEqual(printing.intro, { en: "Printing notes.", de: "Druckhinweise." });
});

test("sparse other-locale text falls back to the default locale at runtime (the map simply omits that tag)", () => {
  const root = baseTree();
  writeConfig(root, baseConfig());
  writeText(root, "text.en.json", baseTextEn());
  // German only sets the popup header, not the body/help/notices: a
  // legitimate partial translation, not a build error.
  writeText(root, "text.de.json", { popup: { header: "Willkommen" } });
  const schema = build(root);
  assert.deepEqual(schema.popup.header, { en: "Welcome", de: "Willkommen" });
  // 'body' has no German entry at all -> the map carries only 'en'.
  assert.deepEqual(schema.popup.body, { en: "Body EN" });
  const walkthrough = schema.help.tabs.find((t) => t.id === "walkthrough");
  assert.deepEqual(walkthrough.label, { en: "Walkthrough" });
});

test("'text' with no entry for the default locale fails the build", () => {
  const root = baseTree();
  writeConfig(root, baseConfig({ text: { de: "text.de.json" } }));
  writeText(root, "text.de.json", baseTextDe());
  assert.throws(() => build(root), /'text' must include an entry for "en"/);
});

test("the default locale's text file missing a required field (a tab with no label) fails the build", () => {
  const root = baseTree();
  writeConfig(root, baseConfig());
  const en = baseTextEn();
  delete en.help.tabs.printing.label;
  writeText(root, "text.en.json", en);
  writeText(root, "text.de.json", baseTextDe());
  assert.throws(() => build(root), /help\.tabs\.printing\.label.*must be a non-empty string/s);
});

test("inline prose alongside 'text' fails the build, naming the config path and the text file", () => {
  const root = baseTree();
  writeConfig(root, baseConfig({ popup: { mode: "dismissible", header: "Inline header" } }));
  writeText(root, "text.en.json", baseTextEn());
  writeText(root, "text.de.json", baseTextDe());
  assert.throws(
    () => build(root),
    /config text mode: 'popup\.header' is set inline.*move it to.*text\.en\.json/s
  );
});

test("inline 'popup.bodyFile'/'fileImport.noteFile' alongside 'text' explains there's no file slot for them in text mode", () => {
  const root = baseTree();
  writeConfig(root, baseConfig({ popup: { mode: "dismissible", bodyFile: "printing.md" } }));
  writeText(root, "text.en.json", baseTextEn());
  writeText(root, "text.de.json", baseTextDe());
  assert.throws(
    () => build(root),
    /'popup\.bodyFile' is set inline.*file-backed prose.*isn't supported in text mode.*'popup\.body' in.*text\.en\.json/s
  );

  const root2 = baseTree();
  writeConfig(root2, baseConfig({ fileImport: { noteFile: "printing.md" } }));
  writeText(root2, "text.en.json", baseTextEn());
  writeText(root2, "text.de.json", baseTextDe());
  assert.throws(
    () => build(root2),
    /'fileImport\.noteFile' is set inline.*file-backed prose.*isn't supported in text mode.*'fileImport\.note' in.*text\.en\.json/s
  );
});

test("a malformed leaf in a NON-default locale's text file names that text file, not a phantom config path", () => {
  const root = baseTree();
  writeConfig(root, baseConfig());
  writeText(root, "text.en.json", baseTextEn());
  // 'de' sets 'popup.button' to a non-string: not a leaf popup.header/body
  // requires (this deployment doesn't set a custom button at all), so this
  // exercises validation of a per-locale OPTIONAL leaf, not the default-tag
  // required-leaf check popup.header/body already had.
  writeText(root, "text.de.json", { ...baseTextDe(), popup: { ...baseTextDe().popup, button: 42 } });
  assert.throws(() => {
    try {
      build(root);
    } catch (e) {
      // The error must name the DE TEXT FILE this leaf actually lives in —
      // never a 'popup.button.de'-shaped path, which would read as a
      // scadpub.config.json location that (in text mode) doesn't exist.
      assert.match(e.message, /text\.de\.json/);
      assert.doesNotMatch(e.message, /popup\.button\.de/);
      throw e;
    }
  }, /'popup\.button' must be a non-empty string/);
});

test("a text file naming an unknown help tab id fails the build", () => {
  const root = baseTree();
  writeConfig(root, baseConfig());
  const en = baseTextEn();
  en.help.tabs.bogus = { label: "Bogus", sections: [] };
  writeText(root, "text.en.json", en);
  writeText(root, "text.de.json", baseTextDe());
  assert.throws(() => build(root), /'help\.tabs\.bogus' does not match any help tab id/);
});

test("a text file naming an unknown notice marker fails the build", () => {
  const root = baseTree();
  writeConfig(root, baseConfig());
  writeText(root, "text.en.json", { ...baseTextEn(), notices: { bogus: "x" } });
  writeText(root, "text.de.json", baseTextDe());
  assert.throws(() => build(root), /'notices\.bogus' does not match any 'notices\[\]\.marker'/);
});

test("a text file naming an unknown license name fails the build", () => {
  const root = baseTree();
  writeConfig(
    root,
    baseConfig({
      licenses: [
        {
          name: "Acme",
          license: "MIT",
          copyright: "Acme",
          url: "https://example.com",
          licenseUrl: "https://example.com/license",
        },
      ],
    })
  );
  writeText(root, "text.en.json", { ...baseTextEn(), licenses: { Bogus: { note: "x" } } });
  writeText(root, "text.de.json", baseTextDe());
  assert.throws(() => build(root), /'licenses\."Bogus"' does not match any 'licenses\[\]\.name'/);
});

test("a text file naming an unknown design id fails the build", () => {
  const root = baseTree();
  writeConfig(root, baseConfig());
  writeText(root, "text.en.json", { ...baseTextEn(), designs: { nope: { label: "Nope" } } });
  writeText(root, "text.de.json", baseTextDe());
  assert.throws(() => build(root), /'designs\.nope' does not match any 'designs\[\]\.id'/);
});

test("a section-count mismatch between locales fails the build, naming both counts", () => {
  const root = baseTree();
  writeConfig(root, baseConfig());
  const en = baseTextEn();
  en.help.tabs.walkthrough.sections.push({ title: "Two", body: "Body two EN" });
  writeText(root, "text.en.json", en);
  writeText(root, "text.de.json", baseTextDe()); // still one section
  assert.throws(
    () => build(root),
    /'help\.tabs\.walkthrough\.sections' has 1 section\(s\), but locale "en" has 2/
  );
});

test("a non-default locale translating a tab's label alone (no sections) fails the build — a tab is omit-or-fully-translate, not leaf-sparse", () => {
  const root = baseTree();
  writeConfig(root, baseConfig());
  writeText(root, "text.en.json", baseTextEn());
  const de = baseTextDe();
  // 'de' sets ONLY the label for 'walkthrough', not the sections its
  // sections-mode default entry requires — distinct from omitting the tab
  // entirely (legal, see the sparse-fallback test above).
  de.help.tabs.walkthrough = { label: "Nur der Titel" };
  writeText(root, "text.de.json", de);
  assert.throws(
    () => build(root),
    /'help\.tabs\.walkthrough\.sections' has 0 section\(s\), but locale "en" has 1/
  );
});

test("a non-default locale translating a file-backed tab's label alone (no file) fails the build", () => {
  const root = baseTree();
  writeConfig(root, baseConfig());
  writeText(root, "text.en.json", baseTextEn());
  const de = baseTextDe();
  de.help.tabs.printing = { label: "Nur der Titel" }; // no 'file'
  writeText(root, "text.de.json", de);
  assert.throws(
    () => build(root),
    /'help\.tabs\.printing' must set 'file' — locale "en" uses 'file' for this tab/
  );
});

test("an un-enabled/unshipped locale tag in the 'text' map fails the build", () => {
  const root = baseTree();
  writeConfig(root, baseConfig({ text: { en: "text.en.json", de: "text.de.json", fr: "text.en.json" } }));
  writeText(root, "text.en.json", baseTextEn());
  writeText(root, "text.de.json", baseTextDe());
  assert.throws(() => build(root), /'text' has an entry for locale "fr".*enabled locales/s);
});

test("help.tabs[] entries must all carry an 'id' in text mode", () => {
  const root = baseTree();
  const config = baseConfig();
  config.help.tabs = [{ id: "walkthrough" }, {}]; // second tab has no id
  writeConfig(root, config);
  writeText(root, "text.en.json", { ...baseTextEn(), help: { tabs: { walkthrough: baseTextEn().help.tabs.walkthrough } } });
  writeText(root, "text.de.json", baseTextDe());
  assert.throws(() => build(root), /config text mode requires every 'help\.tabs\[\]' entry to have an 'id'/);
});

test("per-locale 'file' leaves resolve relative to the config directory, one file per locale", () => {
  const root = baseTree();
  writeConfig(root, baseConfig());
  writeText(root, "text.en.json", baseTextEn());
  writeText(root, "text.de.json", baseTextDe());
  const schema = build(root);
  const printing = schema.help.tabs.find((t) => t.id === "printing");
  // No '##' heading in either file, so the whole body becomes 'intro' and
  // there are no sections — checkHelpShape still accepts an empty list.
  assert.deepEqual(printing.sections, []);
  assert.deepEqual(printing.intro, { en: "Printing notes.", de: "Druckhinweise." });
});

test("'strings' fold: text-file overrides land as locale-tag maps, and an inline 'strings' key conflicts", () => {
  const root = baseTree();
  writeConfig(root, baseConfig());
  writeText(root, "text.en.json", { ...baseTextEn(), strings: { "action.export": "Export EN" } });
  writeText(root, "text.de.json", { ...baseTextDe(), strings: { "action.export": "Export DE" } });
  const schema = build(root);
  assert.deepEqual(schema.strings["action.export"], { en: "Export EN", de: "Export DE" });

  const root2 = baseTree();
  writeConfig(root2, baseConfig({ strings: { "action.export": "Inline" } }));
  writeText(root2, "text.en.json", baseTextEn());
  writeText(root2, "text.de.json", baseTextDe());
  assert.throws(() => build(root2), /'strings' is set inline.*this deployment has 'text' configured/s);
});

test("notices[].label folds per-marker, defaulting a plain-string tag entry to the same word for one/other", () => {
  const root = baseTree();
  writeConfig(root, baseConfig());
  writeText(root, "text.en.json", { ...baseTextEn(), notices: { alert: "alert" } });
  writeText(root, "text.de.json", { ...baseTextDe(), notices: { alert: { one: "Warnung", other: "Warnungen" } } });
  const schema = build(root);
  const notice = schema.notices.find((n) => n.marker === "alert");
  assert.deepEqual(notice.label.other, { en: "alert", de: "Warnungen" });
  assert.deepEqual(notice.label.one, { en: "alert", de: "Warnung" });
});

test("designs[].label/group fold per-id; an id with no text entry falls back to its humanized id, unaffected", () => {
  const root = baseTree();
  writeConfig(root, baseConfig({ designs: [{ id: "widget", group: undefined }, { id: "second-widget", file: "widget.scad" }] }));
  writeText(root, "text.en.json", { ...baseTextEn(), designs: { widget: { label: "Widget EN", group: "Group EN" } } });
  writeText(root, "text.de.json", { ...baseTextDe(), designs: { widget: { label: "Widget DE" } } });
  const schema = build(root);
  const widget = schema.designs.find((d) => d.id === "widget");
  assert.deepEqual(widget.label, { en: "Widget EN", de: "Widget DE" });
  assert.deepEqual(widget.group, { en: "Group EN" });
  const second = schema.designs.find((d) => d.id === "second-widget");
  assert.equal(second.label, "Second widget"); // humanize(id) fallback, no conflict with text mode
});

test("flattenTextLeaves/configTextCoverage/textDrift: coverage and drift over a text file's own leaves", () => {
  const en = { popup: { header: "Welcome", body: "Body" }, help: { intro: "Intro" } };
  const de = { popup: { header: "Willkommen" } };
  const leaves = flattenTextLeaves(en);
  assert.deepEqual(
    leaves.map((l) => l.path).sort(),
    ["help.intro", "popup.body", "popup.header"]
  );
  const coverage = configTextCoverage({ en, de }, ["en", "de"], "en");
  assert.deepEqual(coverage.de, { translated: 1, total: 3 });

  const stamps = computeTextStamps({ en }, "en");
  assert.equal(Object.keys(stamps).length, 3);
  assert.deepEqual(textDrift({ en }, "en", stamps), []);
  const changed = { ...en, popup: { ...en.popup, header: "Welcome!" } };
  assert.deepEqual(textDrift({ en: changed }, "en", stamps), ["popup.header"]);
});

test("a text file with an unknown top-level key fails the build, naming the file and the key", () => {
  const root = baseTree();
  writeConfig(root, baseConfig());
  writeText(root, "text.en.json", { ...baseTextEn(), bogusTopLevelKey: "x" });
  writeText(root, "text.de.json", baseTextDe());
  assert.throws(() => build(root), /text\.en\.json.*unknown key 'bogusTopLevelKey'/s);
});

test("a non-default locale's text file may be an empty object — nothing is required outside the default locale", () => {
  const root = baseTree();
  writeConfig(root, baseConfig());
  writeText(root, "text.en.json", baseTextEn());
  writeText(root, "text.de.json", {});
  const schema = build(root);
  // Every LocalizableText map this deployment produces carries only 'en':
  // 'de' contributed nothing, so every leaf falls back to the default at
  // runtime rather than the build failing.
  assert.deepEqual(schema.popup.header, { en: "Welcome" });
  const walkthrough = schema.help.tabs.find((t) => t.id === "walkthrough");
  assert.deepEqual(walkthrough.label, { en: "Walkthrough" });
});

test("a NON-default locale's text file setting a block the config doesn't have names THAT locale's file, not the default's", () => {
  const root = baseTree();
  // No 'popup' block in the config at all.
  const config = baseConfig();
  delete config.popup;
  writeConfig(root, config);
  writeText(root, "text.en.json", { help: baseTextEn().help }); // 'en' stays clean
  writeText(root, "text.de.json", { help: baseTextDe().help, popup: { header: "Willkommen" } }); // 'de' is the offender
  assert.throws(() => build(root), /text\.de\.json.*sets 'popup', but this config has no 'popup' block/s);
});

test("the config-text stamps file ('<config-basename>.text.stamps.json') is excluded from a broad 'assets' glob", () => {
  const root = baseTree();
  writeConfig(root, baseConfig({ assets: ["**/*.json"] }));
  writeText(root, "text.en.json", baseTextEn());
  writeText(root, "text.de.json", baseTextDe());
  writeFileSync(join(root, "c.config.text.stamps.json"), JSON.stringify({ "popup.header": "deadbeef" }));
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  let schema;
  try {
    schema = build(root);
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(
    !schema.assets.includes("c.config.text.stamps.json"),
    `stamps file must never be bundled as an asset, got: ${JSON.stringify(schema.assets)}`
  );
  assert.ok(
    warnings.some((w) => w.includes("c.config.text.stamps.json")),
    `expected a warning naming the excluded stamps file, got: ${JSON.stringify(warnings)}`
  );
});

// ── The load-bearing equivalence test ──────────────────────────────────────
//
// tests/fixtures/config-text-equiv.inline.json is a byte-preserving snapshot
// of THIS repo's scadpub.config.json as it existed before the config-text
// migration (every path adjusted to remain valid from tests/fixtures/, see
// the commit that added it): every popup/help/notices/designs prose value is
// still written inline, exactly as `generate()` saw it pre-migration. The
// LIVE repo config (scadpub.config.json + scadpub.text.en.json/.de.json) is
// the post-migration form of the exact same deployment. If the migration
// preserved every string byte-for-byte, the two must produce a deep-equal
// designs.json (scadpubVersion excluded: it's the checkout's git describe,
// not migration-related, and dropped here so a dirty/detached checkout can't
// spuriously fail this test).
test("equivalence: the pre-migration inline config and the migrated structure+text pair generate a deep-equal schema", () => {
  const outA = mkdtempSync(join(tmpdir(), "config-text-equiv-inline-"));
  const schemaA = generate({
    configPath: join(FIXTURES, "config-text-equiv.inline.json"),
    outSchemaDir: join(outA, "schema"),
    outScadDir: join(outA, "scad"),
  });
  const outB = mkdtempSync(join(tmpdir(), "config-text-equiv-migrated-"));
  const schemaB = generate({
    configPath: join(ROOT, "scadpub.config.json"),
    outSchemaDir: join(outB, "schema"),
    outScadDir: join(outB, "scad"),
  });
  const { scadpubVersion: _vA, ...restA } = schemaA;
  const { scadpubVersion: _vB, ...restB } = schemaB;
  assert.deepEqual(restA, restB);
});

// ── scadpub.config.text.schema.json actually accepts what the fold requires ──
//
// No ajv (or any JSON Schema validator) is a project dependency, so this is a
// minimal recursive walk covering exactly the subset of draft-2020-12
// buildConfigTextSchema (scripts/gen-config-schema.mjs) emits: `type`,
// `properties`, `additionalProperties` (false, or a schema for dynamically-
// keyed objects like `notices`/`help.tabs`), `items`, `anyOf`, `required`.
// It exists to catch exactly the bug this test suite missed the first time:
// the committed schema shape disagreeing with what a real, fold-accepted text
// file looks like (here, `help.tabs.<id>` requiring `label`, which the schema
// forgot). Returns a list of violation strings; empty means valid.
function validateAgainstSchema(value, schema, path = "$") {
  const violations = [];
  if (schema.anyOf) {
    const branchResults = schema.anyOf.map((branch) => validateAgainstSchema(value, branch, path));
    if (branchResults.every((v) => v.length)) violations.push(`${path}: matches none of ${schema.anyOf.length} anyOf branches`);
    return violations;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") violations.push(`${path}: expected string, got ${JSON.stringify(value)}`);
    return violations;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      violations.push(`${path}: expected array, got ${JSON.stringify(value)}`);
      return violations;
    }
    if (schema.items) value.forEach((v, i) => violations.push(...validateAgainstSchema(v, schema.items, `${path}[${i}]`)));
    return violations;
  }
  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      violations.push(`${path}: expected object, got ${JSON.stringify(value)}`);
      return violations;
    }
    for (const key of schema.required ?? [])
      if (!(key in value)) violations.push(`${path}: missing required key '${key}'`);
    const known = new Set(Object.keys(schema.properties ?? {}));
    for (const [key, v] of Object.entries(value)) {
      if (known.has(key)) {
        violations.push(...validateAgainstSchema(v, schema.properties[key], `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        violations.push(`${path}.${key}: not permitted by the schema (additionalProperties: false)`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        violations.push(...validateAgainstSchema(v, schema.additionalProperties, `${path}.${key}`));
      }
    }
    return violations;
  }
  return violations; // no 'type' (or an unhandled one): nothing this walk can check
}

test("buildConfigTextSchema's tab-entry properties include 'label' (the fold's own required slot)", () => {
  const schema = buildConfigTextSchema();
  const tabEntrySchema = schema.properties.help.properties.tabs.additionalProperties;
  assert.ok(
    "label" in tabEntrySchema.properties,
    "a 'help.tabs.<id>' entry's schema must offer 'label' — foldHelpTab requires it on the default " +
      "locale's entry, so omitting it here means every real tabbed text file fails validation " +
      "against 'additionalProperties: false'"
  );
});

test("both shipped text files (scadpub.text.en.json, scadpub.text.de.json) validate against the emitted schema", () => {
  const schema = buildConfigTextSchema();
  for (const file of ["scadpub.text.en.json", "scadpub.text.de.json"]) {
    const text = JSON.parse(readFileSync(join(ROOT, file), "utf-8"));
    const violations = validateAgainstSchema(text, schema);
    assert.deepEqual(violations, [], `${file} disagrees with scadpub.config.text.schema.json:\n  ${violations.join("\n  ")}`);
  }
});
