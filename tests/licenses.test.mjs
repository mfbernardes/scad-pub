// The built-in open-source attributions (src/lib/licenses.ts) and the build-time
// versions they carry: ScadPub's own stamp, the OpenSCAD WASM snapshot, and the
// installed versions of the bundled npm packages. No version may be a literal:
// that's how the list came to claim React 18.3 while the app bundled 19.x.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { licenseList, mergeLicenses } from "../src/lib/licenses.ts";
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
    "lucide-react": "1.28.0",
    sonner: "2.0.7",
    clsx: "2.1.1",
    "tailwind-merge": "3.6.0",
    "class-variance-authority": "0.7.1",
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
  assert.equal(entry(list, "lucide-react").version, "1.28.0");
  assert.equal(entry(list, "sonner").version, "2.0.7");
  assert.equal(entry(list, "clsx").version, "2.1.1");
  assert.equal(entry(list, "tailwind-merge").version, "3.6.0");
  assert.equal(entry(list, "class-variance-authority").version, "0.7.1");

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

test("the previously-missing bundled runtime packages are all attributed", () => {
  // The gap this file closes: Radix, lucide-react, sonner, clsx,
  // tailwind-merge and class-variance-authority all ship in dist/
  // (package.json "dependencies", THIRD-PARTY-LICENSES.md's bundled-at-runtime
  // table) but were absent from the modal.
  const list = licenseList(VERSIONS);
  const names = list.map((l) => l.name);
  assert.ok(names.includes("Radix UI primitives"));
  assert.ok(names.includes("lucide-react"));
  assert.ok(names.includes("sonner"));
  assert.ok(names.includes("clsx"));
  assert.ok(names.includes("tailwind-merge"));
  assert.ok(names.includes("class-variance-authority"));

  assert.equal(entry(list, "lucide-react").license, "ISC");
  assert.equal(entry(list, "class-variance-authority").license, "Apache-2.0");
  for (const name of ["Radix UI primitives", "sonner", "clsx", "tailwind-merge"]) {
    assert.equal(entry(list, name).license, "MIT");
  }
});

