// The built-in open-source attributions (src/lib/licenses.ts) and the build-time
// versions they carry: ScadPub's own stamp, the OpenSCAD WASM snapshot, and the
// installed versions of the bundled npm packages. No version may be a literal —
// that's how the list came to claim React 18.3 while the app bundled 19.x.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { licenseList } from "../src/lib/licenses.ts";
import { BUNDLED_PACKAGES, componentVersions } from "../scripts/lib/dep-versions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const entry = (list, name) => list.find((l) => l.name === name);

const VERSIONS = {
  scadpub: "v1.4.0-3-gab12cd6",
  openscad: "2026.06.12",
  packages: {
    three: "0.185.1",
    react: "19.2.7",
    "react-dom": "19.2.7",
    "@fontsource/atkinson-hyperlegible": "5.2.8",
  },
};

test("every entry carries the fields the modal and the licenses require", () => {
  const list = licenseList(VERSIONS);
  assert.ok(list.length > 0);
  for (const l of list) {
    for (const key of ["name", "license", "copyright", "url", "licenseUrl"]) {
      assert.equal(typeof l[key], "string", `${l.name} is missing ${key}`);
      assert.ok(l[key].length, `${l.name} has an empty ${key}`);
    }
  }
});

test("each entry's version comes from the build, never a literal", () => {
  const list = licenseList(VERSIONS);
  assert.equal(entry(list, "ScadPub").version, "v1.4.0-3-gab12cd6");
  assert.equal(entry(list, "OpenSCAD (WebAssembly build)").version, "2026.06.12");
  assert.equal(entry(list, "three.js").version, "0.185.1");
  assert.equal(entry(list, "React & React-DOM").version, "19.2.7");
  assert.equal(entry(list, "Atkinson Hyperlegible").version, "5.2.8");

  // Change the build data and every displayed version follows it.
  const bumped = licenseList({
    ...VERSIONS,
    openscad: "2027.01.01",
    packages: { ...VERSIONS.packages, three: "0.190.0" },
  });
  assert.equal(entry(bumped, "OpenSCAD (WebAssembly build)").version, "2027.01.01");
  assert.equal(entry(bumped, "three.js").version, "0.190.0");
});

test("a build with no version data lists the components without versions", () => {
  // A git-less tree / unresolvable install shows no version rather than a stale
  // one; the attributions themselves are still complete.
  for (const list of [licenseList(), licenseList({}), licenseList({ packages: {} })]) {
    assert.equal(list.length, licenseList(VERSIONS).length);
    for (const l of list) assert.equal(l.version, undefined, `${l.name} invented a version`);
  }
});

test("react and react-dom are reported separately if an install splits them", () => {
  const split = licenseList({
    packages: { react: "19.2.7", "react-dom": "19.1.0" },
  });
  assert.equal(entry(split, "React & React-DOM").version, "19.2.7 / 19.1.0");
});

test("the resolver reads the versions actually installed for this build", () => {
  // The end-to-end guard: what the modal shows must equal what node_modules
  // holds, for every bundled package the attributions name.
  const versions = componentVersions();
  const list = licenseList({ packages: versions });
  const installed = (pkg) =>
    JSON.parse(readFileSync(join(ROOT, "node_modules", pkg, "package.json"), "utf-8")).version;

  for (const pkg of BUNDLED_PACKAGES) {
    assert.equal(versions[pkg], installed(pkg), `${pkg} version drifted`);
  }
  assert.equal(entry(list, "three.js").version, installed("three"));
  assert.equal(entry(list, "React & React-DOM").version, installed("react"));
  assert.equal(
    entry(list, "Atkinson Hyperlegible").version,
    installed("@fontsource/atkinson-hyperlegible")
  );
});

test("every bundled package the resolver reports is a declared dependency", () => {
  // Guards the other direction: the package list can't name something the app
  // doesn't actually depend on (and so doesn't bundle).
  const { dependencies } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  for (const pkg of BUNDLED_PACKAGES) {
    assert.ok(dependencies[pkg], `${pkg} is listed as bundled but isn't a dependency`);
  }
});
