// Unit tests for src/lib/shareability.ts — deciding whether a share URL alone
// reproduces the current render, or depends on local-only imported files
// (fonts, SVG-wizard output, generic imported files). See
// docs/architecture-review.md H2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { computeShareability, shareabilityWarning } from "../src/lib/shareability.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_BYTES = new Uint8Array(
  readFileSync(join(HERE, "..", "public", "fonts", "LiberationSans-Regular.ttf"))
);
// Embedded family is "Liberation Sans" (see tests/fonts.test.mjs).

const param = (name, type, extra = {}) => ({
  name,
  section: "S",
  description: "",
  help: "",
  type,
  default: type === "boolean" ? false : type === "number" ? 0 : "",
  ...extra,
});

function design(params) {
  return { id: "d", label: "D", file: "d.scad", presets: [], sections: ["S"], params };
}

test("a config with no local-only inputs reports complete", () => {
  const d = design([
    param("text", "string"),
    param("count", "number"),
    param("flag", "boolean"),
  ]);
  const values = { text: "hello", count: 3, flag: true };
  const result = computeShareability(d, values, {}, []);
  assert.equal(result.complete, true);
  assert.deepEqual(result.localOnly, []);
  assert.equal(shareabilityWarning(result), null);
});

test("a bundled font family is portable, not local-only", () => {
  const d = design([param("font", "string", { isFont: true })]);
  const values = { font: "Liberation Sans" };
  const result = computeShareability(d, values, {}, ["Liberation Sans"]);
  assert.equal(result.complete, true);
});

test("an imported font not in the bundled set is detected as local-only", () => {
  const d = design([param("font", "string", { isFont: true })]);
  const values = { font: "Liberation Sans" };
  const userFiles = { "MyFont.ttf": FONT_BYTES };
  const result = computeShareability(d, values, userFiles, [] /* nothing bundled */);
  assert.equal(result.complete, false);
  assert.deepEqual(result.localOnly, [{ kind: "font", param: "font", name: "MyFont.ttf" }]);
  assert.match(shareabilityWarning(result), /MyFont\.ttf/);
});

test("a font family that is neither bundled nor imported is not flagged (unrelated to sharing)", () => {
  const d = design([param("font", "string", { isFont: true })]);
  const values = { font: "Some Random Font" };
  const result = computeShareability(d, values, {}, ["Liberation Sans"]);
  assert.equal(result.complete, true);
});

test("SVG wizard output is detected as local-only", () => {
  const d = design([param("logo", "string", { svg: { layers: null } })]);
  const values = { logo: "logo.svg" };
  const userFiles = { "logo.svg": new TextEncoder().encode("<svg></svg>") };
  const result = computeShareability(d, values, userFiles, []);
  assert.equal(result.complete, false);
  assert.deepEqual(result.localOnly, [{ kind: "svg", param: "logo", name: "logo.svg" }]);
});

test("a generic imported file referenced by a plain string param is local-only", () => {
  const d = design([param("heightmap", "string")]);
  const values = { heightmap: "terrain.dat" };
  const userFiles = { "terrain.dat": new Uint8Array([1, 2, 3]) };
  const result = computeShareability(d, values, userFiles, []);
  assert.equal(result.complete, false);
  assert.deepEqual(result.localOnly, [{ kind: "file", param: "heightmap", name: "terrain.dat" }]);
});

test("a plain string param whose value does not match any imported file is not flagged", () => {
  const d = design([param("heightmap", "string")]);
  const values = { heightmap: "not-imported.dat" };
  const userFiles = { "terrain.dat": new Uint8Array([1, 2, 3]) };
  const result = computeShareability(d, values, userFiles, []);
  assert.equal(result.complete, true);
});

test("multiple local-only inputs are all reported and named in the warning", () => {
  const d = design([
    param("font", "string", { isFont: true }),
    param("logo", "string", { svg: { layers: null } }),
    param("heightmap", "string"),
  ]);
  const values = { font: "Liberation Sans", logo: "logo.svg", heightmap: "terrain.dat" };
  const userFiles = {
    "MyFont.ttf": FONT_BYTES,
    "logo.svg": new TextEncoder().encode("<svg></svg>"),
    "terrain.dat": new Uint8Array([1, 2, 3]),
  };
  const result = computeShareability(d, values, userFiles, [] /* nothing bundled */);
  assert.equal(result.complete, false);
  assert.equal(result.localOnly.length, 3);
  const warning = shareabilityWarning(result);
  assert.match(warning, /MyFont\.ttf/);
  assert.match(warning, /logo\.svg/);
  assert.match(warning, /terrain\.dat/);
});

test("an enum @font param is checked the same way as a string @font param", () => {
  const d = design([
    param("font", "enum", { isFont: true, choices: [{ value: "Liberation Sans", label: "LS" }] }),
  ]);
  const values = { font: "Liberation Sans" };
  const userFiles = { "MyFont.ttf": FONT_BYTES };
  const result = computeShareability(d, values, userFiles, []);
  assert.equal(result.complete, false);
});
