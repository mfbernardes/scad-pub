// wasm-fetch.mjs — pure, testable helpers for scripts/fetch-wasm.mjs (M12).
// Extracted from the downloader script so the stamp format, override-checksum
// policy, and archive extraction can be unit-tested without hitting the
// network (files.openscad.org) or touching public/wasm/.
//
// M12 fixes two gaps:
//  1. The on-disk stamp used to verify only openscad.wasm, so a modified or
//     partially-extracted openscad.js glue was accepted as current. The stamp
//     now records BOTH extracted files' digests (see buildStamp/stampIsCurrent).
//  2. A non-pinned OPENSCAD_VERSION override used to download completely
//     unverified with just a warning. resolveVerificationPolicy now requires
//     either an explicit OPENSCAD_SHA256 checksum for the override, or an
//     explicit ALLOW_UNVERIFIED_WASM=1 opt-out — silence is no longer an
//     option.
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";

// The two files fetch-wasm.mjs extracts from the OpenSCAD WebAssembly
// snapshot and the render worker loads at runtime (worker.ts: the wasm binary
// + the openscad.js Emscripten glue that instantiates it).
export const ASSETS = ["openscad.js", "openscad.wasm"];

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Decide whether (and against what) the downloaded archive's integrity is
 * verified for a requested `version`:
 *   - the pinned version always verifies against the committed checksum;
 *   - a non-pinned override REQUIRES either an explicit `overrideSha256`
 *     (verified like the pin) or an explicit `allowUnverified` opt-out —
 *     an override can no longer silently ship unverified bytes.
 * Throws (does not return `{ verify: false }` implicitly) when neither is
 * given, so a caller can't accidentally proceed unverified.
 */
export function resolveVerificationPolicy({
  version,
  pinnedVersion,
  pinnedSha256,
  overrideSha256,
  allowUnverified,
}) {
  if (version === pinnedVersion) return { verify: true, expected: pinnedSha256, reason: "pinned" };
  if (overrideSha256) return { verify: true, expected: overrideSha256, reason: "override-checksum" };
  if (allowUnverified) return { verify: false, expected: null, reason: "explicit-unsafe" };
  throw new Error(
    `OPENSCAD_VERSION=${version} overrides the pinned build (${pinnedVersion}) with no checksum to verify it.\n` +
      `  Set OPENSCAD_SHA256=<sha256 of the .zip> to verify the download, or\n` +
      `  ALLOW_UNVERIFIED_WASM=1 to explicitly accept an unverified download.`
  );
}

/** Throws (with .expected/.actual) on a checksum mismatch; no-op when policy.verify is false. */
export function verifyArchive(zipBytes, policy) {
  if (!policy.verify) return;
  const actual = sha256(zipBytes);
  if (actual !== policy.expected) {
    const err = new Error("checksum mismatch for the downloaded archive");
    err.expected = policy.expected;
    err.actual = actual;
    throw err;
  }
}

/**
 * Extract ASSETS from the archive bytes. Throws when any asset is missing —
 * a partial or corrupt archive must never be accepted as if it were complete.
 */
export function extractAssets(zipBytes) {
  const entries = unzipSync(zipBytes, { filter: (file) => ASSETS.includes(file.name) });
  for (const name of ASSETS) {
    if (!entries[name]) throw new Error(`${name} not found in archive`);
  }
  return entries; // { "openscad.js": Uint8Array, "openscad.wasm": Uint8Array }
}

/**
 * The on-disk stamp for a successful extraction: BOTH files' digests (M12),
 * keyed by asset name, plus a top-level `sha256` mirroring the wasm digest
 * for readability/back-compat with the pre-M12 stamp shape.
 */
export function buildStamp(version, entries) {
  return {
    version,
    sha256: sha256(entries["openscad.wasm"]),
    files: Object.fromEntries(ASSETS.map((name) => [name, sha256(entries[name])])),
  };
}

/**
 * True when `stamp` matches `version` and EVERY asset's on-disk digest
 * (`onDiskDigests`, keyed by asset name) matches what the stamp recorded.
 * A pre-M12 stamp (no `files`) or a stamp missing an asset's digest is never
 * current — corruption or a substituted file (of either asset) forces a
 * re-fetch instead of being silently trusted.
 */
export function stampIsCurrent(stamp, version, onDiskDigests) {
  if (!stamp || typeof stamp !== "object") return false;
  if (stamp.version !== version) return false;
  if (!stamp.files || typeof stamp.files !== "object") return false;
  return ASSETS.every((name) => typeof stamp.files[name] === "string" && stamp.files[name] === onDiskDigests[name]);
}
