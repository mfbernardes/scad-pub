// Tests scripts/i18n-status.mjs: coverage reporting, --strict, and the
// --stamp / drift round trip. Drives `run()` (the exported, non-CLI entry
// point) against throwaway fixture trees, plus one subprocess test for the
// CLI's --strict exit code (main()'s own responsibility, not run()'s).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { run } from "../scripts/i18n-status.mjs";
import { translatableFields, coverageForTag } from "../scripts/lib/i18n-coverage.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "..");

// One design carrying every translatable field class: a description, a
// section, a param with description/help/an enum choice/@info, a @review
// label, a @reviewNote, one bundled preset, and a @doc. A German sidecar
// translates SOME of it, so coverage is neither 0 nor total.
function coverageFixture() {
  const src = mkdtempSync(join(tmpdir(), "i18n-status-fixture-"));
  writeFileSync(
    join(src, "d.scad"),
    [
      "// @description A little widget.",
      "// @doc d-doc.md",
      "// @reviewNote \"Prints exactly as typed.\"",
      "",
      "/* [Main] */",
      "// The label to engrave.",
      "// @review \"Text\"",
      'label = "hi";',
      "// Visual style.",
      'style = "flat"; // [flat:Flat, raised:Raised]',
      "// Plate width (mm).",
      "// @info Width | mm",
      "width = 10;",
    ].join("\n")
  );
  writeFileSync(join(src, "d-doc.md"), "# D\n\nThe base doc.\n");
  writeFileSync(
    join(src, "d.json"),
    JSON.stringify({ fileFormatVersion: "1", parameterSets: { Tall: { width: "20" } } })
  );
  // Partial German sidecar: description + one param field only, so coverage
  // reads neither 0/N nor N/N.
  writeFileSync(
    join(src, "d.strings.de.json"),
    JSON.stringify({ description: "Ein kleines Widget.", params: { label: { description: "Der Text." } } })
  );
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({
      title: "T",
      source: ".",
      languages: ["en", "de"],
      designs: [{ id: "d", label: "D" }],
    })
  );
  return src;
}

test("run(): reports per-class translated/total coverage for a partially-translated design", () => {
  const src = coverageFixture();
  const { text, incomplete } = run({ configPath: join(src, "c.config.json") });
  assert.match(text, /design 'd' \(locale: de\)/);
  assert.match(text, /description\s+1\/1/);
  // Only label's description is translated; label's help, style's choices,
  // width's info.label/.unit all remain untranslated -> params < total.
  assert.match(text, /params\s+1\/\d+/);
  assert.match(text, /reviewLabels\s+0\/1/);
  assert.match(text, /reviewNote\s+0\/1/);
  assert.match(text, /presets\s+0\/1/);
  assert.match(text, /doc\s+0\/1/);
  assert.ok(incomplete >= 1);
});

test("run(): a doc translation beside the doc file (not the design's basename) counts toward doc coverage and is stamped", () => {
  const src = coverageFixture();
  // 'd-doc.md' is the base doc (coverageFixture); the translation sits
  // beside IT, named 'd-doc.de.md' — not 'd.doc.de.md' beside the design.
  writeFileSync(join(src, "d-doc.de.md"), "# D\n\nDie Basisdokumentation.\n");

  const { text } = run({ configPath: join(src, "c.config.json") });
  assert.match(text, /doc\s+1\/1/);

  const stamped = run({ configPath: join(src, "c.config.json"), stamp: true });
  assert.match(stamped.text, /Wrote\/updated stamps for 1 design\(s\)\./);
  const stamps = JSON.parse(readFileSync(join(src, "d.strings.stamps.json"), "utf-8"));
  assert.equal(
    stamps.de.doc,
    createHash("sha256").update(readFileSync(join(src, "d-doc.md"), "utf-8"), "utf8").digest("hex")
  );
});

test("run(): full coverage across every field class reports 0 incomplete pairs", () => {
  const src = mkdtempSync(join(tmpdir(), "i18n-status-full-"));
  writeFileSync(
    join(src, "d.scad"),
    ["// @description A little widget.", "", "/* [Main] */", "// The label.", 'label = "hi";'].join("\n")
  );
  writeFileSync(
    join(src, "d.strings.de.json"),
    JSON.stringify({
      description: "Ein kleines Widget.",
      sections: { Main: "Haupt" },
      params: { label: { description: "Der Text.", help: "Der Text." } },
    })
  );
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", languages: ["en", "de"], designs: [{ id: "d", label: "D" }] })
  );
  const { incomplete } = run({ configPath: join(src, "c.config.json") });
  assert.equal(incomplete, 0);
});

