// The build side's designs.json reader has two paths, and shipping the wrong
// one is silent: a build that falls back to `{}` produces a site whose storage
// namespace, title, theme colour and export format all belong to no config at
// all, and nothing in the output says so. Only vite.config.ts's
// `command === "build"` chooses `strict`, so these pin the behaviour it selects.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { validateSchema } from "../src/lib/schema.ts";
import { readGeneratedSchema } from "../scripts/lib/read-schema.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "read-schema-"));

test("a readable schema is returned whole, on both paths", async () => {
  // A REAL generated schema: strict runs the app's own validator now, so a
  // hand-written stub is not a schema and rightly does not pass.
  const real = JSON.parse(
    readFileSync(new URL("../src/generated/designs.json", import.meta.url), "utf-8")
  );
  const p = join(tmp(), "designs.json");
  writeFileSync(p, JSON.stringify({ ...real, format: "stl" }));
  for (const strict of [false, true]) {
    const s = await readGeneratedSchema(p, strict);
    assert.equal(s.id, real.id);
    assert.equal(s.format, "stl");
  }
});

test("a missing schema fails the build and is tolerated by the dev server", async () => {
  const missing = join(tmp(), "designs.json");
  assert.deepEqual(await readGeneratedSchema(missing, false), {}, "dev server keeps going");
  await assert.rejects(
    () => readGeneratedSchema(missing, true),
    /gen-schema first/,
    "a build says which step didn't run"
  );
});

test("a corrupt schema fails the build too, not just a missing one", async () => {
  // The half-written-file case: gen-schema killed mid-write leaves a file that
  // exists and does not parse. Falling back there is the same silent wrong
  // build as a missing one.
  const dir = tmp();
  const p = join(dir, "designs.json");
  writeFileSync(p, '{"id": "widget", "format":');
  assert.deepEqual(await readGeneratedSchema(p, false), {});
  await assert.rejects(() => readGeneratedSchema(p, true), /gen-schema first/);
});

test("a schema that parses to the wrong shape fails too", async () => {
  // JSON.parse succeeds on all of these. Only the strict path's callers care —
  // they go straight on to read `.id`/`.title`/`.themeColor` off the result —
  // so "it parsed" is not the property worth checking.
  const dir = tmp();
  const p = join(dir, "designs.json");
  for (const body of ["null", "[]", "42", '"widget"']) {
    writeFileSync(p, body);
    assert.deepEqual(await readGeneratedSchema(p, false), {}, body);
    await assert.rejects(() => readGeneratedSchema(p, true), /gen-schema first/, body);
  }
});

test("strict runs the app's own validator, not a build-side paraphrase", async () => {
  // Shape alone is not the property, and neither is key presence: `{}` built a
  // site from fallbacks, and `{ id, title, designs: [{ id }], format }` has
  // every key a hand-written subset checked for while validateSchema rejects it
  // for missing `features`/`fonts`/`assets` and an incomplete design. Both
  // shipped a build the app would refuse at startup.
  const dir = tmp();
  const p = join(dir, "designs.json");
  const real = JSON.parse(
    readFileSync(new URL("../src/generated/designs.json", import.meta.url), "utf-8")
  );
  for (const [what, schema] of [
    ["empty", {}],
    ["title only", { title: "T" }],
    ["the keys a subset check looked for", { id: "w", title: "W", designs: [{ id: "w" }], format: "3mf" }],
    ["a non-string id", { ...real, id: 42 }],
    ["a non-string title", { ...real, title: 42 }],
    ["an empty designs array", { ...real, designs: [] }],
    ["an unknown format", { ...real, format: "obj" }],
    ["a design with no params", { ...real, designs: [{ id: "w", label: "W", file: "w.scad" }] }],
  ]) {
    writeFileSync(p, JSON.stringify(schema));
    await assert.rejects(() => readGeneratedSchema(p, true), /gen-schema first/, what);
    // And it is genuinely the runtime's answer, not a stricter build opinion.
    assert.throws(() => validateSchema(schema), /Invalid designs schema/, what);
    // The dev server still tolerates all of it: a half-written file between two
    // saves is ordinary there, and it has a live gen-schema behind it.
    await readGeneratedSchema(p, false);
  }
  // The real generated schema passes both, which is what stops this from being
  // a check nobody can satisfy.
  writeFileSync(p, JSON.stringify(real));
  assert.deepEqual(await readGeneratedSchema(p, true), real);
  assert.equal(validateSchema(real), real);
});
