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
