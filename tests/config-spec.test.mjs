// Unit tests for scripts/lib/config-spec.mjs and the two things it feeds:
// the committed scadpub.config.schema.json (scripts/gen-config-schema.mjs)
// and docs/config.md's key coverage. These are the drift guards the previous
// hand-maintained-in-five-places setup didn't have, see CONFIG_SPEC's
// file-top comment and the commit that introduced it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_SPEC } from "../scripts/lib/config-spec.mjs";
import { buildConfigSchema, buildConfigTextSchema } from "../scripts/gen-config-schema.mjs";
import { generate, parseLang, parseDir, parseFormat } from "../scripts/gen-schema.mjs";
import {
  POPUP_MODES,
  TEXT_DIRECTIONS,
  FORMATS,
  PANEL_SIDES,
  PANEL_DEFAULTS,
  OUTPUT_DEFAULTS,
  VIEWER_STYLES,
  VIEWER_GRID_DEFAULTS,
  INSTALL_MODES,
} from "../src/lib/schema.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FIXTURES = join(HERE, "fixtures");

test("scadpub.config.schema.json is up to date with config-spec.mjs", () => {
  const committed = JSON.parse(
    readFileSync(join(ROOT, "scadpub.config.schema.json"), "utf-8")
  );
  const fresh = buildConfigSchema();
  assert.deepEqual(
    committed,
    fresh,
    "scadpub.config.schema.json is stale — run `npm run gen` (or " +
      "`node scripts/gen-config-schema.mjs`) and commit the result."
  );
});

// scadpub.config.text.schema.json (scripts/lib/config-text.mjs's own doc, and
// docs/config.md "Localizing config text"): same freshness mechanism as the
// main config schema above, over the hand-written (not CONFIG_SPEC-derived)
// text-file schema — see buildConfigTextSchema's own comment for why it can't
// be derived the same way the main one is.
test("scadpub.config.text.schema.json is up to date with buildConfigTextSchema", () => {
  const committed = JSON.parse(
    readFileSync(join(ROOT, "scadpub.config.text.schema.json"), "utf-8")
  );
  const fresh = buildConfigTextSchema();
  assert.deepEqual(
    committed,
    fresh,
    "scadpub.config.text.schema.json is stale — run `npm run gen` (or " +
      "`node scripts/gen-config-schema.mjs`) and commit the result."
  );
});

// `textSuppliable` (config-spec.mjs's own comment on the marker,
// gen-config-schema.mjs's objectSchema): a field can be genuinely `required`
// by the real parser (parsePopup, post config-text fold) while still being
// legitimately ABSENT from the raw scadpub.config.json a deployment with
// 'text' configured writes — scripts/lib/config-text.mjs's foldPopup fills it
// in before parsePopup ever runs. The generated schema must not demand the
// key be present.
test("popup.header/popup.body are textSuppliable and excluded from the generated schema's 'required'", () => {
  assert.equal(CONFIG_SPEC.popup.properties.header.required, true);
  assert.equal(CONFIG_SPEC.popup.properties.header.textSuppliable, true);
  assert.equal(CONFIG_SPEC.popup.properties.body.required, true);
  assert.equal(CONFIG_SPEC.popup.properties.body.textSuppliable, true);

  const schema = buildConfigSchema();
  const popupRequired = schema.properties.popup.required ?? [];
  assert.ok(!popupRequired.includes("header"), "'popup.header' must not be in the schema's required list");
  assert.ok(!popupRequired.includes("body"), "'popup.body' must not be in the schema's required list");
  // Presence is relaxed, but the field itself still isn't nullable — a
  // text-mode config can OMIT 'popup.header', not set it to null inline.
  assert.equal(schema.properties.popup.properties.header.type, undefined, "still a string/anyOf shape, no bare object type");
});

// The regression this schema exists to catch (docs/config-pipeline.md,
// gen-config-schema.mjs's own file-top comment: "editor autocomplete and
// typo-catching for the config author"): a schema that rejects the repo's own
// checked-in config is worse than no schema. Structural only (this repo pins
// ajv@6/draft-07; the generated schema is draft 2020-12, and a full validator
// isn't warranted for one 'required'-list check) — walks every node's own
// `required` array against the real scadpub.config.json, recursing through
// `properties`/`items`/whichever `anyOf` branch shape-matches the value.
function schemaBranchForValue(node, value) {
  if (!node?.anyOf) return node;
  const isPlainObject = typeof value === "object" && value !== null && !Array.isArray(value);
  return node.anyOf.find((b) => (isPlainObject ? b.type === "object" || b.properties : b.type !== "object")) ?? node;
}

