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

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { PINNED_WASM_VERSION, WASM_VERSION as VERSION, WASM_SHA256 as SHA256 } from "./wasm-version.mjs";

const URL = `https://files.openscad.org/snapshots/OpenSCAD-${VERSION}-WebAssembly-web.zip`;

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_DIR = join(HERE, "..", "public", "wasm");
const STAMP = join(WASM_DIR, ".version");
const ASSETS = ["openscad.js", "openscad.wasm"];

const log = (msg) => process.stderr.write(`${msg}\n`);
const die = (msg) => {
  log(`ERROR: ${msg}`);
  process.exit(1);
};

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// OPENSCAD_VERSION overrides the pin below with nothing to verify the download
// against — WASM_SHA256 is only meaningful for PINNED_WASM_VERSION (see the
// integrity check further down) — so warn loudly rather than let an override
// look as trustworthy as the pinned, checksum-verified build.
if (VERSION !== PINNED_WASM_VERSION) {
  log("=".repeat(72));
  log(`WARNING: OPENSCAD_VERSION=${VERSION} overrides the pinned build (${PINNED_WASM_VERSION}).`);
  log("  This download is UNVERIFIED: no checksum is enforced for a non-pinned version.");
  log("=".repeat(72));
}

// Idempotent guard: skip the download when the binary + glue are already
// present, were fetched for the requested version, AND the on-disk
// openscad.wasm still hashes to what we recorded at install time — so
// corruption or a substituted file forces a re-fetch instead of silently
// being trusted. Set FORCE=1 to always re-download. A pre-hash stamp (plain
// "VERSION\n" text) fails JSON.parse and is treated as not current.
async function isCurrent() {
  if (process.env.FORCE === "1") return false;
  if (!ASSETS.every((name) => existsSync(join(WASM_DIR, name)))) return false;
  let stamp;
  try {
    stamp = JSON.parse(await readFile(STAMP, "utf8"));
  } catch {
    return false;
  }
  if (stamp.version !== VERSION || typeof stamp.sha256 !== "string") return false;
  const onDisk = sha256(await readFile(join(WASM_DIR, "openscad.wasm")));
  return onDisk === stamp.sha256;
}

await mkdir(WASM_DIR, { recursive: true });

if (await isCurrent()) {
  log(`OpenSCAD WebAssembly v${VERSION} already present in public/wasm/ — skipping download.`);
  process.exit(0);
}

log(`Downloading OpenSCAD ${VERSION} WebAssembly (web) ...`);
const res = await fetch(URL).catch((err) => die(`download failed for ${URL}: ${err.message}`));
if (!res.ok) die(`download failed for ${URL} (HTTP ${res.status})`);
const zip = new Uint8Array(await res.arrayBuffer());

// Verify integrity when the version matches the pin.
if (VERSION === PINNED_WASM_VERSION) {
  const actual = sha256(zip);
  if (actual !== SHA256) {
    log(`  expected ${SHA256}`);
    log(`  actual   ${actual}`);
    die(`checksum mismatch for ${URL}`);
  }
}

const entries = unzipSync(zip, { filter: (file) => ASSETS.includes(file.name) });
for (const name of ASSETS) {
  if (!entries[name]) die(`${name} not found in ${URL}`);
  await writeFile(join(WASM_DIR, name), entries[name]);
}
// Record the extracted wasm's hash (not the zip's) so a future run can detect
// on-disk drift regardless of how the file changed.
await writeFile(
  STAMP,
  JSON.stringify({ version: VERSION, sha256: sha256(entries["openscad.wasm"]) }) + "\n"
);
log(`Installed openscad.js + openscad.wasm (v${VERSION}) into public/wasm/`);
