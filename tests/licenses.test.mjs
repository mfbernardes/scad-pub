// The built-in open-source attributions (src/lib/licenses.ts) and the build's
// version stamp landing on ScadPub's own entry in the licenses modal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LICENSES, licenseList } from "../src/lib/licenses.ts";

const scadpub = (list) => list.find((l) => l.name === "ScadPub");

test("every built-in entry carries the fields the modal and the licenses require", () => {
  assert.ok(LICENSES.length > 0);
  for (const l of LICENSES) {
    for (const key of ["name", "license", "copyright", "url", "licenseUrl"]) {
      assert.equal(typeof l[key], "string", `${l.name} is missing ${key}`);
      assert.ok(l[key].length, `${l.name} has an empty ${key}`);
    }
  }
});

test("stamps the build version onto ScadPub's own entry only", () => {
  const list = licenseList("v1.4.0-3-gab12cd6");
  assert.equal(scadpub(list).version, "v1.4.0-3-gab12cd6");
  assert.equal(list.length, LICENSES.length);
  // Every other entry keeps its own declared version (the bundled components'
  // versions, which have nothing to do with the ScadPub build).
  for (const [i, l] of list.entries()) {
    if (l.name === "ScadPub") continue;
    assert.equal(l.version, LICENSES[i].version);
  }
  assert.equal(list.find((l) => l.name === "three.js").version, "0.185");
});

test("a build with no version stamp lists the built-ins unchanged", () => {
  assert.equal(licenseList(undefined), LICENSES);
  assert.equal(licenseList(""), LICENSES);
  assert.equal(scadpub(licenseList(undefined)).version, undefined);
});

test("stamping doesn't mutate the shared built-in list", () => {
  licenseList("v9.9.9");
  assert.equal(scadpub(LICENSES).version, undefined);
});
