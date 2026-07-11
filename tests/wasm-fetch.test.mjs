// Tests for scripts/lib/wasm-fetch.mjs (M12) — the network-free stamp,
// checksum-policy, and extraction helpers scripts/fetch-wasm.mjs's CLI wrapper
// is built on. No network access, no real archive download.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import {
  ASSETS,
  sha256,
  resolveVerificationPolicy,
  verifyArchive,
  extractAssets,
  buildStamp,
  stampIsCurrent,
} from "../scripts/lib/wasm-fetch.mjs";

const PINNED = "2026.06.12";
const OTHER = "2099.01.01";

function makeArchive({ includeJs = true, includeWasm = true, extra = {} } = {}) {
  const files = { ...extra };
  if (includeJs) files["openscad.js"] = strToU8("glue-v1");
  if (includeWasm) files["openscad.wasm"] = strToU8("wasm-bytes-v1");
  return zipSync(files);
}

// ── extraction: partial archive ─────────────────────────────────────────────

test("extractAssets returns both files from a complete archive", () => {
  const zip = makeArchive();
  const entries = extractAssets(zip);
  assert.equal(Buffer.from(entries["openscad.js"]).toString(), "glue-v1");
  assert.equal(Buffer.from(entries["openscad.wasm"]).toString(), "wasm-bytes-v1");
});

test("extractAssets throws when the glue file is missing (partial extraction)", () => {
  const zip = makeArchive({ includeJs: false });
  assert.throws(() => extractAssets(zip), /openscad\.js not found in archive/);
});

test("extractAssets throws when the wasm file is missing (partial extraction)", () => {
  const zip = makeArchive({ includeWasm: false });
  assert.throws(() => extractAssets(zip), /openscad\.wasm not found in archive/);
});

test("extractAssets ignores unrelated archive members", () => {
  const zip = makeArchive({ extra: { "README.txt": strToU8("hi") } });
  const entries = extractAssets(zip);
  assert.deepEqual(Object.keys(entries).sort(), [...ASSETS].sort());
});

// ── archive checksum verification ───────────────────────────────────────────

test("verifyArchive passes for a matching pinned checksum", () => {
  const zip = makeArchive();
  const policy = { verify: true, expected: sha256(zip) };
  assert.doesNotThrow(() => verifyArchive(zip, policy));
});

test("verifyArchive throws (with expected/actual) on an archive checksum mismatch", () => {
  const zip = makeArchive();
  const policy = { verify: true, expected: "0".repeat(64) };
  assert.throws(
    () => verifyArchive(zip, policy),
    (err) => {
      assert.match(err.message, /checksum mismatch/);
      assert.equal(err.expected, "0".repeat(64));
      assert.equal(err.actual, sha256(zip));
      return true;
    }
  );
});

test("verifyArchive is a no-op when policy.verify is false", () => {
  const zip = makeArchive();
  assert.doesNotThrow(() => verifyArchive(zip, { verify: false, expected: null }));
});

// ── override checksum policy (M12: required unless explicitly unsafe) ──────

test("resolveVerificationPolicy: the pinned version always verifies against the pinned checksum", () => {
  const policy = resolveVerificationPolicy({
    version: PINNED,
    pinnedVersion: PINNED,
    pinnedSha256: "pinned-hash",
  });
  assert.deepEqual(policy, { verify: true, expected: "pinned-hash", reason: "pinned" });
});

test("resolveVerificationPolicy: a non-pinned override with neither checksum nor unsafe flag throws", () => {
  assert.throws(
    () =>
      resolveVerificationPolicy({
        version: OTHER,
        pinnedVersion: PINNED,
        pinnedSha256: "pinned-hash",
      }),
    /OPENSCAD_VERSION=2099\.01\.01 overrides the pinned build.*no checksum/s
  );
});

test("resolveVerificationPolicy: a non-pinned override with an explicit checksum verifies against it", () => {
  const policy = resolveVerificationPolicy({
    version: OTHER,
    pinnedVersion: PINNED,
    pinnedSha256: "pinned-hash",
    overrideSha256: "override-hash",
  });
  assert.deepEqual(policy, { verify: true, expected: "override-hash", reason: "override-checksum" });
});

