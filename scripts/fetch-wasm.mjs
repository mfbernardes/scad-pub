#!/usr/bin/env node
// fetch-wasm.mjs — download the OpenSCAD WebAssembly "web" snapshot into
// public/wasm/. Pinned to the SAME OpenSCAD version as the test suite
// (tests/setup_openscad.sh), so in-browser renders match the committed
// reference geometry. This snapshot ships Manifold and the textmetrics feature.
// The .wasm binary (~10 MB) is intentionally not committed.
//
// Pure Node (no bash/curl/unzip needed), so it runs the same on Windows, macOS,
// and Linux. The npm predev/prebuild hooks call this on every run; an idempotent
// stamp keeps it cheap — only a first run, a version bump, or on-disk drift
// (see isCurrent()) hits the network.
//
// M12: the stamp/checksum/extraction logic lives in scripts/lib/wasm-fetch.mjs
// (network-free, unit-testable — see tests/wasm-fetch.test.mjs); this file is
// the thin CLI wrapper that does the actual I/O.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_WASM_VERSION, WASM_VERSION as VERSION, WASM_SHA256 as SHA256 } from "./wasm-version.mjs";
import {
  ASSETS,
  sha256,
  resolveVerificationPolicy,
  verifyArchive,
  extractAssets,
  buildStamp,
  stampIsCurrent,
} from "./lib/wasm-fetch.mjs";

const URL = `https://files.openscad.org/snapshots/OpenSCAD-${VERSION}-WebAssembly-web.zip`;

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_DIR = join(HERE, "..", "public", "wasm");
const STAMP = join(WASM_DIR, ".version");

const log = (msg) => process.stderr.write(`${msg}\n`);
const die = (msg) => {
  log(`ERROR: ${msg}`);
  process.exit(1);
};

// Idempotent guard: skip the download when both extracted assets are already
// present, were fetched for the requested version, AND their on-disk bytes
// still hash to what the stamp recorded (M12: both openscad.wasm AND
// openscad.js — verifying only the wasm let a modified/partial glue file pass
// as current). Set FORCE=1 to always re-download. A pre-M12 stamp (no
// per-file digests) is treated as not current.
async function isCurrent() {
  if (process.env.FORCE === "1") return false;
  if (!ASSETS.every((name) => existsSync(join(WASM_DIR, name)))) return false;
  let stamp;
  try {
    stamp = JSON.parse(await readFile(STAMP, "utf8"));
  } catch {
    return false;
  }
  const onDisk = {};
  for (const name of ASSETS) onDisk[name] = sha256(await readFile(join(WASM_DIR, name)));
  return stampIsCurrent(stamp, VERSION, onDisk);
}

await mkdir(WASM_DIR, { recursive: true });

if (await isCurrent()) {
  log(`OpenSCAD WebAssembly v${VERSION} already present in public/wasm/ — skipping download.`);
  process.exit(0);
}

// M12: a non-pinned OPENSCAD_VERSION override no longer downloads silently
// unverified — it requires either an explicit OPENSCAD_SHA256 checksum or an
// explicit ALLOW_UNVERIFIED_WASM=1 opt-out.
let policy;
try {
  policy = resolveVerificationPolicy({
    version: VERSION,
    pinnedVersion: PINNED_WASM_VERSION,
    pinnedSha256: SHA256,
    overrideSha256: process.env.OPENSCAD_SHA256,
    allowUnverified: process.env.ALLOW_UNVERIFIED_WASM === "1",
  });
} catch (err) {
  die(err.message);
}
if (policy.reason === "explicit-unsafe") {
  log("=".repeat(72));
  log(`WARNING: OPENSCAD_VERSION=${VERSION} overrides the pinned build (${PINNED_WASM_VERSION}).`);
  log("  ALLOW_UNVERIFIED_WASM=1 is set: this download is UNVERIFIED by explicit opt-out.");
  log("=".repeat(72));
} else if (policy.reason === "override-checksum") {
  log(
    `OPENSCAD_VERSION=${VERSION} overrides the pinned build (${PINNED_WASM_VERSION}); ` +
      `verifying the download against OPENSCAD_SHA256.`
  );
}

log(`Downloading OpenSCAD ${VERSION} WebAssembly (web) ...`);
const res = await fetch(URL).catch((err) => die(`download failed for ${URL}: ${err.message}`));
if (!res.ok) die(`download failed for ${URL} (HTTP ${res.status})`);
const zip = new Uint8Array(await res.arrayBuffer());

try {
  verifyArchive(zip, policy);
} catch (err) {
  log(`  expected ${err.expected}`);
  log(`  actual   ${err.actual}`);
  die(`checksum mismatch for ${URL}`);
}

let entries;
try {
  entries = extractAssets(zip);
} catch (err) {
  die(`${err.message} (downloaded from ${URL})`);
}

for (const name of ASSETS) {
  await writeFile(join(WASM_DIR, name), entries[name]);
}
// Record both extracted files' hashes (not the zip's) so a future run can
// detect on-disk drift of either one, regardless of how it changed.
await writeFile(STAMP, JSON.stringify(buildStamp(VERSION, entries)) + "\n");
log(`Installed openscad.js + openscad.wasm (v${VERSION}) into public/wasm/`);