function findMissingRequired(node, value, path, missing) {
  if (value === undefined || value === null) return;
  const branch = schemaBranchForValue(node, value);
  const isPlainObject = typeof value === "object" && value !== null && !Array.isArray(value);
  if (isPlainObject) {
    for (const key of branch?.required ?? [])
      if (!(key in value)) missing.push(path ? `${path}.${key}` : key);
    for (const [key, childNode] of Object.entries(branch?.properties ?? {}))
      if (key in value) findMissingRequired(childNode, value[key], path ? `${path}.${key}` : key, missing);
  } else if (Array.isArray(value) && branch?.items) {
    value.forEach((item, i) => findMissingRequired(branch.items, item, `${path}[${i}]`, missing));
  }
}

test("scadpub.config.schema.json's 'required' lists are satisfiable by the repo's own scadpub.config.json", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "scadpub.config.schema.json"), "utf-8"));
  const config = JSON.parse(readFileSync(join(ROOT, "scadpub.config.json"), "utf-8"));
  const missing = [];
  findMissingRequired(schema, config, "", missing);
  assert.deepEqual(
    missing,
    [],
    `scadpub.config.json omits key(s) the generated schema marks 'required': ${missing.join(", ")} — ` +
      "either the config is genuinely broken, or the corresponding config-spec.mjs field needs 'textSuppliable'"
  );
});

// Every key CONFIG_SPEC knows about, flattened to bare names (not paths):
// the same name reused at different nesting levels (e.g. `id` on the config
// itself and on a `designs[]` entry) only needs to be documented once.
function flattenSpecKeys(spec) {
  const names = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.properties) {
      for (const [key, field] of Object.entries(node.properties)) {
        names.add(key);
        walk(field);
      }
    }
    if (node.items) walk(node.items);
  };
  for (const [key, node] of Object.entries(spec)) {
    names.add(key);
    walk(node);
  }
  return names;
}

// docs/config.md documents most keys as `**\`key\`**` (a bold reference
// bullet) and the CSS colour tokens as `` `--token` `` (the custom-property
// name a `colors.<theme>.<token>` value ultimately sets): both conventions
// wrap the bare name in single backticks, so a plain `` `name` ``/`` `--name`
// `` substring search catches either.
function docMentionsKey(doc, key) {
  return doc.includes(`\`${key}\``) || doc.includes(`\`--${key}\``);
}

// Keys config-spec.mjs carries that genuinely aren't given a standalone
// `` `key` `` mention in docs/config.md: each is documented, but not in a
// form this mechanical scan can find (see the comment at each entry).
const SPEC_KEYS_NOT_MECHANICALLY_IN_DOCS = new Set([
  // Mentioned as `"$schema"` (with the quotes inside the backticks, since
  // it's illustrating a JSON key-value pair), not bare `$schema`.
  "$schema",
  // Mentioned as `"heavy": true` (the whole key:value pair inside one
  // backtick span), not bare `heavy`.
  "heavy",
  // `licenses[].version` is only covered by prose ("the rest are optional")
  // alongside `text`/`sourceUrl`/`note`, which (unlike `version`) do get
  // their own standalone mention elsewhere in the file.
  "version",
]);

// docs/config.md also uses the `**\`key\`**` bullet convention for four
// popup.mode ENUM VALUES ("shown on every visit"), not key names: same
// markdown shape, different meaning, so the scan below has to know about
// them explicitly rather than mistaking them for undocumented keys.
const DOC_BOLD_CODE_NOT_A_KEY = new Set(["always", "once", "dismissible", "picker"]);

