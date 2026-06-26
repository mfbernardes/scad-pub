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
  format: "3mf",
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

test("validates the model format", () => {
  assert.doesNotThrow(() => validateSchema({ ...validBase(), format: "3mf" }));
  assert.doesNotThrow(() => validateSchema({ ...validBase(), format: "stl" }));
  const noFormat = validBase();
  delete noFormat.format;
  assert.throws(() => validateSchema(noFormat), /'format' must be/);
  assert.throws(() => validateSchema({ ...validBase(), format: "obj" }), /'format' must be/);
});

test("validates the optional per-design collapsedSections", () => {
  const ok = validBase();
  ok.designs[0].collapsedSections = ["Advanced"];
  assert.doesNotThrow(() => validateSchema(ok));
  const bad = validBase();
  bad.designs[0].collapsedSections = [1, 2];
  assert.throws(() => validateSchema(bad), /collapsedSections/);
});

test("validates the optional colours and extraCss", () => {
  // null/absent is fine.
  assert.doesNotThrow(() => validateSchema({ ...validBase(), colors: null, extraCss: null }));
  assert.doesNotThrow(() =>
    validateSchema({
      ...validBase(),
      colors: { dark: { accent: "#fff" }, light: { accent: "#000" } },
      extraCss: "scad/theme.css",
    })
  );
  // one theme present, the other omitted, is fine.
  assert.doesNotThrow(() => validateSchema({ ...validBase(), colors: { dark: { bg: "#000" } } }));
  // colours must be an object of string values.
  assert.throws(() => validateSchema({ ...validBase(), colors: [] }), /'colors' must be/);
  assert.throws(
    () => validateSchema({ ...validBase(), colors: { dark: { accent: 123 } } }),
    /'colors\.dark' must be/
  );
  assert.throws(
    () => validateSchema({ ...validBase(), colors: { light: "#fff" } }),
    /'colors\.light' must be/
  );
  // extraCss must be a string URL when present.
  assert.throws(() => validateSchema({ ...validBase(), extraCss: 42 }), /'extraCss' must be/);
});

test("validates the optional help (single-pane and tabbed) shape", () => {
  // null/absent is fine.
  assert.doesNotThrow(() => validateSchema({ ...validBase(), help: null }));
  // classic single-pane sections.
  assert.doesNotThrow(() =>
    validateSchema({
      ...validBase(),
      help: { intro: "hi", sections: [{ title: "T", body: "B" }] },
    })
  );
  // tabbed help, with and without top-level sections.
  assert.doesNotThrow(() =>
    validateSchema({
      ...validBase(),
      help: { tabs: [{ label: "One", sections: [{ title: "T", body: "B" }] }] },
    })
  );
  // a section missing a body is rejected.
  assert.throws(
    () => validateSchema({ ...validBase(), help: { sections: [{ title: "T" }] } }),
    /'help\.sections' must be/
  );
  // a tab missing its sections is rejected.
  assert.throws(
    () => validateSchema({ ...validBase(), help: { tabs: [{ label: "One" }] } }),
    /'help\.tabs' must be/
  );
  // help with neither sections nor tabs is rejected.
  assert.throws(
    () => validateSchema({ ...validBase(), help: { intro: "x" } }),
    /'help' must provide/
  );
});

test("validates the optional appended licenses", () => {
  // null/absent/empty is fine.
  assert.doesNotThrow(() => validateSchema({ ...validBase(), licenses: [] }));
  assert.doesNotThrow(() => validateSchema({ ...validBase(), licenses: null }));
  assert.doesNotThrow(() =>
    validateSchema({
      ...validBase(),
      licenses: [
        {
          name: "Lib",
          license: "MIT",
          copyright: "(c) X",
          url: "https://x",
          licenseUrl: "https://x/LICENSE",
        },
      ],
    })
  );
  // not an array.
  assert.throws(
    () => validateSchema({ ...validBase(), licenses: {} }),
    /'licenses' must be an array/
  );
  // an entry missing a required field.
  assert.throws(
    () =>
      validateSchema({
        ...validBase(),
        licenses: [{ name: "Lib", license: "MIT", copyright: "(c)", url: "https://x" }],
      }),
    /missing required string 'licenseUrl'/
  );
});

test("validates the optional fileImport shape", () => {
  // null/absent is fine (the default).
  assert.doesNotThrow(() => validateSchema({ ...validBase(), fileImport: null }));
  assert.doesNotThrow(() => validateSchema({ ...validBase(), fileImport: {} }));
  assert.doesNotThrow(() =>
    validateSchema({
      ...validBase(),
      fileImport: { accept: ".svg", label: "Import file", note: "any file" },
    })
  );
  // not an object.
  assert.throws(
    () => validateSchema({ ...validBase(), fileImport: [] }),
    /'fileImport' must be an object/
  );
  // non-string field.
  assert.throws(
    () => validateSchema({ ...validBase(), fileImport: { accept: 5 } }),
    /'fileImport\.accept' must be a string/
  );
});

test("validates the optional popup shape", () => {
  // null/absent is fine (the default).
  assert.doesNotThrow(() => validateSchema({ ...validBase(), popup: null }));
  for (const mode of ["always", "once", "dismissible"]) {
    assert.doesNotThrow(() =>
      validateSchema({ ...validBase(), popup: { header: "Hi", body: "Body", mode } })
    );
  }
  // not an object.
  assert.throws(
    () => validateSchema({ ...validBase(), popup: [] }),
    /'popup' must be an object/
  );
  // missing / empty required fields.
  assert.throws(
    () => validateSchema({ ...validBase(), popup: { body: "x", mode: "once" } }),
    /'popup\.header' must be a non-empty string/
  );
  // bad mode.
  assert.throws(
    () => validateSchema({ ...validBase(), popup: { header: "x", body: "y", mode: "nope" } }),
    /'popup\.mode' must be/
  );
});