test("run(): a single-locale deployment with no default-tag translations reports nothing to do", () => {
  const src = mkdtempSync(join(tmpdir(), "i18n-status-single-"));
  writeFileSync(join(src, "d.scad"), '/* [Main] */\n// The label.\nlabel = "hi";\n');
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", languages: ["en"], designs: [{ id: "d", label: "D" }] })
  );
  const { text, incomplete } = run({ configPath: join(src, "c.config.json") });
  assert.match(text, /nothing to report/);
  assert.equal(incomplete, 0);
});

test("run({ stamp: true }): writes a stamps file covering only translated fields, then a second run reports no drift", () => {
  const src = coverageFixture();
  const first = run({ configPath: join(src, "c.config.json"), stamp: true });
  assert.match(first.text, /Wrote\/updated stamps for 1 design\(s\)\./);

  const stamps = JSON.parse(readFileSync(join(src, "d.strings.stamps.json"), "utf-8"));
  assert.deepEqual(Object.keys(stamps), ["de"]);
  assert.deepEqual(Object.keys(stamps.de), ["description", "params.label.description"]);
  assert.equal(
    stamps.de.description,
    createHash("sha256").update("A little widget.", "utf8").digest("hex")
  );

  const second = run({ configPath: join(src, "c.config.json") });
  assert.equal(second.drift.length, 0, JSON.stringify(second.drift));
});

test("run(): mutating the source text after stamping surfaces a drift warning", () => {
  const src = coverageFixture();
  run({ configPath: join(src, "c.config.json"), stamp: true });

  const scad = readFileSync(join(src, "d.scad"), "utf-8");
  writeFileSync(join(src, "d.scad"), scad.replace("A little widget.", "A rather large widget."));

  const { drift } = run({ configPath: join(src, "c.config.json") });
  assert.equal(drift.length, 1);
  assert.match(drift[0], /de translation of description may be stale/);
});

test("run(): a drift warning is reported exactly once, not once via gen-schema's own console.warn and again in the tool's report", () => {
  const src = coverageFixture();
  run({ configPath: join(src, "c.config.json"), stamp: true });
  const scad = readFileSync(join(src, "d.scad"), "utf-8");
  writeFileSync(join(src, "d.scad"), scad.replace("A little widget.", "A rather large widget."));

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  let result;
  try {
    result = run({ configPath: join(src, "c.config.json") });
  } finally {
    console.warn = originalWarn;
  }
  // gen-schema's own buildDesigns-time console.warn for this SAME drift is
  // suppressed (see loadDesigns' capture/replay); the tool's own `drift`/
  // `text` still carry it, just not doubled onto the console.
  const driftWarnings = warnings.filter((w) => /may be stale/.test(w));
  assert.equal(driftWarnings.length, 0, JSON.stringify(warnings));
  assert.equal(result.drift.length, 1);
  assert.match(result.text, /Drift warnings:/);
  assert.match(result.text, /de translation of description may be stale/);
});

test("translatableFields: a param with @info but neither a custom label nor a description still yields a fillable info.label field", () => {
  // design-strings.mjs accepts an `info.label` sidecar entry off `hasInfo`
  // alone (see its own INFO_KEYS check), so a param whose bare `@info`
  // falls back to "" here must still get a bucket/stamp, not silently drop
  // any translation of it on the floor.
  const fields = translatableFields({ params: [{ name: "w", info: { label: null, unit: null } }] });
  const infoField = fields.find((f) => f.path === "params.w.info.label");
  assert.ok(infoField, "expected a params.w.info.label field");
  assert.equal(infoField.sourceText, "");
  const byClass = coverageForTag(fields, "de", { params: { w: { info: { label: "Breite" } } } }, []);
  assert.equal(byClass.params.translated, 1);
  assert.equal(byClass.params.total, 1);
});

// A minimal config-text deployment: one design, no design sidecars (so the
// design-coverage section stays trivially 0/0-ish and each test's assertions
// stay focused on the config-text section specifically).
function configTextFixture({ deText } = {}) {
  const src = mkdtempSync(join(tmpdir(), "i18n-status-text-"));
  // No section header, no param comment: zero design-translatable fields, so
  // every test here reads the config-text section in isolation from the
  // (unrelated) per-design coverage report above it.
  writeFileSync(join(src, "d.scad"), 'label = "hi";\n');
  writeFileSync(
    join(src, "text.en.json"),
    JSON.stringify({ popup: { header: "Welcome", body: "Body EN" } })
  );
  writeFileSync(join(src, "text.de.json"), JSON.stringify(deText ?? { popup: { header: "Willkommen" } }));
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({
      title: "T",
      source: ".",
      languages: ["en", "de"],
      text: { en: "text.en.json", de: "text.de.json" },
      designs: [{ id: "d" }],
      popup: { mode: "dismissible" },
    })
  );
  return src;
}

