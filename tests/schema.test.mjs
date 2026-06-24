// Validates that the real generated schema passes validateSchema(), and that
// malformed schemas are rejected with a clear error. Node strips the types from
// the imported .ts module (its only imports are type-only, so nothing else is
// loaded at runtime).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSchema } from "../src/lib/schema.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const realSchema = JSON.parse(
  readFileSync(join(HERE, "..", "src", "generated", "designs.json"), "utf-8")
);

test("the generated schema validates", () => {
  assert.equal(validateSchema(realSchema), realSchema);
});

test("rejects malformed schemas with a descriptive error", () => {
  assert.throws(() => validateSchema(null), /not an object/);
  assert.throws(() => validateSchema({}), /'features' must be an array/);
  assert.throws(
    () => validateSchema({ features: [], fonts: [], assets: [], designs: [] }),
    /non-empty array/
  );
  assert.throws(
    () =>
      validateSchema({
        features: [],
        fonts: [],
        assets: [],
        designs: [{ id: "x", label: "X", sections: [], params: [], presets: [] }],
      }),
    /design 'x' has no file/
  );
  assert.throws(
    () =>
      validateSchema({
        features: [],
        fonts: [],
        assets: [],
        designs: [
          {
            id: "x",
            label: "X",
            file: "x.scad",
            sections: [],
            presets: [],
            params: [{ name: "p", section: "S", type: "bogus", default: 1 }],
          },
        ],
      }),
    /invalid type 'bogus'/
  );
});

const validBase = () => ({
  title: "T",
  logo: null,
  features: [],
  fonts: [],
  assets: [],
  designs: [
    { id: "x", label: "X", file: "x.scad", sections: [], params: [], presets: [] },
  ],
});

test("validates the title and per-theme logo shape", () => {
  assert.doesNotThrow(() => validateSchema(validBase()));
  assert.doesNotThrow(() =>
    validateSchema({ ...validBase(), logo: { light: "a.svg", dark: "b.svg" } })
  );
  const noTitle = validBase();
  delete noTitle.title;
  assert.throws(() => validateSchema(noTitle), /'title' must be a string/);
  // a bare-string logo must already be normalised to { light, dark }
  assert.throws(() => validateSchema({ ...validBase(), logo: "logo.svg" }), /'logo' must be/);
  assert.throws(
    () => validateSchema({ ...validBase(), logo: { light: "a.svg" } }),
    /'logo' must be/
  );
});

test("validates the optional per-design collapsedSections", () => {
  const ok = validBase();
  ok.designs[0].collapsedSections = ["Advanced"];
  assert.doesNotThrow(() => validateSchema(ok));
  const bad = validBase();
  bad.designs[0].collapsedSections = [1, 2];
  assert.throws(() => validateSchema(bad), /collapsedSections/);
});

test("validates the optional fontPrompt shape", () => {
  // null/absent is fine (the default).
  assert.doesNotThrow(() => validateSchema({ ...validBase(), fontPrompt: null }));
  assert.doesNotThrow(() =>
    validateSchema({
      ...validBase(),
      fontPrompt: { url: "https://x/f.ttf", label: "DIN", family: "DIN 32986" },
    })
  );
  // url is required.
  assert.throws(
    () => validateSchema({ ...validBase(), fontPrompt: { label: "DIN" } }),
    /'fontPrompt' must be/
  );
});
