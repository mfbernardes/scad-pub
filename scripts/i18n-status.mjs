#!/usr/bin/env node
// i18n-status.mjs: reports design-translation sidecar coverage and content
// drift (docs/config.md "Keeping translations up to date", layers 2 and 3 —
// layer 1, structural staleness, is already a build error in gen-schema.mjs
// itself). Drives the SAME parsing gen-schema.mjs uses (loadConfig,
// parseIdentity, buildDesigns — all re-exported from gen-schema.mjs) rather
// than re-implementing any part of the Customizer/sidecar parser, honoring
// $SCADPUB_CONFIG exactly like `npm run gen` does.
//
// `buildDesigns` also copies each design's own files (the .scad, its preset
// JSON, icon/image/doc) into the scad tree it's handed, as gen-schema.mjs's
// real build does — a side effect this read-only reporting tool doesn't want
// against the real `public/scad/`, so it points that copy at a throwaway
// temp directory, removed again once buildDesigns returns.
//
// Usage:
//   npm run i18n:status                 # coverage + drift report
//   npm run i18n:status -- --strict     # same, exit 1 on incomplete coverage
//   npm run i18n:status -- --stamp      # (re)write <design>.strings.stamps.json
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig, parseIdentity, makeMustExist, buildDesigns } from "./gen-schema.mjs";
import { createAssetTools } from "./lib/assets.mjs";
import { createDestinationRegistry } from "./lib/destinations.mjs";
import { translatableFields, coverageForTag, computeStamps, driftFields, sha256Hex } from "./lib/i18n-coverage.mjs";

const FIELD_CLASSES = ["description", "params", "sections", "reviewLabels", "reviewNote", "presets", "doc"];

/** Parse `design`'s pre-strip buildDesigns shape into the field list
 *  coverage/drift/stamping all compute over — see i18n-coverage.mjs. */
function fieldsFor(design) {
  return translatableFields({
    description: design.description,
    sections: design.sections,
    params: design.params,
    reviewLabels: design.reviewLabels,
    reviewNote: design.reviewNote,
    presetNames: design.presetNames,
    docSourceText: design.docAbs ? readFileSync(design.docAbs, "utf-8") : null,
  });
}

function docHashFor(design) {
  return design.docAbs ? sha256Hex(readFileSync(design.docAbs, "utf-8")) : undefined;
}

function stampsPathFor(design, SOURCE) {
  const designDir = dirname(join(SOURCE, design.file));
  const base = basename(design.file).replace(/\.scad$/, "");
  return join(designDir, `${base}.strings.stamps.json`);
}

function readStamps(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(`i18n-status: '${path}' is not valid JSON:\n  ${err.message}`, { cause: err });
  }
}

/** Reload the design/config, following gen-schema.mjs's own parse steps, and
 *  return `{ designs, LANGUAGES, DEFAULT_TAG, SOURCE, configPath }`. Writes
 *  buildDesigns' file copies into a throwaway temp dir, removed before
 *  returning. */
function loadDesigns(configPath) {
  const mustExist = makeMustExist(configPath);
  mustExist(configPath, "config file");
  const config = loadConfig(configPath);
  const CONFIG_DIR = dirname(configPath);
  const { LANGUAGES } = parseIdentity(config);
  const DEFAULT_TAG = LANGUAGES[0];

  const SOURCE = resolve(CONFIG_DIR, config.source ?? ".");
  mustExist(SOURCE, `source directory '${config.source ?? "."}'`);
  const { relPosix, checkContained } = createAssetTools({ SOURCE, configPath, mustExist });
  const registry = createDestinationRegistry();

  const scratchDir = mkdtempSync(join(tmpdir(), "scadpub-i18n-status-"));
  const copyAsset = (relPath) => {
    const dest = join(scratchDir, relPath);
    registry.register(dest, `source file '${relPath}'`);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(SOURCE, relPath), dest);
  };
  let designs;
  try {
    designs = buildDesigns({
      config,
      SOURCE,
      CONFIG_DIR,
      outScadDir: scratchDir,
      mustExist,
      checkContained,
      relPosix,
      copyAsset,
      register: registry.register,
      languages: LANGUAGES,
      defaultTag: DEFAULT_TAG,
    });
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
  return { designs, LANGUAGES, DEFAULT_TAG, SOURCE, configPath };
}

/** The (design, tag) pairs worth reporting: every enabled NON-default locale,
 *  plus the default tag itself only for a design that actually carries
 *  something for it (a sidecar, or a default-tag doc translation) — most
 *  designs never translate into their own authored language, and reporting
 *  "0/N" for all of them on every run would bury the pairs that matter. */
function reportTagsFor(design, LANGUAGES, DEFAULT_TAG) {
  const nonDefault = LANGUAGES.filter((tag) => tag !== DEFAULT_TAG);
  const defaultHasSomething =
    design.stringsByTag?.[DEFAULT_TAG] !== undefined || (design.docLocales ?? []).includes(DEFAULT_TAG);
  return defaultHasSomething ? [DEFAULT_TAG, ...nonDefault] : nonDefault;
}