test("run(): reports config-text coverage per non-default locale, the default file as the reference set", () => {
  const src = configTextFixture();
  const { text, incomplete } = run({ configPath: join(src, "c.config.json") });
  assert.match(text, /config text \(default: en\)/);
  // 'de' only sets popup.header, out of 2 leaves (header + body) in 'en'.
  assert.match(text, /de\s+1\/2/);
  assert.ok(incomplete >= 1);
});

test("run(): full config-text coverage across every locale reports 0 incomplete", () => {
  const src = configTextFixture({ deText: { popup: { header: "Willkommen", body: "Body DE" } } });
  const { text, incomplete } = run({ configPath: join(src, "c.config.json") });
  assert.match(text, /de\s+2\/2/);
  assert.equal(incomplete, 0);
});

test("run({ stamp: true }): writes '<config-basename>.text.stamps.json' hashing the default locale's leaves, then a second run reports no drift", () => {
  const src = configTextFixture();
  const first = run({ configPath: join(src, "c.config.json"), stamp: true });
  assert.match(first.text, /Wrote\/updated config text stamps\./);

  const stamps = JSON.parse(readFileSync(join(src, "c.config.text.stamps.json"), "utf-8"));
  assert.deepEqual(Object.keys(stamps).sort(), ["popup.body", "popup.header"]);
  assert.equal(stamps["popup.header"], createHash("sha256").update("Welcome", "utf8").digest("hex"));

  const second = run({ configPath: join(src, "c.config.json") });
  assert.equal(second.drift.filter((d) => d.startsWith("config text:")).length, 0, JSON.stringify(second.drift));
});

test("run(): editing the default locale's text after stamping surfaces a config-text drift warning", () => {
  const src = configTextFixture();
  run({ configPath: join(src, "c.config.json"), stamp: true });

  writeFileSync(join(src, "text.en.json"), JSON.stringify({ popup: { header: "Welcome!", body: "Body EN" } }));

  const { drift } = run({ configPath: join(src, "c.config.json") });
  const configDrift = drift.filter((d) => d.startsWith("config text:"));
  assert.equal(configDrift.length, 1);
  assert.match(configDrift[0], /'popup\.header' may be stale/);
});

test("run(): a deployment with no 'text' key reports no config-text section at all", () => {
  const src = mkdtempSync(join(tmpdir(), "i18n-status-notext-"));
  writeFileSync(join(src, "d.scad"), '/* [Main] */\n// The label.\nlabel = "hi";\n');
  writeFileSync(
    join(src, "d.strings.de.json"),
    JSON.stringify({ params: { label: { description: "Der Text." } } })
  );
  writeFileSync(
    join(src, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", languages: ["en", "de"], designs: [{ id: "d", label: "D" }] })
  );
  const { text } = run({ configPath: join(src, "c.config.json") });
  assert.doesNotMatch(text, /config text \(default:/);
});

test("CLI --strict exits 1 when coverage is incomplete, 0 when it's complete", () => {
  const src = coverageFixture();
  assert.throws(() =>
    execFileSync(process.execPath, [join(REPO, "scripts", "i18n-status.mjs"), "--strict"], {
      env: { ...process.env, SCADPUB_CONFIG: join(src, "c.config.json") },
      stdio: "pipe",
    })
  );

  const fullSrc = mkdtempSync(join(tmpdir(), "i18n-status-cli-full-"));
  writeFileSync(
    join(fullSrc, "d.scad"),
    ["// @description A little widget.", "", "/* [Main] */", "// The label.", 'label = "hi";'].join("\n")
  );
  writeFileSync(
    join(fullSrc, "d.strings.de.json"),
    JSON.stringify({
      description: "Ein kleines Widget.",
      sections: { Main: "Haupt" },
      params: { label: { description: "Der Text.", help: "Der Text." } },
    })
  );
  writeFileSync(
    join(fullSrc, "c.config.json"),
    JSON.stringify({ title: "T", source: ".", languages: ["en", "de"], designs: [{ id: "d", label: "D" }] })
  );
  execFileSync(process.execPath, [join(REPO, "scripts", "i18n-status.mjs"), "--strict"], {
    env: { ...process.env, SCADPUB_CONFIG: join(fullSrc, "c.config.json") },
    stdio: "pipe",
  });
});