test("resolveVerificationPolicy: a non-pinned override with the explicit unsafe flag proceeds unverified", () => {
  const policy = resolveVerificationPolicy({
    version: OTHER,
    pinnedVersion: PINNED,
    pinnedSha256: "pinned-hash",
    allowUnverified: true,
  });
  assert.deepEqual(policy, { verify: false, expected: null, reason: "explicit-unsafe" });
});

test("resolveVerificationPolicy: an explicit checksum wins over the unsafe flag when both are set", () => {
  const policy = resolveVerificationPolicy({
    version: OTHER,
    pinnedVersion: PINNED,
    pinnedSha256: "pinned-hash",
    overrideSha256: "override-hash",
    allowUnverified: true,
  });
  assert.equal(policy.reason, "override-checksum");
  assert.equal(policy.verify, true);
});

// ── stamp: both files' digests (M12: glue drift must be detected too) ──────

test("buildStamp records both assets' digests, keyed by name", () => {
  const entries = { "openscad.js": strToU8("glue"), "openscad.wasm": strToU8("wasm") };
  const stamp = buildStamp(PINNED, entries);
  assert.equal(stamp.version, PINNED);
  assert.equal(stamp.sha256, sha256(entries["openscad.wasm"]));
  assert.deepEqual(stamp.files, {
    "openscad.js": sha256(entries["openscad.js"]),
    "openscad.wasm": sha256(entries["openscad.wasm"]),
  });
});

test("stampIsCurrent is true when version and both on-disk digests match", () => {
  const entries = { "openscad.js": strToU8("glue"), "openscad.wasm": strToU8("wasm") };
  const stamp = buildStamp(PINNED, entries);
  const onDisk = { "openscad.js": sha256(entries["openscad.js"]), "openscad.wasm": sha256(entries["openscad.wasm"]) };
  assert.equal(stampIsCurrent(stamp, PINNED, onDisk), true);
});

test("stampIsCurrent is false on glue drift: the wasm digest matches but openscad.js was modified on disk", () => {
  // This is the exact M12 gap: a stamp that only recorded/verified the wasm
  // digest would call this "current" even though the glue file changed.
  const entries = { "openscad.js": strToU8("glue-original"), "openscad.wasm": strToU8("wasm") };
  const stamp = buildStamp(PINNED, entries);
  const driftedOnDisk = {
    "openscad.js": sha256(strToU8("glue-TAMPERED")),
    "openscad.wasm": sha256(entries["openscad.wasm"]),
  };
  assert.equal(stampIsCurrent(stamp, PINNED, driftedOnDisk), false);
});

test("stampIsCurrent is false on wasm drift even when the glue digest matches", () => {
  const entries = { "openscad.js": strToU8("glue"), "openscad.wasm": strToU8("wasm-original") };
  const stamp = buildStamp(PINNED, entries);
  const driftedOnDisk = {
    "openscad.js": sha256(entries["openscad.js"]),
    "openscad.wasm": sha256(strToU8("wasm-TAMPERED")),
  };
  assert.equal(stampIsCurrent(stamp, PINNED, driftedOnDisk), false);
});

test("stampIsCurrent is false for a different version, even with matching digests", () => {
  const entries = { "openscad.js": strToU8("glue"), "openscad.wasm": strToU8("wasm") };
  const stamp = buildStamp(PINNED, entries);
  const onDisk = { "openscad.js": sha256(entries["openscad.js"]), "openscad.wasm": sha256(entries["openscad.wasm"]) };
  assert.equal(stampIsCurrent(stamp, OTHER, onDisk), false);
});

test("stampIsCurrent is false for a pre-M12 stamp (no per-file digests) — forces a re-verify instead of trusting it", () => {
  const legacyStamp = { version: PINNED, sha256: "abc123" };
  assert.equal(stampIsCurrent(legacyStamp, PINNED, { "openscad.js": "x", "openscad.wasm": "abc123" }), false);
});

test("stampIsCurrent is false for a missing/malformed stamp", () => {
  assert.equal(stampIsCurrent(null, PINNED, {}), false);
  assert.equal(stampIsCurrent(undefined, PINNED, {}), false);
  assert.equal(stampIsCurrent("not json", PINNED, {}), false);
});