test("every config-spec.mjs key is documented in docs/config.md, and vice versa", () => {
  const doc = readFileSync(join(ROOT, "docs", "config.md"), "utf-8");
  const specKeys = flattenSpecKeys(CONFIG_SPEC);

  const undocumented = [...specKeys].filter(
    (key) => !SPEC_KEYS_NOT_MECHANICALLY_IN_DOCS.has(key) && !docMentionsKey(doc, key)
  );
  assert.deepEqual(
    undocumented,
    [],
    "config-spec.mjs key(s) with no `key`/`--key` mention in docs/config.md " +
      "(add documentation, or — if it genuinely can't be phrased that way — " +
      "extend SPEC_KEYS_NOT_MECHANICALLY_IN_DOCS with a comment explaining why)"
  );

  const boldDocKeys = new Set(
    [...doc.matchAll(/\*\*`([^`]*)`\*\*/g)].map((m) => m[1])
  );
  const staleDocKeys = [...boldDocKeys].filter(
    (key) => !DOC_BOLD_CODE_NOT_A_KEY.has(key) && !specKeys.has(key)
  );
  assert.deepEqual(
    staleDocKeys,
    [],
    "docs/config.md bold-codes a key config-spec.mjs doesn't know about " +
      "(stale documentation, or config-spec.mjs is missing this key)"
  );
});

// src/lib/schema.ts re-types several CONFIG_SPEC enums by hand as
// string-literal arrays for validateSchema's own runtime checks against
// designs.json (which carries the resolved value, not the spec node). Each
// pair below is the same enum's data-side (CONFIG_SPEC) and app-side
// (src/lib/schema.ts) declaration; asserting they're equal is the drift guard
// a third value could otherwise slip past every other test and only fail at
// runtime in the browser.
const ENUM_CROSS_CHECKS = [
  ["popup.mode", POPUP_MODES, CONFIG_SPEC.popup.properties.mode.values],
  ["dir", TEXT_DIRECTIONS, CONFIG_SPEC.dir.values],
  ["render.format", FORMATS, CONFIG_SPEC.render.properties.format.values],
  ["ui.panelSide", PANEL_SIDES, CONFIG_SPEC.ui.properties.panelSide.values],
  ["ui.panelDefault", PANEL_DEFAULTS, CONFIG_SPEC.ui.properties.panelDefault.values],
  ["ui.outputDefault", OUTPUT_DEFAULTS, CONFIG_SPEC.ui.properties.outputDefault.values],
  ["viewer.style", VIEWER_STYLES, CONFIG_SPEC.viewer.properties.style.values],
  ["viewer.grid", VIEWER_GRID_DEFAULTS, CONFIG_SPEC.viewer.properties.grid.values],
  ["pwa.install", INSTALL_MODES, CONFIG_SPEC.pwa.properties.install.values],
];

test("src/lib/schema.ts's hand-typed enum lists match config-spec.mjs", () => {
  for (const [key, schemaTs, configSpec] of ENUM_CROSS_CHECKS) {
    assert.deepEqual(
      schemaTs,
      configSpec,
      `'${key}': src/lib/schema.ts's enum list has drifted from CONFIG_SPEC's ` +
        `(config-spec.mjs is the source of truth — update src/lib/schema.ts's ` +
        `matching const to match)`
    );
  }
});

// CONFIG_SPEC enum nodes that deliberately have no schema.ts counterpart,
// because designs.json never carries the value for validateSchema to check.
// Listing them here rather than leaving the exhaustiveness check to a
// hand-picked sample is the point: a NEW enum that does reach designs.json
// then fails this test instead of silently going unvalidated at runtime.
// Empty today: every enum in the config surface reaches designs.json and is
// validated at load. A future manifest-only enum (pwa.* is otherwise a
// rasterizer input with no runtime reader) belongs here with its reason.
const ENUMS_NOT_IN_DESIGNS_JSON = new Set([]);

// The DEFAULT half of the same problem: an enum's values were single-sourced
// but each parser still re-typed the spec's `default` a few lines below the
// enum it had just imported from it, so the two could disagree with nothing
// failing. These assert the parsers return exactly what the spec declares.
test("the bespoke parsers' fallbacks are the spec's declared defaults", () => {
  assert.equal(parseLang(null), CONFIG_SPEC.lang.default);
  assert.equal(parseDir(null), CONFIG_SPEC.dir.default);
  assert.equal(parseFormat(null), CONFIG_SPEC.render.properties.format.default);
  // And each declared default must itself be a member of its own enum.
  assert.ok(CONFIG_SPEC.dir.values.includes(CONFIG_SPEC.dir.default));
  assert.ok(
    CONFIG_SPEC.render.properties.format.values.includes(
      CONFIG_SPEC.render.properties.format.default
    )
  );
});

