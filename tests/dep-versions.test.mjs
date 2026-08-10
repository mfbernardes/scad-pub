// Unit tests for scripts/lib/dep-versions.mjs: the installed versions of the
// bundled packages that feed the licenses modal. The interesting case is a
// package whose `exports` map refuses "./package.json" (three does), where the
// version has to come from walking up out of the resolved entry point.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { componentVersions, BUNDLED_PACKAGES } from "../scripts/lib/dep-versions.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require_ = createRequire(join(ROOT, "package.json"));

test("resolves every bundled package to a concrete version", () => {
  const versions = componentVersions();
  for (const pkg of BUNDLED_PACKAGES) {
    assert.match(versions[pkg] ?? "", /^\d+\.\d+\.\d+/, `${pkg} did not resolve`);
  }
});

test("resolves a package whose exports map hides package.json", () => {
  // three's package.json is not in its `exports`, so a direct
  // require("three/package.json") throws ERR_PACKAGE_PATH_NOT_EXPORTED: if the
  // walk-up fallback regressed, three would silently lose its version.
  assert.throws(() => require_.resolve("three/package.json"));
  assert.match(componentVersions({ packages: ["three"] }).three, /^\d+\.\d+\.\d+/);
});

test("an unresolvable package is omitted, not guessed", () => {
  // A dependency that isn't installed leaves its attribution without a version
  // instead of failing the build (vite would fail on the missing import anyway).
  const versions = componentVersions({ packages: ["three", "no-such-package-xyz"] });
  assert.equal("no-such-package-xyz" in versions, false);
  assert.ok(versions.three);
});

test("resolves against the given checkout, not the process cwd", () => {
  // Same reasoning as the version stamp: ScadPub builds run from a consumer
  // project's directory, so resolution is anchored to the ScadPub checkout.
  assert.deepEqual(componentVersions({ dir: "/nonexistent-checkout" }), {});
});

test("every package.json runtime dependency is a declared bundled package", () => {
  // The inverse of licenses.test.mjs's "every bundled package the resolver
  // reports is a declared dependency": together the two pin BUNDLED_PACKAGES
  // as the *exact* set of package.json's "dependencies" (everything bundled
  // into dist/, per this repo's dependencies/devDependencies split), so a new
  // runtime dependency can't silently ship without a licenses.ts attribution.
  const { dependencies } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  for (const name of Object.keys(dependencies)) {
    assert.ok(
      BUNDLED_PACKAGES.includes(name),
      `${name} is a package.json dependency but missing from BUNDLED_PACKAGES`
    );
  }
});