test("Radix UI primitives is one grouped entry with no single version claimed", () => {
  // Covers 12 independently-versioned @radix-ui/react-* packages; showing
  // none is the deliberate choice (see licenses.ts), not an oversight -
  // inventing one version, or concatenating all 12, would misrepresent it.
  const list = licenseList(VERSIONS);
  const radix = entry(list, "Radix UI primitives");
  assert.equal(list.filter((l) => l.name === "Radix UI primitives").length, 1);
  assert.equal(radix.version, undefined);
  assert.equal(radix.license, "MIT");
  assert.equal(radix.copyright, "Copyright (c) 2022 WorkOS");
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

// mergeLicenses: how a config's `licenses[]` combines with the built-ins.
test("a config entry naming the same component merges into one entry", () => {
  // No build versions here on purpose: the built-in has no version for this
  // entry, so the config's should fill the gap (checked further below).
  const builtins = licenseList();
  const atkinson = entry(builtins, "Atkinson Hyperlegible");
  const extra = [
    {
      name: "  atkinson hyperlegible  ", // different case/whitespace: still a match
      license: atkinson.license,
      copyright: atkinson.copyright,
      url: "https://example.com/some-other-mirror",
      licenseUrl: "https://example.com/some-other-license-mirror",
      version: "999", // built-in has no version for this entry -> config fills in
      note: "Bundled profile-lettering alternative for our designs.",
    },
  ];

  const merged = mergeLicenses(builtins, extra);

  // Still exactly one component list slot for it, not two.
  assert.equal(merged.length, builtins.length);
  assert.equal(merged.filter((l) => l.name.toLowerCase() === "atkinson hyperlegible").length, 1);

  const result = entry(merged, "Atkinson Hyperlegible");
  // Legal fields are the built-in's, never the config's.
  assert.equal(result.license, atkinson.license);
  assert.equal(result.copyright, atkinson.copyright);
  assert.equal(result.url, atkinson.url);
  assert.equal(result.licenseUrl, atkinson.licenseUrl);
  // The built-in had no version -> the config's fills the gap.
  assert.equal(result.version, "999");
  // Both notes survive, combined into one.
  assert.ok(result.note.includes("app chrome"), "built-in note text is gone");
  assert.ok(
    result.note.includes("Bundled profile-lettering alternative"),
    "config note text is gone"
  );
});

test("the built-in's own version/text/sourceUrl are never overwritten by a config", () => {
  const builtins = licenseList(VERSIONS); // Atkinson Hyperlegible has a version here
  const atkinson = entry(builtins, "Atkinson Hyperlegible");
  assert.ok(atkinson.version, "fixture assumption: built-in already has a version");

  const merged = mergeLicenses(builtins, [
    {
      name: "Atkinson Hyperlegible",
      license: atkinson.license,
      copyright: atkinson.copyright,
      url: "https://example.com/x",
      licenseUrl: "https://example.com/x/LICENSE",
      version: "0.0.1-should-not-win",
      text: "should not win either",
    },
  ]);

  const result = entry(merged, "Atkinson Hyperlegible");
  assert.equal(result.version, atkinson.version);
  assert.equal(result.text, atkinson.text);
});

test("a same-name entry with a different license/copyright stays a separate entry", () => {
  const builtins = licenseList(VERSIONS);
  const differentLicense = [
    {
      name: "Atkinson Hyperlegible",
      license: "Apache-2.0", // disagrees with the built-in's OFL-1.1
      copyright: "Copyright 2030 Someone Else",
      url: "https://example.com/fork",
      licenseUrl: "https://example.com/fork/LICENSE",
    },
  ];

  const merged = mergeLicenses(builtins, differentLicense);

  assert.equal(merged.length, builtins.length + 1);
  const matches = merged.filter((l) => l.name === "Atkinson Hyperlegible");
  assert.equal(matches.length, 2);
  // The built-in entry is untouched.
  assert.deepEqual(entry(merged, "Atkinson Hyperlegible"), entry(builtins, "Atkinson Hyperlegible"));
  // The mismatched config entry is present verbatim, not blended in.
  assert.ok(matches.some((l) => l.license === "Apache-2.0"));
});

test("a config-only name is simply appended", () => {
  const builtins = licenseList(VERSIONS);
  const extra = [
    {
      name: "Acme Widget Library",
      license: "MIT",
      copyright: "Copyright (c) 2024 Acme Corp",
      url: "https://example.com/acme",
      licenseUrl: "https://example.com/acme/LICENSE",
      note: "Bundled helper geometry.",
    },
  ];

  const merged = mergeLicenses(builtins, extra);
  assert.equal(merged.length, builtins.length + 1);
  assert.equal(merged.at(-1).name, "Acme Widget Library");
});

test("ordering is stable: built-ins first, in their own order, extras after", () => {
  const builtins = licenseList(VERSIONS);
  const extras = [
    { name: "Zeta Lib", license: "MIT", copyright: "c", url: "u", licenseUrl: "l" },
    { name: "Alpha Lib", license: "MIT", copyright: "c", url: "u", licenseUrl: "l" },
  ];

  const merged = mergeLicenses(builtins, extras);

  // Every built-in keeps its original relative position.
  for (let i = 0; i < builtins.length; i++) {
    assert.equal(merged[i].name, builtins[i].name);
  }
  // Unmerged extras follow, in the order given (not re-sorted).
  assert.equal(merged[builtins.length].name, "Zeta Lib");
  assert.equal(merged[builtins.length + 1].name, "Alpha Lib");
});

test("mergeLicenses never mutates its inputs", () => {
  const builtins = licenseList(VERSIONS);
  const atkinson = entry(builtins, "Atkinson Hyperlegible");
  const before = JSON.stringify(builtins);

  mergeLicenses(builtins, [
    {
      name: "Atkinson Hyperlegible",
      license: atkinson.license,
      copyright: atkinson.copyright,
      url: "https://example.com/x",
      licenseUrl: "https://example.com/x/LICENSE",
      note: "Some deployment-specific note.",
    },
  ]);

  assert.equal(JSON.stringify(builtins), before);
});