test("every CONFIG_SPEC enum is either cross-checked or explicitly exempt", () => {
  // The pairs above are hand-written, so the thing that can rot is not a pair
  // drifting (that test catches it) but a new enum never getting a pair.
  const checked = new Set(ENUM_CROSS_CHECKS.map(([key]) => key));
  const found = [];
  const walk = (node, path) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "enum" && Array.isArray(node.values)) found.push(path);
    for (const [key, child] of Object.entries(node.properties ?? {}))
      walk(child, path ? `${path}.${key}` : key);
    if (node.items) walk(node.items, `${path}[]`);
  };
  for (const [key, node] of Object.entries(CONFIG_SPEC)) walk(node, key);

  const unchecked = found.filter((p) => !checked.has(p) && !ENUMS_NOT_IN_DESIGNS_JSON.has(p));
  assert.deepEqual(
    unchecked,
    [],
    `these CONFIG_SPEC enums have no src/lib/schema.ts cross-check:\n  ${unchecked.join("\n  ")}\n` +
      `Either add the pair to ENUM_CROSS_CHECKS, or add the path to ` +
      `ENUMS_NOT_IN_DESIGNS_JSON with a reason.`
  );
});

// ── Null agreement: does "the emitted schema permits null here" match "the
// real parser accepts an explicit null here", for EVERY field CONFIG_SPEC
// knows about? ───────────────────────────────────────────────────────────
//
// This is the test the PR review asked for, driven mechanically off
// CONFIG_SPEC itself rather than a hand-picked sample: `walkSpecPaths` below
// enumerates every settable path in the tree (a top-level key, a nested
// group's own key, and (via a synthetic "[]" path segment) every field of
// an array's entry template, at any depth: `colors.light.<token>`,
// `designs[].presets.images`, …). For each path this builds a real,
// otherwise-valid scadpub.config.json (`baseConfig()`, below) with ONLY that
// one field set to an explicit `null`, and runs it through the actual
// `generate()` gen-schema.mjs itself calls at build time: no re-implemented
// validation, no assumptions about which fields "should" be nullable.
//
// The baseline config is deliberately minimal: every field this sweep isn't
// currently testing is left ENTIRELY ABSENT rather than populated with a
// representative value, because most fields validate independently of their
// siblings and an absent optional field is already exactly as well-trodden a
// path as gen-schema.mjs gets (every other fixture-driven test exercises it).
// The exceptions are the handful of genuine cross-field dependencies a
// missing shell would crash THIS TEST's own path navigation on, or would
// accidentally fail for a reason unrelated to the field under test, see each
// baseConfig() key's own comment.
test("emitted schema nullability matches the real parser, for every CONFIG_SPEC field", () => {
  // A minimal, dependency-free design: no `use`/`include`, no `// @icon`, so
  // no other file needs to exist for buildDesigns to accept it, and 'assets'
  // auto-discovery (collectDeps) trivially finds nothing to walk.
  const root = mkdtempSync(join(tmpdir(), "config-null-agreement-"));
  writeFileSync(
    join(root, "widget.scad"),
    `/* [Main] */\n// A demo parameter.\nlabel = "hi";\n`
  );
  // Real, existing files for the two fields gen-schema.mjs unconditionally
  // stats/reads regardless of outPublicDir (copyLogoAssets, copyExtraCss):
  // every OTHER file-backed field (pwa.icon, render.fonts, …) is only ever
  // read when outPublicDir is given, which this sweep never passes.
  const logoAbs = join(FIXTURES, "logo.svg");
  const extraCssAbs = join(FIXTURES, "extra.css");
  const configPath = join(root, "c.config.json");
  const outSchemaDir = join(root, "out", "schema");
  const outScadDir = join(root, "out", "scad");

  // The one baseline every per-field config is cloned from. `source` is
  // deliberately absent: the config file lives directly in `root` (alongside
  // widget.scad), so 'source''s own built-in default ('.') already resolves
  // there. Meaning setting 'source' to null (this sweep's own test of that
  // field) changes nothing about where designs are found either.
  function baseConfig() {
    return {
      designs: [
        {
          id: "widget",
          file: "widget.scad",
          // A shell, not a populated value: only present so
          // 'designs[].presets.images' has an object to navigate into when
          // ITS OWN nullability is under test (see setNull below). Absent
          // otherwise, presets.images stays unset: checkPresetImages treats
          // that exactly like an absent 'presets' object.
          presets: {},
        },
      ],
      // Both real, existing files (copyLogoAssets always stats them,
      // regardless of outPublicDir): 'dark' backs 'logo.light: null' falling
      // back to it (and vice versa) without a crash.
      logo: { light: logoAbs, dark: logoAbs },
      extraCss: extraCssAbs,
      // header/body are popup's only REQUIRED fields: present so every
      // OTHER popup.* field's own null-test still parses a valid popup.
      popup: { header: "Welcome", body: "Inline popup body." },
      // Inline form (not 'noteFile'): populating 'note' means a null
      // 'fileImport.noteFile' test never collides with the "both set" check,
      // since resolveFileField only fires when 'noteFile' is non-null.
      fileImport: { note: "Inline guidance." },
      // Empty-object shells purely so a *nested* field one level down
      // ('ui.afterExport.helpTab', 'viewer.controls.measure', …) has a real
      // object to set a key on, see setNull's own "container" comment.
      // Deliberately WITHOUT a real 'helpTab' value: gen-schema.mjs
      // cross-checks a non-null helpTab against real 'help.tabs[].label's,
      // and this sweep has no reason to also exercise that unrelated check.
      ui: { afterExport: {} },
      viewer: { controls: {} },
      render: { cache: {} },
      pwa: { themeColor: {} },
      colors: { light: {}, dark: {} },
      // marker is notices[]'s only required field. 'label' is a shell (not a
      // real singular/plural pair the test cares about) purely so
      // 'notices[].label.one'/'.other' have a real object to set a key on,
      // see setNull's own "container" comment. 'other' must be a real
      // non-empty string since it's the object form's own required key
      // (independent of the whole 'label' field's optionality), or every
      // OTHER sibling field's null-test here would also trip that
      // requirement.
      notices: [{ marker: "alert", label: { other: "alerts" } }],
      // name/license/copyright/url/licenseUrl are licenses[]'s only required
      // fields; the optional ones (version/text/sourceUrl/note/textFile) are
      // deliberately absent so each one's own null-test is unconfounded.
      licenses: [
        {
          name: "Acme Widget Library",
          license: "MIT",
          copyright: "Copyright (c) 2024 Acme Corp",
          url: "https://example.com/acme",
          licenseUrl: "https://example.com/acme/LICENSE",
        },
      ],
      // `{ sections: [] }`, not `{}`: an empty help block is a modal with
      // nothing in it and gen-schema rejects it (src/lib/helpShape.mjs, shared
      // with the runtime validator). An empty section LIST is well-formed, so
      // this is still just a shell for the nested `help.*` fields below.
      help: { sections: [] },
    };
  }

  // Set the value at `path` (a segment list; "[]" means "index 0 of the
  // array named by the PRECEDING segment") to `null`, mutating `config` in
  // place. Every intermediate container must already exist in `config`:
  // that's baseConfig()'s job (see its own shell comments); a missing one
  // means the baseline needs a new shell, not that this helper should paper
  // over it, so it throws a clear, path-naming error instead of a bare
  // "Cannot set properties of undefined".
  function setNull(config, path) {
    let cur = config;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i] === "[]" ? 0 : path[i];
      const next = cur?.[key];
      if (next === undefined || next === null || typeof next !== "object") {
        throw new Error(
          `config-null-agreement test setup: baseConfig() has no container at ` +
            `'${path.slice(0, i + 1).join(".")}' for path '${path.join(".")}'`
        );
      }
      cur = next;
    }
    const lastKey = path[path.length - 1] === "[]" ? 0 : path[path.length - 1];
    cur[lastKey] = null;
  }

  // Enumerate every settable path in CONFIG_SPEC: one entry per key found in
  // any node's `properties` (at any depth an array's `items` recurses
  // through, marked "[]"), mirroring flattenSpecKeys above but keeping the
  // full path instead of collapsing to a bare name. This is the "walk the
  // spec" the PR review asked for, not a hand-picked sample.
  function walkSpecPaths(spec) {
    const paths = [];
    const walk = (node, path) => {
      if (!node || typeof node !== "object") return;
      if (node.properties) {
        for (const [key, field] of Object.entries(node.properties)) {
          const fieldPath = [...path, key];
          paths.push({ path: fieldPath, field });
          walk(field, fieldPath);
        }
      }
      if (node.items) walk(node.items, [...path, "[]"]);
    };
    walk({ properties: spec }, []);
    return paths;
  }

  // Mirror image of setNull/walkSpecPaths, but over the EMITTED schema
  // rather than the config: does the schema fragment at `path` permit a
  // `null` instance? Transparently looks inside an `anyOf` union (fileImport/
  // logo/pwa.themeColor's primitive-or-object shape, designs[].presets.images's
  // string-or-object one, and (since gen-config-schema.mjs's own addNull)
  // every enum) for whichever branch actually carries `properties`/`items`,
  // since that's the branch a deeper path segment needs to descend into.
  function schemaBranchWith(node, key) {
    if (node?.properties) return node.properties[key];
    if (node?.anyOf) {
      for (const branch of node.anyOf) {
        if (branch.properties && key in branch.properties) return branch.properties[key];
      }
    }
    return undefined;
  }
  function schemaArrayItems(node) {
    if (node?.items) return node.items;
    if (node?.anyOf) {
      for (const branch of node.anyOf) {
        if (branch.items) return branch.items;
      }
    }
    return undefined;
  }
  function navigateSchema(root, path) {
    let cur = root;
    for (const seg of path) {
      cur = seg === "[]" ? schemaArrayItems(cur) : schemaBranchWith(cur, seg);
      if (cur === undefined) return undefined;
    }
    return cur;
  }
  function schemaAllowsNull(node) {
    if (!node) return false;
    if (Array.isArray(node.type) && node.type.includes("null")) return true;
    if (node.anyOf) return node.anyOf.some((b) => b.type === "null");
    return false;
  }

  mkdirSync(outSchemaDir, { recursive: true });
  const freshSchema = buildConfigSchema();
  const paths = walkSpecPaths(CONFIG_SPEC);
  assert.ok(paths.length > 50, `expected many CONFIG_SPEC paths, found ${paths.length}`);

  const mismatches = [];
  for (const { path } of paths) {
    const dotted = path.join(".");
    const schemaNode = navigateSchema(freshSchema, path);
    const schemaNullable = schemaAllowsNull(schemaNode);

    const config = baseConfig();
    setNull(config, path);
    writeFileSync(configPath, JSON.stringify(config));
    let parserAccepted = true;
    let errorMessage = "";
    try {
      generate({ configPath, outSchemaDir, outScadDir });
    } catch (err) {
      parserAccepted = false;
      errorMessage = err.message;
    }

    if (schemaNullable !== parserAccepted) {
      mismatches.push(
        `'${dotted}': schema ${schemaNullable ? "permits" : "does NOT permit"} null, but the real ` +
          `parser ${parserAccepted ? "accepted" : "rejected"} an explicit null` +
          (errorMessage ? ` (${errorMessage})` : "")
      );
    }
  }

  rmSync(root, { recursive: true, force: true });

  assert.deepEqual(
    mismatches,
    [],
    "emitted schema nullability disagrees with the real parser for the field(s) above — " +
      "either the field's config-spec.mjs node needs 'required' (or not), " +
      "or its own parser needs to genuinely accept/reject null to match"
  );
});

