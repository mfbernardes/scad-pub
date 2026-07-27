// gen-config-schema.mjs — emits a real JSON Schema (draft 2020-12) for
// scadpub.config.json, generated from scripts/lib/config-spec.mjs so the
// schema can never drift from what gen-schema.mjs itself accepts: a key
// config-spec.mjs doesn't know about can't appear here, and a key added here
// by hand (rather than in config-spec.mjs) is impossible, since this file has
// no data of its own to add it with. Wired into the same predev/prebuild/
// pretest hooks as gen-schema.mjs (see package.json's "gen" script) —
// regenerating on every build is fine, but the output,
// scadpub.config.schema.json at the repo root, is committed, and
// tests/config-spec.test.mjs fails the build if it's stale.
//
// This is intentionally NOT a precise JSON Schema for every corner of the
// config. The handful of top-level keys that carry real bespoke validation
// logic (colors, licenses, notices, strings, help, designs, categories,
// screenshots, shortcuts — see config-spec.mjs's `custom` marker) get a
// best-effort structural schema from whatever `properties`/`items` shape is
// registered for them there, which is looser than what gen-schema.mjs
// actually enforces (it can't express "a `reviewLabels` key must name a real
// declared parameter" or "a `strings` key must be in the i18n catalogue" —
// those are cross-field/file-I/O checks, not shape, and config-spec.mjs
// deliberately doesn't own them either — see its file-top comment). The goal
// here is editor autocomplete and typo-catching for the config author, not a
// drop-in replacement for gen-schema's own validation.
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { CONFIG_SPEC } from "./lib/config-spec.mjs";

const PRIMITIVE_TYPES = new Set(["string", "boolean", "number", "integer"]);

// The `{ type: "object", properties, additionalProperties, required }` shape
// shared by every object-typed node: the top-level config itself, `ui`,
// `viewer`, `render`, `render.cache`, `popup`, `ui.afterExport`, and the
// best-effort shapes for the bespoke/`custom` array-of-object and
// object-of-object keys (colors, designs[], notices[], licenses[]).
function objectSchema(node) {
  const properties = {};
  const required = [];
  for (const [key, field] of Object.entries(node.properties)) {
    properties[key] = nodeToSchema(field);
    if (field.required) required.push(key);
  }
  const schema = { type: "object", properties };
  if (required.length) schema.required = required;
  // Every node `applyGroupSpec` drives (the top-level config itself, `ui`,
  // `viewer`, `render`, `render.cache`, `popup`, the object form of
  // `fileImport`, `ui.afterExport`) is genuinely closed at runtime now — an
  // unrecognised key always fails the build. The bespoke/`custom` shapes
  // (`colors`, `designs[]`, `notices[]`, `licenses[]`, …) are the only ones
  // that still silently tolerate or drop an unrecognised key (see
  // config-spec.mjs's file-top comment and config-parsers.mjs's
  // parseColors/parseLicenses/parseNotices), so only those stay open here.
  schema.additionalProperties = !!node.custom;
  return schema;
}

// Turn one config-spec.mjs node (a top-level key, or a nested field) into a
// JSON Schema fragment. A node with BOTH a primitive `type` and a
// `properties` map (`fileImport`: boolean | options object; `logo`: string |
// { light, dark }) becomes an `anyOf` of the primitive form and the object
// form — the two shapes config-parsers.mjs's own runtime shortcuts accept.
function nodeToSchema(node) {
  const base = {};
  if (node.description) base.description = node.description;
  if ("default" in node) base.default = node.default;

  if (node.type === "enum") return { ...base, type: "string", enum: node.values };

  if (node.type === "array")
    return { ...base, type: "array", items: node.items ? nodeToSchema(node.items) : {} };

  const hasProperties = node.properties && typeof node.properties === "object";

  if (PRIMITIVE_TYPES.has(node.type) && hasProperties)
    return { ...base, anyOf: [{ type: node.type }, objectSchema(node)] };

  if (node.type === "object")
    return hasProperties ? { ...base, ...objectSchema(node) } : { ...base, type: "object" };

  return { ...base, type: node.type };
}

// Exported so tests/config-spec.test.mjs can regenerate in-memory and
// deep-compare against the committed file, without shelling out.
export function buildConfigSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "ScadPub configuration",
    description:
      "scadpub.config.json. Generated from scripts/lib/config-spec.mjs by scripts/gen-config-schema.mjs " +
      "— see docs/config.md for the full human reference.",
    ...objectSchema({ properties: CONFIG_SPEC }),
  };
}

function main() {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const outPath = join(HERE, "..", "scadpub.config.schema.json");
  writeFileSync(outPath, JSON.stringify(buildConfigSchema(), null, 2) + "\n");
  console.log(`gen-config-schema: wrote ${outPath}`);
}

// Run only when executed directly (not when imported by the tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