function formatCoverageReport(designs, LANGUAGES, DEFAULT_TAG) {
  const lines = [];
  let incomplete = 0;
  for (const design of designs) {
    const fields = fieldsFor(design);
    const tags = reportTagsFor(design, LANGUAGES, DEFAULT_TAG);
    for (const tag of tags) {
      const sidecar = design.stringsByTag?.[tag];
      const byClass = coverageForTag(fields, tag, sidecar, design.docLocales ?? []);
      let translated = 0;
      let total = 0;
      lines.push(`design '${design.id}' (locale: ${tag})`);
      for (const cls of FIELD_CLASSES) {
        const bucket = byClass[cls];
        if (!bucket) continue;
        translated += bucket.translated;
        total += bucket.total;
        lines.push(`  ${cls.padEnd(14)} ${bucket.translated}/${bucket.total}`);
      }
      lines.push(`  ${"TOTAL".padEnd(14)} ${translated}/${total}`);
      if (translated < total) incomplete++;
    }
  }
  return { lines, incomplete };
}

function formatDriftReport(designs, SOURCE) {
  const lines = [];
  for (const design of designs) {
    const stampsPath = stampsPathFor(design, SOURCE);
    const stamps = readStamps(stampsPath);
    if (!stamps) continue;
    const fields = fieldsFor(design);
    const docHash = docHashFor(design);
    for (const [tag, tagStamps] of Object.entries(stamps)) {
      for (const path of driftFields(fields, tagStamps, docHash)) {
        lines.push(`${tag} translation of ${path} may be stale (source changed since it was stamped) [${design.id}]`);
      }
    }
  }
  return lines;
}

/** (Re)write `<design>.strings.stamps.json` beside every design that has at
 *  least one translated field for at least one enabled locale (default tag
 *  included: a design CAN translate back into its own language). Each tag's
 *  block is fully replaced by the CURRENT translation state, never merged —
 *  a stamp records what a translation was made against right now. */
function writeStamps(designs, LANGUAGES, SOURCE) {
  let written = 0;
  for (const design of designs) {
    const fields = fieldsFor(design);
    const docHash = docHashFor(design);
    const out = {};
    for (const tag of LANGUAGES) {
      const sidecar = design.stringsByTag?.[tag];
      const tagStamps = computeStamps(fields, tag, sidecar, design.docLocales ?? [], docHash);
      if (Object.keys(tagStamps).length) out[tag] = tagStamps;
    }
    if (!Object.keys(out).length) continue;
    // Deterministic key order: tags sorted, and each tag's field paths
    // sorted, independent of Map/Set iteration order upstream.
    const sortedOut = {};
    for (const tag of Object.keys(out).sort()) {
      const sortedFields = {};
      for (const path of Object.keys(out[tag]).sort()) sortedFields[path] = out[tag][path];
      sortedOut[tag] = sortedFields;
    }
    writeFileSync(stampsPathFor(design, SOURCE), JSON.stringify(sortedOut, null, 2) + "\n");
    written++;
  }
  return written;
}

export function run({ configPath, strict = false, stamp = false } = {}) {
  const { designs, LANGUAGES, DEFAULT_TAG, SOURCE } = loadDesigns(configPath);
  const out = [];
  out.push(`i18n-status: config '${configPath}', languages: ${LANGUAGES.join(", ")} (default: ${DEFAULT_TAG})`);

  if (LANGUAGES.length < 2 && !designs.some((d) => d.stringsByTag?.[DEFAULT_TAG] || d.docLocales?.length)) {
    out.push("No non-default locale is enabled (and no default-locale translations exist); nothing to report.");
    return { text: out.join("\n"), incomplete: 0, drift: [] };
  }

  const { lines, incomplete } = formatCoverageReport(designs, LANGUAGES, DEFAULT_TAG);
  out.push("", ...lines);

  const drift = formatDriftReport(designs, SOURCE);
  if (drift.length) {
    out.push("", "Drift warnings:");
    for (const d of drift) out.push(`  ${d}`);
  }

  if (stamp) {
    const written = writeStamps(designs, LANGUAGES, SOURCE);
    out.push("", `Wrote/updated stamps for ${written} design(s).`);
  }

  out.push("", `${incomplete} design/locale pair(s) have incomplete coverage.`);
  if (strict && incomplete > 0) out.push("--strict: failing due to incomplete coverage.");

  return { text: out.join("\n"), incomplete, drift };
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const stamp = args.includes("--stamp");
  const HERE = dirname(fileURLToPath(import.meta.url));
  const WEB = join(HERE, "..");
  const configPath = process.env.SCADPUB_CONFIG || join(WEB, "scadpub.config.json");
  const { text, incomplete } = run({ configPath, strict, stamp });
  console.log(text);
  if (strict && incomplete > 0) process.exitCode = 1;
}

// Run only when executed directly (not when `run()` is imported by tests),
// mirroring gen-schema.mjs's own CLI-vs-import guard.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
