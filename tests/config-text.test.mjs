// Unit tests for the opt-in `text` config key (scripts/lib/config-text.mjs,
// docs/config.md "Localizing config text"): the fold's validation matrix,
// driven against throwaway temp-tree fixtures (the same style
// tests/config-spec.test.mjs's null-agreement sweep uses), plus the
// load-bearing equivalence test — a config expressed with inline prose and
// the same deployment expressed as structure + text files must produce a
// deep-equal designs.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "../scripts/gen-schema.mjs";
import { flattenTextLeaves, configTextCoverage, computeTextStamps, textDrift } from "../scripts/lib/config-text.mjs";

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
