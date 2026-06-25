#!/usr/bin/env node
// fetch-wasm.mjs — download the OpenSCAD WebAssembly "web" snapshot into
// public/wasm/. Pinned to the SAME OpenSCAD version as the test suite
// (tests/setup_openscad.sh), so in-browser renders match the committed
// reference geometry. This snapshot ships Manifold and the textmetrics feature.
// The .wasm binary (~10 MB) is intentionally not committed.
//
// Pure Node (no bash/curl/unzip needed), so it runs the same on Windows, macOS,
// and Linux. The npm predev/prebuild hooks call this on every run; an idempotent
// stamp keeps it cheap — only a first run or a version bump hits the network.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const VERSION = process.env.OPENSCAD_VERSION || "2026.06.12";
const URL = `https://files.openscad.org/snapshots/OpenSCAD-${VERSION}-WebAssembly-web.zip`;
const SHA256 = "509879dd6813f2c4e5cf2ce1da6420928ce9bb212cd08491ca5ec9d5bffc700b";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_DIR = join(HERE, "..", "public", "wasm");
const STAMP = join(WASM_DIR, ".version");
const ASSETS = ["openscad.js", "openscad.wasm"];

const log = (msg) => process.stderr.write(`${msg}\n`);
const die = (msg) => {
  log(`ERROR: ${msg}`);
  process.exit(1);
};

// Idempotent guard: skip the download when the binary + glue are already
// present and were fetched for the requested version. Set FORCE=1 to always
// re-download. This lets the pre-build/pre-dev hooks call us cheaply on every
// run — only the first run (or a version bump) reaches the network.
async function isCurrent() {
  if (process.env.FORCE === "1") return false;
  if (!ASSETS.every((name) => existsSync(join(WASM_DIR, name)))) return false;
  try {
    return (await readFile(STAMP, "utf8")).trim() === VERSION;
  } catch {
    return false;
  }
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
if (VERSION === "2026.06.12") {
  const actual = createHash("sha256").update(zip).digest("hex");
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
await writeFile(STAMP, `${VERSION}\n`);
log(`Installed openscad.js + openscad.wasm (v${VERSION}) into public/wasm/`);