test("Node floor metadata is internally consistent", () => {
  // METADATA only: that package.json, the lockfile and the docs agree, and that
  // the number they agree on is at least the 22.18 type-stripping floor. Whether
  // the toolchain still RUNS there is a different question and a different
  // gate — see the `min-node` job in .github/workflows/ci.yml, which executes
  // the unit suite and the build on exactly 22.18.0.
  // The build and the test suite both import TypeScript directly, and type
  // stripping is unflagged only from 22.18.0 — below it the import fails with
  // ERR_UNKNOWN_FILE_EXTENSION. "Node >= 22" was stated in two places and was
  // wrong in both, which nothing caught because CI happens to run a newer 22.x.
  const read = (p) => readFileSync(join(ROOT, p), "utf-8");
  const engines = JSON.parse(read("package.json")).engines?.node;
  assert.ok(engines, "package.json must declare an engines.node range");
  const floor = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(engines);
  assert.ok(floor, `engines.node should be a '>=x.y.z' floor (got ${engines})`);
  const [, major, minor] = floor.map(Number);
  assert.ok(
    major > 22 || (major === 22 && minor >= 18),
    `${engines} is below the 22.18 type-stripping floor`
  );
  // The lockfile carries it too, or `npm ci` on an old Node installs happily
  // and fails at the first `.ts` import instead of at install time.
  const locked = JSON.parse(read("package-lock.json")).packages?.[""]?.engines?.node;
  assert.equal(locked, engines, "package-lock.json's root engines must match package.json's");
  // And the prose agrees, so a contributor reading either one is not misled.
  for (const doc of ["README.md", "CLAUDE.md"]) {
    const stated = [...read(doc).matchAll(/Node\s*(?:>=|≥)\s*(\d+)(?:\.(\d+))?/g)];
    assert.ok(stated.length > 0, `${doc} should state the Node requirement`);
    for (const [text, maj, min] of stated)
      assert.ok(
        Number(maj) > 22 || (Number(maj) === 22 && Number(min ?? 0) >= 18),
        `${doc} says "${text}", below the ${engines} floor`
      );
  }
});
